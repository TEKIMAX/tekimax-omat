import { z } from 'zod'
import { AssessmentPipeline, type AssessmentPipelineConfig } from './pipeline'
import type { Rubric, FormativeFeedback, RubricLevel, FAIRMetadata, ResponseModality } from './types'

// ─── Patient / Health Literacy Demographics ───────────────────────────────────

export type HealthLiteracyLevel =
    | 'below-basic'   // Cannot perform most literacy tasks
    | 'basic'          // Simple, concrete literacy tasks
    | 'intermediate'   // Moderately complex tasks
    | 'proficient'     // Complex, challenging tasks

export type CareContext =
    | 'primary-care'
    | 'emergency'
    | 'chronic-disease'
    | 'behavioral-health'
    | 'maternal-health'
    | 'pediatric'
    | 'oncology'
    | 'rehabilitation'
    | 'community-health'
    | 'telehealth'

/**
 * Patient or participant demographic context for health literacy assessments.
 * Never sent to the AI model — stored locally for equity reporting only.
 */
export interface HealthDemographicTag {
    /** Self-reported health literacy level (if known) */
    healthLiteracyLevel?: HealthLiteracyLevel
    /** Care context where communication is happening */
    careContext?: CareContext
    /** BCP-47 language tag — determines feedback language */
    language?: string
    /** Age group (used to adjust communication style) */
    ageGroup?: 'pediatric' | 'adult' | 'older-adult'
    /** Whether patient has limited English proficiency */
    limitedEnglishProficiency?: boolean
    /** Whether patient is navigating care for a family member, not themselves */
    caregiverContext?: boolean
    /** Geographic context */
    locale?: 'urban' | 'suburban' | 'rural' | 'tribal'
}

// ─── Patient Response ─────────────────────────────────────────────────────────

/**
 * A patient or participant response in a health literacy or communication context.
 */
export interface PatientResponse {
    /** Unique identifier */
    id: string
    /** Input modality */
    modality: ResponseModality
    /** Text response or transcribed speech */
    text?: string
    /** Raw audio — base64 string or Buffer */
    audio?: string | Buffer
    /** Image (e.g. filled-in diagram, written response) — base64 data URI, URL, or Buffer */
    image?: string | Buffer
    /** Demographic context for equity reporting. Never sent to the model. */
    demographics?: HealthDemographicTag
    /** BCP-47 language code of the response */
    language?: string
    /** Unix ms timestamp */
    timestamp?: number
    /** The health communication task or prompt */
    taskPrompt?: string
    /** Clinical context — e.g. 'Patient discharge instructions for CHF' */
    clinicalContext?: string
}

// ─── Health Literacy Rubric ───────────────────────────────────────────────────

export interface HealthLiteracyCriterion {
    id: string
    name: string
    description: string
    levels: RubricLevel[]
    /** Plain language principle this criterion addresses */
    plainLanguagePrinciple?: string
    weight?: number
}

export interface HealthLiteracyRubric extends Omit<Rubric, 'criteria'> {
    criteria: HealthLiteracyCriterion[]
    /** Clinical domain this rubric is designed for */
    clinicalDomain?: string
    /** Reading level target for communications assessed by this rubric */
    targetReadingLevel?: string  // e.g. '6th grade', '8th grade'
    fair?: Partial<FAIRMetadata>
}

// ─── Zod schemas ─────────────────────────────────────────────────────────────

export const healthDemographicTagSchema = z.object({
    healthLiteracyLevel: z.enum(['below-basic', 'basic', 'intermediate', 'proficient']).optional(),
    careContext: z.string().optional(),
    language: z.string().optional(),
    ageGroup: z.enum(['pediatric', 'adult', 'older-adult']).optional(),
    limitedEnglishProficiency: z.boolean().optional(),
    caregiverContext: z.boolean().optional(),
    locale: z.enum(['urban', 'suburban', 'rural', 'tribal']).optional(),
})

// ─── HealthLiteracyPipeline ───────────────────────────────────────────────────

