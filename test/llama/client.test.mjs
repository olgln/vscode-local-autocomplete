// Tests the HTTP client against a fake llama-server built on node:http (no model needed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { checkHealth, isAbortError, requestInfill, ServerUnavailableError } from '../../out/llama/client.js';

const request = {
    inputPrefix: 'def add(a, b):\n',
    inputSuffix: '\n',
    prompt: '    ',
    nIndent: 4,
    maxTokens: 16,
    maxPredictMs: 500,
};

/** Starts a server on a random local port; handler(req, body, res). */
async function withServer(handler, fn) {
    const server = createServer((req, res) => {
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => handler(req, body, res));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const endpoint = `http://127.0.0.1:${server.address().port}`;
    try {
        await fn(endpoint);
    } finally {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
    }
}

test('sends the FIM request and parses the answer', async () => {
    let seen;
    await withServer(
        (req, body, res) => {
            seen = { method: req.method, url: req.url, body: JSON.parse(body) };
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ content: 'return a + b', tokens_cached: 7, timings: { prompt_n: 3, predicted_n: 5 } }));
        },
        async (endpoint) => {
            const result = await requestInfill(endpoint, request, 2000, new AbortController().signal);
            assert.equal(result.content, 'return a + b');
            assert.equal(result.cachedTokens, 7);
            assert.equal(result.predictedTokens, 5);
        },
    );
    assert.equal(seen.method, 'POST');
    assert.equal(seen.url, '/infill');
    assert.equal(seen.body.input_prefix, request.inputPrefix);
    assert.equal(seen.body.prompt, '    ');
    assert.equal(seen.body.n_predict, 16);
    assert.equal(seen.body.n_indent, 4);
    assert.equal(seen.body.cache_prompt, true);
});

test('reports an unreachable server', async () => {
    // Port 9 (discard) is normally closed, so the connection is refused.
    await assert.rejects(
        requestInfill('http://127.0.0.1:9', request, 2000, new AbortController().signal),
        ServerUnavailableError,
    );
    assert.equal(await checkHealth('http://127.0.0.1:9'), 'unavailable');
});

test('aborts when cancelled and on timeout', async () => {
    await withServer(
        () => {
            /* never answers */
        },
        async (endpoint) => {
            const cancel = new AbortController();
            const pending = requestInfill(endpoint, request, 5000, cancel.signal);
            cancel.abort();
            await assert.rejects(pending, (e) => isAbortError(e));
            await assert.rejects(requestInfill(endpoint, request, 100, new AbortController().signal), (e) => isAbortError(e));
        },
    );
});

test('health: ok and loading', async () => {
    let status = 503;
    await withServer(
        (req, body, res) => {
            res.statusCode = status;
            res.end('{}');
        },
        async (endpoint) => {
            assert.equal(await checkHealth(endpoint), 'loading');
            status = 200;
            assert.equal(await checkHealth(endpoint), 'ok');
        },
    );
});
