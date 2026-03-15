import { TekimaxPlugin, PluginContext, ChatResult, StreamChunk } from '../core/types';

const SENSITIVE_KEYS = /api.?key|secret|token|password|auth|credential|bearer/i;

function sanitizeForLog(obj: unknown): unknown {
    if (typeof obj !== 'object' || obj === null) return obj;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        out[k] = SENSITIVE_KEYS.test(k) ? '[REDACTED]' : v;
    }
    return out;
}

/**
 * Telemetry: basic Logger Plugin
 * Logs payloads, streaming chunks, and tool execution boundaries.
 */
export class LoggerPlugin implements TekimaxPlugin {
    name = 'LoggerPlugin';

    onInit() {
        console.log('[LoggerPlugin] Tekimax SDK initialized with Logger Plugin active.');
    }

    async beforeRequest(context: PluginContext) {
        console.log(`[LoggerPlugin] Sending request to model: ${context.model} (${context.messages.length} messages)`);
    }

    async afterResponse(context: PluginContext, result: ChatResult) {
        console.log(`[LoggerPlugin] Received completion from ${context.model}. Usage:`, result.usage);
    }

    onStreamChunk(context: PluginContext, chunk: StreamChunk) {
        if (chunk.usage) {
            console.log(`[LoggerPlugin] Stream completed. Final usage:`, chunk.usage);
        }
    }

    async beforeToolExecute(toolName: string, args: unknown) {
        // Sanitize args — mask any key that looks like a credential before logging
        const sanitized = sanitizeForLog(args);
        console.log(`[LoggerPlugin] Executing tool '${toolName}' with args:`, sanitized);
    }

    async afterToolExecute(toolName: string, result: unknown) {
        console.log(`[LoggerPlugin] Tool '${toolName}' returned successfully.`);
    }
}
