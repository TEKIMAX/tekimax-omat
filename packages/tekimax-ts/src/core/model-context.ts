/**
 * Model context window registry.
 *
 * Static fallback values sourced from OpenRouter's model catalog
 * (`https://openrouter.ai/api/v1/models` → `context_length`).
 *
 * At runtime, callers can call `fetchModelContextWindow()` to get a live
 * value directly from OpenRouter — this overrides the static table.
 */

export interface ModelContextInfo {
    /** Max context window in tokens (input + output combined) */
    contextLength: number
    /** Max output tokens (where known) */
    maxOutputTokens?: number
}

/** Static registry of common models and their context window sizes. */
const MODEL_CONTEXT_REGISTRY: Record<string, ModelContextInfo> = {
    // --- OpenAI ---
    'gpt-4o':                          { contextLength: 128_000, maxOutputTokens: 16_384 },
    'gpt-4o-mini':                     { contextLength: 128_000, maxOutputTokens: 16_384 },
    'gpt-4-turbo':                     { contextLength: 128_000, maxOutputTokens: 4_096 },
    'gpt-4-turbo-preview':             { contextLength: 128_000, maxOutputTokens: 4_096 },
    'gpt-4':                           { contextLength: 8_192,   maxOutputTokens: 4_096 },
    'gpt-4-32k':                       { contextLength: 32_768,  maxOutputTokens: 4_096 },
    'gpt-3.5-turbo':                   { contextLength: 16_385,  maxOutputTokens: 4_096 },
    'gpt-3.5-turbo-16k':               { contextLength: 16_385,  maxOutputTokens: 4_096 },
    'o1':                              { contextLength: 200_000, maxOutputTokens: 100_000 },
    'o1-mini':                         { contextLength: 128_000, maxOutputTokens: 65_536 },
    'o1-preview':                      { contextLength: 128_000, maxOutputTokens: 32_768 },
    'o3':                              { contextLength: 200_000, maxOutputTokens: 100_000 },
    'o3-mini':                         { contextLength: 200_000, maxOutputTokens: 100_000 },
    'o4-mini':                         { contextLength: 200_000, maxOutputTokens: 100_000 },

    // --- Anthropic / Claude ---
    'claude-3-5-sonnet-20241022':      { contextLength: 200_000, maxOutputTokens: 8_192 },
    'claude-3-5-haiku-20241022':       { contextLength: 200_000, maxOutputTokens: 8_192 },
    'claude-3-opus-20240229':          { contextLength: 200_000, maxOutputTokens: 4_096 },
    'claude-3-sonnet-20240229':        { contextLength: 200_000, maxOutputTokens: 4_096 },
    'claude-3-haiku-20240307':         { contextLength: 200_000, maxOutputTokens: 4_096 },
    'claude-sonnet-4-6':               { contextLength: 200_000, maxOutputTokens: 64_000 },
    'claude-opus-4-6':                 { contextLength: 200_000, maxOutputTokens: 32_000 },
    'claude-haiku-4-5-20251001':       { contextLength: 200_000, maxOutputTokens: 16_384 },
    // OpenRouter aliases
    'anthropic/claude-3-5-sonnet':     { contextLength: 200_000, maxOutputTokens: 8_192 },
    'anthropic/claude-3-opus':         { contextLength: 200_000, maxOutputTokens: 4_096 },
    'anthropic/claude-3-haiku':        { contextLength: 200_000, maxOutputTokens: 4_096 },

    // --- Google ---
    'gemini-1.5-pro':                  { contextLength: 1_048_576, maxOutputTokens: 8_192 },
    'gemini-1.5-flash':                { contextLength: 1_048_576, maxOutputTokens: 8_192 },
    'gemini-1.5-flash-8b':             { contextLength: 1_048_576, maxOutputTokens: 8_192 },
    'gemini-2.0-flash':                { contextLength: 1_048_576, maxOutputTokens: 8_192 },
    'gemini-2.5-pro':                  { contextLength: 1_048_576, maxOutputTokens: 65_536 },
    'google/gemini-pro-1.5':           { contextLength: 1_048_576, maxOutputTokens: 8_192 },
    'google/gemini-flash-1.5':         { contextLength: 1_048_576, maxOutputTokens: 8_192 },
    'google/gemini-2.0-flash-001':     { contextLength: 1_048_576, maxOutputTokens: 8_192 },

    // --- Meta / Llama ---
    'meta-llama/llama-3.1-8b-instruct':   { contextLength: 131_072 },
    'meta-llama/llama-3.1-70b-instruct':  { contextLength: 131_072 },
    'meta-llama/llama-3.1-405b-instruct': { contextLength: 131_072 },
    'meta-llama/llama-3.2-1b-instruct':   { contextLength: 131_072 },
    'meta-llama/llama-3.2-3b-instruct':   { contextLength: 131_072 },
    'meta-llama/llama-3.3-70b-instruct':  { contextLength: 131_072 },

    // --- Mistral ---
    'mistralai/mistral-7b-instruct':      { contextLength: 32_768 },
    'mistralai/mixtral-8x7b-instruct':    { contextLength: 32_768 },
    'mistralai/mistral-large':            { contextLength: 128_000 },
    'mistralai/mistral-medium':           { contextLength: 32_768 },
    'mistralai/mistral-small':            { contextLength: 32_768 },
    'mistralai/codestral-mamba':          { contextLength: 256_000 },

    // --- DeepSeek ---
    'deepseek/deepseek-chat':            { contextLength: 64_000, maxOutputTokens: 8_192 },
    'deepseek/deepseek-r1':              { contextLength: 64_000, maxOutputTokens: 8_000 },
    'deepseek/deepseek-coder':           { contextLength: 16_000 },

    // --- Qwen ---
    'qwen/qwen-2.5-72b-instruct':        { contextLength: 131_072 },
    'qwen/qwen-2.5-7b-instruct':         { contextLength: 131_072 },
    'qwen/qwq-32b':                      { contextLength: 131_072 },

    // --- Cohere ---
    'cohere/command-r-plus':             { contextLength: 128_000 },
    'cohere/command-r':                  { contextLength: 128_000 },

    // --- Together / Perplexity ---
    'perplexity/llama-3.1-sonar-large-128k-online': { contextLength: 127_072 },
    'perplexity/llama-3.1-sonar-small-128k-online': { contextLength: 127_072 },
}

