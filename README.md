<div align="center">
  <img src="https://raw.githubusercontent.com/TEKIMAX/tekimax-omat/main/apps/docs/public/tekimax-logo.png" alt="TEKIMAX OMAT" width="120" />
  <h1>tekimax-omat</h1>
  <p><strong>Open AI Infrastructure for the Public Good</strong></p>

  <p>
    <a href="https://opensource.org/licenses/Apache-2.0"><img src="https://img.shields.io/badge/License-Apache%202.0-blue.svg" alt="License"></a>
    <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.0-3178C6.svg" alt="TypeScript"></a>
    <a href="https://www.npmjs.com/package/tekimax-omat"><img src="https://img.shields.io/npm/v/tekimax-omat.svg" alt="NPM Version"></a>
    <a href="https://packagephobia.com/result?p=tekimax-omat"><img src="https://packagephobia.com/badge?p=tekimax-omat" alt="Bundle Size"></a>
    <a href="https://github.com/TEKIMAX/tekimax-omat/actions/workflows/security-scan.yml"><img src="https://github.com/TEKIMAX/tekimax-omat/actions/workflows/security-scan.yml/badge.svg" alt="Security Scan"></a>
    <a href="https://tekimax.com"><img src="https://img.shields.io/badge/TEKIMAX-Open%20Source-000000.svg" alt="TEKIMAX"></a>
  </p>

  <p>
    A unified, type-safe AI SDK built for organizations doing public good — nonprofits, healthcare, education, workforce development, and civic tech. One interface for <strong>84+ AI providers</strong> and <strong>2,300+ models</strong>, with a full assessment toolkit, privacy-first design, and enterprise-grade security baked in.
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

## Quick Install

```bash
npm install tekimax-omat
```

---

## What's in the Box

| Module | Description |
|--------|-------------|
| **Core SDK** | Unified provider interface — OpenAI, Anthropic, Gemini, Ollama, Grok, OpenRouter |
| **OMAT Assessment Toolkit** | Rubric schemas, formative feedback pipelines, fairness auditing, benchmarks |
| **ApiSkillPlugin** | Register any REST API as a model-callable tool — CRUD, OpenAPI, or custom |
| **Security Plugins** | PII redaction, SSRF blocking, audit logging, token-aware context |
| **React Hooks** | `useChat`, `useAssessment` — SSE streaming with abort support |
| **Redis Adapter** | Response caching, rate limiting, token budgets, session storage |

---

## Core SDK

### Providers

```typescript
import { Tekimax, OpenAIProvider, AnthropicProvider, GeminiProvider, OllamaProvider } from 'tekimax-omat'

const client = new Tekimax({
  provider: new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY })
})

// Switch providers with zero code changes
const claude = new Tekimax({
  provider: new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY })
})

// Local / self-hosted
const local = new Tekimax({
  provider: new OllamaProvider({ baseUrl: 'http://localhost:11434' })
})
```

### Streaming

```typescript
import { generateText } from 'tekimax-omat'

const stream = await generateText(provider, {
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Explain this policy in plain language.' }],
  stream: true
})

for await (const chunk of stream) {
  process.stdout.write(chunk.delta ?? '')
}
```

### Multimodal

```typescript
// Vision
const analysis = await client.images.analyze({
  model: 'gpt-4o',
  image: 'https://example.com/image.png',
  prompt: 'Describe this document'
})

// Audio
const audio = await client.audio.speak({
  model: 'tts-1',
  input: 'Welcome to your case worker portal.',
  voice: 'alloy'
})

// Embeddings
const vectors = await client.text.embed({
  model: 'text-embedding-3-small',
  input: ['participant intake form', 'housing assistance application']
})
```

---

## OMAT — Open Multimodal Assessment Toolkit

OMAT is the assessment layer of tekimax-omat — designed for any organization that needs structured, equitable, AI-powered evaluation: education, workforce development, healthcare literacy, civic programs.

```typescript
import { AssessmentPipeline, FairnessAuditPlugin } from 'tekimax-omat'

const pipeline = new AssessmentPipeline({
  provider,
  rubric: {
    task: 'Explain how to apply for rental assistance.',
    claims: [
      { id: 'c1', description: 'Identifies the correct agency', weight: 0.4 },
      { id: 'c2', description: 'Lists required documents', weight: 0.6 },
    ]
  },
  plugins: [new FairnessAuditPlugin({ minGroupSize: 5 })]
})

const result = await pipeline.assess({
  id: 'r-001',
  modality: 'text',
  text: 'You need to contact the housing authority and bring your lease...'
})

console.log(result.feedback.strengths)
console.log(result.feedback.nextSteps)
console.log(result.score)
```

