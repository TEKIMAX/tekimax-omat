// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * Minimal Redis client interface.
 * Compatible with `ioredis`, `@upstash/redis`, `redis` (node-redis), etc.
 */
export interface RedisClient {
    get(key: string): Promise<string | null>
    set(key: string, value: string, ...args: any[]): Promise<any>
    del(key: string | string[]): Promise<any>
    incrby(key: string, increment: number): Promise<number>
    expire(key: string, seconds: number): Promise<any>
    incr(key: string): Promise<number>
    ttl(key: string): Promise<number>
    keys?(pattern: string): Promise<string[]>
}

export interface CacheOptions {
    /** TTL in seconds for cached responses. Default: 3600 (1 hour) */
    ttl?: number
    /** Key prefix for all cache entries. Default: 'tekimax:' */
    prefix?: string
    /** Custom key generation function. Default: SHA-256 of model+messages */
    keyFn?: (model: string, messages: any[]) => string
}

export interface RateLimitOptions {
    /** Maximum requests per window. Default: 60 */
    maxRequests: number
    /** Window size in seconds. Default: 60 */
    windowSeconds?: number
    /** Key prefix. Default: 'tekimax:ratelimit:' */
    prefix?: string
}

export interface TokenBudgetOptions {
    /** Maximum tokens allowed in the budget period */
    maxTokens: number
    /** Budget period in seconds. Default: 86400 (24 hours) */
    periodSeconds?: number
    /** Key prefix. Default: 'tekimax:budget:' */
    prefix?: string
}

export interface SessionOptions {
    /** TTL for session data in seconds. Default: 1800 (30 minutes) */
    ttl?: number
    /** Key prefix. Default: 'tekimax:session:' */
    prefix?: string
}

export interface RateLimitResult {
    allowed: boolean
    remaining: number
    resetInSeconds: number
}

export interface TokenBudgetResult {
    allowed: boolean
    used: number
    remaining: number
    resetInSeconds: number
}

// ─── Response Cache ─────────────────────────────────────────────────────────

/**
 * Cache AI responses in Redis. Identical requests return cached results
 * without hitting the provider API — saving cost and latency.
 *
 * @example
 * ```ts
 * import { ResponseCache } from 'tekimax-omat'
 * import Redis from 'ioredis'
 *
 * const cache = new ResponseCache(new Redis(), { ttl: 3600 })
 *
 * // Check cache before calling provider
 * const cached = await cache.get('gpt-4o', messages)
 * if (cached) return cached
 *
 * const result = await ai.chat('gpt-4o', messages)
 * await cache.set('gpt-4o', messages, result)
 * ```
 */
export class ResponseCache {
    private redis: RedisClient
    private ttl: number
    private prefix: string
    private keyFn: (model: string, messages: any[]) => string

    constructor(redis: RedisClient, options: CacheOptions = {}) {
        this.redis = redis
        this.ttl = options.ttl ?? 3600
        this.prefix = options.prefix ?? 'tekimax:cache:'
        this.keyFn = options.keyFn ?? this.defaultKeyFn
    }

    async get(model: string, messages: any[]): Promise<any | null> {
        const key = this.prefix + this.keyFn(model, messages)
        const data = await this.redis.get(key)
        if (!data) return null
        try {
            return JSON.parse(data)
        } catch {
            console.warn(`[ResponseCache] Corrupted cache entry for key ${key} — evicting`)
            await this.redis.del(key)
            return null
        }
    }

    async set(model: string, messages: any[], response: any): Promise<void> {
        const key = this.prefix + this.keyFn(model, messages)
        await this.redis.set(key, JSON.stringify(response), 'EX', this.ttl)
    }

    async invalidate(model: string, messages: any[]): Promise<void> {
        const key = this.prefix + this.keyFn(model, messages)
        await this.redis.del(key)
    }

    private defaultKeyFn(model: string, messages: any[]): string {
        const payload = JSON.stringify({ model, messages })

        // Isomorphic DBJ2 Hash (Sync) to avoid Node crypto imports 
        let hash = 5381
        for (let i = 0; i < payload.length; i++) {
            hash = ((hash << 5) + hash) + payload.charCodeAt(i)
        }

        return (hash >>> 0).toString(16)
    }
}

// ─── Rate Limiter ───────────────────────────────────────────────────────────

/**
 * Track per-provider request rates with sliding windows.
 * Prevents 429 errors by checking limits before making API calls.
 *
 * @example
 * ```ts
 * const limiter = new RateLimiter(redis, { maxRequests: 60, windowSeconds: 60 })
 *
 * const { allowed, remaining } = await limiter.check('openai')
 * if (!allowed) throw new Error('Rate limit exceeded')
 *
 * await limiter.record('openai')
 * ```
 */
export class RateLimiter {
    private redis: RedisClient
    private maxRequests: number
    private windowSeconds: number
    private prefix: string

