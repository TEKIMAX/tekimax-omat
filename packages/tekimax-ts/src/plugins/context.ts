import { TekimaxPlugin, PluginContext, Message } from '../core/types';
import { getModelContextInfo, fetchModelContextWindow } from '../core/model-context';

// ─── Token Estimation ─────────────────────────────────────────────────────────

/**
 * Estimate tokens for a single message using the chars/4 heuristic.
 * Accounts for role overhead (~4 tokens) and content character count.
 */
function estimateMessageTokens(msg: Message): number {
    const roleOverhead = 4
    if (!msg.content) return roleOverhead
    if (typeof msg.content === 'string') {
        return roleOverhead + Math.ceil(msg.content.length / 4)
    }
    // Multi-part content (text + images)
    let chars = 0
    for (const part of msg.content) {
        if (part.type === 'text') chars += part.text.length
        else if (part.type === 'image_url') chars += 1_024 // ~1K token est. per image
    }
    return roleOverhead + Math.ceil(chars / 4)
}

function estimateTotalTokens(messages: Message[]): number {
    return messages.reduce((sum, m) => sum + estimateMessageTokens(m), 0)
}

// ─── Stripe Metering ──────────────────────────────────────────────────────────

export interface StripeMeteringConfig {
    /** Stripe secret key */
    secretKey: string
    /** Stripe customer ID to attribute usage to */
    customerId: string
    /**
     * The meter event name configured in Stripe Billing.
     * Must match the `event_name` on your Stripe meter.
     * Defaults to `convex_ai_tokens_overage`.
     */
    eventName?: string
}

