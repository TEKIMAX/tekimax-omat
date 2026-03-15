import type { AssessmentPipeline } from '../assessment/pipeline'
import type {
    BenchmarkSuite,
    BenchmarkResult,
    BenchmarkMetric,
    BenchmarkItem,
    FormativeFeedback,
    FAIRMetadata,
} from '../assessment/types'

// ─── Config ───────────────────────────────────────────────────────────────────

export interface BenchmarkRunnerConfig {
    pipeline: AssessmentPipeline
    /** Package version for FAIR metadata */
    version?: string
    /** Creator organizations */
    creators?: string[]
    /**
     * Called after each item is assessed. Use for progress tracking.
     */
    onProgress?: (completed: number, total: number, itemId: string) => void
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function grade(score: number): BenchmarkMetric['grade'] {
    if (score >= 0.85) return 'excellent'
    if (score >= 0.70) return 'good'
    if (score >= 0.50) return 'fair'
    return 'poor'
}

/**
 * Cohen's Kappa for ordinal agreement between AI scores and human scores.
 * Returns a 0–1 normalized value (1 = perfect agreement).
 */
function kappaAgreement(ai: number[], human: number[]): number {
    if (ai.length === 0 || ai.length !== human.length) return 0
    const n = ai.length
    const exact = ai.filter((a, i) => a === human[i]).length
    const po = exact / n

    // Expected agreement by chance (simple)
    const aiMean = ai.reduce((s, v) => s + v, 0) / n
    const humanMean = human.reduce((s, v) => s + v, 0) / n
    const maxScore = Math.max(...ai, ...human, 1)
    const pe = (aiMean / maxScore) * (humanMean / maxScore) + ((1 - aiMean / maxScore) * (1 - humanMean / maxScore))

    return pe >= 1 ? 1 : Math.max(0, (po - pe) / (1 - pe))
}

// ─── BenchmarkRunner ──────────────────────────────────────────────────────────

/**
 * BenchmarkRunner
 *
 * Runs standardized evaluations across a BenchmarkSuite and produces
 * a structured BenchmarkResult ready for public goods archival.
 *
 * Four metrics measured (inspired by the K-12 AI Infrastructure Program RFP and extended to all assessment contexts):
 * - **Accuracy** — Score agreement with human expert ratings (Cohen's Kappa)
 * - **Fairness** — Demographic disparity across student subgroups
 * - **Actionability** — % of feedback with ≥1 concrete, specific suggestion
 * - **Alignment** — Rubric criterion coverage and evidence grounding
 *
 * Results include FAIR metadata for DOI assignment and archival.
 *
 * @example
 * ```ts
 * const runner = new BenchmarkRunner({ pipeline, version: '1.0.0' })
 * const result = await runner.run(mySuite)
 * console.log(result.accuracy.score)  // e.g. 0.82
 * console.log(result.fair.license)    // 'Apache-2.0'
 * ```
 */
export class BenchmarkRunner {
    private cfg: Required<Pick<BenchmarkRunnerConfig, 'version' | 'creators'>>
        & BenchmarkRunnerConfig

    constructor(config: BenchmarkRunnerConfig) {
        this.cfg = {
            version: '1.0.0',
            creators: ['Tekimax'],
            onProgress: undefined,
            ...config,
        }
    }

    async run(suite: BenchmarkSuite): Promise<BenchmarkResult> {
        const results: Array<{ item: BenchmarkItem; feedback: FormativeFeedback }> = []

        for (let i = 0; i < suite.items.length; i++) {
            const item = suite.items[i]!
            const feedback = await this.cfg.pipeline.assess(item.studentResponse)
            results.push({ item, feedback })
            this.cfg.onProgress?.(i + 1, suite.items.length, item.id)
        }

        const accuracy = this.scoreAccuracy(results)
        const fairness = this.scoreFairness(results)
        const actionability = this.scoreActionability(results)
        const alignment = this.scoreAlignment(results, suite)

        const fair: FAIRMetadata = {
            license: 'Apache-2.0',
            version: this.cfg.version,
            createdAt: new Date().toISOString(),
            description: `Benchmark results for suite: ${suite.name}`,
            keywords: ['formative-assessment', 'benchmark', 'education', ...(suite.subject ? [suite.subject] : [])],
            creators: this.cfg.creators,
            ...suite.fair,
        }

        return {
            suiteId: suite.id,
            suiteName: suite.name,
            model: results[0]?.feedback.model ?? 'unknown',
            provider: 'tekimax-omat',
            accuracy,
            fairness,
            actionability,
            alignment,
            runAt: new Date().toISOString(),
            fair,
        }
    }

    // ── Metrics ───────────────────────────────────────────────────────────────

