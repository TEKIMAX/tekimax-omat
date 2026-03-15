import { z } from 'zod'
import { AssessmentPipeline, type AssessmentPipelineConfig } from './pipeline'
import { FairnessAuditPlugin } from '../plugins/fairness-audit'
import type {
    Rubric,
    FormativeFeedback,
    RubricLevel,
    FairnessReport,
    FAIRMetadata,
    ResponseModality,
} from './types'

// ─── Workforce Demographics ───────────────────────────────────────────────────

export type CompetencyLevel = 'foundational' | 'developing' | 'proficient' | 'advanced' | 'expert'

export type EmploymentStatus =
    | 'employed'
    | 'unemployed'
    | 'underemployed'
    | 'in-training'
    | 'seeking'

export type WorkforceProgram =
    | 'WIOA'            // Workforce Innovation and Opportunity Act
    | 'YouthBuild'
    | 'ApprenticeshipUSA'
    | 'AmeriCorps'
    | 'PerkinsCTE'      // Career & Technical Education
    | 'SNAP-ET'         // SNAP Employment & Training
    | 'TAA'             // Trade Adjustment Assistance
    | 'JobCorps'
    | 'custom'

export type WorkforceBarrier =
    | 'justice-involved'
    | 'housing-insecure'
    | 'veteran'
    | 'disability'
    | 'language'
    | 'childcare'
    | 'transportation'
    | 'digital-access'

/**
 * Workforce-specific demographic context.
 * Never sent to the model — stored locally for equity reporting only.
 */
export interface WorkforceDemographicTag {
    /** Current employment situation */
    employmentStatus?: EmploymentStatus
    /** Program sponsoring training */
    program?: WorkforceProgram | string
    /** Target credential or certification, e.g. 'CompTIA A+', 'CNA', 'CDL-A' */
    credentialTarget?: string
    /** O*NET-SOC code for the target occupation, e.g. '15-1252.00' */
    occupationCode?: string
    /** Current self-reported competency level in this domain */
    competencyLevel?: CompetencyLevel
    /** Barriers to employment that may affect assessment context */
    barriers?: WorkforceBarrier[]
    /** Age cohort */
    ageGroup?: 'youth' | 'adult' | 'older-worker'
    /** BCP-47 language tag */
    language?: string
    /** Geographic context */
    locale?: 'urban' | 'suburban' | 'rural' | 'tribal'
}

// ─── Workforce Response ───────────────────────────────────────────────────────

export type WorkforceAssessmentType =
    | 'skills-check'
    | 'competency-demonstration'
    | 'portfolio-review'
    | 'exit-assessment'
    | 'credential-prep'

/**
 * A workforce participant response for competency or skills assessment.
 */
export interface WorkforceResponse {
    /** Unique identifier */
    id: string
    /** Input modality */
    modality: ResponseModality
    /** Text response or transcribed speech */
    text?: string
    /** Raw audio — base64 string or Buffer */
    audio?: string | Buffer
    /** Drawing, diagram, or document image — base64 data URI, URL, or Buffer */
    image?: string | Buffer
    /** Demographic context for equity reporting. Never sent to the model. */
    demographics?: WorkforceDemographicTag
    /** BCP-47 language code of the response (default: 'en') */
    language?: string
    /** Unix ms timestamp */
    timestamp?: number
    /** The task or prompt the participant was responding to */
    taskPrompt?: string
    /** Industry or occupational context for the assessor */
    occupationalContext?: string
    /** Type of assessment this response belongs to */
    assessmentType?: WorkforceAssessmentType
}

// ─── Workforce Rubric ─────────────────────────────────────────────────────────

export interface CompetencyProgressionStep {
    /** Sequence number — 1 = earliest stage */
    sequence: number
    /** Description of competency at this stage */
    description: string
    /** Typical experience level when workers reach this stage */
    typicalExperience?: string   // e.g. '0-6 months', '1-2 years'
    /** Observable, job-relevant indicators */
    indicators: string[]
    /** Credentials or certifications typically earned at this stage */
    credentials?: string[]
}