    constructor(redis: RedisClient, options: RateLimitOptions) {
        this.redis = redis
        this.maxRequests = options.maxRequests
        this.windowSeconds = options.windowSeconds ?? 60
        this.prefix = options.prefix ?? 'tekimax:ratelimit:'
    }

    async check(provider: string): Promise<RateLimitResult> {
        const key = this.prefix + provider
        const current = await this.redis.get(key)
        const count = current ? parseInt(current, 10) : 0
        const ttl = await this.redis.ttl(key)

        return {
            allowed: count < this.maxRequests,
            remaining: Math.max(0, this.maxRequests - count),
            resetInSeconds: ttl > 0 ? ttl : this.windowSeconds,
        }
    }

    async record(provider: string): Promise<RateLimitResult> {
        const key = this.prefix + provider
        const count = await this.redis.incr(key)

        // Set TTL on first request in window
        if (count === 1) {
            await this.redis.expire(key, this.windowSeconds)
        }

        const ttl = await this.redis.ttl(key)

        return {
            allowed: count <= this.maxRequests,
            remaining: Math.max(0, this.maxRequests - count),
            resetInSeconds: ttl > 0 ? ttl : this.windowSeconds,
        }
    }
}

// ─── Token Budget Tracker ───────────────────────────────────────────────────

/**
 * Track daily/monthly token usage per API key.
 * Prevent surprise bills by enforcing token budgets.
 *
 * @example
 * ```ts
 * const budget = new TokenBudget(redis, { maxTokens: 100_000, periodSeconds: 86400 })
 *
 * // Check before making a call
 * const { allowed, used } = await budget.check('openai-prod')
 * if (!allowed) throw new Error(`Token budget exhausted (${used} used)`)
 *
 * // Record usage after call
 * await budget.record('openai-prod', result.usage.totalTokens)
 * ```
 */
export class TokenBudget {
    private redis: RedisClient
    private maxTokens: number
    private periodSeconds: number
    private prefix: string

    constructor(redis: RedisClient, options: TokenBudgetOptions) {
        this.redis = redis
        this.maxTokens = options.maxTokens
        this.periodSeconds = options.periodSeconds ?? 86400
        this.prefix = options.prefix ?? 'tekimax:budget:'
    }

    async check(bucket: string): Promise<TokenBudgetResult> {
        const key = this.prefix + bucket
        const current = await this.redis.get(key)
        const used = current ? parseInt(current, 10) : 0
        const ttl = await this.redis.ttl(key)

        return {
            allowed: used < this.maxTokens,
            used,
            remaining: Math.max(0, this.maxTokens - used),
            resetInSeconds: ttl > 0 ? ttl : this.periodSeconds,
        }
    }

    async record(bucket: string, tokensUsed: number): Promise<TokenBudgetResult> {
        const key = this.prefix + bucket
        const ttl = await this.redis.ttl(key)
        const used = await this.redis.incrby(key, tokensUsed)

        // Set TTL on first record in period
        if (ttl < 0) {
            await this.redis.expire(key, this.periodSeconds)
        }

        const newTtl = await this.redis.ttl(key)

        return {
            allowed: used <= this.maxTokens,
            used,
            remaining: Math.max(0, this.maxTokens - used),
            resetInSeconds: newTtl > 0 ? newTtl : this.periodSeconds,
        }
    }
}

// ─── Session Store ──────────────────────────────────────────────────────────

/**
 * Lightweight conversation session storage for serverless/edge deployments.
 * Store and retrieve message history with automatic TTL expiry.
 *
 * @example
 * ```ts
 * const sessions = new SessionStore(redis, { ttl: 1800 })
 *
 * // Save conversation state
 * await sessions.save('user-123', {
 *   messages: [...],
 *   metadata: { model: 'gpt-4o', startedAt: Date.now() }
 * })
 *
 * // Restore on next request
 * const session = await sessions.load('user-123')
 * ```
 */
export class SessionStore {
    private redis: RedisClient
    private ttl: number
    private prefix: string

    constructor(redis: RedisClient, options: SessionOptions = {}) {
        this.redis = redis
        this.ttl = options.ttl ?? 1800
        this.prefix = options.prefix ?? 'tekimax:session:'
    }

    async save(sessionId: string, data: any): Promise<void> {
        const key = this.prefix + sessionId
        await this.redis.set(key, JSON.stringify(data), 'EX', this.ttl)
    }

    async load(sessionId: string): Promise<any | null> {
        const key = this.prefix + sessionId
        const data = await this.redis.get(key)
        if (!data) return null
        try {
            return JSON.parse(data)
        } catch {
            console.warn(`[SessionStore] Corrupted session data for ${sessionId} — returning null`)
            return null
        }
    }

    async destroy(sessionId: string): Promise<void> {
        const key = this.prefix + sessionId
        await this.redis.del(key)
    }

    async touch(sessionId: string): Promise<void> {
        const key = this.prefix + sessionId
        await this.redis.expire(key, this.ttl)
    }
}