/**
 * AssessmentPipeline variant for health literacy and patient communication contexts.
 *
 * Differences from the base pipeline:
 * - System prompt uses health communication framing (not K-12)
 * - Feedback is patient-centered, plain language, and actionable
 * - Encouragement acknowledges health system complexity and navigation challenges
 * - `assessPatient()` accepts PatientResponse with HealthDemographicTag
 * - Demographics stored locally; never included in model prompts
 *
 * @example
 * ```ts
 * const pipeline = new HealthLiteracyPipeline({
 *   provider,
 *   model: 'gpt-4o',
 *   rubric: DISCHARGE_INSTRUCTIONS_RUBRIC,
 *   clinicalContext: 'Post-operative discharge instructions for knee replacement',
 * })
 *
 * const feedback = await pipeline.assessPatient({
 *   id: 'p-001',
 *   modality: 'text',
 *   text: 'I need to keep my knee elevated and take my pain medication every 6 hours...',
 *   demographics: { healthLiteracyLevel: 'basic', language: 'es', limitedEnglishProficiency: true }
 * })
 * ```
 */
export class HealthLiteracyPipeline extends AssessmentPipeline {
    private clinicalContext?: string

    constructor(config: AssessmentPipelineConfig & {
        /** Clinical context for the assessor, e.g. 'Discharge instructions for CHF' */
        clinicalContext?: string
    }) {
        super(config)
        this.clinicalContext = config.clinicalContext
    }

    /**
     * Assess a patient response. Demographics are stored locally and never sent to the model.
     */
    async assessPatient(response: PatientResponse): Promise<FormativeFeedback> {
        // Add clinical context to the task prompt if provided and not already present
        const enriched: PatientResponse = this.clinicalContext && !response.clinicalContext
            ? { ...response, clinicalContext: this.clinicalContext }
            : response

        return this.assess(enriched as Parameters<typeof this.assess>[0])
    }

    /**
     * Assess multiple patient responses sequentially.
     */
    async assessPatientBatch(responses: PatientResponse[]): Promise<FormativeFeedback[]> {
        const results: FormativeFeedback[] = []
        for (const r of responses) {
            results.push(await this.assessPatient(r))
        }
        return results
    }
}

// ─── Starter Rubric Factories ─────────────────────────────────────────────────

/**
 * Starter rubric for assessing patient comprehension of health information.
 * Based on plain language and health literacy best practices (CDC, AHRQ).
 */
