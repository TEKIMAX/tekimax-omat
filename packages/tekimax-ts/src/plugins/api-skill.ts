import type { TekimaxPlugin, PluginContext, ChatResult, ToolDefinition, ToolCall } from '../core/types'

// ─── Auth ─────────────────────────────────────────────────────────────────────

/**
 * Authentication config for a skill endpoint.
 * Credentials are resolved at execution time and never included
 * in the tool definition sent to the LLM.
 */
export type ApiSkillAuth =
    | { type: 'bearer'; token: string }
    | { type: 'apikey'; header: string; value: string }
    | { type: 'basic'; username: string; password: string }
    | { type: 'none' }

// ─── Endpoint Config ──────────────────────────────────────────────────────────

/**
 * A single REST endpoint registered as a callable skill.
 * The `parametersSchema` is the JSON Schema the LLM uses to construct args.
 * Execution metadata (URL, auth, headers) is never sent to the model.
 *
 * @example
 * ```ts
 * {
 *   name: 'search_programs',
 *   description: 'Search workforce development programs by category and city',
 *   method: 'GET',
 *   url: 'https://api.myorg.com/programs',
 *   queryParams: ['category', 'city', 'limit'],
 *   parametersSchema: {
 *     type: 'object',
 *     properties: {
 *       category: { type: 'string', description: 'Program category e.g. technology, healthcare' },
 *       city: { type: 'string', description: 'City name' },
 *       limit: { type: 'number', description: 'Max results', default: 10 },
 *     },
 *     required: ['category'],
 *   },
 * }
 * ```
 */
export interface SkillEndpoint {
    /** Tool name the LLM will use to call this skill (snake_case recommended) */
    name: string
    /** What this skill does — shown to the LLM as the function description */
    description: string
    /** HTTP method */
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
    /**
     * Full URL or path relative to `ApiSkillPluginConfig.baseUrl`.
     * Supports `{param}` placeholders for path parameters.
     * e.g. `'https://api.example.com/users/{id}'` or `'/users/{id}'`
     */
    url: string
    /**
     * JSON Schema describing the tool's parameters.
     * The LLM uses this to construct the args object passed to `execute()`.
     * Validated with a structural check before each HTTP call.
     */
    parametersSchema?: Record<string, unknown>
    /**
     * Parameter names to interpolate into the URL path as `{name}` substitutions.
     * e.g. `['id']` for `/users/{id}`
     */
    pathParams?: string[]
    /**
     * Parameter names to append as `?key=value` query string.
     * Only used for GET/DELETE — POST/PUT/PATCH params go in the body by default.
     */
    queryParams?: string[]
    /**
     * Parameter names to include in the JSON request body.
     * Defaults to all params not in `pathParams` or `queryParams` for non-GET methods.
     */
    bodyParams?: string[]
    /** Auth override for this specific endpoint. Falls back to plugin default. */
    auth?: ApiSkillAuth
    /** Extra headers for this endpoint. Merged with plugin defaults. */
    headers?: Record<string, string>
    /** Timeout in ms for this endpoint. Falls back to plugin default (15_000). */
    timeout?: number
}

// ─── OpenAPI Config ───────────────────────────────────────────────────────────

export interface OpenApiSkillConfig {
    /**
     * OpenAPI 3.x document — parsed object or JSON/YAML string.
     * Only JSON is parsed internally. Pass a pre-parsed object for YAML.
     */
    spec: Record<string, unknown> | string
    /** Only register these operationIds. If omitted, all operations are registered. */
    includeOperations?: string[]
    /** Base URL override. Falls back to `spec.servers[0].url`. */
    baseUrl?: string
    /** Default auth applied to all operations in this spec. */
    auth?: ApiSkillAuth
    /** Extra headers applied to all operations. */
    headers?: Record<string, string>
}

// ─── Result ───────────────────────────────────────────────────────────────────

export interface SkillResult {
    ok: boolean
    status: number
    data: unknown
    latency: number
    error?: string
}

