import type { TekimaxPlugin, PluginContext, ChatResult } from '../core/types'
import type {
    FormativeFeedback,
    DemographicGroup,
    DisparityFlag,
    FairnessReport,
    FAIRMetadata,
} from '../assessment/types'

// ─── Config ───────────────────────────────────────────────────────────────────

export interface FairnessAuditConfig {
    /**
     * Score gap threshold that triggers a 'warning' flag (default: 0.1 = 10%).
     * E.g. if ELL students average 0.15 below overall, flag it.
     */
    warningThreshold?: number
    /**
     * Score gap threshold that triggers a 'critical' flag (default: 0.2 = 20%).
     */
    criticalThreshold?: number
    /**
     * Minimum group size to report (default: 5).
     * Groups smaller than this are not reported individually to protect privacy.
     */
    minGroupSize?: number
    /**
     * FAIR metadata for public goods archival.
     */
    fair?: Partial<FAIRMetadata>
}

// ─── Internal record ──────────────────────────────────────────────────────────

interface AuditRecord {
    feedback: FormativeFeedback
    demographicTags: string[]
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

/**
 * FairnessAuditPlugin
 *
 * Collects `(FormativeFeedback, demographics)` pairs across all assessments
 * and produces structured demographic performance reports for equity analysis.
 *
 * Inspired by the K-12 AI Infrastructure Program's "targeted universalism"
 * principle — tracking outcomes across demographic subgroups including ELL learners,
 * individuals with IEPs/504s, economically disadvantaged populations, and other
 * groups where equity gaps may arise.
 *
 * @example
 * ```ts
 * const fairnessPlugin = new FairnessAuditPlugin({ warningThreshold: 0.1 })
 * const pipeline = new AssessmentPipeline({ ..., plugins: [fairnessPlugin] })
 *
 * await pipeline.assessBatch(responses)
 *
 * const report = fairnessPlugin.getReport()
 * console.log(report.disparityFlags)
 * ```
 */
export class FairnessAuditPlugin implements TekimaxPlugin {
    name = 'FairnessAuditPlugin'

    private cfg: Required<FairnessAuditConfig>
    private records: AuditRecord[] = []
    private pendingTags: string[] = []

    constructor(config: FairnessAuditConfig = {}) {
        this.cfg = {
            warningThreshold: config.warningThreshold ?? 0.1,
            criticalThreshold: config.criticalThreshold ?? 0.2,
            minGroupSize: config.minGroupSize ?? 5,
            fair: config.fair ?? {},
        }
    }

    /**
     * Called by AssessmentPipeline to attach demographic tags before assessment.
     * The tags are never sent to the model — only stored locally for reporting.
     */
    tagNextResponse(demographics: Record<string, unknown>): void {
        this.pendingTags = this.extractTags(demographics)
    }

    async afterResponse(_context: PluginContext, result: ChatResult): Promise<void> {
        const feedback = result.aiTag
            ? undefined  // Already tagged by AIActionTagPlugin
            : undefined

        // The pipeline attaches FormativeFeedback directly on the result via a custom field
        const assessmentFeedback = (result as any).assessmentFeedback as FormativeFeedback | undefined
        if (!assessmentFeedback) {
            this.pendingTags = []
            return
        }

        this.records.push({
            feedback: assessmentFeedback,
            demographicTags: [...this.pendingTags],
        })
        this.pendingTags = []
    }

    /**
     * Record a completed feedback item with its demographic context.
     * Called directly by AssessmentPipeline after generating feedback.
     */
    record(feedback: FormativeFeedback, demographicTags: string[]): void {
        this.records.push({ feedback, demographicTags })
    }

