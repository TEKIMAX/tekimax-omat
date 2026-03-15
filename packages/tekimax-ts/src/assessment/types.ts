import { z } from 'zod'

// ─── Modality ─────────────────────────────────────────────────────────────────

export type ResponseModality = 'text' | 'speech' | 'drawing' | 'handwriting'

// ─── Demographics (for FairnessAuditPlugin) ──────────────────────────────────

export interface DemographicTag {
    /** Grade level: 'K', '1' … '12' */
    gradeLevel?: string
    /** BCP-47 language tag, e.g. 'en-US', 'es-MX', 'zh-TW' */
    language?: string
    /** English Language Learner proficiency status */
    ellStatus?: 'none' | 'beginner' | 'intermediate' | 'advanced' | 'reclassified'
    /** Disability / special education designations */
    disabilityStatus?: Array<'IEP' | '504' | 'GT' | 'other'>
    /** Socioeconomic / program subgroups */
    subgroup?: Array<'FRL' | 'migrant' | 'homeless' | 'foster' | 'military'>
    /** Geographic context */
    locale?: 'urban' | 'suburban' | 'rural' | 'tribal'
}

// ─── Student Response ─────────────────────────────────────────────────────────

export interface StudentResponse {
    /** Unique identifier for this response */
    id: string
    /** Primary input modality */
    modality: ResponseModality
    /** Text response (modality='text') or transcribed speech */
    text?: string
    /** Raw audio — base64 string or Buffer (modality='speech') */
    audio?: string | Buffer
    /** Drawing or handwriting image — base64 data URI, URL, or Buffer */
    image?: string | Buffer
    /** Demographic metadata for fairness auditing. Never sent to the model. */
    demographics?: DemographicTag
    /** ISO 639-1 language code of the response content (default: 'en') */
    language?: string
    /** Unix ms timestamp */
    timestamp?: number
    /** Additional context (e.g. the prompt/task the student was responding to) */
    taskPrompt?: string
}

// ─── Rubric ───────────────────────────────────────────────────────────────────

export interface RubricLevel {
    /** Numeric score for this level (e.g. 0–4) */
    score: number
    /** Label: 'Exceeds', 'Meets', 'Approaching', 'Beginning', etc. */
    label: string
    /** Full descriptor of what student work at this level looks like */
    descriptor: string
    /** Anchor examples of student work at this level */
    examples?: string[]
}

export interface LearningProgressionStep {
    /** Sequence number — 1 = earliest developmental stage */
    sequence: number
    /** Description of this stage in student-observable terms */
    description: string
    /** Typical grade level where students reach this stage */
    typicalGrade?: string
    /** Observable indicators that a student is at this stage */
    indicators: string[]
}

export interface RubricCriterion {
    id: string
    name: string
    description: string
    levels: RubricLevel[]
    /** Developmental progression this criterion maps onto */
    learningProgression?: LearningProgressionStep[]
    /** Academic standard this criterion addresses (e.g. CCSS.ELA-LITERACY.W.3.1) */
    standard?: string
    /** Weight for overall score calculation (default: 1) */
    weight?: number
}

export interface Rubric {
    id: string
    name: string
    description?: string
    subject?: string
    /** Grade range: ['3', '5'] means grades 3–5 */
    gradeRange?: [string, string]
    criteria: RubricCriterion[]
    /** Max possible score (computed if not set) */
    maxScore?: number
}

// ─── Formative Feedback ───────────────────────────────────────────────────────

export interface CriterionScore {
    criterionId: string
    criterionName: string
    score: number
    levelLabel: string
    /** Rationale grounded in the rubric descriptor */
    rationale: string
    /** Direct quotes or paraphrases from the student's response as evidence */
    evidence: string[]
    /** Concrete, actionable next steps for this criterion */
    suggestions: string[]
    /** Where on the learning progression this response falls */
    progressionStep?: number
    /** Brief description of the next progression milestone */
    nextMilestone?: string
}

export interface FormativeFeedback {
    /** Matches the StudentResponse.id this feedback is for */
    responseId: string
    rubricId: string
    /** Summary feedback narrative — affirming, asset-based tone */
    overall: string
    /** Per-criterion scores */
    scores: CriterionScore[]
    /** 2–3 specific strengths identified in the response */
    strengths: string[]
    /** 1–2 prioritized next steps (not overwhelming) */
    nextSteps: string[]
    /** Short affirming closing statement — always present */
    encouragement: string
    /** Language the feedback was generated in (BCP-47) */
    language: string
    /** Weighted overall score (0–1 normalized) */
    normalizedScore: number
    /** Unix ms timestamp */
    generatedAt: number
    /** Model that produced this feedback */
    model: string
}

// ─── Fairness ─────────────────────────────────────────────────────────────────

