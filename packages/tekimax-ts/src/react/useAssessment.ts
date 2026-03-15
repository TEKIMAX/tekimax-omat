import { useCallback, useRef, useState } from 'react'
import type { AssessmentPipeline } from '../assessment/pipeline'
import type { StudentResponse, FormativeFeedback } from '../assessment/types'

export interface UseAssessmentOptions {
    /** Configured AssessmentPipeline instance */
    pipeline: AssessmentPipeline
    /** Called when a full feedback object is ready */
    onFeedback?: (feedback: FormativeFeedback) => void
    /** Called on error */
    onError?: (error: Error) => void
    /**
     * Use streaming mode for real-time text updates.
     * The final structured feedback is parsed from the accumulated stream.
     * Default: false (non-streaming returns clean structured feedback)
     */
    streaming?: boolean
}

export interface UseAssessmentHelpers {
    /** Latest complete feedback object (null until first assessment completes) */
    feedback: FormativeFeedback | null
    /** True while an assessment request is in flight */
    isAssessing: boolean
    /** Partial streamed text (only populated in streaming mode) */
    streamedText: string
    /** All feedback items from this session */
    history: FormativeFeedback[]
    /** Submit a student response for assessment */
    assess: (response: StudentResponse) => Promise<void>
    /** Cancel an in-flight assessment */
    stop: () => void
    /** Clear feedback and history */
    reset: () => void
}

/**
 * useAssessment
 *
 * React hook for real-time formative assessment. Wraps `AssessmentPipeline`
 * with React state management, streaming support, and abort handling.
 *
 * Supports all input modalities: text, speech, drawings, and handwriting.
 * The pipeline handles transcription and image analysis automatically.
 *
 * @example
 * ```tsx
 * import { useAssessment } from 'tekimax-omat/react'
 * import { AssessmentPipeline } from 'tekimax-omat'
 *
 * const pipeline = new AssessmentPipeline({
 *   provider: new OpenAIProvider({ apiKey: '...' }),
 *   rubric: myRubric,
 *   model: 'gpt-4o',
 * })
 *
 * export function AssessmentWidget() {
 *   const { feedback, isAssessing, assess } = useAssessment({ pipeline })
 *
 *   return (
 *     <div>
 *       <button onClick={() => assess({ id: '1', modality: 'text', text: studentWork })}>
 *         {isAssessing ? 'Assessing…' : 'Get Feedback'}
 *       </button>
 *       {feedback && (
 *         <div>
 *           <p>{feedback.overall}</p>
 *           <p>Score: {(feedback.normalizedScore * 100).toFixed(0)}%</p>
 *           <ul>{feedback.nextSteps.map((s, i) => <li key={i}>{s}</li>)}</ul>
 *           <p><em>{feedback.encouragement}</em></p>
 *         </div>
 *       )}
 *     </div>
 *   )
 * }
 * ```
 */
export function useAssessment({
    pipeline,
    onFeedback,
    onError,
    streaming = false,
}: UseAssessmentOptions): UseAssessmentHelpers {
    const [feedback, setFeedback] = useState<FormativeFeedback | null>(null)
    const [history, setHistory] = useState<FormativeFeedback[]>([])
    const [isAssessing, setIsAssessing] = useState(false)
    const [streamedText, setStreamedText] = useState('')
    const abortRef = useRef<{ abort: () => void } | null>(null)

    const stop = useCallback(() => {
        abortRef.current?.abort()
        abortRef.current = null
        setIsAssessing(false)
    }, [])

    const reset = useCallback(() => {
        stop()
        setFeedback(null)
        setHistory([])
        setStreamedText('')
    }, [stop])

    const assess = useCallback(async (response: StudentResponse) => {
        if (isAssessing) return

        setIsAssessing(true)
        setStreamedText('')

        let aborted = false
        abortRef.current = { abort: () => { aborted = true } }

        try {
            if (streaming) {
                // Stream mode — accumulate text, then parse final JSON
                let accumulated = ''
                for await (const chunk of pipeline.assessStream(response)) {
                    if (aborted) break
                    accumulated += chunk
                    setStreamedText(accumulated)
                }

                if (!aborted) {
                    // Try to extract JSON from the streamed text
                    const jsonMatch = accumulated.match(/\{[\s\S]*\}/)
                    if (jsonMatch) {
                        try {
                            const parsed = JSON.parse(jsonMatch[0]) as Partial<FormativeFeedback>
                            const result: FormativeFeedback = {
                                responseId: response.id,
                                rubricId: '',
                                overall: parsed.overall ?? accumulated,
                                scores: parsed.scores ?? [],
                                strengths: parsed.strengths ?? [],
                                nextSteps: parsed.nextSteps ?? [],
                                encouragement: parsed.encouragement ?? '',
                                language: parsed.language ?? 'en',
                                normalizedScore: parsed.normalizedScore ?? 0,
                                generatedAt: Date.now(),
                                model: parsed.model ?? '',
                            }
                            setFeedback(result)
                            setHistory(prev => [...prev, result])
                            onFeedback?.(result)
                        } catch {
                            // JSON parse failed — still surface the streamed text
                        }
                    }
                }
            } else {
                // Non-streaming mode — structured feedback directly
                const result = await pipeline.assess(response)
                if (!aborted) {
                    setFeedback(result)
                    setHistory(prev => [...prev, result])
                    onFeedback?.(result)
                }
            }
        } catch (err: any) {
            if (!aborted) {
                onError?.(err instanceof Error ? err : new Error(String(err)))
            }
        } finally {
            if (!aborted) {
                setIsAssessing(false)
                abortRef.current = null
            }
        }
    }, [isAssessing, pipeline, streaming, onFeedback, onError])

    return {
        feedback,
        isAssessing,
        streamedText,
        history,
        assess,
        stop,
        reset,
    }
}