    /**
     * Generate a FairnessReport from all collected records.
     */
    getReport(): FairnessReport {
        const total = this.records.length
        if (total === 0) {
            return this.emptyReport()
        }

        const overallAvg = this.records.reduce((s, r) => s + r.feedback.normalizedScore, 0) / total
        const overallActionability = this.records.reduce((s, r) => {
            const hasAction = r.feedback.scores.some(sc => sc.suggestions.length > 0)
            return s + (hasAction ? 1 : 0)
        }, 0) / total

        // Build groups
        const tagMap = new Map<string, AuditRecord[]>()
        for (const record of this.records) {
            for (const tag of record.demographicTags) {
                if (!tagMap.has(tag)) tagMap.set(tag, [])
                tagMap.get(tag)!.push(record)
            }
        }

        const groups: DemographicGroup[] = []
        for (const [tag, members] of tagMap.entries()) {
            if (members.length < this.cfg.minGroupSize) continue

            const avgScore = members.reduce((s, r) => s + r.feedback.normalizedScore, 0) / members.length
            const actionabilityRate = members.reduce((s, r) => {
                return s + (r.feedback.scores.some(sc => sc.suggestions.length > 0) ? 1 : 0)
            }, 0) / members.length
            const avgSuggestions = members.reduce((s, r) => {
                return s + r.feedback.scores.reduce((ss, sc) => ss + sc.suggestions.length, 0)
            }, 0) / members.length

            const scoreDist: Record<string, number> = {}
            for (const member of members) {
                for (const sc of member.feedback.scores) {
                    scoreDist[sc.levelLabel] = (scoreDist[sc.levelLabel] ?? 0) + 1
                }
            }

            groups.push({
                tag,
                n: members.length,
                averageScore: avgScore,
                scoreDistribution: scoreDist,
                actionabilityRate,
                avgSuggestionsPerResponse: avgSuggestions,
            })
        }

        // Flag disparities
        const flags: DisparityFlag[] = []
        for (const group of groups) {
            const scoreGap = overallAvg - group.averageScore
            if (scoreGap >= this.cfg.criticalThreshold) {
                flags.push(this.makeFlag(group.tag, 'score', group.averageScore, overallAvg, scoreGap, 'critical'))
            } else if (scoreGap >= this.cfg.warningThreshold) {
                flags.push(this.makeFlag(group.tag, 'score', group.averageScore, overallAvg, scoreGap, 'warning'))
            }

            const actionGap = overallActionability - group.actionabilityRate
            if (actionGap >= this.cfg.criticalThreshold) {
                flags.push(this.makeFlag(group.tag, 'actionability', group.actionabilityRate, overallActionability, actionGap, 'critical'))
            } else if (actionGap >= this.cfg.warningThreshold) {
                flags.push(this.makeFlag(group.tag, 'actionability', group.actionabilityRate, overallActionability, actionGap, 'warning'))
            }
        }

        return {
            totalResponses: total,
            overallAverageScore: overallAvg,
            overallActionabilityRate: overallActionability,
            groups,
            disparityFlags: flags,
            generatedAt: new Date().toISOString(),
            fair: {
                license: 'Apache-2.0',
                version: '1.0.0',
                createdAt: new Date().toISOString(),
                keywords: ['formative-assessment', 'fairness', 'equity', 'education'],
                ...this.cfg.fair,
            },
        }
    }

    /** Clear all collected records. */
    reset(): void {
        this.records = []
        this.pendingTags = []
    }

    /** Total number of responses recorded. */
    get size(): number {
        return this.records.length
    }

    // ── Private ───────────────────────────────────────────────────────────────

    private extractTags(demographics: Record<string, unknown>): string[] {
        const tags: string[] = []
        if (demographics.gradeLevel) tags.push(`grade:${demographics.gradeLevel}`)
        if (demographics.ellStatus && demographics.ellStatus !== 'none') {
            tags.push(`ELL:${demographics.ellStatus}`)
        }
        if (Array.isArray(demographics.disabilityStatus)) {
            for (const d of demographics.disabilityStatus) tags.push(String(d))
        }
        if (Array.isArray(demographics.subgroup)) {
            for (const s of demographics.subgroup) tags.push(String(s))
        }
        if (demographics.locale) tags.push(`locale:${demographics.locale}`)
        return tags
    }

    private makeFlag(
        group: string,
        metric: DisparityFlag['metric'],
        groupValue: number,
        overallValue: number,
        gap: number,
        severity: 'warning' | 'critical'
    ): DisparityFlag {
        const pct = (gap * 100).toFixed(1)
        return {
            group,
            metric,
            groupValue,
            overallValue,
            gap,
            severity,
            description: `Group "${group}" scores ${pct}% below overall on ${metric}.`,
        }
    }

    private emptyReport(): FairnessReport {
        return {
            totalResponses: 0,
            overallAverageScore: 0,
            overallActionabilityRate: 0,
            groups: [],
            disparityFlags: [],
            generatedAt: new Date().toISOString(),
            fair: {
                license: 'Apache-2.0',
                version: '1.0.0',
                createdAt: new Date().toISOString(),
                ...this.cfg.fair,
            },
        }
    }
}
