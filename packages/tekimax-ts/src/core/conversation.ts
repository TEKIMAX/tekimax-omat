import type { Message, ChatOptions, ChatResult, StreamChunk } from './types'
import type { AIProvider } from './adapter'
import type { TekimaxPlugin, PluginContext } from './types'

export interface ConversationOptions {
    model: string
    system?: string
    temperature?: number
    maxTokens?: number
    plugins?: TekimaxPlugin[]
}

/**
 * Conversation — stateful multi-turn chat manager.
 *
 * Maintains the full message history automatically. Each call to `send()`
 * appends the user message, gets the assistant response, appends that too,
 * and returns the result — so the next `send()` has the full context.
 *
 * @example
 * ```ts
 * const convo = new Conversation(provider, {
 *   model: 'gpt-4o',
 *   system: 'You are a helpful assistant.',
 * })
 *
 * const r1 = await convo.send('What is 2 + 2?')
 * console.log(r1.message.content) // "4"
 *
 * const r2 = await convo.send('Multiply that by 3')
 * console.log(r2.message.content) // "12"
 *
 * console.log(convo.history) // all messages so far
 * convo.clear() // reset history (keeps system prompt)
 * ```
 */
export class Conversation {
    private _history: Message[] = []
    private opts: Required<Pick<ConversationOptions, 'model'>> & ConversationOptions
    private plugins: TekimaxPlugin[]

    constructor(
        private provider: AIProvider,
        options: ConversationOptions,
    ) {
        this.opts = options
        this.plugins = options.plugins ?? []

        if (options.system) {
            this._history.push({ role: 'system', content: options.system })
        }
    }

    /** Full message history including system prompt. */
    get history(): ReadonlyArray<Message> {
        return this._history
    }

    /** Number of non-system turns (user + assistant pairs). */
    get turnCount(): number {
        return this._history.filter(m => m.role === 'user').length
    }

    /**
     * Send a user message and get the assistant response.
     * The exchange is automatically appended to history.
     */
    async send(userMessage: string | Message['content']): Promise<ChatResult> {
        const userMsg: Message = {
            role: 'user',
            content: typeof userMessage === 'string' ? userMessage : userMessage,
        }
        this._history.push(userMsg)

        const chatOptions: ChatOptions = {
            model: this.opts.model,
            messages: [...this._history],
            temperature: this.opts.temperature,
            maxTokens: this.opts.maxTokens,
        }

        // Run plugin beforeRequest
        let context: PluginContext = {
            model: chatOptions.model,
            messages: chatOptions.messages,
            timestamp: Date.now(),
            requestOptions: {},
        }
        for (const plugin of this.plugins) {
            if (plugin.beforeRequest) {
                const updated = await plugin.beforeRequest(context)
                if (updated) context = updated
            }
        }
        chatOptions.messages = context.messages

        const result = await this.provider.chat(chatOptions)

        // Run plugin afterResponse
        for (const plugin of this.plugins) {
            if (plugin.afterResponse) await plugin.afterResponse(context, result)
        }

        // Append assistant response to real history (not the plugin-modified copy)
        this._history.push(result.message)

        return result
    }

    /**
     * Stream a user message response.
     * The complete assistant message is assembled from chunks and appended to history.
     */
    async *stream(userMessage: string | Message['content']): AsyncGenerator<StreamChunk> {
        const userMsg: Message = {
            role: 'user',
            content: typeof userMessage === 'string' ? userMessage : userMessage,
        }
        this._history.push(userMsg)

        const chatOptions: ChatOptions = {
            model: this.opts.model,
            messages: [...this._history],
            temperature: this.opts.temperature,
            maxTokens: this.opts.maxTokens,
        }

        let context: PluginContext = {
            model: chatOptions.model,
            messages: chatOptions.messages,
            timestamp: Date.now(),
            requestOptions: {},
        }
        for (const plugin of this.plugins) {
            if (plugin.beforeRequest) {
                const updated = await plugin.beforeRequest(context)
                if (updated) context = updated
            }
        }
        chatOptions.messages = context.messages

        let assembled = ''
        for await (const chunk of this.provider.chatStream(chatOptions)) {
            assembled += chunk.delta
            for (const plugin of this.plugins) {
                if (plugin.onStreamChunk) plugin.onStreamChunk(context, chunk)
            }
            yield chunk
        }

        // Append assembled response to history
        this._history.push({ role: 'assistant', content: assembled })
    }

    /**
     * Inject an assistant message directly into history without sending to the model.
     * Useful for seeding context or replaying prior exchanges.
     */
    inject(message: Message): void {
        this._history.push(message)
    }

    /**
     * Clear all messages from history.
     * If a system prompt was provided at construction, it is kept.
     */
    clear(): void {
        if (this.opts.system) {
            this._history = [{ role: 'system', content: this.opts.system }]
        } else {
            this._history = []
        }
    }

    /**
     * Replace history with a snapshot (e.g. loaded from a database).
     */
    restore(messages: Message[]): void {
        this._history = [...messages]
    }

    /**
     * Export history as a plain array for serialization / storage.
     */
    export(): Message[] {
        return [...this._history]
    }
}
