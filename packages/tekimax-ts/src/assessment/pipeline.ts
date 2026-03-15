import type { AIProvider, TranscriptionCapability, VisionCapability } from '../core/adapter'
import type { TekimaxPlugin, PluginContext } from '../core/types'
import { formativeFeedbackSchema } from './types'
import type {
    StudentResponse,
    Rubric,
    FormativeFeedback,
    CriterionScore,
} from './types'

// ─── Config ───────────────────────────────────────────────────────────────────

export interface AssessmentPipelineConfig {
    /** Provider to use for text generation (must implement AIProvider) */
    provider: AIProvider
    /** The rubric to assess against */
    rubric: Rubric
    /** Model ID for feedback generation */
    model: string
    /**
     * Language for generated feedback. BCP-47 tag.
     * The pipeline will instruct the model to respond in this language.
     * Default: 'en'
     */
    feedbackLanguage?: string
    /** Plugins to run on each assessment request (before/afterResponse hooks) */
    plugins?: TekimaxPlugin[]
    /**
     * Automatically transcribe speech responses before assessment.
     * Requires the provider to implement TranscriptionCapability.
     * Default: true
     */
    transcribeSpeech?: boolean
    /**
     * Automatically describe drawing/handwriting images before assessment.
     * Requires the provider to implement VisionCapability.
     * Default: true
     */
    analyzeImages?: boolean
    /**
     * Model to use for speech transcription (default: 'whisper-1').
     * Only used if transcribeSpeech=true.
     */
    transcriptionModel?: string
    /**
     * Model to use for image description (default: same as `model`).
     * Only used if analyzeImages=true.
     */
    visionModel?: string
    /**
     * Temperature for feedback generation (default: 0.3).
     * Lower = more consistent rubric-aligned scoring.
     */
    temperature?: number
}

// ─── System Prompt Builder ────────────────────────────────────────────────────

function buildSystemPrompt(rubric: Rubric, language: string): string {
    const criteriaBlock = rubric.criteria.map(c => {
        const levels = c.levels
            .map(l => `  • ${l.label} (${l.score}): ${l.descriptor}`)
            .join('\n')
        const progression = c.learningProgression
            ? '\n  Learning progression:\n' + c.learningProgression
                .map(p => `    Stage ${p.sequence}: ${p.description}`)
                .join('\n')
            : ''
        return `Criterion: ${c.name} (id: ${c.id})\n  ${c.description}\n  Levels:\n${levels}${progression}`
    }).join('\n\n')

    return `You are an expert formative assessment AI.
Your role is to provide specific, actionable, and affirming feedback on learner work across educational, workforce, and professional contexts.

RUBRIC: ${rubric.name}
${rubric.description ?? ''}

${criteriaBlock}

ASSESSMENT PRINCIPLES:
1. Asset-based framing — lead with what the student CAN do
2. Cite specific evidence directly from the student's response
3. Give concrete, achievable next steps (not vague advice)
4. Use age-appropriate, accessible language
5. Encouragement is mandatory — every student deserves to feel capable
6. If the student is an ELL, acknowledge linguistic strengths
7. Feedback language: ${language}

OUTPUT FORMAT (strict JSON — no markdown, no code fences):
{
  "overall": "<2-4 sentence summary — affirming, specific>",
  "scores": [
    {
      "criterionId": "<id>",
      "criterionName": "<name>",
      "score": <number>,
      "levelLabel": "<label>",
      "rationale": "<why this score, grounded in descriptor>",
      "evidence": ["<direct quote or paraphrase from student work>"],
      "suggestions": ["<concrete next step>"],
      "progressionStep": <number or null>,
      "nextMilestone": "<next stage description or null>"
    }
  ],
  "strengths": ["<specific strength 1>", "<specific strength 2>"],
  "nextSteps": ["<priority next step 1>", "<priority next step 2>"],
  "encouragement": "<short, genuine, personalized closing>",
  "normalizedScore": <0.0–1.0>
}`
}

