import { TekimaxPlugin, PluginContext, ContentPart } from '../core/types';

/**
 * Security: PII Filter Plugin
 * Redacts sensitive patterns from messages before they are sent to the provider.
 * Handles both plain string content and multi-part ContentPart[] arrays.
 */
export class PIIFilterPlugin implements TekimaxPlugin {
    name = 'PIIFilterPlugin';

    // Patterns are compiled once and reused (reset lastIndex each call via /g + exec loop)
    private readonly patterns: ReadonlyArray<{ pattern: RegExp; label: string }> = [
        { pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,  label: 'EMAIL' },
        { pattern: /\b\d{3}-\d{2}-\d{4}\b/g,                             label: 'SSN' },
        // Linear pattern — avoids nested quantifier ReDoS on long numeric strings
        { pattern: /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{1,4}\b/g,        label: 'CARD' },
        // Fixed separators — no optional group repetition
        { pattern: /\b\d{3}[-.]\d{3}[-.]\d{4}\b|\b\d{3}\s\d{3}\s\d{4}\b/g, label: 'PHONE' },
    ];

    private redact(text: string): string {
        let result = text;
        for (const { pattern, label } of this.patterns) {
            // Reset lastIndex before each use of a global regex
            pattern.lastIndex = 0;
            result = result.replace(pattern, `[REDACTED ${label}]`);
        }
        return result;
    }

    private redactParts(parts: Array<ContentPart>): Array<ContentPart> {
        return parts.map(part => {
            if (part.type === 'text') {
                return { ...part, text: this.redact(part.text) };
            }
            return part;
        });
    }

    async beforeRequest(context: PluginContext): Promise<PluginContext | void> {
        context.messages = context.messages.map(msg => {
            if (typeof msg.content === 'string') {
                return { ...msg, content: this.redact(msg.content) };
            }
            if (Array.isArray(msg.content)) {
                return { ...msg, content: this.redactParts(msg.content) };
            }
            return msg;
        });
        return context;
    }
}