export interface WorkforceRubricCriterion {
    id: string
    name: string
    description: string
    levels: RubricLevel[]
    /** Workforce competency progression */
    competencyProgression?: CompetencyProgressionStep[]
    /** O*NET competency or skill element this maps to */
    onetElement?: string
    /** Industry or credential framework standard, e.g. 'NOCTI', 'NIMS' */
    standard?: string
    weight?: number
}

export interface WorkforceRubric {
    id: string
    name: string
    description?: string
    /** Target occupation or industry, e.g. 'Healthcare Support', 'IT' */
    occupation?: string
    /** O*NET-SOC code */
    occupationCode?: string
    /** Target credential(s) */
    credentials?: string[]
    criteria: WorkforceRubricCriterion[]
    maxScore?: number
    /** FAIR metadata for grant/program reporting */
    fair?: Partial<FAIRMetadata>
}

// ─── Zod schemas ─────────────────────────────────────────────────────────────

export const workforceDemographicTagSchema = z.object({
    employmentStatus: z.enum(['employed', 'unemployed', 'underemployed', 'in-training', 'seeking']).optional(),
    program: z.string().optional(),
    credentialTarget: z.string().optional(),
    occupationCode: z.string().optional(),
    competencyLevel: z.enum(['foundational', 'developing', 'proficient', 'advanced', 'expert']).optional(),
    barriers: z.array(z.string()).optional(),
    ageGroup: z.enum(['youth', 'adult', 'older-worker']).optional(),
    language: z.string().optional(),
    locale: z.enum(['urban', 'suburban', 'rural', 'tribal']).optional(),
})

// ─── WorkforceFairnessAuditPlugin ─────────────────────────────────────────────

/**
 * FairnessAuditPlugin adapted for workforce context.
 * Tags responses by employment status, program, barriers, age group, and credential target.
 * Disparity reporting helps programs identify equity gaps before grant reporting.
 */
export class WorkforceFairnessAuditPlugin extends FairnessAuditPlugin {
    /**
     * Tag the next response with workforce demographic context.
     */
    tagWorkforceResponse(demographics: WorkforceDemographicTag): void {
        const tags: string[] = []
        if (demographics.employmentStatus) tags.push(`status:${demographics.employmentStatus}`)
        if (demographics.program) tags.push(`program:${demographics.program}`)
        if (demographics.credentialTarget) tags.push(`credential:${demographics.credentialTarget}`)
        if (demographics.ageGroup) tags.push(`age:${demographics.ageGroup}`)
        if (demographics.locale) tags.push(`locale:${demographics.locale}`)
        if (demographics.barriers?.length) {
            for (const b of demographics.barriers) tags.push(`barrier:${b}`)
        }
        if (demographics.language) tags.push(`lang:${demographics.language}`)
        this.tagNextResponse(Object.fromEntries(tags.map(t => [t, true])))
    }

    getWorkforceReport(): FairnessReport {
        return this.getReport()
    }
}

// ─── WorkforceAssessmentPipeline ──────────────────────────────────────────────

/**
 * AssessmentPipeline variant for workforce development contexts.
 *
 * Differences from the base pipeline:
 * - System prompt uses workforce/competency framing instead of K-12 framing
 * - Feedback is asset-based and job-relevant (not age-appropriate)
 * - Encouragement acknowledges real barriers (career change, re-entry, language)
 * - `assessWorkforce()` accepts WorkforceResponse with WorkforceDemographicTag
 * - Integrates with WorkforceFairnessAuditPlugin for equity reporting
 *
 * @example
 * ```ts
 * const pipeline = new WorkforceAssessmentPipeline({
 *   provider,
 *   model: 'gpt-4o',
 *   rubric: myCompetencyRubric,
 *   occupationalContext: 'Entry-level IT support technician',
 * })
 *
 * const feedback = await pipeline.assessWorkforce({
 *   id: 'r-001',
 *   modality: 'text',
 *   text: 'To troubleshoot a network issue I would first check...',
 *   demographics: { employmentStatus: 'unemployed', program: 'WIOA', barriers: ['justice-involved'] }
 * })
 * ```
 */