// ─── Plugin Config ────────────────────────────────────────────────────────────

export interface ApiSkillPluginConfig {
    /** Base URL prepended to relative endpoint URLs */
    baseUrl?: string
    /** Default auth applied to all skills unless overridden at endpoint level */
    defaultAuth?: ApiSkillAuth
    /** Default headers sent with every skill HTTP call */
    defaultHeaders?: Record<string, string>
    /** Default request timeout in ms (default: 15_000) */
    timeout?: number
    /**
     * Automatically inject registered skill tool definitions into every
     * outgoing chat request via `beforeRequest`. (default: true)
     */
    autoInject?: boolean
    /** Called before every skill HTTP execution */
    onSkillCall?: (name: string, args: Record<string, unknown>) => void
    /** Called after every skill HTTP execution */
    onSkillResult?: (name: string, result: SkillResult) => void
}

// ─── Internal registry entry ──────────────────────────────────────────────────

interface RegisteredSkill {
    toolDefinition: ToolDefinition
    endpoint: Required<Pick<SkillEndpoint, 'method' | 'url' | 'timeout'>> & SkillEndpoint
}

// ─── SSRF guard ───────────────────────────────────────────────────────────────

const PRIVATE_HOSTNAME = /^(localhost|.*\.local)$/i

function isPrivateOrReservedHost(hostname: string): boolean {
    if (PRIVATE_HOSTNAME.test(hostname)) return true

    const parts = hostname.replace(/^\[|\]$/g, '').split('.').map(Number)
    if (parts.length === 4 && parts.every(p => !isNaN(p) && p >= 0 && p <= 255)) {
        const [a, b] = parts as [number, number, number, number]
        if (a === 127) return true
        if (a === 10) return true
        if (a === 172 && b >= 16 && b <= 31) return true
        if (a === 192 && b === 168) return true
        if (a === 169 && b === 254) return true
        if (a === 0) return true
    }

    if (hostname === '::1' || hostname === '[::1]') return true

    return false
}

function guardSsrf(url: string): void {
    let parsed: URL
    try {
        parsed = new URL(url)
    } catch {
        throw new Error(`ApiSkillPlugin: invalid URL "${url}"`)
    }
    if (isPrivateOrReservedHost(parsed.hostname)) {
        throw new Error(
            `ApiSkillPlugin: request to "${parsed.hostname}" is blocked — ` +
            'private, loopback, and cloud metadata addresses are not allowed'
        )
    }
}

// ─── Lightweight parameter validation ────────────────────────────────────────

function validateArgs(
    args: Record<string, unknown>,
    schema: Record<string, unknown> | undefined,
    skillName: string
): void {
    if (!schema) return
    const required = (schema['required'] as string[] | undefined) ?? []
    for (const field of required) {
        if (!(field in args)) {
            throw new Error(
                `ApiSkillPlugin: required parameter "${field}" missing for skill "${skillName}"`
            )
        }
    }
}

// ─── Auth header injection ────────────────────────────────────────────────────

function applyAuth(
    headers: Record<string, string>,
    auth: ApiSkillAuth | undefined
): void {
    if (!auth || auth.type === 'none') return
    if (auth.type === 'bearer') {
        headers['Authorization'] = `Bearer ${auth.token}`
    } else if (auth.type === 'apikey') {
        headers[auth.header] = auth.value
    } else if (auth.type === 'basic') {
        const encoded = btoa(`${auth.username}:${auth.password}`)
        headers['Authorization'] = `Basic ${encoded}`
    }
}

// ─── Lightweight OpenAPI 3.x parser ─────────────────────────────────────────

interface ParsedOperation {
    operationId: string
    method: string
    path: string
    description: string
    pathParams: string[]
    queryParams: string[]
    bodySchema: Record<string, unknown> | undefined
    paramSchema: Record<string, unknown>
}

