import { TekimaxPlugin, PluginContext } from '../core/types';

// ─────────────────────────────────────────────────────────────
// SSRF guard — block private, loopback, and metadata ranges
// ─────────────────────────────────────────────────────────────

const PRIVATE_HOSTNAME = /^(localhost|.*\.local)$/i;

function isPrivateOrReservedUrl(urlString: string): boolean {
    let host: string;
    try {
        host = new URL(urlString).hostname;
    } catch {
        return true; // Malformed URL — block it
    }

    // Hostname checks
    if (PRIVATE_HOSTNAME.test(host)) return true;

    // IPv4 checks
    const parts = host.split('.').map(Number);
    if (parts.length === 4 && parts.every(p => !isNaN(p))) {
        const [a, b] = parts as [number, number, number, number];
        if (a === 127) return true;                           // 127.0.0.0/8 loopback
        if (a === 10) return true;                            // 10.0.0.0/8 private
        if (a === 172 && b >= 16 && b <= 31) return true;    // 172.16.0.0/12 private
        if (a === 192 && b === 168) return true;              // 192.168.0.0/16 private
        if (a === 169 && b === 254) return true;              // 169.254.0.0/16 link-local (AWS metadata)
        if (a === 0) return true;                             // 0.0.0.0/8 reserved
    }

    // IPv6 loopback
    if (host === '::1' || host === '[::1]') return true;

    return false;
}

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface ProvisionConfig {
    /** Base URL of the API to connect to */
    apiUrl: string;
    /** API key for authentication (sent as X-API-Key header) */
    apiKey?: string;
    /** Deployment or tenant identifier */
    deploymentId?: string;
    /** Rate limit: max requests per window (default: 60) */
    rateLimit?: number;
    /** Rate limit window in ms (default: 60_000 = 1 minute) */
    rateLimitWindow?: number;
    /** Custom headers to include in every request */
    headers?: Record<string, string>;
    /** Request timeout in ms (default: 15_000) */
    timeout?: number;
    /** Auth header name (default: 'X-API-Key') */
    authHeader?: string;
}

export interface ApiEndpoint {
    /** HTTP method */
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    /** Path template (supports :param and {param} patterns) */
    path: string;
    /** Description for documentation / logging */
    description?: string;
}

export interface ApiResponse<T = unknown> {
    ok: boolean;
    status: number;
    data: T;
    headers: Record<string, string>;
    /** Time taken in ms */
    latency: number;
}

// ─────────────────────────────────────────────────────────────
// Rate Limiter
// ─────────────────────────────────────────────────────────────

class RateLimiter {
    private timestamps: number[] = [];

    constructor(
        private maxRequests: number,
        private windowMs: number
    ) { }

    async acquire(): Promise<void> {
        // Iterative — no recursion risk under backpressure
        while (true) {
            const now = Date.now();
            this.timestamps = this.timestamps.filter(t => now - t < this.windowMs);

            if (this.timestamps.length < this.maxRequests) {
                this.timestamps.push(now);
                return;
            }

            const oldest = this.timestamps[0]!;
            const waitMs = this.windowMs - (now - oldest) + 10;
            await new Promise<void>(r => setTimeout(r, waitMs));
        }
    }
}

// ─────────────────────────────────────────────────────────────
// ApiNamespace — Generic endpoint registry for any API
// ─────────────────────────────────────────────────────────────

/**
 * A namespace that groups related API endpoints together.
 * Register named endpoints, then call them by name with params and body.
 *
 * @example
 * ```ts
 * const users = provision.api('/api/users');
 * users.register('search', { method: 'GET', path: '/search?q=:query' });
 * users.register('create', { method: 'POST', path: '/' });
 * users.register('getById', { method: 'GET', path: '/{id}' });
 *
 * const result = await users.call('search', { query: 'john' });
 * const user = await users.call('getById', { id: '123' });
 * const created = await users.call('create', {}, { name: 'Jane' });
 * ```
 */
export class ApiNamespace {
    private endpoints: Map<string, ApiEndpoint> = new Map();

    constructor(
        private requestFn: <T>(method: string, path: string, body?: unknown) => Promise<ApiResponse<T>>,
        private basePath: string = ''
    ) { }