export const HEALTH_LITERACY_COMPREHENSION_RUBRIC: HealthLiteracyRubric = {
    id: 'hl-comprehension-v1',
    name: 'Health Information Comprehension',
    description: 'Assesses whether a patient can accurately recall, interpret, and act on health information',
    clinicalDomain: 'general',
    targetReadingLevel: '6th grade',
    criteria: [
        {
            id: 'recall',
            name: 'Information Recall',
            description: 'Can accurately recall the key health information provided',
            plainLanguagePrinciple: 'Use active voice and present information clearly',
            levels: [
                { score: 1, label: 'Minimal', descriptor: 'Recalls little or no key information; critical details missing or incorrect' },
                { score: 2, label: 'Partial', descriptor: 'Recalls some key information but misses or misidentifies important details' },
                { score: 3, label: 'Adequate', descriptor: 'Recalls most key information accurately with minor omissions' },
                { score: 4, label: 'Complete', descriptor: 'Recalls all key information accurately and completely' },
            ],
            weight: 1,
        },
        {
            id: 'interpretation',
            name: 'Meaning & Application',
            description: 'Correctly interprets what the information means for their situation',
            plainLanguagePrinciple: 'Explain what patients need to do, not just what they need to know',
            levels: [
                { score: 1, label: 'Minimal', descriptor: 'Cannot connect information to their situation or what to do' },
                { score: 2, label: 'Partial', descriptor: 'Partially understands implications; some misinterpretation present' },
                { score: 3, label: 'Adequate', descriptor: 'Correctly interprets most implications for their situation' },
                { score: 4, label: 'Complete', descriptor: 'Fully connects information to their situation and knows what to do next' },
            ],
            weight: 1.5,
        },
        {
            id: 'action-steps',
            name: 'Actionable Next Steps',
            description: 'Can identify concrete actions they need to take',
            plainLanguagePrinciple: 'Limit to three to five key action points; use numbered lists',
            levels: [
                { score: 1, label: 'Minimal', descriptor: 'Cannot identify any concrete next steps' },
                { score: 2, label: 'Partial', descriptor: 'Identifies some steps but misses critical ones or has incorrect steps' },
                { score: 3, label: 'Adequate', descriptor: 'Identifies most required steps accurately' },
                { score: 4, label: 'Complete', descriptor: 'Identifies all required steps correctly and in appropriate sequence' },
            ],
            weight: 2,
        },
        {
            id: 'safety-signals',
            name: 'Safety & Warning Signs',
            description: 'Understands when to seek help or call a provider',
            plainLanguagePrinciple: 'Always state what patients should watch for and what to do if it happens',
            levels: [
                { score: 1, label: 'Minimal', descriptor: 'Does not recognize any warning signs or when to seek help' },
                { score: 2, label: 'Partial', descriptor: 'Recognizes some warning signs but not all critical ones' },
                { score: 3, label: 'Adequate', descriptor: 'Correctly identifies most warning signs and appropriate responses' },
                { score: 4, label: 'Complete', descriptor: 'Fully understands all warning signs and exactly when and how to seek help' },
            ],
            weight: 2,
        },
    ],
    maxScore: undefined,
}

/**
 * Starter rubric for assessing patient understanding of medication instructions.
 */
export const MEDICATION_INSTRUCTIONS_RUBRIC: HealthLiteracyRubric = {
    id: 'hl-medication-v1',
    name: 'Medication Instructions Comprehension',
    description: 'Assesses patient ability to accurately follow medication instructions',
    clinicalDomain: 'medication management',
    targetReadingLevel: '6th grade',
    criteria: [
        {
            id: 'dose-timing',
            name: 'Dose and Timing',
            description: 'Knows correct dosage and when to take medication',
            levels: [
                { score: 1, label: 'Minimal', descriptor: 'Cannot state correct dose or timing' },
                { score: 2, label: 'Partial', descriptor: 'Knows one (dose or timing) but not both accurately' },
                { score: 3, label: 'Adequate', descriptor: 'States both dose and timing correctly' },
                { score: 4, label: 'Complete', descriptor: 'States dose, timing, and duration accurately; knows what to do if a dose is missed' },
            ],
            weight: 2,
        },
        {
            id: 'food-interactions',
            name: 'Food and Drug Interactions',
            description: 'Understands what to avoid while taking this medication',
            levels: [
                { score: 1, label: 'Minimal', descriptor: 'Unaware of any interactions or restrictions' },
                { score: 2, label: 'Partial', descriptor: 'Aware of some but not all relevant interactions' },
                { score: 3, label: 'Adequate', descriptor: 'Correctly identifies primary interactions and restrictions' },
                { score: 4, label: 'Complete', descriptor: 'Fully understands all interactions, restrictions, and why they matter' },
            ],
            weight: 1,
        },
        {
            id: 'side-effects',
            name: 'Side Effects to Watch For',
            description: 'Can identify when to stop or seek help due to side effects',
            levels: [
                { score: 1, label: 'Minimal', descriptor: 'Cannot name any relevant side effects or warning signs' },
                { score: 2, label: 'Partial', descriptor: 'Knows some side effects but not the critical ones requiring action' },
                { score: 3, label: 'Adequate', descriptor: 'Correctly identifies side effects that require calling a provider' },
                { score: 4, label: 'Complete', descriptor: 'Knows all key side effects, their severity, and what to do for each' },
            ],
            weight: 2,
        },
    ],
}