function parseOpenApiSpec(
    rawSpec: Record<string, unknown> | string,
    includeOperations?: string[]
): ParsedOperation[] {
    const spec: Record<string, unknown> = typeof rawSpec === 'string'
        ? JSON.parse(rawSpec)
        : rawSpec

    const paths = (spec['paths'] as Record<string, unknown>) ?? {}
    const ops: ParsedOperation[] = []

    const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const

    for (const [pathStr, pathItem] of Object.entries(paths)) {
        if (typeof pathItem !== 'object' || pathItem === null) continue
        for (const method of METHODS) {
            const op = (pathItem as Record<string, unknown>)[method]
            if (typeof op !== 'object' || op === null) continue

            const opObj = op as Record<string, unknown>
            const operationId = (opObj['operationId'] as string | undefined)
                ?? `${method}_${pathStr.replace(/[^a-zA-Z0-9]/g, '_')}`

            if (includeOperations && !includeOperations.includes(operationId)) continue

            const description = (opObj['summary'] as string | undefined)
                ?? (opObj['description'] as string | undefined)
                ?? `${method.toUpperCase()} ${pathStr}`

            // Parse parameters
            const parameters = ((opObj['parameters'] as unknown[]) ?? []) as Array<Record<string, unknown>>
            const pathParams: string[] = []
            const queryParams: string[] = []
            const propSchemas: Record<string, unknown> = {}
            const requiredParams: string[] = []

            for (const param of parameters) {
                const name = param['name'] as string
                const location = param['in'] as string
                const paramSchema = (param['schema'] as Record<string, unknown>) ?? { type: 'string' }
                const required = param['required'] as boolean | undefined

                propSchemas[name] = {
                    ...paramSchema,
                    description: (param['description'] as string | undefined) ?? paramSchema['description'],
                }

                if (location === 'path') pathParams.push(name)
                else if (location === 'query') queryParams.push(name)

                if (required) requiredParams.push(name)
            }

            // Parse requestBody schema
            let bodySchema: Record<string, unknown> | undefined
            const requestBody = opObj['requestBody'] as Record<string, unknown> | undefined
            if (requestBody) {
                const content = requestBody['content'] as Record<string, unknown> | undefined
                const jsonContent = content?.['application/json'] as Record<string, unknown> | undefined
                const bodySchemaRaw = jsonContent?.['schema'] as Record<string, unknown> | undefined
                if (bodySchemaRaw) {
                    bodySchema = bodySchemaRaw
                    // Merge body properties into paramSchema
                    const bodyProps = bodySchemaRaw['properties'] as Record<string, unknown> | undefined
                    if (bodyProps) {
                        Object.assign(propSchemas, bodyProps)
                    }
                    const bodyRequired = bodySchemaRaw['required'] as string[] | undefined
                    if (bodyRequired) requiredParams.push(...bodyRequired)
                }
            }

            const paramSchema: Record<string, unknown> = {
                type: 'object',
                properties: propSchemas,
            }
            if (requiredParams.length > 0) {
                paramSchema['required'] = [...new Set(requiredParams)]
            }

            ops.push({ operationId, method, path: pathStr, description, pathParams, queryParams, bodySchema, paramSchema })
        }
    }

    return ops
}

// ─── ApiSkillPlugin ───────────────────────────────────────────────────────────