export interface DemographicGroup {
    /** Tag value, e.g. 'ELL:beginner', 'grade:3', 'FRL' */
    tag: string
    /** Number of responses in this group */
    n: number
    /** Mean normalized score */
    averageScore: number
    /** Level label → count */
    scoreDistribution: Record<string, number>
    /** Fraction of feedback items that contain ≥1 concrete suggestion */
    actionabilityRate: number
    /** Mean suggestions per feedback item */
    avgSuggestionsPerResponse: number
}

export interface DisparityFlag {
    group: string
    metric: 'score' | 'actionability' | 'suggestions'
    groupValue: number
    overallValue: number
    /** Absolute gap */
    gap: number
    severity: 'info' | 'warning' | 'critical'
    description: string
}

export interface FairnessReport {
    totalResponses: number
    overallAverageScore: number
    overallActionabilityRate: number
    groups: DemographicGroup[]
    disparityFlags: DisparityFlag[]
    /** ISO 8601 */
    generatedAt: string
    /** FAIR metadata for public goods release */
    fair: FAIRMetadata
}

// ─── Benchmark ────────────────────────────────────────────────────────────────

export interface BenchmarkItem {
    id: string
    studentResponse: StudentResponse
    /** Human expert scores for accuracy comparison */
    humanScores?: Record<string, number>
    /** Full human expert feedback for qualitative comparison */
    humanFeedback?: Partial<FormativeFeedback>
}

export interface BenchmarkSuite {
    id: string
    name: string
    description: string
    subject?: string
    gradeRange?: [string, string]
    items: BenchmarkItem[]
    rubric: Rubric
    /** FAIR metadata */
    fair?: Partial<FAIRMetadata>
}

export interface BenchmarkMetric {
    name: string
    /** 0–1 normalized score */
    score: number
    /** Human-readable interpretation */
    grade: 'excellent' | 'good' | 'fair' | 'poor'
    details: Record<string, unknown>
}

export interface BenchmarkResult {
    suiteId: string
    suiteName: string
    model: string
    provider: string
    /** Score agreement with human ratings (Cohen's kappa or %) */
    accuracy: BenchmarkMetric
    /** Demographic disparity across subgroups */
    fairness: BenchmarkMetric
    /** % of feedback with ≥1 concrete, actionable suggestion */
    actionability: BenchmarkMetric
    /** Rubric criterion coverage and evidence grounding */
    alignment: BenchmarkMetric
    runAt: string
    /** FAIR metadata for public goods archival */
    fair: FAIRMetadata
}

// ─── FAIR Metadata (public goods release) ────────────────────────────────────

export interface FAIRMetadata {
    /** Digital Object Identifier assigned by the program repository */
    doi?: string
    /** Apache-2.0 for code, CC-BY-4.0 for datasets/content */
    license: 'Apache-2.0' | 'CC-BY-4.0'
    /** Semantic version */
    version: string
    /** ISO 8601 */
    createdAt: string
    /** Human-readable description */
    description?: string
    /** Keywords for discoverability */
    keywords?: string[]
    /** Creator organization(s) */
    creators?: string[]
}

// ─── Zod Schemas ──────────────────────────────────────────────────────────────

export const rubricLevelSchema = z.object({
    score: z.number().int().min(0),
    label: z.string().min(1),
    descriptor: z.string().min(1),
    examples: z.array(z.string()).optional(),
})

export const learningProgressionStepSchema = z.object({
    sequence: z.number().int().positive(),
    description: z.string().min(1),
    typicalGrade: z.string().optional(),
    indicators: z.array(z.string()).min(1),
})

export const rubricCriterionSchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().min(1),
    levels: z.array(rubricLevelSchema).min(2),
    learningProgression: z.array(learningProgressionStepSchema).optional(),
    standard: z.string().optional(),
    weight: z.number().positive().optional(),
})

export const rubricSchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    subject: z.string().optional(),
    gradeRange: z.tuple([z.string(), z.string()]).optional(),
    criteria: z.array(rubricCriterionSchema).min(1),
    maxScore: z.number().optional(),
})

export const criterionScoreSchema = z.object({
    criterionId: z.string(),
    criterionName: z.string(),
    score: z.number(),
    levelLabel: z.string(),
    rationale: z.string().min(10),
    evidence: z.array(z.string()),
    suggestions: z.array(z.string()),
    progressionStep: z.number().optional(),
    nextMilestone: z.string().optional(),
})

export const formativeFeedbackSchema = z.object({
    responseId: z.string(),
    rubricId: z.string(),
    overall: z.string().min(20),
    scores: z.array(criterionScoreSchema),
    strengths: z.array(z.string()).min(1).max(5),
    nextSteps: z.array(z.string()).min(1).max(3),
    encouragement: z.string().min(5),
    language: z.string(),
    normalizedScore: z.number().min(0).max(1),
    generatedAt: z.number(),
    model: z.string(),
})
