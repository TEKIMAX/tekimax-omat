# Contributing to tekimax-omat

Thank you for contributing to tekimax-omat, an open-source AI SDK for the public good. We especially welcome contributions from people working in education, healthcare, workforce development, nonprofit technology, and civic tech.

---

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [What to Contribute](#what-to-contribute)
- [Development Setup](#development-setup)
- [Making Changes](#making-changes)
- [Testing](#testing)
- [Submitting a Pull Request](#submitting-a-pull-request)
- [Commit Format](#commit-format)
- [Enterprise Contributions](#enterprise-contributions)
- [Security Issues](#security-issues)

---

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](./CODE_OF_CONDUCT.md). By participating you agree to abide by its terms. Report violations to info@tekimax.com.

---

## What to Contribute

**Great first issues** — look for [`good first issue`](https://github.com/TEKIMAX/tekimax-omat/labels/good%20first%20issue) labels.

**High-value contributions:**

| Area | Examples |
|------|---------|
| New providers | Add Mistral, Cohere, Bedrock, Azure OpenAI, Vertex AI |
| OMAT modalities | Improve speech/drawing assessment support |
| Security hardening | Additional SSRF vectors, PII pattern improvements |
| Fairness | New demographic subgroup reporting, bias detection |
| Docs | Real-world usage examples, integration guides |
| Tests | Coverage for edge cases, provider-specific behaviors |
| Accessibility | Multilingual support, screen reader compatibility in React hooks |

**Before starting large features**, open an issue first so we can discuss approach and avoid duplicate work.

---

## Development Setup

### Prerequisites

- Node.js 20+
- npm 10+ (or bun)

### Install

```bash
git clone https://github.com/TEKIMAX/tekimax-omat.git
cd tekimax-omat
npm install
```

### Build

```bash
# Build all packages
npx turbo build

# Build only the SDK
cd packages/tekimax-ts
npm run build
```

### Type check

```bash
# Full monorepo
npx turbo typecheck

# SDK only
cd packages/tekimax-ts
npx tsc --noEmit
```

### Run the docs site

```bash
npx turbo dev --filter=docs
# Visit http://localhost:3001
```

### Run the demo

```bash
npx turbo dev --filter=demo
```

---

## Making Changes

### Branch naming

```
feature/your-feature-name
fix/issue-number-short-description
docs/what-you-updated
security/vulnerability-description
```

### File locations

| What you're changing | Where |
|---------------------|-------|
| New provider | `packages/tekimax-ts/src/providers/` |
| New plugin | `packages/tekimax-ts/src/plugins/` |
| Core types | `packages/tekimax-ts/src/core/types.ts` |
| OMAT assessment | `packages/tekimax-ts/src/assessment/` |
| Benchmarks | `packages/tekimax-ts/src/benchmarks/` |
| React hooks | `packages/tekimax-ts/src/react/` |
| Docs | `apps/docs/content/docs/` |
| Barrel exports | `packages/tekimax-ts/src/index.ts` + `src/plugins/index.ts` |

### Adding a new provider

1. Create `src/providers/yourprovider.ts` implementing `AIProvider`
2. Export from `src/providers/index.ts` and `src/index.ts`
3. Add a doc entry in `apps/docs/content/docs/providers.mdx`
4. Add a test in `src/providers/__tests__/`

### Adding a new plugin

1. Create `src/plugins/yourplugin.ts` implementing `TekimaxPlugin`
2. Export from `src/plugins/index.ts` and `src/index.ts`
3. Document in `apps/docs/content/docs/plugins.mdx`

---

## Testing

```bash
# Run all tests
npx turbo test

# Run SDK tests only
cd packages/tekimax-ts
npm test

# Type check (no emit)
npx tsc --noEmit
```

**Guidelines:**
- Unit tests for all new public methods
- Integration tests for provider adapters (can be skipped in CI if no key available — use `process.env.OPENAI_API_KEY && describe(...)` guards)
- Security tests for any plugin touching external data or URLs
- Do not mock core logic in unit tests — mock only at the provider boundary

---

## Submitting a Pull Request

1. Fork the repo and create your branch from `main`
2. Make your changes
3. Ensure `npx tsc --noEmit` exits 0
4. Ensure tests pass
5. Update docs if you changed behavior
6. Update `CHANGELOG.md` under `[Unreleased]`
7. Open a PR with a clear title and description

**PR checklist:**

- [ ] TypeScript compiles clean
- [ ] Tests pass
- [ ] Docs updated (if behavior changed)
- [ ] No new dependencies added without discussion
- [ ] No hardcoded API keys or secrets
- [ ] Security implications considered (SSRF, PII, injection)

**PR size:** Keep PRs focused. One feature or fix per PR. Large PRs are hard to review and slow to merge.

---

## Commit Format

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short description>

[optional body]

[optional footer]
```

**Types:**

| Type | When to use |
|------|-------------|
| `feat` | New feature or capability |
| `fix` | Bug fix |
| `security` | Security hardening or vulnerability fix |
| `docs` | Documentation only |
| `test` | Adding or fixing tests |
| `refactor` | Code change with no behavior change |
| `chore` | Build tooling, deps, config |

**Examples:**

```
feat(plugins): add ApiSkillPlugin with SSRF guard
fix(pii): replace nested quantifier regex to prevent ReDoS
security(provision): block private IP ranges in outbound requests
docs(guides): add api-skills integration guide with SLA rules
```

---

## Enterprise Contributions

Organizations that deploy tekimax-omat in production are encouraged to contribute back improvements — especially:

- HIPAA / FERPA compliance-readiness patterns (SDK controls, not certification)
- Large-scale audit logging integrations
- Self-hosting / air-gap deployment tooling
- Custom provider adapters for internal APIs

For significant contributions, please open an issue first so we can discuss design before you invest implementation time.

**Developer Certificate of Origin (DCO):** By submitting a PR you certify that you have the right to submit the contribution under the Apache 2.0 license. If your organization requires a CLA, contact enterprise@tekimax.com.

---

## Security Issues

**Do not open public issues for security vulnerabilities.** See [SECURITY.md](../.github/SECURITY.md) for the responsible disclosure process.
