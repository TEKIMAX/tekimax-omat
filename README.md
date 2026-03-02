<div align="center">
  <img src="https://raw.githubusercontent.com/TEKIMAX/tekimax-ts/main/apps/docs/public/tekimax-logo.png" alt="Tekimax SDK Logo" width="120" />
  <h1>Tekimax SDK</h1>
  <p><strong>The Universal Standard</strong></p>
  
  <p>
    <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License"></a>
    <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.0-3178C6.svg" alt="TypeScript"></a>
    <a href="https://tekimax.com"><img src="https://img.shields.io/badge/Standard-Tekimax-000000.svg" alt="Standard"></a>
    <a href="https://www.npmjs.com/package/tekimax-ts"><img src="https://img.shields.io/npm/v/tekimax-ts.svg" alt="NPM Version"></a>
    <a href="https://packagephobia.com/result?p=tekimax-ts"><img src="https://packagephobia.com/badge?p=tekimax-ts" alt="Bundle Size"></a>
  </p>
  
  <p>
    Integrate <strong>OpenAI</strong>, <strong>Anthropic</strong>, <strong>Gemini</strong>, <strong>Ollama</strong>, <strong>Grok</strong>, and <strong>OpenRouter</strong> with a single, type-safe API.
  </p>

  <div>
    <img src="https://img.shields.io/badge/OpenAI-412991?style=for-the-badge&logo=openai&logoColor=white" alt="OpenAI" />
    <img src="https://img.shields.io/badge/Anthropic-D06940?style=for-the-badge&logo=anthropic&logoColor=white" alt="Anthropic" />
    <img src="https://img.shields.io/badge/Gemini-8E75B2?style=for-the-badge&logo=google%20gemini&logoColor=white" alt="Gemini" />
    <img src="https://img.shields.io/badge/Ollama-000000?style=for-the-badge&logo=ollama&logoColor=white" alt="Ollama" />
    <img src="https://img.shields.io/badge/Grok-000000?style=for-the-badge&logo=x&logoColor=white" alt="Grok" />
    <img src="https://img.shields.io/badge/OpenRouter-6366F1?style=for-the-badge&logo=openai&logoColor=white" alt="OpenRouter" />
  </div>
</div>

---

## 🚀 The Universal Standard

The **Tekimax SDK** solves the fragmentation of AI APIs. Instead of rewriting your integration code for every provider (handling different request formats, streaming implementations, and error types), you use **one standard interface**.

- **Write Once, Run Anywhere**: Switch between OpenAI (Cloud) and Ollama (Local) with a single line of config.
- **Type-Safe**: Full TypeScript support with Zod validation for inputs and outputs.
- **Multi-Modal**: Text, images, audio, video, and **embeddings** through a unified namespace API.
- **OpenResponses Catalog**: Fuses `models.dev` metadata into standard `ModelDefinition` objects for reasoning, modalities, and token limits.
- **Middleware Plugins**: Built-in architecture for Security (`PIIFilterPlugin`), Scalability (`MaxContextOverflowPlugin`), and Telemetry (`LoggerPlugin`).
- **React Ready**: Includes a `useChat` hook for instant UI integration, complete with SSE streaming.
- **Redis Adapter** _(optional)_: Response caching, rate limiting, token budgets, and session storage with any Redis client.


## 💻 Installation

```bash
# Install core and your desired adapters
npm install tekimax-ts
```

## 💻 Usage

### 1. Initialize the Client

The `Tekimax` client is the unified entry point. It wraps any provider (OpenAI, Anthropic, Ollama, etc.) and exposes a consistent multi-modal interface.

```typescript
import { 
  Tekimax, 
  OpenAIProvider, 
  AnthropicProvider, 
  OllamaProvider,
  GeminiProvider 
} from 'tekimax-ts'

// OpenAI
const client = new Tekimax({
    provider: new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY })
})

// Anthropic
const claude = new Tekimax({
    provider: new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY })
})

// Ollama (Local)
const local = new Tekimax({
    provider: new OllamaProvider({ baseUrl: 'http://localhost:11434' })
})
```

### 2. Multi-Modal Interfaces

The client is organized into cohesive namespaces:

#### Text (Chat)

```typescript
const response = await client.text.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'Hello!' }]
})
console.log(response.message.content)
```

#### Images (Generation & Vision)

```typescript
// Generate
const image = await client.images.generate({
    model: 'dall-e-3',
    prompt: 'A cyberpunk city',
    size: '1024x1024'
})

// Analyze (Vision)
const analysis = await client.images.analyze({
    model: 'gpt-4o',
    image: 'https://example.com/image.png',
    prompt: 'Describe this scene'
})
```

#### Audio (TTS)

```typescript
const audio = await client.audio.speak({
    model: 'tts-1',
    input: 'Hello world',
    voice: 'alloy'
})
```

#### Video (Analysis)

```typescript
const analysis = await client.videos.analyze({
    model: 'gemini-1.5-flash',
    video: 'https://example.com/video.mp4',
    prompt: 'Summarize this clip'
})
```

#### Embeddings