/** Default context window when a model is unknown (safe conservative value). */
const DEFAULT_CONTEXT_LENGTH = 8_192

/**
 * Look up the context window for a model from the static registry.
 * Returns `DEFAULT_CONTEXT_LENGTH` if the model is not found.
 */
export function getModelContextInfo(modelId: string): ModelContextInfo {
    // Exact match
    if (MODEL_CONTEXT_REGISTRY[modelId]) {
        return MODEL_CONTEXT_REGISTRY[modelId]
    }
    // Prefix match — handles versioned IDs like "gpt-4o-2024-11-20"
    for (const [key, info] of Object.entries(MODEL_CONTEXT_REGISTRY)) {
        if (modelId.startsWith(key) || key.startsWith(modelId)) {
            return info
        }
    }
    return { contextLength: DEFAULT_CONTEXT_LENGTH }
}

/** OpenRouter model response shape (partial). */
interface OpenRouterModelEntry {
    id: string
    context_length: number
    top_provider?: { max_completion_tokens?: number }
}

/** In-process cache: modelId → contextInfo */
const _liveCache = new Map<string, ModelContextInfo>()

/**
 * Fetch real-time context window info from OpenRouter's model catalog.
 *
 * Results are cached in memory for the lifetime of the process.
 * Falls back to the static registry (then default) if the fetch fails.
 *
 * @param modelId   The model identifier to look up.
 * @param apiKey    Optional OpenRouter API key (not required for the public endpoint).
 */
export async function fetchModelContextWindow(
    modelId: string,
    apiKey?: string
): Promise<ModelContextInfo> {
    if (_liveCache.has(modelId)) {
        return _liveCache.get(modelId)!
    }

    try {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        }
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`

        const res = await fetch('https://openrouter.ai/api/v1/models', { headers })
        if (!res.ok) throw new Error(`OpenRouter models API returned ${res.status}`)

        const body = await res.json() as { data: OpenRouterModelEntry[] }

        // Populate full cache from single fetch
        for (const entry of body.data ?? []) {
            const info: ModelContextInfo = {
                contextLength: entry.context_length,
                maxOutputTokens: entry.top_provider?.max_completion_tokens,
            }
            _liveCache.set(entry.id, info)
        }

        if (_liveCache.has(modelId)) {
            return _liveCache.get(modelId)!
        }
    } catch {
        // Silent fallback — don't crash on network errors
    }

    // Fall back to static registry
    return getModelContextInfo(modelId)
}

/**
 * Register a custom model into the static registry.
 * Useful for private deployments or fine-tuned models not in OpenRouter.
 */
export function registerModelContext(modelId: string, info: ModelContextInfo): void {
    MODEL_CONTEXT_REGISTRY[modelId] = info
}
