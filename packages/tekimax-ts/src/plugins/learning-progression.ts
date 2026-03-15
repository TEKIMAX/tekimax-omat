import type { TekimaxPlugin, PluginContext, ChatResult } from '../core/types'
import type { LearningProgressionStep, FormativeFeedback } from '../assessment/types'

export interface LearningProgressionConfig {
    /**
     * Map of criterion ID → ordered progression steps.
     * Steps should be ordered from earliest (1) to most advanced.
     */
    progressions: Record<string, LearningProgressionStep[]>
}

/**
 * LearningProgressionPlugin
 *
 * After feedback is generated, maps each criterion score to a position
 * on a developmental learning progression and annotates the feedback with:
 * - The current stage description
 * - The next milestone to work toward
 * - Specific observable indicators for the current stage
 *
 * Inspired by the K-12 AI Infrastructure Program's requirement to
 * ground AI feedback in learning sciences research, this plugin gives educators
 * and trainers actionable developmental context across any assessment domain.
 *
 * @example
 * ```ts
 * const progressionPlugin = new LearningProgressionPlugin({
 *   progressions: {
 *     'argument-structure': [
 *       { sequence: 1, description: 'States an opinion', typicalGrade: '2', indicators: ['Uses "I think"', 'No supporting reasons'] },
 *       { sequence: 2, description: 'Gives one reason', typicalGrade: '3', indicators: ['Provides one reason', 'May not elaborate'] },
 *       { sequence: 3, description: 'Multiple reasons with evidence', typicalGrade: '4', indicators: ['2+ reasons', 'Cites text evidence'] },
 *     ]
 *   }
 * })
 * ```
 */
export class LearningProgressionPlugin implements TekimaxPlugin {
    name = 'LearningProgressionPlugin'

    private progressions: Record<string, LearningProgressionStep[]>

    constructor(config: LearningProgressionConfig) {
        // Sort each progression by sequence ascending
        this.progressions = Object.fromEntries(
            Object.entries(config.progressions).map(([id, steps]) => [
                id,
                [...steps].sort((a, b) => a.sequence - b.sequence),
            ])
        )
    }

    async afterResponse(_context: PluginContext, result: ChatResult): Promise<void> {
        const feedback = (result as any).assessmentFeedback as FormativeFeedback | undefined
        if (!feedback) return

        this.annotate(feedback)
    }

    /**
     * Annotate feedback in-place with progression context.
     * Can be called directly for pipeline integration.
     */
    annotate(feedback: FormativeFeedback): void {
        for (const score of feedback.scores) {
            const progression = this.progressions[score.criterionId]
            if (!progression || progression.length === 0) continue

            // Map score to a progression step by proportional position
            const criterion = this.findCriterionStep(progression, score.score, score.normalizedPosition)

            if (criterion.current) {
                score.progressionStep = criterion.current.sequence
                if (!score.nextMilestone && criterion.next) {
                    score.nextMilestone = criterion.next.description
                }

                // Append progression context to suggestions if not already present
                if (criterion.next && !score.suggestions.some(s => s.includes(criterion.next!.description))) {
                    const nextIndicators = criterion.next.indicators.slice(0, 2).join('; ')
                    score.suggestions.push(
                        `Work toward: ${criterion.next.description}${nextIndicators ? ` — try to show: ${nextIndicators}` : ''}`
                    )
                }
            }
        }
    }

    /**
     * Get the full progression for a criterion by ID.
     */
    getProgression(criterionId: string): LearningProgressionStep[] | undefined {
        return this.progressions[criterionId]
    }

    // ── Private ───────────────────────────────────────────────────────────────

    private findCriterionStep(
        steps: LearningProgressionStep[],
        _score: number,
        normalizedPosition?: number
    ): { current: LearningProgressionStep | null; next: LearningProgressionStep | null } {
        if (steps.length === 0) return { current: null, next: null }

        // Use normalized 0-1 position to map onto progression
        const pos = normalizedPosition ?? 0
        const index = Math.min(
            Math.floor(pos * steps.length),
            steps.length - 1
        )

        return {
            current: steps[index] ?? null,
            next: steps[index + 1] ?? null,
        }
    }
}

// Extend CriterionScore type to add normalizedPosition for internal use
declare module '../assessment/types' {
    interface CriterionScore {
        /** Internal: 0–1 position used by LearningProgressionPlugin */
        normalizedPosition?: number
    }
}