    /** Register a named endpoint */
    register(name: string, endpoint: ApiEndpoint): this {
        this.endpoints.set(name, endpoint);
        return this;
    }

    /** Register multiple endpoints at once */
    registerAll(endpoints: Record<string, ApiEndpoint>): this {
        for (const [name, endpoint] of Object.entries(endpoints)) {
            this.endpoints.set(name, endpoint);
        }
        return this;
    }

    /** Call a registered endpoint by name */
    async call<T = unknown>(
        name: string,
        params?: Record<string, string>,
        body?: unknown
    ): Promise<ApiResponse<T>> {
        const endpoint = this.endpoints.get(name);
        if (!endpoint) {
            throw new Error(`ProvisionPlugin: endpoint '${name}' not registered. Available: ${[...this.endpoints.keys()].join(', ')}`);
        }

        let path = this.basePath + endpoint.path;
        if (params) {
            for (const [key, value] of Object.entries(params)) {
                path = path.replace(`:${key}`, encodeURIComponent(value));
                path = path.replace(`{${key}}`, encodeURIComponent(value));
            }
        }

        return this.requestFn<T>(endpoint.method, path, body);
    }

    /** List all registered endpoint names */
    list(): string[] {
        return [...this.endpoints.keys()];
    }

    // ── Convenience methods for unregistered paths ────────

    async get<T = unknown>(path: string): Promise<ApiResponse<T>> {
        return this.requestFn<T>('GET', this.basePath + path);
    }

    async post<T = unknown>(path: string, body?: unknown): Promise<ApiResponse<T>> {
        return this.requestFn<T>('POST', this.basePath + path, body);
    }

    async put<T = unknown>(path: string, body?: unknown): Promise<ApiResponse<T>> {
        return this.requestFn<T>('PUT', this.basePath + path, body);
    }

    async patch<T = unknown>(path: string, body?: unknown): Promise<ApiResponse<T>> {
        return this.requestFn<T>('PATCH', this.basePath + path, body);
    }

    async del<T = unknown>(path: string): Promise<ApiResponse<T>> {
        return this.requestFn<T>('DELETE', this.basePath + path);
    }
}

// ─────────────────────────────────────────────────────────────
// ProvisionPlugin
// ─────────────────────────────────────────────────────────────

/**
 * ProvisionPlugin — A generic, endpoint-agnostic API client plugin for
 * the Tekimax SDK. Provides authenticated, rate-limited access to any
 * REST API with a clean namespace pattern.
 *
 * Features:
 * - **Auth injection**: API key sent via configurable header (`X-API-Key` default)
 * - **Rate limiting**: Token-bucket limiter to prevent API abuse
 * - **Timeout handling**: Configurable request timeouts via AbortController
 * - **Namespace pattern**: Group related endpoints with `api()` method
 * - **Type-safe responses**: Generic `ApiResponse<T>` with latency tracking
 *
 * @example
 * ```ts
 * import { ProvisionPlugin } from 'tekimax-omat';
 *
 * const provision = new ProvisionPlugin({
 *   apiUrl: 'https://api.example.com',
 *   apiKey: 'sk_live_...',
 * });
 *
 * // Create namespaces for different API areas
 * const users = provision.api('/api/users');
 * users.registerAll({
 *   list:   { method: 'GET',  path: '/' },
 *   get:    { method: 'GET',  path: '/{id}' },
 *   create: { method: 'POST', path: '/' },
 *   delete: { method: 'DELETE', path: '/{id}' },
 * });
 *
 * // Type-safe calls
 * const result = await users.call<User[]>('list');
 * const user = await users.call<User>('get', { id: '123' });
 *
 * // Direct HTTP for one-off requests
 * const health = await provision.request('GET', '/api/health');
 * ```
 */
export class ProvisionPlugin implements TekimaxPlugin {
    name = 'ProvisionPlugin';

    private config: Required<Pick<ProvisionConfig, 'apiUrl'>> & ProvisionConfig;
    private rateLimiter: RateLimiter;
    private _apis: Map<string, ApiNamespace> = new Map();