// ─── Pipeline ─────────────────────────────────────────────────────────────────

export class AssessmentPipeline {
    private cfg: Required<
        Pick<AssessmentPipelineConfig, 'model' | 'feedbackLanguage' | 'transcribeSpeech' |
            'analyzeImages' | 'temperature'>
    > & AssessmentPipelineConfig

    constructor(config: AssessmentPipelineConfig) {
        this.cfg = {
            feedbackLanguage: 'en',
            transcribeSpeech: true,
            analyzeImages: true,
            transcriptionModel: 'whisper-1',
            visionModel: config.model,
            temperature: 0.3,
            plugins: [],
            ...config,
        }
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /**
     * Assess a single student response and return structured formative feedback.
     */
    async assess(response: StudentResponse): Promise<FormativeFeedback> {
        const textContent = await this.resolveToText(response)
        return this.generateFeedback(response.id, textContent, response.language)
    }

    /**
     * Assess multiple responses. Runs sequentially to avoid rate limits.
     */
    async assessBatch(responses: StudentResponse[]): Promise<FormativeFeedback[]> {
        const results: FormativeFeedback[] = []
        for (const r of responses) {
            results.push(await this.assess(r))
        }
        return results
    }

    /**
     * Stream formative feedback text chunks as they arrive.
     * Use this for real-time UI updates via `useAssessment()`.
     */
    async *assessStream(response: StudentResponse): AsyncGenerator<string> {
        const textContent = await this.resolveToText(response)
        const system = buildSystemPrompt(this.cfg.rubric, this.cfg.feedbackLanguage)

        const context: PluginContext = {
            model: this.cfg.model,
            messages: [
                { role: 'system', content: system },
                { role: 'user', content: `Student response:\n\n${textContent}` },
            ],
            timestamp: Date.now(),
            requestOptions: {},
        }

        // Run beforeRequest plugins
        let ctx = context
        for (const plugin of (this.cfg.plugins ?? [])) {
            if (plugin.beforeRequest) {
                const updated = await plugin.beforeRequest(ctx)
                if (updated) ctx = updated
            }
        }

        for await (const chunk of this.cfg.provider.chatStream({
            model: ctx.model,
            messages: ctx.messages,
            temperature: this.cfg.temperature,
        })) {
            yield chunk.delta
        }
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    /**
     * Normalize all input modalities to a text string for the LLM.
     */
    private async resolveToText(response: StudentResponse): Promise<string> {
        // 1. Already text
        if (response.modality === 'text' && response.text) {
            return response.text
        }

        // 2. Speech → transcribe
        if (response.modality === 'speech' && response.audio) {
            if (!this.cfg.transcribeSpeech) {
                throw new Error('AssessmentPipeline: speech response received but transcribeSpeech=false')
            }
            const transcriber = this.cfg.provider as unknown as TranscriptionCapability
            if (!('transcribeAudio' in transcriber)) {
                throw new Error(
                    `Provider '${this.cfg.provider.name}' does not support audio transcription. ` +
                    'Use OpenAIProvider or set transcribeSpeech=false.'
                )
            }
            const file = typeof response.audio === 'string'
                ? Buffer.from(response.audio, 'base64')
                : response.audio
            const result = await transcriber.transcribeAudio({
                file,
                model: this.cfg.transcriptionModel ?? 'whisper-1',
                language: response.language,
            })
            return result.text
        }

        // 3. Drawing / handwriting → describe image
        if ((response.modality === 'drawing' || response.modality === 'handwriting') && response.image) {
            if (!this.cfg.analyzeImages) {
                throw new Error(`AssessmentPipeline: image response received but analyzeImages=false`)
            }
            const vision = this.cfg.provider as unknown as VisionCapability
            if (!('analyzeImage' in vision)) {
                throw new Error(
                    `Provider '${this.cfg.provider.name}' does not support image analysis. ` +
                    'Use OpenAIProvider, AnthropicProvider, or GeminiProvider.'
                )
            }
            const prompt = response.modality === 'handwriting'
                ? 'Transcribe all handwritten text exactly as written, preserving spelling and grammar. Do not correct errors.'
                : 'Describe this student drawing in detail. Note all visual elements, labels, and any text present.'
            const result = await vision.analyzeImage({
                model: this.cfg.visionModel ?? this.cfg.model,
                image: response.image as string,
                prompt,
            })
            return result.content
        }

        // 4. Fallback to whatever text field exists
        if (response.text) return response.text

        throw new Error(`AssessmentPipeline: cannot resolve response ${response.id} to text — no content provided`)
    }

    /**
     * Call the model, parse the JSON response, and validate with Zod.
     */
    private async generateFeedback(
        responseId: string,
        studentText: string,
        responseLang?: string
    ): Promise<FormativeFeedback> {
        const language = this.cfg.feedbackLanguage
        const system = buildSystemPrompt(this.cfg.rubric, language)

        const context: PluginContext = {
            model: this.cfg.model,
            messages: [
                { role: 'system', content: system },
                { role: 'user', content: `Student response:\n\n${studentText}` },
            ],
            timestamp: Date.now(),
            requestOptions: {},
        }

        // Run beforeRequest plugins
        let ctx = context
        for (const plugin of (this.cfg.plugins ?? [])) {
            if (plugin.beforeRequest) {
                const updated = await plugin.beforeRequest(ctx)
                if (updated) ctx = updated
            }
        }

        const result = await this.cfg.provider.chat({
            model: ctx.model,
            messages: ctx.messages,
            temperature: this.cfg.temperature,
            responseFormat: { type: 'json_object' },
        })

        // Run afterResponse plugins
        for (const plugin of (this.cfg.plugins ?? [])) {
            if (plugin.afterResponse) await plugin.afterResponse(ctx, result)
        }

        const raw = typeof result.message.content === 'string'
            ? result.message.content
            : JSON.stringify(result.message.content)

        let parsed: Record<string, unknown>
        try {
            parsed = JSON.parse(raw)
        } catch {
            throw new Error(`AssessmentPipeline: model returned invalid JSON for response ${responseId}`)
        }

        // Compute normalized score from rubric max
        const rubricMax = this.cfg.rubric.maxScore
            ?? this.cfg.rubric.criteria.reduce((sum, c) => {
                const max = Math.max(...c.levels.map(l => l.score))
                return sum + max * (c.weight ?? 1)
            }, 0)

        const rawScores = (parsed.scores as CriterionScore[] | undefined) ?? []
        const weightedSum = rawScores.reduce((sum, s) => {
            const criterion = this.cfg.rubric.criteria.find(c => c.id === s.criterionId)
            return sum + s.score * (criterion?.weight ?? 1)
        }, 0)

        const normalizedScore = rubricMax > 0
            ? Math.min(1, Math.max(0, weightedSum / rubricMax))
            : (parsed.normalizedScore as number ?? 0)

        const feedback: FormativeFeedback = {
            responseId,
            rubricId: this.cfg.rubric.id,
            overall: (parsed.overall as string) ?? '',
            scores: rawScores,
            strengths: (parsed.strengths as string[]) ?? [],
            nextSteps: (parsed.nextSteps as string[]) ?? [],
            encouragement: (parsed.encouragement as string) ?? 'Keep up the great work!',
            language,
            normalizedScore,
            generatedAt: Date.now(),
            model: this.cfg.model,
        }

        // Validate with Zod (warn but don't throw — feedback is still useful)
        const validation = formativeFeedbackSchema.safeParse(feedback)
        if (!validation.success) {
            console.warn(
                `[AssessmentPipeline] Feedback validation warning for ${responseId}:`,
                validation.error.flatten().fieldErrors
            )
        }

        return feedback
    }
}