    private scoreAccuracy(
        results: Array<{ item: BenchmarkItem; feedback: FormativeFeedback }>
    ): BenchmarkMetric {
        const aiScores: number[] = []
        const humanScores: number[] = []

        for (const { item, feedback } of results) {
            if (!item.humanScores) continue
            for (const [criterionId, humanScore] of Object.entries(item.humanScores)) {
                const aiScore = feedback.scores.find(s => s.criterionId === criterionId)
                if (aiScore !== undefined) {
                    aiScores.push(aiScore.score)
                    humanScores.push(humanScore)
                }
            }
        }

        if (aiScores.length === 0) {
            return {
                name: 'accuracy',
                score: 0,
                grade: 'poor',
                details: { note: 'No human scores available for comparison', comparisons: 0 },
            }
        }

        const kappa = kappaAgreement(aiScores, humanScores)
        const exactMatch = aiScores.filter((a, i) => a === humanScores[i]).length / aiScores.length
        const adjacentMatch = aiScores.filter((a, i) => Math.abs(a - humanScores[i]!) <= 1).length / aiScores.length

        return {
            name: 'accuracy',
            score: kappa,
            grade: grade(kappa),
            details: {
                kappa,
                exactMatchRate: exactMatch,
                adjacentMatchRate: adjacentMatch,
                comparisons: aiScores.length,
            },
        }
    }

    private scoreFairness(
        results: Array<{ item: BenchmarkItem; feedback: FormativeFeedback }>
    ): BenchmarkMetric {
        // Group by demographic tags
        const tagScores = new Map<string, number[]>()

        for (const { item, feedback } of results) {
            const demo = item.studentResponse.demographics
            if (!demo) continue

            const tags: string[] = []
            if (demo.gradeLevel) tags.push(`grade:${demo.gradeLevel}`)
            if (demo.ellStatus && demo.ellStatus !== 'none') tags.push(`ELL`)
            if (demo.disabilityStatus?.length) tags.push('IEP/504')
            if (demo.subgroup?.includes('FRL')) tags.push('FRL')

            for (const tag of tags) {
                if (!tagScores.has(tag)) tagScores.set(tag, [])
                tagScores.get(tag)!.push(feedback.normalizedScore)
            }
        }

        const allScores = results.map(r => r.feedback.normalizedScore)
        const overall = allScores.reduce((s, v) => s + v, 0) / (allScores.length || 1)

        if (tagScores.size === 0) {
            return {
                name: 'fairness',
                score: 1,
                grade: 'excellent',
                details: { note: 'No demographic data available', overallScore: overall },
            }
        }

        let maxGap = 0
        const groupDetails: Record<string, { avg: number; gap: number; n: number }> = {}

        for (const [tag, scores] of tagScores.entries()) {
            const avg = scores.reduce((s, v) => s + v, 0) / scores.length
            const gap = Math.abs(overall - avg)
            maxGap = Math.max(maxGap, gap)
            groupDetails[tag] = { avg, gap, n: scores.length }
        }

        // Fairness score = 1 - max disparity gap (penalizes outlier gaps)
        const fairnessScore = Math.max(0, 1 - maxGap * 2)

        return {
            name: 'fairness',
            score: fairnessScore,
            grade: grade(fairnessScore),
            details: { overallScore: overall, maxDisparity: maxGap, groups: groupDetails },
        }
    }

    private scoreActionability(
        results: Array<{ item: BenchmarkItem; feedback: FormativeFeedback }>
    ): BenchmarkMetric {
        if (results.length === 0) return { name: 'actionability', score: 0, grade: 'poor', details: {} }

        let withSuggestions = 0
        let totalSuggestions = 0

        for (const { feedback } of results) {
            const hasSuggestion = feedback.scores.some(s => s.suggestions.length > 0)
                || feedback.nextSteps.length > 0
            if (hasSuggestion) withSuggestions++
            totalSuggestions += feedback.nextSteps.length
                + feedback.scores.reduce((s, sc) => s + sc.suggestions.length, 0)
        }

        const rate = withSuggestions / results.length
        const avgSuggestions = totalSuggestions / results.length

        return {
            name: 'actionability',
            score: rate,
            grade: grade(rate),
            details: { rateWithSuggestions: rate, avgSuggestionsPerResponse: avgSuggestions, total: results.length },
        }
    }

    private scoreAlignment(
        results: Array<{ item: BenchmarkItem; feedback: FormativeFeedback }>,
        suite: BenchmarkSuite
    ): BenchmarkMetric {
        if (results.length === 0) return { name: 'alignment', score: 0, grade: 'poor', details: {} }

        const rubricCriteria = new Set(suite.rubric.criteria.map(c => c.id))
        let totalCriteria = 0
        let coveredCriteria = 0
        let withEvidence = 0
        let totalScores = 0

        for (const { feedback } of results) {
            for (const score of feedback.scores) {
                totalScores++
                if (rubricCriteria.has(score.criterionId)) {
                    coveredCriteria++
                }
                if (score.evidence && score.evidence.length > 0) {
                    withEvidence++
                }
            }
            totalCriteria += rubricCriteria.size
        }

        const coverageRate = totalCriteria > 0 ? coveredCriteria / totalCriteria : 0
        const evidenceRate = totalScores > 0 ? withEvidence / totalScores : 0
        const alignmentScore = (coverageRate + evidenceRate) / 2

        return {
            name: 'alignment',
            score: alignmentScore,
            grade: grade(alignmentScore),
            details: { criterionCoverageRate: coverageRate, evidenceRate, totalScores },
        }
    }
}
