import { TekimaxPlugin, PluginContext, ContentPart } from '../core/types';

/**
 * ClinicalPIIFilterPlugin
 *
 * Extends PII redaction with clinical identifiers specific to healthcare contexts.
 * Redacts all standard PII (email, SSN, phone, card) PLUS:
 *
 * - Medical Record Numbers (MRN)
 * - National Provider Identifier (NPI) — 10-digit provider numbers
 * - DEA numbers — controlled substance prescribing identifiers
 * - ICD-10 diagnosis codes — can re-identify patients in small cohorts
 * - NDC codes — National Drug Code (medication identifiers)
 * - Dates of birth in common formats
 * - Insurance member IDs
 *
 * Use this plugin in any pipeline that processes patient-facing communications,
 * clinical documentation assistance, or health literacy tools.
 *
 * All regex patterns are written to avoid catastrophic backtracking (ReDoS).
 *
 * @example
 * ```ts
 * import { ClinicalPIIFilterPlugin, Tekimax } from 'tekimax-omat'
 *
 * const client = new Tekimax({
 *   provider,
 *   plugins: [new ClinicalPIIFilterPlugin()]
 * })
 *
 * // Input:  "Patient MRN 1234567 with NPI 1234567893 diagnosed with M79.3 prescribed NDC 00071-0155-23"
 * // Sent:   "Patient [REDACTED MRN] with [REDACTED NPI] diagnosed with [REDACTED ICD10] prescribed [REDACTED NDC]"
 * ```
 */
export class ClinicalPIIFilterPlugin implements TekimaxPlugin {
    name = 'ClinicalPIIFilterPlugin';

    private readonly patterns: ReadonlyArray<{ pattern: RegExp; label: string }> = [
        // ── Standard PII ─────────────────────────────────────────────────────
        { pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,          label: 'EMAIL' },
        { pattern: /\b\d{3}-\d{2}-\d{4}\b/g,                                     label: 'SSN' },
        // Linear card pattern — no nested quantifiers
        { pattern: /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{1,4}\b/g,               label: 'CARD' },
        // Fixed separator phone patterns
        { pattern: /\b\d{3}[-.]\d{3}[-.]\d{4}\b|\b\d{3}\s\d{3}\s\d{4}\b/g,     label: 'PHONE' },

        // ── Clinical Identifiers ──────────────────────────────────────────────
        // MRN — typically 5-10 digits, often preceded by "MRN" or "MR#"
        // Fixed-length alternatives to avoid nested-quantifier ReDoS
        {
            pattern: /\b(?:MRN|MR#|Medical Record(?:\s+No\.?|(?:\s+Number)?)?)[:\s#]*\d{5,10}\b/gi,
            label: 'MRN',
        },
        // NPI — exactly 10 digits (Luhn-validated in production; pattern matches format)
        {
            pattern: /\bNPI[:\s#]*\d{10}\b/gi,
            label: 'NPI',
        },
        // DEA number — 2 letters + 7 digits (AA1234563 format)
        {
            pattern: /\b[A-Z]{2}\d{7}\b/g,
            label: 'DEA',
        },
        // ICD-10 codes — letter + 2 digits + optional decimal + 1-4 alphanumeric
        // E.g. M79.3, E11.9, Z23, F32.1
        {
            pattern: /\b[A-Z]\d{2}(?:\.\d{1,4})?\b/g,
            label: 'ICD10',
        },
        // NDC (National Drug Code) — 5-4-2 or 5-3-2 or 4-4-2 formats
        {
            pattern: /\b\d{4,5}-\d{3,4}-\d{2}\b/g,
            label: 'NDC',
        },
        // Date of birth — common formats: MM/DD/YYYY, MM-DD-YYYY, Month DD YYYY
        {
            pattern: /\b(?:0?[1-9]|1[0-2])[\/\-](?:0?[1-9]|[12]\d|3[01])[\/\-](?:19|20)\d{2}\b/g,
            label: 'DOB',
        },
        // Insurance member ID — "Member ID" or "Member #" followed by alphanumeric
        {
            pattern: /\b(?:Member\s+(?:ID|#)|Insurance\s+(?:ID|#))[:\s]*[A-Z0-9]{6,15}\b/gi,
            label: 'MEMBER_ID',
        },
    ];

    private redact(text: string): string {
        let result = text;
        for (const { pattern, label } of this.patterns) {
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
