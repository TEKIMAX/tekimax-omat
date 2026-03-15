import type { AIProvider } from './adapter'
import type { GenerateTextResult, ChatResult, Message, Tool, TekimaxPlugin, PluginContext } from './types'

export interface GenerateTextOptions {
    model: string
    messages: Array<Message>
    tools?: Record<string, Tool>
    maxSteps?: number
    temperature?: number
    maxTokens?: number
    signal?: AbortSignal
    plugins?: TekimaxPlugin[]
}

export async function generateText({
    adapter,
    plugins = [],
    ...options
}: GenerateTextOptions & { adapter: AIProvider }): Promise<GenerateTextResult> {
    const { model, tools, maxSteps = 1, temperature, maxTokens, signal } = options
    let currentMessages = [...options.messages]
    let currentModel = model
    let steps = 0
    let lastResult: ChatResult | undefined

    // Transform tools map to array for caching/adapter
    const toolDefinitions = tools ? Object.values(tools) : undefined

    while (steps < maxSteps) {
        steps++

        let context: PluginContext = {
            model: currentModel,
            messages: [...currentMessages],
            timestamp: Date.now(),
            requestOptions: { ...options }
        }
        for (const plugin of plugins) {
            if (plugin.beforeRequest) {
                const updated = await plugin.beforeRequest(context)
                if (updated) context = updated
            }
        }
        currentMessages = context.messages
        currentModel = context.model

        const result = await adapter.chat({
            model: currentModel,
            messages: currentMessages,
            tools: toolDefinitions,
            temperature,
            maxTokens,
            signal,
        })
        lastResult = result

        for (const plugin of plugins) {
            if (plugin.afterResponse) await plugin.afterResponse(context, result)
        }

        const { message } = result
        currentMessages.push(message)

        // If no tool calls, we are done
        if (!message.toolCalls || message.toolCalls.length === 0) {
            return {
                text: typeof message.content === 'string'
                    ? message.content || ''
                    : Array.isArray(message.content)
                        ? message.content.filter(p => p.type === 'text').map(p => (p as any).text).join('')
                        : '',
                toolCalls: [],
                toolResults: [],
                finishReason: 'stop',
                usage: result.usage || { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
                aiTag: result.aiTag,
            }
        }

        // Handle Tool Calls
        const toolResults = await Promise.all(
            message.toolCalls.map(async (call) => {
                const toolName = call.function.name
                const tool = tools?.[toolName]
                if (!tool) {
                    return { id: call.id, result: `Error: Tool ${toolName} not found` }
                }

                try {
                    let args = JSON.parse(call.function.arguments)
                    for (const plugin of plugins) {
                        if (plugin.beforeToolExecute) await plugin.beforeToolExecute(toolName, args)
                    }

                    const output = await tool.execute(args)

                    for (const plugin of plugins) {
                        if (plugin.afterToolExecute) await plugin.afterToolExecute(toolName, output)
                    }

                    return { id: call.id, result: output }
                } catch (error: any) {
                    return { id: call.id, result: `Error executing tool: ${error.message}` }
                }
            })
        )

        // Add tool results to messages
        for (const res of toolResults) {
            currentMessages.push({
                role: 'tool',
                content: JSON.stringify(res.result),
                toolCallId: res.id,
                name: message.toolCalls.find(c => c.id === res.id)?.function.name,
            })
        }
    }

    // If we exit loop, max steps reached
    return {
        text: '',
        toolCalls: [],
        toolResults: [],
        finishReason: 'length',
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        warnings: ['Max steps reached'],
        aiTag: lastResult?.aiTag,
    }
}