/**
 * ApiSkillPlugin — Bring Your Own API middleware.
 *
 * Register any REST endpoint as a model-callable skill. The plugin:
 * - Exposes registered skills as `ToolDefinition[]` for the LLM
 * - Executes authenticated HTTP calls when the model invokes a skill
 * - Optionally auto-injects tools into every outgoing request (plugin hook)
 * - Validates args against parameter schemas before execution
 * - Blocks SSRF (private IPs, loopback, cloud metadata addresses)
 * - Never sends auth credentials to the model
 *
 * Two registration paths:
 * 1. `registerEndpoint()` — simple CRUD config, no spec required
 * 2. `registerFromOpenApi()` — parse an OpenAPI 3.x spec, auto-generate skills
 *
 * @example
 * ```ts
 * import { ApiSkillPlugin, Tekimax, OpenAIProvider } from 'tekimax-omat'
 *
 * const skills = new ApiSkillPlugin({
 *   baseUrl: 'https://api.myorg.com',
 *   defaultAuth: { type: 'bearer', token: process.env.API_TOKEN! },
 * })
 *
 * skills.registerEndpoint({
 *   name: 'search_programs',
 *   description: 'Search workforce development programs',
 *   method: 'GET',
 *   url: '/programs',
 *   queryParams: ['category', 'city'],
 *   parametersSchema: {
 *     type: 'object',
 *     properties: {
 *       category: { type: 'string', description: 'Program category' },
 *       city: { type: 'string', description: 'City name' },
 *     },
 *     required: ['category'],
 *   },
 * })
 *
 * const client = new Tekimax({ provider, plugins: [skills] })
 * // skills are auto-injected into every request
 * ```
 */
export class ApiSkillPlugin implements TekimaxPlugin {
    name = 'ApiSkillPlugin'

    private cfg: Required<Pick<ApiSkillPluginConfig, 'timeout' | 'autoInject'>> & ApiSkillPluginConfig
    private registry = new Map<string, RegisteredSkill>()

    constructor(config: ApiSkillPluginConfig = {}) {
        this.cfg = {
            timeout: 15_000,
            autoInject: true,
            ...config,
        }
    }

    // ── Registration ──────────────────────────────────────────────────────────

    /**
     * Register a single REST endpoint as a callable skill.
     */
    registerEndpoint(endpoint: SkillEndpoint): this {
        const toolDefinition: ToolDefinition = {
            type: 'function',
            function: {
                name: endpoint.name,
                description: endpoint.description,
                parameters: endpoint.parametersSchema ?? { type: 'object', properties: {} },
            },
        }

        this.registry.set(endpoint.name, {
            toolDefinition,
            endpoint: {
                timeout: this.cfg.timeout,
                pathParams: [],
                queryParams: [],
                ...endpoint,
            },
        })
        return this
    }

    /**
     * Register multiple endpoints at once.
     */
    registerAll(endpoints: SkillEndpoint[]): this {
        for (const ep of endpoints) this.registerEndpoint(ep)
        return this
    }

    /**
     * Parse an OpenAPI 3.x spec and register all (or filtered) operations as skills.
     * Supports JSON specs as string or pre-parsed object.
     * Path, query, and body parameters are extracted automatically.
     *
     * @example
     * ```ts
     * skills.registerFromOpenApi({
     *   spec: require('./my-api-spec.json'),
     *   includeOperations: ['search_programs', 'get_program'],
     *   baseUrl: 'https://api.myorg.com',
     *   auth: { type: 'bearer', token: process.env.API_TOKEN! },
     * })
     * ```
     */
    registerFromOpenApi(config: OpenApiSkillConfig): this {
        let spec: Record<string, unknown>
        try {
            spec = typeof config.spec === 'string' ? JSON.parse(config.spec) : config.spec
        } catch {
            throw new Error('ApiSkillPlugin.registerFromOpenApi: failed to parse spec — must be valid JSON')
        }

        // Resolve base URL from spec servers if not provided
        const servers = spec['servers'] as Array<{ url: string }> | undefined
        const specBaseUrl = servers?.[0]?.url ?? ''
        const baseUrl = config.baseUrl ?? specBaseUrl ?? this.cfg.baseUrl ?? ''

        const operations = parseOpenApiSpec(spec, config.includeOperations)

        for (const op of operations) {
            this.registerEndpoint({
                name: op.operationId,
                description: op.description,
                method: op.method.toUpperCase() as SkillEndpoint['method'],
                url: baseUrl.replace(/\/+$/, '') + op.path,
                pathParams: op.pathParams,
                queryParams: op.queryParams,
                parametersSchema: op.paramSchema,
                auth: config.auth,
                headers: config.headers,
            })
        }
        return this
    }