    constructor(config: ProvisionConfig) {
        if (!config.apiUrl) throw new Error('ProvisionPlugin: apiUrl is required');
        this.config = {
            rateLimit: 60,
            rateLimitWindow: 60_000,
            timeout: 15_000,
            authHeader: 'X-API-Key',
            ...config,
            apiUrl: config.apiUrl.replace(/\/+$/, ''),
        };
        this.rateLimiter = new RateLimiter(
            this.config.rateLimit!,
            this.config.rateLimitWindow!
        );
    }

    // ── TekimaxPlugin Lifecycle Hooks ─────────────────────

    onInit(client: any) {
        console.log(`[ProvisionPlugin] Initialized — API: ${this.config.apiUrl}`);
    }

    async beforeRequest(context: PluginContext) {
        if (this.config.deploymentId) {
            context.requestOptions = {
                ...context.requestOptions,
                deploymentId: this.config.deploymentId,
                provisionApiUrl: this.config.apiUrl,
            };
        }
    }

    // ── Namespace Factory ────────────────────────────────

    /**
     * Get or create a namespaced API client. Namespaces are cached by
     * basePath for reuse across your application.
     *
     * @param basePath - Base path prefix for all endpoints in this namespace
     */
    api(basePath: string = ''): ApiNamespace {
        if (!this._apis.has(basePath)) {
            this._apis.set(basePath, new ApiNamespace(this.request.bind(this), basePath));
        }
        return this._apis.get(basePath)!;
    }

    // ── Core HTTP Client ─────────────────────────────────

    /**
     * Make an authenticated, rate-limited request to the API.
     * Used by all namespaces and also available for direct calls.
     */
    async request<T = unknown>(
        method: string,
        path: string,
        body?: unknown
    ): Promise<ApiResponse<T>> {
        await this.rateLimiter.acquire();

        // Build full URL first, then SSRF-check the resolved address
        let url: string;
        if (path.startsWith('http://') || path.startsWith('https://')) {
            const requestedHost = new URL(path).host;
            const baseHost = new URL(this.config.apiUrl).host;
            if (requestedHost !== baseHost) {
                throw new Error(
                    `ProvisionPlugin: absolute URL host "${requestedHost}" does not match configured apiUrl host "${baseHost}"`
                );
            }
            url = path;
        } else {
            url = `${this.config.apiUrl}${path}`;
        }

        // Block private/loopback/metadata addresses regardless of how the URL was built
        if (isPrivateOrReservedUrl(url)) {
            throw new Error(
                `ProvisionPlugin: request to "${new URL(url).hostname}" is blocked — ` +
                'private, loopback, and metadata service addresses are not allowed'
            );
        }
        const start = Date.now();

        // Build headers
        const headers: Record<string, string> = {
            'Accept': 'application/json',
            ...this.config.headers,
        };

        if (this.config.apiKey && this.config.authHeader) {
            headers[this.config.authHeader!] = this.config.apiKey;
        }

        if (this.config.deploymentId) {
            headers['X-Deployment-ID'] = this.config.deploymentId;
        }

        // Build fetch options
        const fetchOpts: RequestInit = { method, headers };

        if (body !== undefined && body !== null) {
            if (typeof FormData !== 'undefined' && body instanceof FormData) {
                fetchOpts.body = body;
            } else {
                headers['Content-Type'] = 'application/json';
                fetchOpts.body = JSON.stringify(body);
            }
        }

        // Timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeout!);
        fetchOpts.signal = controller.signal;

        try {
            const res = await fetch(url, fetchOpts);
            clearTimeout(timeoutId);

            const latency = Date.now() - start;
            const responseHeaders: Record<string, string> = {};
            res.headers.forEach((v, k) => { responseHeaders[k] = v; });

            let data: T;
            const contentType = res.headers.get('content-type') || '';
            if (contentType.includes('application/json')) {
                data = await res.json() as T;
            } else {
                data = (await res.text()) as unknown as T;
            }

            return { ok: res.ok, status: res.status, data, headers: responseHeaders, latency };
        } catch (err: any) {
            clearTimeout(timeoutId);
            const latency = Date.now() - start;

            if (err.name === 'AbortError') {
                return {
                    ok: false, status: 408,
                    data: { error: `Request timed out after ${this.config.timeout}ms` } as unknown as T,
                    headers: {}, latency,
                };
            }

            return {
                ok: false, status: 0,
                data: { error: err.message } as unknown as T,
                headers: {}, latency,
            };
        }
    }
}