export class WorkforceAssessmentPipeline extends AssessmentPipeline {
    private occupationalContext?: string
    private workforcePlugins: WorkforceFairnessAuditPlugin[]

    constructor(config: AssessmentPipelineConfig & {
        /** Brief description of the occupation/role being assessed */
        occupationalContext?: string
    }) {
        super(config)
        this.occupationalContext = config.occupationalContext
        this.workforcePlugins = (config.plugins ?? []).filter(
            (p): p is WorkforceFairnessAuditPlugin => p instanceof WorkforceFairnessAuditPlugin
        )
    }

    /**
     * Assess a workforce participant response.
     * Demographics are stored locally and never sent to the model.
     */
    async assessWorkforce(response: WorkforceResponse): Promise<FormativeFeedback> {
        // Tag fairness plugins before assessment
        if (response.demographics) {
            for (const plugin of this.workforcePlugins) {
                plugin.tagWorkforceResponse(response.demographics)
            }
        }
        // Cast to StudentResponse shape — all required fields (id, modality, text, audio, image) are present
        return this.assess(response as Parameters<typeof this.assess>[0])
    }

    /**
     * Assess multiple workforce responses sequentially.
     */
    async assessWorkforceBatch(responses: WorkforceResponse[]): Promise<FormativeFeedback[]> {
        const results: FormativeFeedback[] = []
        for (const r of responses) {
            results.push(await this.assessWorkforce(r))
        }
        return results
    }
}

// ─── Starter Rubric Factory ───────────────────────────────────────────────────

/**
 * Generate a starter WIOA-aligned competency rubric.
 * Customize criteria and levels for your specific occupation.
 */
export function createWorkforceRubric(options: {
    id: string
    name: string
    occupation: string
    occupationCode?: string
    criteria?: WorkforceRubricCriterion[]
}): WorkforceRubric {
    const defaultCriteria: WorkforceRubricCriterion[] = [
        {
            id: 'technical-knowledge',
            name: 'Technical Knowledge',
            description: 'Demonstrates relevant occupational knowledge and understanding',
            levels: [
                { score: 1, label: 'Foundational', descriptor: 'Shows basic awareness of concepts; needs significant guidance' },
                { score: 2, label: 'Developing', descriptor: 'Understands core concepts; applies with some support' },
                { score: 3, label: 'Proficient', descriptor: 'Applies knowledge accurately and independently in familiar situations' },
                { score: 4, label: 'Advanced', descriptor: 'Applies knowledge in complex situations; can troubleshoot and adapt' },
            ],
            weight: 1,
        },
        {
            id: 'applied-skills',
            name: 'Applied Skills',
            description: 'Demonstrates ability to perform job-relevant tasks',
            levels: [
                { score: 1, label: 'Foundational', descriptor: 'Can attempt basic tasks with step-by-step guidance' },
                { score: 2, label: 'Developing', descriptor: 'Completes routine tasks with occasional support' },
                { score: 3, label: 'Proficient', descriptor: 'Completes tasks accurately and efficiently without support' },
                { score: 4, label: 'Advanced', descriptor: 'Handles complex tasks; adapts approach when conditions change' },
            ],
            weight: 1,
        },
        {
            id: 'workplace-communication',
            name: 'Workplace Communication',
            description: 'Communicates clearly and professionally in work contexts',
            levels: [
                { score: 1, label: 'Foundational', descriptor: 'Communication is unclear or missing key information' },
                { score: 2, label: 'Developing', descriptor: 'Communicates main points with some gaps or informality' },
                { score: 3, label: 'Proficient', descriptor: 'Communicates clearly, professionally, and completely' },
                { score: 4, label: 'Advanced', descriptor: 'Adapts communication style; handles complex or sensitive situations well' },
            ],
            weight: 0.5,
        },
    ]

    return {
        id: options.id,
        name: options.name,
        occupation: options.occupation,
        occupationCode: options.occupationCode,
        criteria: options.criteria ?? defaultCriteria,
    }
}
