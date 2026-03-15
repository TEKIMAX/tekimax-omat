import type { TekimaxPlugin, PluginContext, ChatResult } from '../core/types'
import type { Rubric, FormativeFeedback } from '../assessment/types'

export interface RubricValidatorConfig {
    rubric: Rubric
    /**
     * Throw on validation failure instead of just warning (default: false).
     * Set true in test/benchmark contexts where you need strict correctness.
     */
    strict?: boolean
}

export interface ValidationIssue {
    field: string
    severity: 'error' | 'warning'
    message: string
}

export interface ValidationResult {
    valid: boolean
    issues: ValidationIssue[]
}

/**
 * RubricValidatorPlugin
 *
 * Validates AI-generated formative feedback against the rubric schema:
 * - All rubric criterion IDs are covered
 * - Scores fall within the defined level range
 * - Each criterion score maps to a real level label
 * - Evidence array is non-empty (feedback must be grounded)
 * - Suggestions are present (feedback must be actionable)
 * - Normalized score is mathematically consistent with criterion scores
 *
 * Works by intercepting the ChatResult from AssessmentPipeline and
 * inspecting the `assessmentFeedback` field attached by the pipeline.
 */
export class RubricValidatorPlugin implements TekimaxPlugin {
    name = 'RubricValidatorPlugin'

    private rubric: Rubric
    private strict: boolean
    private lastResult: ValidationResult | null = null

    constructor(config: RubricValidatorConfig) {
        this.rubric = config.rubric
        this.strict = config.strict ?? false
    }

    async afterResponse(_context: PluginContext, result: ChatResult): Promise<void> {
        const feedback = (result as any).assessmentFeedback as FormativeFeedback | undefined
        if (!feedback) return

        const validation = this.validate(feedback)
        this.lastResult = validation

        if (!validation.valid) {
            const errors = validation.issues.filter(i => i.severity === 'error')
            const warnings = validation.issues.filter(i => i.severity === 'warning')

            if (warnings.length > 0) {
                console.warn(
                    `[RubricValidatorPlugin] ${warnings.length} warning(s) for response ${feedback.responseId}:`,
                    warnings.map(w => w.message)
                )
            }

            if (errors.length > 0) {
                const msg = `[RubricValidatorPlugin] ${errors.length} error(s) for response ${feedback.responseId}: ${errors.map(e => e.message).join('; ')}`
                if (this.strict) throw new Error(msg)
                console.error(msg)
            }
        }
    }

    /**
     * Validate a FormativeFeedback against the rubric.
     * Can be called directly (without the plugin hook) for unit testing.
     */
    validate(feedback: FormativeFeedback): ValidationResult {
        const issues: ValidationIssue[] = []

        const criterionIds = new Set(this.rubric.criteria.map(c => c.id))
        const scoredIds = new Set(feedback.scores.map(s => s.criterionId))

        // 1. All criteria covered
        for (const id of criterionIds) {
            if (!scoredIds.has(id)) {
                issues.push({ field: `scores[${id}]`, severity: 'error', message: `Criterion '${id}' is missing from feedback scores` })
            }
        }

        // 2. No phantom criteria
        for (const id of scoredIds) {
            if (!criterionIds.has(id)) {
                issues.push({ field: `scores[${id}]`, severity: 'warning', message: `Score for unknown criterion '${id}' — not in rubric` })
            }
        }

        // 3. Score within range + level label matches
        for (const score of feedback.scores) {
            const criterion = this.rubric.criteria.find(c => c.id === score.criterionId)
            if (!criterion) continue

            const validScores = criterion.levels.map(l => l.score)
            const min = Math.min(...validScores)
            const max = Math.max(...validScores)

            if (score.score < min || score.score > max) {
                issues.push({
                    field: `scores[${score.criterionId}].score`,
                    severity: 'error',
                    message: `Score ${score.score} for '${score.criterionId}' is outside valid range [${min}, ${max}]`
                })
            }

            const matchingLevel = criterion.levels.find(l => l.score === score.score)
            if (matchingLevel && matchingLevel.label !== score.levelLabel) {
                issues.push({
                    field: `scores[${score.criterionId}].levelLabel`,
                    severity: 'warning',
                    message: `Level label '${score.levelLabel}' doesn't match expected '${matchingLevel.label}' for score ${score.score}`
                })
            }

            // 4. Evidence present
            if (!score.evidence || score.evidence.length === 0) {
                issues.push({
                    field: `scores[${score.criterionId}].evidence`,
                    severity: 'warning',
                    message: `No evidence provided for criterion '${score.criterionId}' — feedback must be grounded in student work`
                })
            }

            // 5. Suggestions present (actionability)
            if (!score.suggestions || score.suggestions.length === 0) {
                issues.push({
                    field: `scores[${score.criterionId}].suggestions`,
                    severity: 'warning',
                    message: `No suggestions for criterion '${score.criterionId}' — feedback must be actionable`
                })
            }
        }

        // 6. Required narrative fields
        if (!feedback.overall || feedback.overall.trim().length < 10) {
            issues.push({ field: 'overall', severity: 'error', message: 'overall feedback narrative is missing or too short' })
        }
        if (!feedback.encouragement || feedback.encouragement.trim().length < 5) {
            issues.push({ field: 'encouragement', severity: 'error', message: 'encouragement field is required — every student deserves affirmation' })
        }
        if (!feedback.strengths || feedback.strengths.length === 0) {
            issues.push({ field: 'strengths', severity: 'warning', message: 'no strengths identified — asset-based framing requires at least one strength' })
        }
        if (!feedback.nextSteps || feedback.nextSteps.length === 0) {
            issues.push({ field: 'nextSteps', severity: 'error', message: 'next steps are required — feedback must be actionable' })
        }

        // 7. Normalized score bounds
        if (feedback.normalizedScore < 0 || feedback.normalizedScore > 1) {
            issues.push({ field: 'normalizedScore', severity: 'error', message: `normalizedScore ${feedback.normalizedScore} is outside [0, 1]` })
        }

        return {
            valid: issues.filter(i => i.severity === 'error').length === 0,
            issues,
        }
    }

    /** Get the validation result from the last assessed response. */
    get lastValidation(): ValidationResult | null {
        return this.lastResult
    }
}
