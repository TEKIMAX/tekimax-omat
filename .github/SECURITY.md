# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| v0.4.x  | Yes — current release |
| v0.3.x  | Security patches only |
| < v0.3  | No |

## Reporting a Vulnerability

**Do not open a public issue for security vulnerabilities.**

### Preferred: GitHub Security Advisory

Open a [Security Advisory](https://github.com/TEKIMAX/tekimax-omat/security/advisories/new) on GitHub. This keeps the report private until a fix is released.

### Alternative: Email

Email `security@tekimax.com` with:

- A description of the vulnerability
- Steps to reproduce
- The affected version(s)
- Any relevant logs or screenshots
- Your preferred disclosure credit (name/handle, or anonymous)

### Response Timeline

| Milestone | Target |
|-----------|--------|
| Acknowledgement | Within 48 hours |
| Severity assessment | Within 5 business days |
| Fix + patch release | Within 30 days for CRITICAL/HIGH |
| Public disclosure | After patch ships + 7-day notice |

We follow [coordinated disclosure](https://cheatsheetseries.owasp.org/cheatsheets/Vulnerability_Disclosure_Cheat_Sheet.html). We will credit you in the release notes unless you prefer to remain anonymous.

---

## Zero CVE Policy

tekimax-omat strives to maintain zero CVEs in production builds:

- **Chainguard Images** — distroless base, no shell, no package manager, rebuilt daily
- **Trivy scanning** — runs on every commit and nightly; builds fail on CRITICAL or HIGH findings
- **Cosign signing** — all build artifacts are signed via Sigstore for tamper verification
- **Minimal dependencies** — core runtime requires only `zod` and `eventsource-parser`

---

## Known Security Controls

| Control | Implementation |
|---------|----------------|
| PII redaction | `PIIFilterPlugin` — strips SSNs, emails, phones, cards before any network call |
| SSRF prevention | `ProvisionPlugin` + `ApiSkillPlugin` block private IPs, loopback, and cloud metadata endpoints |
| ReDoS prevention | All regex patterns in `PIIFilterPlugin` are linear (no nested quantifiers) |
| Secret sanitization | `LoggerPlugin.sanitizeForLog()` redacts keys matching `apikey`, `secret`, `token`, `password`, `auth`, `credential`, `bearer` |
| JSON hardening | All `JSON.parse` calls on external/cached data are wrapped; corrupted Redis entries are auto-evicted |
| Audit trail | `AIActionTagPlugin` tags every AI-initiated action with `source`, `operation`, `confidence`, `model`, `timestamp` |
| Least privilege | `ApiSkillPlugin` only exposes endpoints you explicitly register |

---

## Enterprise & Compliance

tekimax-omat provides security controls that support compliance in regulated environments — but the SDK itself is **not certified** under HIPAA, FERPA, or SOC 2. These standards require organizational policies, formal audits, and legal agreements that are your responsibility.

**What the SDK provides:**
- `PIIFilterPlugin` — redacts PHI and student PII before any data leaves your network
- `FairnessAuditPlugin` — demographics are never sent to AI providers (FERPA-aligned)
- `AIActionTagPlugin` — audit trail infrastructure for AI-initiated actions
- SSRF blocking — prevents data exfiltration to internal or metadata endpoints
- Cosign-signed artifacts + Trivy CVE scanning — supply chain integrity

**What you still need (per standard):**
- **HIPAA**: BAA with your AI providers; HIPAA risk assessment; breach notification SOP
- **FERPA**: Data retention policy; FERPA officer; incident response procedure
- **SOC 2**: Formal audit; access control and change management policies

If your organization requires:

- **SBOM (Software Bill of Materials)**
- **Full security control inventory for your auditors**
- **Custom CVE SLAs**
- **Penetration testing coordination**
- **Compliance guidance for your deployment**

Contact `enterprise@tekimax.com`.

---

## Scope

In-scope for security reports:

- `packages/tekimax-ts/src/` — core SDK and plugins
- `apps/demo/` — demo application
- Supply chain / dependency vulnerabilities affecting published npm package

Out of scope:

- Vulnerabilities in your own deployment or configuration
- Social engineering attacks
- Issues requiring physical access