```typescript
const vectors = await client.text.embed({
    model: 'text-embedding-3-small',
    input: ['Hello world', 'Tekimax SDK is awesome']
})
console.log(vectors.embeddings)
```

### 3. Cross-Provider Model Catalog

The SDK strictly implements the **OpenResponses** schema, optionally fusing metadata from `models.dev` so your application always knows what capabilities the active provider supports.

```typescript
// Returns standard ModelDefinition[] populated with reasoning levels, modal limits, and costs
const models = await client.provider.getModels?.() 

if (models) {
    console.log(models.find(m => m.id === 'gpt-4o')?.modalities.input) // ['text', 'image', 'audio', 'video']
}
```

## 🏗️ Monorepo Structure

This repository is managed as a **Turborepo** monorepo.

- **`apps/docs`**: Documentation site (Next.js + Fumadocs).
- **`packages/*`**: Core SDK and Provider Adapters.
- **`tekimax-cli`**: Developer tools for Tekimax.

### Commands

```bash
# Build all packages
npx turbo build

# Run tests
npx turbo test

# Start Docs Site
npx turbo dev --filter=docs
```

## ⚡ Optional Redis Adapter

No extra dependency — bring your own `ioredis`, `@upstash/redis`, or `node-redis`:

```typescript
import { ResponseCache, RateLimiter, TokenBudget, SessionStore } from 'tekimax-ts'
import Redis from 'ioredis'

const redis = new Redis(process.env.REDIS_URL)

// Cache AI responses (avoid repeat API costs)
const cache = new ResponseCache(redis, { ttl: 3600 })

// Enforce rate limits per provider
const limiter = new RateLimiter(redis, { maxRequests: 60, windowSeconds: 60 })

// Track daily token spend
const budget = new TokenBudget(redis, { maxTokens: 100_000, periodSeconds: 86400 })

// Conversation state for serverless
const sessions = new SessionStore(redis, { ttl: 1800 })
```

## 🔌 ProvisionPlugin — API Gateway Client

The `ProvisionPlugin` is a generic, endpoint-agnostic API client for authenticated API access. It handles auth injection, rate limiting, and deployment-scoped requests.

```typescript
import { ProvisionPlugin } from 'tekimax-ts'

const plugin = new ProvisionPlugin({
    apiUrl: 'https://your-api.example.com',
    apiKey: 'your-api-key',
    deploymentId: 'dep_abc123',  // Scopes requests to this deployment
})

// Initialize
await plugin.initialize()

// Create typed API namespaces
const naics = plugin.api('/api/naics')
const ocr = plugin.api('/api/ocr')

// Use the namespace
const results = await naics.get('/search', { q: 'software' })
const sectors = await naics.get('/sectors')
const code = await naics.get('/codes/541511')

// OCR
const extracted = await ocr.post('/', formData)
```

### Features
- **Auth Injection**: Automatically adds `X-API-Key` and `X-Deployment-ID` headers
- **Rate Limiting**: Built-in client-side rate limiting (configurable)
- **Request Timeouts**: Configurable timeout per request
- **Lifecycle Hooks**: `initialize()` and `destroy()` for resource management
- **Endpoint Agnostic**: Works with any REST API — no domain-specific code

### Security Model

| Header | Purpose |
|--------|---------|
| `X-API-Key` | Authenticates the request |
| `X-Deployment-ID` | Identifies the deployment + authorizes API access |

The API server validates that the deployment exists and has the requested API feature enabled in its `enabledApis` list.

## 🗺️ Roadmap

| Feature | Description | Status |
|---------|-------------|--------|
| **Middleware Plugins** | Pre-built and custom lifecycle hooks for Security, Telemetry, and Scalability. | ✅ Shipped |
| **OpenResponses Catalog** | Provider abstraction parsing `models.dev` metadata for token limits, reasoning capabilities, and allowed modalities. | ✅ Shipped |
| **Real-time SSE Streaming** | Native SDK token streaming, `StreamChunk` event typing, and full React hooks support (`useChat`). | ✅ Shipped |
| **Redis Adapter** | Optional response caching, rate limiting, token budget tracking, and session storage with any Redis client. | ✅ Shipped |
| **Observability** | Telemetry and tracing via `plugins` architecture. | ✅ Shipped |
| **ProvisionPlugin** | Endpoint-agnostic API gateway client with deployment-scoped auth. | ✅ Shipped |
| **Batch API** | Queue thousands of requests and retrieve results asynchronously. | 🔜 Planned |
| **Edge Runtime** | Cloudflare Workers / Deno support. | 🔜 Planned |
| **Assistants / Threads** | Stateful conversation management with persistence. | 🔜 Planned |
| **Fine-tuning API** | Programmatic fine-tuning via internal and integrated APIs. | 🔜 Planned |

> **Want to help?** Pick a feature and open a PR, or join the discussion in [GitHub Issues](https://github.com/TEKIMAX/tekimax-ts/issues).

## 💖 Support

Tekimax is open source. If you find it valuable, please consider [becoming a sponsor](https://github.com/sponsors/TEKIMAX) to support long-term maintenance.

---

<div align="center">
  <p>Built with ❤️ by the Tekimax Team</p>
</div>