    /**
     * Remove a registered skill by tool name.
     */
    unregister(toolName: string): this {
        this.registry.delete(toolName)
        return this
    }

    // ── Tool Definition Export ────────────────────────────────────────────────

    /**
     * Returns all registered skills as `ToolDefinition[]`.
     * Pass this to `ChatOptions.tools` to expose skills to the model.
     *
     * @example
     * ```ts
     * const response = await client.text.chat.completions.create({
     *   model: 'gpt-4o',
     *   messages,
     *   tools: skills.getToolDefinitions(),
     * })
     * ```
     */
    getToolDefinitions(): ToolDefinition[] {
        return [...this.registry.values()].map(s => s.toolDefinition)
    }

    /**
     * Get a single tool definition by name.
     */
    getTool(name: string): ToolDefinition | undefined {
        return this.registry.get(name)?.toolDefinition
    }

    /** List all registered skill names. */
    get skillNames(): string[] {
        return [...this.registry.keys()]
    }

    // ── Execution ─────────────────────────────────────────────────────────────

    /**
     * Execute a skill by name with LLM-provided args.
     * Validates args against the registered schema, builds the HTTP request,
     * applies auth, and returns a `SkillResult`.
     *
     * @example
     * ```ts
     * const result = await skills.execute('search_programs', { category: 'technology', city: 'Oakland' })
     * console.log(result.data) // API response
     * ```
     */
    async execute(
        toolName: string,
        args: Record<string, unknown>
    ): Promise<SkillResult> {
        const skill = this.registry.get(toolName)
        if (!skill) {
            return { ok: false, status: 0, data: null, latency: 0, error: `Skill "${toolName}" not registered` }
        }

        const { endpoint } = skill

        // Validate required parameters
        validateArgs(args, endpoint.parametersSchema, toolName)

        this.cfg.onSkillCall?.(toolName, args)

        const start = Date.now()

        try {
            // Build URL with path param substitution
            let url = endpoint.url.startsWith('http')
                ? endpoint.url
                : (this.cfg.baseUrl ?? '').replace(/\/+$/, '') + endpoint.url

            // Apply base URL prefix for relative paths
            if (!url.startsWith('http') && this.cfg.baseUrl) {
                url = this.cfg.baseUrl.replace(/\/+$/, '') + url
            }

            // Substitute {param} placeholders
            for (const param of (endpoint.pathParams ?? [])) {
                const val = args[param]
                if (val !== undefined) {
                    url = url.replace(`{${param}}`, encodeURIComponent(String(val)))
                    url = url.replace(`:${param}`, encodeURIComponent(String(val)))
                }
            }

            // SSRF guard
            guardSsrf(url)

            // Build query string for GET/DELETE or explicit queryParams
            const queryParamNames = endpoint.queryParams ?? []
            const isReadMethod = endpoint.method === 'GET' || endpoint.method === 'DELETE'
            const allQueryParams = isReadMethod
                ? [...queryParamNames, ...Object.keys(args).filter(k =>
                    !endpoint.pathParams?.includes(k) && !queryParamNames.includes(k)
                )]
                : queryParamNames

            const qs = new URLSearchParams()
            for (const key of allQueryParams) {
                if (args[key] !== undefined) {
                    qs.set(key, String(args[key]))
                }
            }
            if (qs.toString()) url += `?${qs.toString()}`

            // Build request body for non-GET methods
            let bodyStr: string | undefined
            if (!isReadMethod) {
                const bodyParamNames = endpoint.bodyParams
                    ?? Object.keys(args).filter(k =>
                        !endpoint.pathParams?.includes(k) &&
                        !queryParamNames.includes(k)
                    )
                const body: Record<string, unknown> = {}
                for (const k of bodyParamNames) {
                    if (args[k] !== undefined) body[k] = args[k]
                }
                if (Object.keys(body).length > 0) bodyStr = JSON.stringify(body)
            }

            // Build headers
            const headers: Record<string, string> = {
                'Accept': 'application/json',
                ...this.cfg.defaultHeaders,
                ...endpoint.headers,
            }
            if (bodyStr) headers['Content-Type'] = 'application/json'

            // Apply auth (endpoint auth takes priority over plugin default)
            const auth = endpoint.auth ?? this.cfg.defaultAuth
            applyAuth(headers, auth)

            // Execute with timeout
            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), endpoint.timeout)

