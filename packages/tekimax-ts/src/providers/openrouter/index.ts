import OpenAI from 'openai'
import type {
    AIProvider,
    ChatOptions,
    ChatResult,
    Message,
    StreamChunk,
    ToolDefinition,
    ToolCall,
    ImageAnalysisOptions,
    ImageAnalysisResult,
    VisionCapability,
} from '../../core'

// OpenRouter uses OpenAI-compatible API with vision passthrough
export class OpenRouterProvider implements AIProvider, VisionCapability {
    name = 'openrouter'
    private client: OpenAI

    constructor(options: { apiKey: string }) {
        this.client = new OpenAI({
            apiKey: options.apiKey,
            baseURL: 'https://openrouter.ai/api/v1',
            defaultHeaders: {
                'HTTP-Referer': 'https://tekimax.com', // Required by OpenRouter
                'X-Title': 'Tekimax SDK'
            }
        })
    }

    async analyzeImage(options: ImageAnalysisOptions): Promise<ImageAnalysisResult> {
        // OpenRouter passes image_url content to the underlying vision model (GPT-4o, Claude, Gemini, etc.)
        const imageUrl = options.image instanceof Buffer
            ? `data:image/png;base64,${options.image.toString('base64')}`
            : options.image as string

        const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
            ...(options.messages ? this.mapMessages(options.messages) : []),
            {
                role: 'user',
                content: [
                    { type: 'text', text: options.prompt || 'Describe this image' },
                    { type: 'image_url', image_url: { url: imageUrl } },
                ],
            },
        ]

        const response = await this.client.chat.completions.create({
            model: options.model,
            messages,
            max_tokens: 1_024,
        })

        const choice = response.choices[0]
        if (!choice) throw new Error('No choice returned from OpenRouter vision request')

        return {
            content: choice.message.content || '',
            usage: response.usage ? {
                inputTokens: response.usage.prompt_tokens,
                outputTokens: response.usage.completion_tokens,
                totalTokens: response.usage.total_tokens,
            } : undefined,
        }
    }

    async chat(options: ChatOptions): Promise<ChatResult> {
        const response = await this.client.chat.completions.create({
            model: options.model,
            messages: this.mapMessages(options.messages),
            tools: options.tools?.map(this.mapTool),
            temperature: options.temperature,
            max_tokens: options.maxTokens,
            response_format: options.responseFormat ? { type: options.responseFormat.type } : undefined,
        })

        const choice = response.choices[0]
        if (!choice) throw new Error('No choice returned from OpenRouter')

        return {
            usage: response.usage ? {
                promptTokens: response.usage.prompt_tokens,
                completionTokens: response.usage.completion_tokens,
                totalTokens: response.usage.total_tokens
            } : undefined,
            message: this.mapResponseMessage(choice.message)
        }
    }

    async *chatStream(options: ChatOptions): AsyncIterable<StreamChunk> {
        const stream = await this.client.chat.completions.create({
            model: options.model,
            messages: this.mapMessages(options.messages),
            tools: options.tools?.map(this.mapTool),
            temperature: options.temperature,
            max_tokens: options.maxTokens,
            stream: true,
            response_format: options.responseFormat ? { type: options.responseFormat.type } : undefined,
        })

        for await (const chunk of stream) {
            const choice = chunk.choices[0]
            if (!choice) continue

            const delta = choice.delta

            let toolCallDelta: StreamChunk['toolCallDelta'] = undefined
            if (delta.tool_calls && delta.tool_calls.length > 0) {
                const tc = delta.tool_calls[0]
                if (tc) {
                    toolCallDelta = {
                        index: tc.index,
                        id: tc.id,
                        type: 'function',
                        function: tc.function ? {
                            name: tc.function.name,
                            arguments: tc.function.arguments
                        } : undefined
                    }
                }
            }

            yield {
                delta: delta.content || '',
                toolCallDelta,
            }
        }
    }

    private mapMessages(messages: Message[]): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
        return messages.map(m => {
            if (m.role === 'tool') {
                return {
                    role: 'tool',
                    content: (typeof m.content === 'string' ? m.content : '') || '',
                    tool_call_id: m.toolCallId || 'unknown'
                } as OpenAI.Chat.Completions.ChatCompletionToolMessageParam
            }
            if (m.role === 'system') {
                return { role: 'system', content: (typeof m.content === 'string' ? m.content : '') || '' }
            }
            if (m.role === 'user') {
                return { role: 'user', content: (typeof m.content === 'string' ? m.content : '') || '' }
            }
            if (m.role === 'assistant') {
                const tool_calls = m.toolCalls?.map(tc => ({
                    id: tc.id,
                    type: 'function' as const,
                    function: {
                        name: tc.function.name,
                        arguments: tc.function.arguments
                    }
                }))
                return {
                    role: 'assistant',
                    content: (typeof m.content === 'string' ? m.content : '') || null,
                    tool_calls
                } as OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam
            }
            throw new Error(`Unknown role: ${m.role}`)
        })
    }

    private mapTool(tool: ToolDefinition): OpenAI.Chat.Completions.ChatCompletionTool {
        return {
            type: 'function',
            function: {
                name: tool.function.name,
                description: tool.function.description,
                parameters: tool.function.parameters as any
            }
        }
    }

    private mapResponseMessage(msg: OpenAI.Chat.Completions.ChatCompletionMessage): Message {
        return {
            role: msg.role,
            content: msg.content || '',
            toolCalls: msg.tool_calls?.map(tc => {
                if (tc.type === 'function') {
                    return {
                        id: tc.id,
                        function: {
                            name: tc.function.name,
                            arguments: tc.function.arguments
                        },
                        type: 'function'
                    }
                }
                return undefined
            }).filter(Boolean) as ToolCall[] | undefined
        } as unknown as Message
    }
}