### React Hook

```typescript
import { useAssessment } from 'tekimax-omat/react'

function AssessmentForm() {
  const { assess, feedback, isStreaming } = useAssessment({ pipeline })

  return (
    <>
      <button onClick={() => assess({ modality: 'text', text: input })}>
        Submit
      </button>
      {isStreaming && <Spinner />}
      {feedback && <FeedbackCard data={feedback} />}
    </>
  )
}
```

---

## ApiSkillPlugin — Bring Your Own API

Register any REST endpoint as a model-callable tool. No LLM middleware required.

```typescript
import { ApiSkillPlugin } from 'tekimax-omat'

const skills = new ApiSkillPlugin({
  baseUrl: 'https://api.yourorg.com',
  defaultAuth: { type: 'bearer', token: process.env.API_TOKEN! },
  autoInject: true,  // auto-injects tools on every request
})

skills.registerEndpoint({
  name: 'get_participant',
  description: 'Look up a participant record by ID',
  method: 'GET',
  url: '/participants/{id}',
  pathParams: ['id'],
})

skills.registerEndpoint({
  name: 'update_enrollment',
  description: 'Update a participant enrollment status',
  method: 'PATCH',
  url: '/participants/{id}/enrollment',
  pathParams: ['id'],
  bodyParams: ['status', 'notes'],
})

// Or load directly from an OpenAPI 3.x spec
skills.registerFromOpenApi({
  specUrl: 'https://api.yourorg.com/openapi.json',
  auth: { type: 'apikey', header: 'X-API-Key', value: process.env.API_KEY! },
  include: ['get_participant', 'create_referral'],
})
```

---

## Security Plugins

tekimax-omat is built for regulated environments — healthcare, social services, education, public sector.

```typescript
import { Tekimax, PIIFilterPlugin, LoggerPlugin, AIActionTagPlugin } from 'tekimax-omat'

const client = new Tekimax({
  provider,
  plugins: [
    // Redact SSNs, emails, phones, cards before they reach any AI provider
    new PIIFilterPlugin(),

    // Sanitize sensitive keys from tool argument logs
    new LoggerPlugin(),

    // Tag every AI action for audit trail
    new AIActionTagPlugin({
      onTag: (tag, ctx) => auditLog.record({ ...tag, userId: ctx.requestOptions?.userId })
    }),
  ]
})
```

**SSRF protection** is built into both `ProvisionPlugin` and `ApiSkillPlugin` — private IPs (10.x, 172.16-31.x, 192.168.x), loopback (127.x, localhost), and cloud metadata endpoints (169.254.x) are blocked at every layer.

---

## Enterprise Use

tekimax-omat is production-ready for enterprise deployment:

| Requirement | How tekimax-omat addresses it |
|-------------|-------------------------------|
| **Zero CVEs** | Chainguard-based images, Trivy scanning on every commit |
| **Artifact integrity** | Cosign/Sigstore signing on all build artifacts |
| **PII compliance** | `PIIFilterPlugin` redacts before any data leaves your network |
| **Audit logging** | `AIActionTagPlugin` + `ApiSkillPlugin` audit hooks |
| **SSRF prevention** | Private IP blocking in all outbound plugins |
| **Least-privilege** | Register only the endpoints the model actually needs |
| **Self-hostable** | Ollama provider + Redis adapter = fully air-gapped |
| **SBOM / audit reports** | Contact enterprise@tekimax.com |

### Self-Hosting

```bash
# Air-gapped / on-premise
docker run -p 11434:11434 ollama/ollama
```

```typescript
const client = new Tekimax({
  provider: new OllamaProvider({ baseUrl: 'http://localhost:11434' }),
  plugins: [new PIIFilterPlugin(), new LoggerPlugin()]
})
```

### Compliance Readiness

tekimax-omat provides controls that support compliance in regulated environments. These are technical controls — organizational policies, BAAs, and formal certifications are your responsibility.