            try {
                const res = await fetch(url, {
                    method: endpoint.method,
                    headers,
                    body: bodyStr,
                    signal: controller.signal,
                })
                clearTimeout(timeoutId)

                const latency = Date.now() - start
                let data: unknown
                const ct = res.headers.get('content-type') ?? ''
                if (ct.includes('application/json')) {
                    try { data = await res.json() } catch { data = await res.text() }
                } else {
                    data = await res.text()
                }

                const result: SkillResult = { ok: res.ok, status: res.status, data, latency }
                this.cfg.onSkillResult?.(toolName, result)
                return result
            } finally {
                clearTimeout(timeoutId)
            }
        } catch (err: unknown) {
            const latency = Date.now() - start
            const message = err instanceof Error ? err.message : String(err)
            const isTimeout = err instanceof Error && err.name === 'AbortError'
            const result: SkillResult = {
                ok: false,
                status: isTimeout ? 408 : 0,
                data: null,
                latency,
                error: isTimeout ? `Skill "${toolName}" timed out after ${endpoint.timeout}ms` : message,
            }
            this.cfg.onSkillResult?.(toolName, result)
            return result
        }
    }

    /**
     * Convenience: execute all tool calls from a `ChatResult` in parallel.
     * Returns results keyed by the original tool call ID — ready to append
     * as `role: 'tool'` messages for the next conversation turn.
     *
     * @example
     * ```ts
     * const response = await provider.chat({ model, messages, tools: skills.getToolDefinitions() })
     *
     * if (response.message.toolCalls?.length) {
     *   const results = await skills.executeToolCalls(response.message.toolCalls)
     *   // Append results and continue the conversation
     * }
     * ```
     */
    async executeToolCalls(
        toolCalls: ToolCall[]
    ): Promise<Array<{ id: string; toolName: string; result: SkillResult }>> {
        return Promise.all(
            toolCalls.map(async call => {
                const toolName = call.function.name
                let args: Record<string, unknown> = {}
                try {
                    args = JSON.parse(call.function.arguments) as Record<string, unknown>
                } catch {
                    return {
                        id: call.id,
                        toolName,
                        result: { ok: false, status: 0, data: null, latency: 0, error: 'Invalid JSON arguments from model' },
                    }
                }
                const result = await this.execute(toolName, args)
                return { id: call.id, toolName, result }
            })
        )
    }

    // ── TekimaxPlugin lifecycle ───────────────────────────────────────────────

    /**
     * Auto-inject registered skill tool definitions into every outgoing request.
     * Merges with any tools already set in `context.requestOptions.tools`.
     */
    async beforeRequest(context: PluginContext): Promise<PluginContext | void> {
        if (!this.cfg.autoInject || this.registry.size === 0) return

        const existing = (context.requestOptions?.tools as ToolDefinition[] | undefined) ?? []
        const myTools = this.getToolDefinitions()

        // Merge — avoid duplicating if already injected
        const existingNames = new Set(existing.map(t => t.function.name))
        const toAdd = myTools.filter(t => !existingNames.has(t.function.name))

        context.requestOptions = {
            ...context.requestOptions,
            tools: [...existing, ...toAdd],
        }
        return context
    }

    async beforeToolExecute(toolName: string, args: unknown): Promise<void> {
        if (!this.registry.has(toolName)) return
        // Skill is about to be executed — could add rate limiting here
    }
}
