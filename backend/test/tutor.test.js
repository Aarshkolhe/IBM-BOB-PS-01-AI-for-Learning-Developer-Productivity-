'use strict';

/**
 * Tests for POST /api/tutor and POST /api/reexplain
 * All provider HTTP calls are intercepted by overriding global.fetch.
 * No real API keys are used.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { PROVIDERS } = require('../providers');

const originalFetch = global.fetch;

function makeFetchStub(status, body) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
    body: { cancel: async () => {} }
  });
}

// Gemini response wrapping a text string
function geminiText(text) {
  return { candidates: [{ content: { parts: [{ text }] } }] };
}

// A valid tutor JSON payload
const VALID_TUTOR_JSON = {
  steps: [
    { title: 'Step 1', explanation: 'Explanation 1', worked_example: 'Example 1' },
    { title: 'Step 2', explanation: 'Explanation 2', worked_example: 'Example 2' },
    { title: 'Step 3', explanation: 'Explanation 3', worked_example: 'Example 3' },
    { title: 'Step 4', explanation: 'Explanation 4', worked_example: 'Example 4' }
  ],
  recap: 'This is the recap of the answer.',
  final_check_question: 'What does range(5) produce in Python?'
};

// ── POST helper ───────────────────────────────────────────────────────────────

async function postRoute(app, path, payload) {
  const http = require('node:http');
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const data = JSON.stringify(payload);
      const req = http.request({
        method: 'POST',
        hostname: '127.0.0.1',
        port,
        path,
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) }
      }, (res) => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
          server.close();
          let parsed;
          try { parsed = JSON.parse(body); } catch { parsed = null; }
          resolve({ status: res.statusCode, body: parsed });
        });
      });
      req.on('error', (err) => { server.close(); reject(err); });
      req.write(data);
      req.end();
    });
  });
}

const TUTOR_PAYLOAD = {
  provider: 'gemini',
  apiKey: 'test-gemini-key-1234',
  question: 'Why does my Python loop print the wrong result?',
  winnerText: 'The range(5) loop iterates from 0 to 4 inclusive.'
};

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/tutor
// ══════════════════════════════════════════════════════════════════════════════

// ── 1. Valid tutor JSON response ──────────────────────────────────────────────

test('tutor: returns parsed steps on a valid gemini response', async () => {
  global.fetch = makeFetchStub(200, geminiText(JSON.stringify(VALID_TUTOR_JSON)));
  const app = require('../server');
  const { status, body } = await postRoute(app, '/api/tutor', TUTOR_PAYLOAD);
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.ok(Array.isArray(body.steps) && body.steps.length === 4);
  assert.equal(body.steps[0].title, 'Step 1');
  assert.ok(typeof body.recap === 'string' && body.recap.length > 0);
  assert.ok(typeof body.final_check_question === 'string' && body.final_check_question.length > 0);
  assert.equal('apiKey' in body, false, 'API key must not appear in response');
  global.fetch = originalFetch;
});

// ── 2. Code fences stripped and parsed ────────────────────────────────────────

test('tutor: strips json code fences before parsing', async () => {
  const fenced = '```json\n' + JSON.stringify(VALID_TUTOR_JSON) + '\n```';
  global.fetch = makeFetchStub(200, geminiText(fenced));
  const app = require('../server');
  const { status, body } = await postRoute(app, '/api/tutor', TUTOR_PAYLOAD);
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.steps.length, 4);
  global.fetch = originalFetch;
});

// ── 3. Invalid JSON on first attempt → retries once → fails with 422 ─────────

test('tutor: invalid json triggers automatic retry and returns 422 after two failures', async () => {
  // Both attempts return unparseable text
  let callCount = 0;
  global.fetch = async () => {
    callCount++;
    return {
      ok: true, status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => geminiText('This is not JSON at all.'),
      body: { cancel: async () => {} }
    };
  };
  const app = require('../server');
  const { status, body } = await postRoute(app, '/api/tutor', TUTOR_PAYLOAD);
  assert.equal(status, 422);
  assert.ok(body.error && (body.error.code === 'TUTOR_INVALID_JSON' || body.error.code === 'TUTOR_SCHEMA_ERROR'));
  assert.equal(body.retried, true);
  assert.equal(callCount, 2, 'Provider should be called exactly twice (original + 1 retry)');
  global.fetch = originalFetch;
});

// ── 4. Invalid JSON on first attempt → valid JSON on retry → succeeds ─────────

test('tutor: recovers when first attempt fails and retry succeeds', async () => {
  let callCount = 0;
  global.fetch = async () => {
    callCount++;
    const responseText = callCount === 1
      ? 'not json'
      : JSON.stringify(VALID_TUTOR_JSON);
    return {
      ok: true, status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => geminiText(responseText),
      body: { cancel: async () => {} }
    };
  };
  const app = require('../server');
  const { status, body } = await postRoute(app, '/api/tutor', TUTOR_PAYLOAD);
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(callCount, 2);
  assert.equal(body.retried, true);
  global.fetch = originalFetch;
});

// ── 5. Schema error: step count outside 4-6 → 422 ────────────────────────────

test('tutor: rejects tutor json with too few steps', async () => {
  const bad = { ...VALID_TUTOR_JSON, steps: VALID_TUTOR_JSON.steps.slice(0, 2) };
  global.fetch = async () => ({
    ok: true, status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => geminiText(JSON.stringify(bad)),
    body: { cancel: async () => {} }
  });
  const app = require('../server');
  const { status, body } = await postRoute(app, '/api/tutor', TUTOR_PAYLOAD);
  // First attempt and retry both fail schema validation
  assert.equal(status, 422);
  assert.ok(body.error && (body.error.code === 'TUTOR_SCHEMA_ERROR' || body.error.code === 'TUTOR_INVALID_JSON'));
  global.fetch = originalFetch;
});

// ── 6. Schema error: missing recap → 422 ─────────────────────────────────────

test('tutor: rejects tutor json with missing recap', async () => {
  const bad = { steps: VALID_TUTOR_JSON.steps, final_check_question: 'Q?' };
  // both attempts return same bad payload
  global.fetch = makeFetchStub(200, geminiText(JSON.stringify(bad)));
  const app = require('../server');
  const { status, body } = await postRoute(app, '/api/tutor', TUTOR_PAYLOAD);
  assert.equal(status, 422);
  assert.ok(body.error);
  global.fetch = originalFetch;
});

// ── 7. Tutor uses the strong model ────────────────────────────────────────────

test('tutor: gemini tutor request uses the configured strong model', async () => {
  let capturedUrl = '';
  global.fetch = async (url) => {
    capturedUrl = url;
    return {
      ok: true, status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => geminiText(JSON.stringify(VALID_TUTOR_JSON)),
      body: { cancel: async () => {} }
    };
  };
  const app = require('../server');
  await postRoute(app, '/api/tutor', TUTOR_PAYLOAD);
  assert.ok(capturedUrl.includes(PROVIDERS.gemini.strongModel),
    `Tutor must use strong model "${PROVIDERS.gemini.strongModel}", got: ${capturedUrl}`);
  assert.equal(capturedUrl.includes(PROVIDERS.gemini.fastModel), false,
    `Tutor must not use fast model "${PROVIDERS.gemini.fastModel}"`);
  global.fetch = originalFetch;
});

// ── 8. Missing API key → 400 INVALID_REQUEST ─────────────────────────────────

test('tutor: rejects empty api key', async () => {
  const app = require('../server');
  const { status, body } = await postRoute(app, '/api/tutor', {
    ...TUTOR_PAYLOAD, apiKey: ''
  });
  assert.equal(status, 400);
  assert.ok(body.error && body.error.code === 'INVALID_REQUEST');
});

// ── 9. Invalid provider → 400 INVALID_REQUEST ────────────────────────────────

test('tutor: rejects unsupported provider', async () => {
  const app = require('../server');
  const { status, body } = await postRoute(app, '/api/tutor', {
    ...TUTOR_PAYLOAD, provider: 'grok'
  });
  assert.equal(status, 400);
  assert.ok(body.error && body.error.code === 'INVALID_REQUEST');
});

// ── 10. Provider 401 → sanitized auth error, key not in response ──────────────

test('tutor: gemini 401 maps to sanitized auth error, key not in response', async () => {
  const badKey = 'gemini-tutor-bad-key-12345';
  global.fetch = makeFetchStub(401, { error: { message: 'API key not valid.' } });
  const app = require('../server');
  const { status, body } = await postRoute(app, '/api/tutor', {
    ...TUTOR_PAYLOAD, apiKey: badKey
  });
  assert.equal(status, 422);
  assert.ok(body.error && body.error.code === 'PROVIDER_AUTH_FAILED');
  assert.equal(JSON.stringify(body).includes(badKey), false, 'API key must not appear in error response');
  global.fetch = originalFetch;
});

// ── 11. API key never in success response ─────────────────────────────────────

test('tutor: api key never appears in success response', async () => {
  const secretKey = 'gemini-tutor-secret-key-abc123';
  global.fetch = makeFetchStub(200, geminiText(JSON.stringify(VALID_TUTOR_JSON)));
  const app = require('../server');
  const { body } = await postRoute(app, '/api/tutor', {
    ...TUTOR_PAYLOAD, apiKey: secretKey
  });
  assert.equal(JSON.stringify(body).includes(secretKey), false, 'API key must not appear in success response');
  global.fetch = originalFetch;
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/reexplain
// ══════════════════════════════════════════════════════════════════════════════

const REEXPLAIN_PAYLOAD = {
  provider: 'gemini',
  apiKey: 'test-gemini-key-1234',
  stepTitle: 'Understanding range()',
  stepExplanation: 'range(5) produces values 0, 1, 2, 3, 4',
  notClearCount: 1
};

// ── 12. Re-explanation count 1 returns simpler explanation ────────────────────

test('reexplain: returns simpler explanation for notClearCount 1', async () => {
  global.fetch = makeFetchStub(200, geminiText('A simpler explanation: think of it as counting from 0.'));
  const app = require('../server');
  const { status, body } = await postRoute(app, '/api/reexplain', REEXPLAIN_PAYLOAD);
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.ok(typeof body.explanation === 'string' && body.explanation.length > 0);
  assert.equal('apiKey' in body, false);
  global.fetch = originalFetch;
});

// ── 13. Re-explanation count 2 returns alternative analogy ───────────────────

test('reexplain: returns worked example explanation for notClearCount 2', async () => {
  global.fetch = makeFetchStub(200, geminiText('Worked example: range(3) → [0, 1, 2]. Count starts at zero.'));
  const app = require('../server');
  const { status, body } = await postRoute(app, '/api/reexplain', {
    ...REEXPLAIN_PAYLOAD, notClearCount: 2
  });
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.ok(typeof body.explanation === 'string' && body.explanation.length > 0);
  global.fetch = originalFetch;
});

// ── 14. notClearCount 3 is rejected (third click uses worked_example, no call) ─

test('reexplain: rejects notClearCount of 3 (third click handled client-side)', async () => {
  const app = require('../server');
  const { status, body } = await postRoute(app, '/api/reexplain', {
    ...REEXPLAIN_PAYLOAD, notClearCount: 3
  });
  assert.equal(status, 400);
  assert.ok(body.error && body.error.code === 'INVALID_REQUEST');
});

// ── 15. notClearCount 0 is rejected ──────────────────────────────────────────

test('reexplain: rejects notClearCount of 0', async () => {
  const app = require('../server');
  const { status, body } = await postRoute(app, '/api/reexplain', {
    ...REEXPLAIN_PAYLOAD, notClearCount: 0
  });
  assert.equal(status, 400);
  assert.ok(body.error && body.error.code === 'INVALID_REQUEST');
});

// ── 16. Re-explain uses the strong model ─────────────────────────────────────

test('reexplain: gemini re-explanation request uses the configured strong model', async () => {
  let capturedUrl = '';
  global.fetch = async (url) => {
    capturedUrl = url;
    return {
      ok: true, status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => geminiText('Simpler: think of counting.'),
      body: { cancel: async () => {} }
    };
  };
  const app = require('../server');
  await postRoute(app, '/api/reexplain', REEXPLAIN_PAYLOAD);
  assert.ok(capturedUrl.includes(PROVIDERS.gemini.strongModel),
    `Re-explain must use strong model "${PROVIDERS.gemini.strongModel}", got: ${capturedUrl}`);
  global.fetch = originalFetch;
});

// ── 17. Re-explain missing key → 400 ─────────────────────────────────────────

test('reexplain: rejects empty api key', async () => {
  const app = require('../server');
  const { status, body } = await postRoute(app, '/api/reexplain', {
    ...REEXPLAIN_PAYLOAD, apiKey: ''
  });
  assert.equal(status, 400);
  assert.ok(body.error && body.error.code === 'INVALID_REQUEST');
});

// ── 18. Re-explain provider 401 → sanitized error, key not in response ────────

test('reexplain: gemini 401 maps to sanitized auth error, key not in response', async () => {
  const badKey = 'gemini-reexplain-bad-key-789';
  global.fetch = makeFetchStub(401, { error: { message: 'API key not valid.' } });
  const app = require('../server');
  const { status, body } = await postRoute(app, '/api/reexplain', {
    ...REEXPLAIN_PAYLOAD, apiKey: badKey
  });
  assert.equal(status, 422);
  assert.ok(body.error && body.error.code === 'PROVIDER_AUTH_FAILED');
  assert.equal(JSON.stringify(body).includes(badKey), false, 'API key must not appear in error response');
  global.fetch = originalFetch;
});

// ── 19. Re-explain key never in success response ──────────────────────────────

test('reexplain: api key never appears in success response', async () => {
  const secretKey = 'gemini-reexplain-secret-key-xyz';
  global.fetch = makeFetchStub(200, geminiText('This is clearer: think of a loop counter.'));
  const app = require('../server');
  const { body } = await postRoute(app, '/api/reexplain', {
    ...REEXPLAIN_PAYLOAD, apiKey: secretKey
  });
  assert.equal(JSON.stringify(body).includes(secretKey), false, 'API key must not appear in success response');
  global.fetch = originalFetch;
});

// ── 20. Oversized stepExplanation is rejected ─────────────────────────────────

test('reexplain: rejects stepExplanation exceeding 3,000 characters', async () => {
  const app = require('../server');
  const { status, body } = await postRoute(app, '/api/reexplain', {
    ...REEXPLAIN_PAYLOAD, stepExplanation: 'x'.repeat(3001)
  });
  assert.equal(status, 400);
  assert.ok(body.error && body.error.code === 'INVALID_REQUEST');
});