| Regulation | SDK controls that apply | What you still need |
|------------|------------------------|---------------------|
| **FERPA** | `FairnessAuditPlugin` never sends demographics to AI providers; `PIIFilterPlugin` redacts student PII; `AIActionTagPlugin` creates audit trails | Data retention policy; FERPA officer designation; incident response procedure |
| **HIPAA** | `PIIFilterPlugin` redacts PHI before any network call; SSRF blocking prevents exfiltration; audit logging hooks | Business Associate Agreement (BAA) with your AI providers; HIPAA risk assessment; breach notification procedure |
| **SOC 2** | Chainguard images + Trivy scanning; Cosign artifact signing; secret sanitization in logs; audit trail infrastructure | Formal SOC 2 audit; access control policies; change management documentation |

tekimax-omat is **not certified** under these standards. The controls are designed to help your organization achieve compliance — consult your legal and compliance teams for the full picture.

For SBOM, security audit report, or compliance guidance for your deployment, contact `enterprise@tekimax.com`.

---

## Redis Adapter

```typescript
import { ResponseCache, RateLimiter, TokenBudget, SessionStore } from 'tekimax-omat'
import Redis from 'ioredis'

const redis = new Redis(process.env.REDIS_URL)

const cache = new ResponseCache(redis, { ttl: 3600 })
const limiter = new RateLimiter(redis, { maxRequests: 60, windowSeconds: 60 })
const budget = new TokenBudget(redis, { maxTokens: 100_000, periodSeconds: 86400 })
const sessions = new SessionStore(redis, { ttl: 1800 })
```

---

## Monorepo Structure

```
tekimax-ts/
├── packages/tekimax-ts/     # Core SDK (published as tekimax-omat)
│   └── src/
│       ├── core/            # generate, types, cost, retry, middleware, cache
│       ├── providers/       # OpenAI, Anthropic, Gemini, Ollama, Grok, OpenRouter
│       ├── plugins/         # All middleware plugins
│       ├── assessment/      # OMAT assessment pipeline
│       ├── benchmarks/      # OMAT benchmark suite
│       └── react/           # useChat, useAssessment hooks
├── apps/docs/               # Docs site (Next.js + Fumadocs)
└── apps/demo/               # Demo application
```

### Dev Commands

```bash
# Install
npm install

# Build all packages
npx turbo build

# Type check
npx turbo typecheck

# Start docs
npx turbo dev --filter=docs

# Run security scan
npx turbo scan
```

---

## Roadmap

| Feature | Status |
|---------|--------|
| Unified provider interface (OpenAI, Anthropic, Gemini, Ollama, Grok, OpenRouter) | ✅ Shipped |
| SSE streaming + React `useChat` hook | ✅ Shipped |
| Middleware plugin architecture | ✅ Shipped |
| Redis adapter (cache, rate limit, budget, sessions) | ✅ Shipped |
| `PIIFilterPlugin` — ReDoS-safe, ContentPart[] support | ✅ Shipped |
| `AIActionTagPlugin` — audit trail | ✅ Shipped |
| `ProvisionPlugin` — SSRF-hardened API gateway | ✅ Shipped |
| `ApiSkillPlugin` — register any REST API as a model tool | ✅ Shipped |
| OMAT `AssessmentPipeline` — rubric schemas, feedback generation | ✅ Shipped |
| `FairnessAuditPlugin` — demographic equity reporting | ✅ Shipped |
| `RubricValidatorPlugin` + `LearningProgressionPlugin` | ✅ Shipped |
| OMAT benchmark suite | ✅ Shipped |
| `useAssessment()` React hook | ✅ Shipped |
| Edge runtime (Cloudflare Workers / Deno) | Planned |
| Batch API | Planned |
| Fine-tuning API | Planned |

---

## Contributing

See [CONTRIBUTING.md](packages/tekimax-ts/CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](packages/tekimax-ts/CODE_OF_CONDUCT.md).

We especially welcome contributions from organizations working in education, healthcare, workforce development, and civic technology.

---

## License

- **SDK & Code** — [Apache 2.0](LICENSE)
- **Documentation** — [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/)

---

## Support

- **Docs**: https://tekimax.com/docs
- **Issues**: [GitHub Issues](https://github.com/TEKIMAX/tekimax-omat/issues)
- **Enterprise**: enterprise@tekimax.com
- **Security**: security@tekimax.com
- **Sponsor**: [GitHub Sponsors](https://github.com/sponsors/TEKIMAX)

---

<div align="center">
  <p>Built by <a href="https://tekimax.com">TEKIMAX</a> — AI infrastructure for organizations doing public good</p>
</div>
