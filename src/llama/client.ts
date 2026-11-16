// Minimal client for llama-server. Uses the built-in fetch: no runtime dependencies.
// API reference: llama.cpp tools/server/README.md (POST /infill, GET /health).

export interface InfillRequest {
    /** Lines before the current line, ending with "\n". */
    inputPrefix: string;
    /** Rest of the current line plus the lines after it. */
    inputSuffix: string;
    /** Current line up to the cursor; the model continues right after it. */
    prompt: string;
    /** Indentation of the current line; the server stops when a line is indented less. */
    nIndent: number;
    maxTokens: number;
    maxPredictMs: number;
}

export interface InfillResult {
    content: string;
    promptTokens?: number;
    promptMs?: number;
    predictedTokens?: number;
    predictedMs?: number;
    cachedTokens?: number;
    /** True when the client stopped the stream because the completion was already complete. */
    stoppedEarly?: boolean;
    /** True when the server stopped at maxTokens / maxPredictMs (the text may be cut mid-block). */
    hitLimit?: boolean;
}

/** The server could not be reached (not started, wrong port). */
export class ServerUnavailableError extends Error {}

/** One server-sent event of a streamed /infill response. */
interface LlamaInfillChunk {
    content?: string;
    stop?: boolean;
    stop_type?: string;
    tokens_cached?: number;
    timings?: {
        prompt_n?: number;
        prompt_ms?: number;
        predicted_n?: number;
        predicted_ms?: number;
    };
}

/**
 * Streams the completion. `isEnough` sees the text received so far after each chunk; once it
 * returns true the stream is closed, which makes llama-server stop generating.
 */
export async function requestInfill(
    endpoint: string,
    req: InfillRequest,
    timeoutMs: number,
    cancel: AbortSignal,
    isEnough: (textSoFar: string) => boolean = () => false,
): Promise<InfillResult> {
    const body = {
        input_prefix: req.inputPrefix,
        input_suffix: req.inputSuffix,
        input_extra: [],
        prompt: req.prompt,
        n_predict: req.maxTokens,
        n_indent: req.nIndent,
        top_k: 40,
        top_p: 0.99,
        samplers: ['top_k', 'top_p', 'infill'],
        // Reuse the KV cache between requests: only the changed tail is re-processed.
        cache_prompt: true,
        t_max_prompt_ms: 500,
        t_max_predict_ms: req.maxPredictMs,
        stream: true,
    };

    const response = await post(`${endpoint}/infill`, body, timeoutMs, cancel);
    if (!response.ok) {
        throw new Error(`llama-server /infill: HTTP ${response.status} ${await response.text()}`);
    }
    if (!response.body) throw new Error('llama-server /infill: empty response');

    const result: InfillResult = { content: '' };
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += value;
        // Events are "data: {json}" lines separated by blank lines.
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
            if (line.startsWith('data: ')) applyChunk(result, JSON.parse(line.slice(6)) as LlamaInfillChunk);
        }
        if (isEnough(result.content)) {
            result.stoppedEarly = true;
            await reader.cancel();
            break;
        }
    }
    return result;
}

function applyChunk(result: InfillResult, chunk: LlamaInfillChunk): void {
    result.content += chunk.content ?? '';
    if (!chunk.stop) return;
    result.hitLimit = chunk.stop_type === 'limit';
    result.cachedTokens = chunk.tokens_cached;
    result.promptTokens = chunk.timings?.prompt_n;
    result.promptMs = chunk.timings?.prompt_ms;
    result.predictedTokens = chunk.timings?.predicted_n;
    result.predictedMs = chunk.timings?.predicted_ms;
}

export type HealthStatus = 'ok' | 'loading' | 'unavailable';

/** GET /health: 200 when ready, 503 while the model is loading. */
export async function checkHealth(endpoint: string, timeoutMs = 2000): Promise<HealthStatus> {
    try {
        const response = await fetch(`${endpoint}/health`, { signal: AbortSignal.timeout(timeoutMs) });
        if (response.ok) return 'ok';
        if (response.status === 503) return 'loading';
        return 'unavailable';
    } catch {
        return 'unavailable';
    }
}

export function isAbortError(error: unknown): boolean {
    return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

async function post(url: string, body: unknown, timeoutMs: number, cancel: AbortSignal): Promise<Response> {
    try {
        return await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.any([cancel, AbortSignal.timeout(timeoutMs)]),
        });
    } catch (error) {
        if (isAbortError(error)) throw error;
        // Node's fetch rejects with TypeError("fetch failed") on ECONNREFUSED and similar.
        throw new ServerUnavailableError(`Cannot reach ${url}: ${describe(error)}`);
    }
}

function describe(error: unknown): string {
    if (error instanceof Error) {
        const cause = (error as Error & { cause?: unknown }).cause;
        return cause instanceof Error ? `${error.message} (${cause.message})` : error.message;
    }
    return String(error);
}
