import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { Tekimax, OpenAIProvider } from 'tekimax-omat';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.post('/api/chat', async (req, res) => {
    try {
        const { messages, model, providerConfig } = req.body;

        const resolvedKey = providerConfig?.apiKey || process.env.MODEL_PROXY_KEY || 'sk-default';
        const resolvedURL = providerConfig?.baseURL || process.env.MODEL_PROXY_URL || 'http://localhost:11434/v1';

        console.log(`[Tekimax SDK] model=${model} baseURL=${resolvedURL}`);

        // Instantiate through the official Tekimax SDK
        const client = new Tekimax({
            provider: new OpenAIProvider({
                apiKey: resolvedKey,
                baseURL: resolvedURL,
            })
        });

        // Set SSE headers for streaming
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        let chunksReceived = false;

        try {
            // Use the Tekimax SDK's official streaming API
            const stream = client.text.generateStream({
                model: model || 'mistral:latest',
                messages: messages,
            });

            for await (const chunk of stream) {
                chunksReceived = true;
                const data = JSON.stringify({ delta: chunk.delta || '', thinking: chunk.thinking || '' });
                res.write(`data: ${data}\n\n`);
            }
        } catch (streamErr: any) {
            console.log('[Tekimax SDK] Streaming failed, falling back to non-streaming:', streamErr.message);
        }

        // Fallback: if streaming yielded nothing, use the SDK's non-streaming API
        if (!chunksReceived) {
            const response = await client.text.chat.completions.create({
                model: model || 'mistral:latest',
                messages: messages,
            });
            const content = response.message.content || '';
            res.write(`data: ${JSON.stringify({ delta: content })}\n\n`);
        }

        res.write(`data: [DONE]\n\n`);
        res.end();
    } catch (error: any) {
        console.error('[Tekimax SDK] Error:', error.message);
        if (res.headersSent) {
            res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
            res.end();
        } else {
            res.status(500).json({ error: error.message || "Unknown proxy error." });
        }
    }
});

app.get('/api/models', async (req, res) => {
    try {
        const response = await fetch('https://models.dev/api.json');

        if (!response.ok) {
            throw new Error(`Upstream error: ${response.status} ${response.statusText}`);
        }

        const registry = await response.json() as Record<string, any>;
        const models: any[] = [];

        // Map models.dev registry into OpenResponses-compliant ModelDefinition[]
        for (const [providerId, providerData] of Object.entries(registry)) {
            if (!providerData || !providerData.models) continue;

            for (const [modelId, modelData] of Object.entries(providerData.models)) {
                const md = modelData as any;
                models.push({
                    id: md.id || modelId,
                    name: md.name || modelId,
                    family: md.family || undefined,
                    provider: providerData.name || providerId,

                    // OpenResponses Capability Mapping
                    attachment: md.attachment || false,
                    tool_call: md.tool_call || false,
                    structured_output: md.structured_output || false,
                    reasoning: md.reasoning || false,

                    // Modalities (direct passthrough from models.dev)
                    modalities: md.modalities || { input: ['text'], output: ['text'] },

                    // Token Limits
                    limit: md.limit || { context: 4096, output: 4096 },

                    // Cost (if available)
                    ...(md.cost ? { cost: md.cost } : {})
                });
            }
        }

        res.json({ object: "list", data: models });
    } catch (error: any) {
        console.error('Models API Error:', error);
        res.status(500).json({ error: error.message });
    }
});

const PORT = 3001;
app.listen(PORT, () => {
    console.log(`Backend securely running on http://localhost:${PORT}`);
});