async function reportTokensToStripe(
    config: StripeMeteringConfig,
    tokens: number
): Promise<void> {
    const eventName = config.eventName ?? 'convex_ai_tokens_overage'
    const body = new URLSearchParams({
        'event_name': eventName,
        'payload[stripe_customer_id]': config.customerId,
        'payload[value]': String(tokens),
        'timestamp': String(Math.floor(Date.now() / 1000)),
    })

    const res = await fetch('https://api.stripe.com/v1/billing/meter_events', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${config.secretKey}`,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
    })

    if (!res.ok) {
        const err = await res.text().catch(() => res.status.toString())
        console.warn(`[TokenAwareContextPlugin] Stripe metering report failed: ${err}`)
    }
}

// ─── Plugin Config ────────────────────────────────────────────────────────────

export interface TokenAwareContextConfig {
    /**
     * How to truncate when the context window is exceeded.
     * - `'auto'`          — Automatically drop oldest non-system messages (default).
     * - `'last_messages'` — Keep only the most recent messages that fit.
     * - `'disabled'`      — No truncation; emit a warning and pass through.
     */
    truncationStrategy?: 'auto' | 'last_messages' | 'disabled'

    /**
     * Reserve this many tokens for the model's output response.
     * If not set, falls back to the model's known `maxOutputTokens`, then 4_096.
     */
    reserveOutputTokens?: number

    /**
     * Fraction of the context window to use (0–1, default 0.9).
     * Leaves a safety margin — e.g. 0.9 means use up to 90% of the window.
     */
    contextUsageFraction?: number

    /**
     * Optional OpenRouter API key used to fetch live context window sizes.
     * If not provided, the static registry is used.
     */
    openrouterApiKey?: string

    /**
     * Optional Stripe metering configuration.
     * When provided (and `enabled` is true), estimated prompt tokens are
     * reported to Stripe Billing after each request.
     *
     * Disabled by default — set `enabled: true` to activate.
     */
    stripeMetering?: StripeMeteringConfig & { enabled?: boolean }
}

// ─── Main Plugin ──────────────────────────────────────────────────────────────

/**
 * TokenAwareContextPlugin
 *
 * Replaces the old message-count–based `MaxContextOverflowPlugin` with a
 * fully token-aware, model-dynamic implementation.
 *
 * Key behaviours:
 * - Reads the model's real context window (static registry → live OpenRouter fetch).
 * - Estimates tokens with a chars/4 heuristic (no external tokeniser needed).
 * - Trims the oldest non-system messages until the conversation fits.
 * - Respects `truncationStrategy`: `auto`, `last_messages`, or `disabled`.
 * - If the model has a 1M token window, allows up to 1M tokens before trimming.
 * - Optionally reports estimated prompt tokens to Stripe Billing (opt-in, off by default).
 * - Exposes `contextWindowTokensUsed` / `contextWindowTokensRemaining` on
 *   `requestOptions` for downstream observability (OpenResponses spec).
 */
export class TokenAwareContextPlugin implements TekimaxPlugin {
    name = 'TokenAwareContextPlugin'

    private cfg: Required<Pick<TokenAwareContextConfig, 'truncationStrategy' | 'contextUsageFraction'>>
        & Omit<TokenAwareContextConfig, 'truncationStrategy' | 'contextUsageFraction'>

    constructor(config: TokenAwareContextConfig = {}) {
        const fraction = config.contextUsageFraction ?? 0.9
        if (fraction <= 0 || fraction > 1) {
            throw new RangeError(
                `TokenAwareContextPlugin: contextUsageFraction must be between 0 (exclusive) and 1 (inclusive), got ${fraction}`
            )
        }
        this.cfg = {
            truncationStrategy: config.truncationStrategy ?? 'auto',
            contextUsageFraction: fraction,
            reserveOutputTokens: config.reserveOutputTokens,
            openrouterApiKey: config.openrouterApiKey,
            stripeMetering: config.stripeMetering,
        }
    }

    async beforeRequest(context: PluginContext): Promise<PluginContext | void> {
        // 1. Resolve context window for the requested model
        const modelInfo = this.cfg.openrouterApiKey
            ? await fetchModelContextWindow(context.model, this.cfg.openrouterApiKey)
            : getModelContextInfo(context.model)

        const reserveOutput = this.cfg.reserveOutputTokens
            ?? modelInfo.maxOutputTokens
            ?? 4_096

        // Guard: reserveOutput must not exceed contextLength
        const safeReserve = Math.min(reserveOutput, Math.floor(modelInfo.contextLength * 0.5))
        const usableTokens = Math.max(
            1,
            Math.floor((modelInfo.contextLength - safeReserve) * this.cfg.contextUsageFraction)
        )

        // 2. Estimate current token usage
        let currentTokens = estimateTotalTokens(context.messages)

        // 3. Truncate if needed
        if (currentTokens > usableTokens) {
            if (this.cfg.truncationStrategy === 'disabled') {
                console.warn(
                    `[TokenAwareContextPlugin] Context overflow: ~${currentTokens} tokens exceeds ` +
                    `usable budget of ${usableTokens} (model "${context.model}" window: ` +
                    `${modelInfo.contextLength}). Truncation is disabled — passing through.`
                )
            } else {
                context.messages = this.truncate(
                    context.messages,
                    usableTokens,
                    currentTokens,
                    context.model,
                    modelInfo.contextLength
                )
                currentTokens = estimateTotalTokens(context.messages)
            }
        }

        // 4. Attach usage metadata (OpenResponses spec: context_window_tokens_used/remaining)
        context.requestOptions = {
            ...context.requestOptions,
            contextWindowTokensUsed: currentTokens,
            contextWindowTokensRemaining: Math.max(0, modelInfo.contextLength - currentTokens),
            contextWindowSize: modelInfo.contextLength,
        }

        // 5. Optional Stripe metering (off by default)
        const stripe = this.cfg.stripeMetering
        if (stripe?.enabled) {
            reportTokensToStripe(stripe, currentTokens).catch((err: unknown) => {
                // Non-blocking — never fail the request because of metering
                console.warn('[TokenAwareContextPlugin] Stripe metering fire-and-forget failed:', err)
            })
        }

        return context
    }

    private truncate(
        messages: Message[],
        usableTokens: number,
        currentTokens: number,
        model: string,
        contextLength: number
    ): Message[] {
        const hasSystem = messages[0]?.role === 'system'
        const systemMsg = hasSystem ? messages[0] : null
        const rest = hasSystem ? messages.slice(1) : [...messages]

        if (this.cfg.truncationStrategy === 'last_messages') {
            // Greedy fill from newest to oldest — skip any single message that is
            // too large on its own rather than stopping at the first one that doesn't fit.
            const kept: Message[] = []
            let budget = usableTokens - (systemMsg ? estimateMessageTokens(systemMsg) : 0)
            for (let i = rest.length - 1; i >= 0; i--) {
                const msg = rest[i]!
                const t = estimateMessageTokens(msg)
                if (budget - t >= 0) {
                    kept.unshift(msg)
                    budget -= t
                }
                // If a single message is larger than the remaining budget, skip it
                // and continue scanning older messages that might be smaller.
            }
            const result = systemMsg ? [systemMsg, ...kept] : kept
            const dropped = messages.length - result.length
            if (dropped > 0) {
                console.warn(
                    `[TokenAwareContextPlugin] Truncated ${dropped} message(s) ` +
                    `(~${currentTokens} → ~${estimateTotalTokens(result)} tokens, ` +
                    `model "${model}" window: ${contextLength}).`
                )
            }
            return result
        }

        // 'auto' — drop oldest non-system messages one at a time
        const mutable = [...rest]
        let tokens = currentTokens
        while (tokens > usableTokens && mutable.length > 0) {
            const removed = mutable.shift()!
            tokens -= estimateMessageTokens(removed)
        }

        const result = systemMsg ? [systemMsg, ...mutable] : mutable
        const dropped = messages.length - result.length
        if (dropped > 0) {
            console.warn(
                `[TokenAwareContextPlugin] Truncated ${dropped} message(s) ` +
                `(~${currentTokens} → ~${tokens} tokens, ` +
                `model "${model}" window: ${contextLength}).`
            )
        }
        return result
    }
}

// ─── Back-compat alias ────────────────────────────────────────────────────────

/**
 * @deprecated Use `TokenAwareContextPlugin` instead.
 * This alias keeps existing code working during migration.
 */
export class MaxContextOverflowPlugin extends TokenAwareContextPlugin {
    name = 'MaxContextOverflowPlugin'

    /** @param maxMessages Ignored — kept for API compatibility only. */
    constructor(_maxMessages?: number) {
        super({ truncationStrategy: 'auto' })
    }
}
