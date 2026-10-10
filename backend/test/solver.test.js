'use strict';

/**
 * Tests for POST /api/solver
 * All provider HTTP calls are intercepted by overriding global.fetch.
 * No real API keys are used.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { PROVIDERS } = require('../providers');

// We need to stub fetch BEFORE requiring the app, so we set it globally here.
// Each test restores or replaces it as needed.
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

// ── Helper: POST to /api/solver through the Express app ───────────────────────

async function postSolver(app, payload) {
  // Use supertest-style manual HTTP only if available; otherwise use the
  // built-in http module.  We avoid a supertest dependency by driving the
  // Express handler directly.
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
        path: '/api/solver',
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

// ── 1. Successful solver response ─────────────────────────────────────────────

test('solver: returns a draft on a successful provider response (anthropic)', async () => {
  global.fetch = makeFetchStub(200, {
    content: [{ type: 'text', text: 'The loop fails because of off-by-one indexing.' }]
  });
  const app = require('../server');
  const { status, body } = await postSolver(app, {
    provider: 'anthropic',
    apiKey: 'test-key-123456789',
    question: 'Why does my Python loop fail?',
    style: 'concise'
  });
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.provider, 'anthropic');
  assert.equal(body.style, 'concise');
  assert.ok(typeof body.draft === 'string' && body.draft.length > 0);
  assert.equal('apiKey' in body, false, 'Response must not echo the API key');
  global.fetch = originalFetch;
});

// ── 2. Successful solver response (openai) ────────────────────────────────────

test('solver: returns a draft on a successful provider response (openai)', async () => {
  global.fetch = makeFetchStub(200, {
    choices: [{ message: { content: 'The loop iterates incorrectly.' } }]
  });
  const app = require('../server');
  const { status, body } = await postSolver(app, {
    provider: 'openai',
    apiKey: 'test-key-123456789',
    question: 'Why does my Python loop fail?',
    style: 'first_principles'
  });
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.provider, 'openai');
  assert.equal(body.style, 'first_principles');
  assert.ok(typeof body.draft === 'string');
  global.fetch = originalFetch;
});

// ── 3. Successful solver response (gemini) ────────────────────────────────────

test('solver: returns a draft on a successful provider response (gemini)', async () => {
  global.fetch = makeFetchStub(200, {
    candidates: [{ content: { parts: [{ text: 'The loop range is off.' }] } }]
  });
  const app = require('../server');
  const { status, body } = await postSolver(app, {
    provider: 'gemini',
    apiKey: 'test-key-123456789',
    question: 'Why does my Python loop fail?',
    style: 'example_driven'
  });
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.provider, 'gemini');
  global.fetch = originalFetch;
});

// ── 4. Invalid provider is rejected ──────────────────────────────────────────

test('solver: rejects an unsupported provider name', async () => {
  const app = require('../server');
  const { status, body } = await postSolver(app, {
    provider: 'fakeprovider',
    apiKey: 'test-key-123456789',
    question: 'Why does my Python loop fail?',
    style: 'concise'
  });
  assert.equal(status, 400);
  assert.ok(body.error && body.error.code === 'INVALID_REQUEST');
});

// ── 5. Invalid solver style is rejected ──────────────────────────────────────

test('solver: rejects an invalid solver style', async () => {
  const app = require('../server');
  const { status, body } = await postSolver(app, {
    provider: 'openai',
    apiKey: 'test-key-123456789',
    question: 'Why does my Python loop fail?',
    style: 'make_up_my_own'
  });
  assert.equal(status, 400);
  assert.ok(body.error && body.error.code === 'INVALID_REQUEST');
});

// ── 6. Oversized question is rejected ────────────────────────────────────────

test('solver: rejects a question exceeding 12,000 characters', async () => {
  const app = require('../server');
  const { status, body } = await postSolver(app, {
    provider: 'openai',
    apiKey: 'test-key-123456789',
    question: 'x'.repeat(12001),
    style: 'concise'
  });
  assert.equal(status, 400);
  assert.ok(body.error && body.error.code === 'INVALID_REQUEST');
});

// ── 7. Provider returns 401 → sanitized auth error ───────────────────────────

test('solver: maps provider 401 to a sanitized auth error', async () => {
  global.fetch = makeFetchStub(401, { error: { message: 'invalid_api_key' } });
  const app = require('../server');
  const { status, body } = await postSolver(app, {
    provider: 'anthropic',
    apiKey: 'bad-key-12345678',
    question: 'Why does my Python loop fail?',
    style: 'concise'
  });
  assert.equal(status, 422);
  assert.ok(body.error && body.error.code === 'PROVIDER_AUTH_FAILED');
  // Confirm the key is not echoed back
  assert.equal(JSON.stringify(body).includes('bad-key'), false);
  global.fetch = originalFetch;
});

// ── 8. Provider returns 429 → rate limit forwarded ───────────────────────────

test('solver: maps provider 429 to a rate-limit error', async () => {
  global.fetch = makeFetchStub(429, { error: 'rate_limit_exceeded' });
  const app = require('../server');
  const { status, body } = await postSolver(app, {
    provider: 'openai',
    apiKey: 'test-key-123456789',
    question: 'What is recursion?',
    style: 'first_principles'
  });
  assert.equal(status, 429);
  assert.ok(body.error && body.error.code === 'PROVIDER_LIMIT_REACHED');
  global.fetch = originalFetch;
});

// ── 9. Provider returns empty text → safe error ───────────────────────────────

test('solver: returns an error when provider returns empty text', async () => {
  global.fetch = makeFetchStub(200, {
    choices: [{ message: { content: '   ' } }]  // whitespace-only
  });
  const app = require('../server');
  const { status, body } = await postSolver(app, {
    provider: 'openai',
    apiKey: 'test-key-123456789',
    question: 'What is a closure?',
    style: 'concise'
  });
  assert.equal(status, 502);
  assert.ok(body.error && body.error.code === 'PROVIDER_EMPTY_RESPONSE');
  global.fetch = originalFetch;
});

// ── 10. Response never contains the API key ───────────────────────────────────

test('solver: response body never contains the submitted API key', async () => {
  const secretKey = 'sk-very-secret-key-abcdef';
  global.fetch = makeFetchStub(200, {
    choices: [{ message: { content: 'Recursion is a function that calls itself.' } }]
  });
  const app = require('../server');
  const { body } = await postSolver(app, {
    provider: 'openai',
    apiKey: secretKey,
    question: 'What is recursion?',
    style: 'concise'
  });
  const responseText = JSON.stringify(body);
  assert.equal(responseText.includes(secretKey), false, 'API key must not appear in response');
  global.fetch = originalFetch;
});

// ── 11. Gemini concise solver succeeds ───────────────────────────────────────

test('solver: returns a draft for gemini with concise style', async () => {
  global.fetch = makeFetchStub(200, {
    candidates: [{ content: { parts: [{ text: 'A concise answer about loops.' }] } }]
  });
  const app = require('../server');
  const { status, body } = await postSolver(app, {
    provider: 'gemini',
    apiKey: 'test-gemini-key-1234',
    question: 'Why does my Python loop fail?',
    style: 'concise'
  });
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.provider, 'gemini');
  assert.equal(body.style, 'concise');
  assert.ok(typeof body.draft === 'string' && body.draft.length > 0);
  assert.equal('apiKey' in body, false, 'Response must not echo the API key');
  global.fetch = originalFetch;
});

// ── 12. Gemini first_principles solver succeeds ───────────────────────────────

test('solver: returns a draft for gemini with first_principles style', async () => {
  global.fetch = makeFetchStub(200, {
    candidates: [{ content: { parts: [{ text: 'From first principles: iteration works by...' }] } }]
  });
  const app = require('../server');
  const { status, body } = await postSolver(app, {
    provider: 'gemini',
    apiKey: 'test-gemini-key-1234',
    question: 'Why does my Python loop fail?',
    style: 'first_principles'
  });
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.provider, 'gemini');
  assert.equal(body.style, 'first_principles');
  assert.ok(typeof body.draft === 'string' && body.draft.length > 0);
  global.fetch = originalFetch;
});

// ── 13. Gemini example_driven solver succeeds ─────────────────────────────────

test('solver: returns a draft for gemini with example_driven style', async () => {
  global.fetch = makeFetchStub(200, {
    candidates: [{ content: { parts: [{ text: 'Example: for i in range(5): ...' }] } }]
  });
  const app = require('../server');
  const { status, body } = await postSolver(app, {
    provider: 'gemini',
    apiKey: 'test-gemini-key-1234',
    question: 'Why does my Python loop fail?',
    style: 'example_driven'
  });
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.provider, 'gemini');
  assert.equal(body.style, 'example_driven');
  assert.ok(typeof body.draft === 'string' && body.draft.length > 0);
  global.fetch = originalFetch;
});

// ── 14. Gemini solver uses the fast model ─────────────────────────────────────

test('solver: gemini solver request uses the configured fast model', async () => {
  let capturedUrl = '';
  global.fetch = async (url) => {
    capturedUrl = url;
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'Fast model answer.' }] } }]
      }),
      body: { cancel: async () => {} }
    };
  };
  const app = require('../server');
  await postSolver(app, {
    provider: 'gemini',
    apiKey: 'test-gemini-key-1234',
    question: 'What is recursion?',
    style: 'concise'
  });
  assert.ok(capturedUrl.includes(PROVIDERS.gemini.fastModel),
    `Expected URL to contain fast model "${PROVIDERS.gemini.fastModel}", got: ${capturedUrl}`);
  assert.equal(capturedUrl.includes(PROVIDERS.gemini.strongModel), false,
    `URL must not contain strong model "${PROVIDERS.gemini.strongModel}"`);
  global.fetch = originalFetch;
});

// ── 15. Empty Gemini key is rejected before provider call ─────────────────────

test('solver: rejects an empty gemini api key', async () => {
  const app = require('../server');
  const { status, body } = await postSolver(app, {
    provider: 'gemini',
    apiKey: '',
    question: 'What is a stack?',
    style: 'concise'
  });
  assert.equal(status, 400);
  assert.ok(body.error && body.error.code === 'INVALID_REQUEST');
});

// ── 16. Short/invalid Gemini key is rejected before provider call ─────────────

test('solver: rejects a gemini api key that is too short', async () => {
  const app = require('../server');
  const { status, body } = await postSolver(app, {
    provider: 'gemini',
    apiKey: 'tooshort',   // 8 chars — under the 10-char minimum
    question: 'What is a queue?',
    style: 'concise'
  });
  assert.equal(status, 400);
  assert.ok(body.error && body.error.code === 'INVALID_REQUEST');
});

// ── 17. Gemini 401 → sanitized auth error, key not in response ───────────────

test('solver: gemini 401 maps to sanitized auth error and key is not in response', async () => {
  const badKey = 'gemini-bad-key-12345';
  global.fetch = makeFetchStub(401, { error: { message: 'API key not valid.' } });
  const app = require('../server');
  const { status, body } = await postSolver(app, {
    provider: 'gemini',
    apiKey: badKey,
    question: 'Why does my Python loop fail?',
    style: 'concise'
  });
  assert.equal(status, 422);
  assert.ok(body.error && body.error.code === 'PROVIDER_AUTH_FAILED');
  assert.equal(JSON.stringify(body).includes(badKey), false,
    'API key must not appear in the error response');
  global.fetch = originalFetch;
});

// ── 18. Gemini success response never contains the API key ────────────────────

test('solver: gemini response body never contains the submitted api key', async () => {
  const secretKey = 'gemini-secret-key-xyzabc';
  global.fetch = makeFetchStub(200, {
    candidates: [{ content: { parts: [{ text: 'The answer is here.' }] } }]
  });
  const app = require('../server');
  const { body } = await postSolver(app, {
    provider: 'gemini',
    apiKey: secretKey,
    question: 'What is polymorphism?',
    style: 'example_driven'
  });
  assert.equal(JSON.stringify(body).includes(secretKey), false,
    'API key must not appear in the success response');
  global.fetch = originalFetch;
});

// ── 19. Gemini multi-part candidate joins parts cleanly ───────────────────────

test('solver: gemini multi-part candidate joins parts cleanly', async () => {
  global.fetch = makeFetchStub(200, {
    candidates: [{
      content: {
        parts: [
          { text: 'First part of answer. ' },
          { text: 'Second part with details.' }
        ]
      }
    }]
  });
  const app = require('../server');
  const { status, body } = await postSolver(app, {
    provider: 'gemini',
    apiKey: 'gemini-key-12345678',
    question: 'How do hash tables work?',
    style: 'concise'
  });
  assert.equal(status, 200);
  assert.equal(body.draft, 'First part of answer. Second part with details.');
  global.fetch = originalFetch;
});

// ── 20. Gemini 400 with API_KEY_INVALID maps to 422 PROVIDER_AUTH_FAILED ─────

test('solver: gemini 400 with API_KEY_INVALID maps to 422 PROVIDER_AUTH_FAILED', async () => {
  const secretKey = 'gemini-invalid-secret-key-999';
  global.fetch = async () => ({
    ok: false,
    status: 400,
    text: async () => JSON.stringify({
      error: {
        code: 400,
        message: 'API key not valid. Please pass a valid API key.',
        status: 'INVALID_ARGUMENT',
        details: [{ reason: 'API_KEY_INVALID' }]
      }
    }),
    body: { cancel: async () => {} }
  });

  const app = require('../server');
  const { status, body } = await postSolver(app, {
    provider: 'gemini',
    apiKey: secretKey,
    question: 'Explain recursion.',
    style: 'first_principles'
  });
  assert.equal(status, 422);
  assert.equal(body.error.code, 'PROVIDER_AUTH_FAILED');
  assert.equal(JSON.stringify(body).includes(secretKey), false, 'API key must not leak');
  global.fetch = originalFetch;
});

