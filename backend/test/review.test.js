'use strict';

/**
 * Tests for POST /api/review (critic and judge stages)
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

const SAMPLE_DRAFTS = [
  { label: 'A', text: 'The loop fails due to off-by-one error.' },
  { label: 'B', text: 'Python range(5) produces 0..4, so the loop is correct.' },
  { label: 'C', text: 'Here is an example: for i in range(5): print(i+1)' }
];
const SAMPLE_QUESTION = 'Why does my Python loop print the wrong result?';

async function postReview(app, payload) {
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
        path: '/api/review',
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

// ── 1. Critic succeeds ────────────────────────────────────────────────────────

test('review/critic: returns critique text on success', async () => {
  global.fetch = makeFetchStub(200, {
    choices: [{ message: { content: 'Draft A has an off-by-one claim that is unverified. Draft B is clearest.' } }]
  });
  const app = require('../server');
  const { status, body } = await postReview(app, {
    provider: 'openai',
    apiKey: 'test-key-123456789',
    stage: 'critic',
    question: SAMPLE_QUESTION,
    drafts: SAMPLE_DRAFTS
  });
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.stage, 'critic');
  assert.ok(typeof body.critique === 'string' && body.critique.length > 0);
  assert.equal('apiKey' in body, false);
  global.fetch = originalFetch;
});

// ── 2. Judge succeeds with valid JSON ─────────────────────────────────────────

const VALID_JUDGE_RESPONSE = {
  winner: 'B',
  winnerText: 'The range(5) loop in Python iterates from 0 to 4 inclusive.',
  scores: {
    A: { correctness: 6, clarity: 7, completeness: 5, reason: 'Claims off-by-one but does not justify it.' },
    B: { correctness: 9, clarity: 8, completeness: 9, reason: 'Accurate and well explained.' },
    C: { correctness: 8, clarity: 7, completeness: 7, reason: 'Good example but missing explanation.' }
  }
};

test('review/judge: returns valid winner and scores on success', async () => {
  global.fetch = makeFetchStub(200, {
    content: [{ type: 'text', text: JSON.stringify(VALID_JUDGE_RESPONSE) }]
  });
  const app = require('../server');
  const { status, body } = await postReview(app, {
    provider: 'anthropic',
    apiKey: 'test-key-123456789',
    stage: 'judge',
    question: SAMPLE_QUESTION,
    drafts: SAMPLE_DRAFTS,
    critique: 'Draft A has an off-by-one claim.'
  });
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.stage, 'judge');
  assert.equal(body.winner, 'B');
  assert.ok(typeof body.winnerText === 'string' && body.winnerText.length > 0);
  assert.ok(body.scores && body.scores.A && body.scores.B && body.scores.C);
  assert.equal(body.scores.B.correctness, 9);
  assert.equal('apiKey' in body, false);
  global.fetch = originalFetch;
});

// ── 3. Judge JSON with code fences is stripped and parsed ─────────────────────

test('review/judge: strips markdown code fences from judge response', async () => {
  const fenced = '```json\n' + JSON.stringify(VALID_JUDGE_RESPONSE) + '\n```';
  global.fetch = makeFetchStub(200, {
    content: [{ type: 'text', text: fenced }]
  });
  const app = require('../server');
  const { status, body } = await postReview(app, {
    provider: 'anthropic',
    apiKey: 'test-key-123456789',
    stage: 'judge',
    question: SAMPLE_QUESTION,
    drafts: SAMPLE_DRAFTS
  });
  assert.equal(status, 200);
  assert.equal(body.winner, 'B');
  global.fetch = originalFetch;
});

// ── 4. Judge with invalid JSON → 422 ─────────────────────────────────────────

test('review/judge: returns 422 when judge returns malformed JSON', async () => {
  global.fetch = makeFetchStub(200, {
    content: [{ type: 'text', text: 'This is not JSON at all, just prose.' }]
  });
  const app = require('../server');
  const { status, body } = await postReview(app, {
    provider: 'anthropic',
    apiKey: 'test-key-123456789',
    stage: 'judge',
    question: SAMPLE_QUESTION,
    drafts: SAMPLE_DRAFTS
  });
  assert.equal(status, 422);
  assert.ok(body.error && body.error.code === 'JUDGE_INVALID_JSON');
  global.fetch = originalFetch;
});

// ── 5. Judge with out-of-range scores → 422 ──────────────────────────────────

test('review/judge: rejects scores outside 1-10 range', async () => {
  const bad = JSON.parse(JSON.stringify(VALID_JUDGE_RESPONSE));
  bad.scores.A.correctness = 11; // invalid
  global.fetch = makeFetchStub(200, {
    content: [{ type: 'text', text: JSON.stringify(bad) }]
  });
  const app = require('../server');
  const { status, body } = await postReview(app, {
    provider: 'anthropic',
    apiKey: 'test-key-123456789',
    stage: 'judge',
    question: SAMPLE_QUESTION,
    drafts: SAMPLE_DRAFTS
  });
  assert.equal(status, 422);
  assert.ok(body.error && body.error.code === 'JUDGE_SCHEMA_ERROR');
  global.fetch = originalFetch;
});

// ── 6. Judge with winner not in drafts → 422 ─────────────────────────────────

test('review/judge: rejects winner label not present in submitted drafts', async () => {
  const bad = JSON.parse(JSON.stringify(VALID_JUDGE_RESPONSE));
  bad.winner = 'Z'; // not a valid label in the submitted drafts
  global.fetch = makeFetchStub(200, {
    content: [{ type: 'text', text: JSON.stringify(bad) }]
  });
  const app = require('../server');
  const { status, body } = await postReview(app, {
    provider: 'anthropic',
    apiKey: 'test-key-123456789',
    stage: 'judge',
    question: SAMPLE_QUESTION,
    drafts: SAMPLE_DRAFTS
  });
  assert.equal(status, 422);
  assert.ok(body.error);
  global.fetch = originalFetch;
});

// ── 7. Invalid stage field is rejected ───────────────────────────────────────

test('review: rejects unknown stage value', async () => {
  const app = require('../server');
  const { status, body } = await postReview(app, {
    provider: 'openai',
    apiKey: 'test-key-123456789',
    stage: 'unknown',
    question: SAMPLE_QUESTION,
    drafts: SAMPLE_DRAFTS
  });
  assert.equal(status, 400);
  assert.ok(body.error && body.error.code === 'INVALID_REQUEST');
});

// ── 8. Critic failure → judge proceeds in degraded mode ──────────────────────

test('review/judge: degraded flag is true when no critique is passed', async () => {
  global.fetch = makeFetchStub(200, {
    content: [{ type: 'text', text: JSON.stringify(VALID_JUDGE_RESPONSE) }]
  });
  const app = require('../server');
  const { status, body } = await postReview(app, {
    provider: 'anthropic',
    apiKey: 'test-key-123456789',
    stage: 'judge',
    question: SAMPLE_QUESTION,
    drafts: SAMPLE_DRAFTS
    // no 'critique' field — simulates critic failure scenario
  });
  assert.equal(status, 200);
  assert.equal(body.degraded, true, 'degraded flag should be true when no critique is provided');
  global.fetch = originalFetch;
});

// ── 9. Provider 401 → sanitized error, key not in response ───────────────────

test('review: provider 401 maps to sanitized auth error, no key leak', async () => {
  const secretKey = 'sk-review-secret-key-xyz';
  global.fetch = makeFetchStub(401, { error: 'unauthorized' });
  const app = require('../server');
  const { status, body } = await postReview(app, {
    provider: 'openai',
    apiKey: secretKey,
    stage: 'critic',
    question: SAMPLE_QUESTION,
    drafts: SAMPLE_DRAFTS
  });
  assert.equal(status, 422);
  assert.ok(body.error && body.error.code === 'PROVIDER_AUTH_FAILED');
  assert.equal(JSON.stringify(body).includes(secretKey), false, 'key must not appear in error response');
  global.fetch = originalFetch;
});

// ── 10. Drafts array bounds are validated ──────────────────────────────────────

test('review: rejects empty drafts array', async () => {
  const app = require('../server');
  const { status, body } = await postReview(app, {
    provider: 'openai',
    apiKey: 'test-key-123456789',
    stage: 'critic',
    question: SAMPLE_QUESTION,
    drafts: []
  });
  assert.equal(status, 400);
  assert.ok(body.error && body.error.code === 'INVALID_REQUEST');
});

// ── 11. Gemini critic uses the fast model ─────────────────────────────────────

test('review/critic: gemini critic request uses the configured fast model', async () => {
  let capturedUrl = '';
  global.fetch = async (url) => {
    capturedUrl = url;
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'Draft A has an unsupported claim.' }] } }]
      }),
      body: { cancel: async () => {} }
    };
  };
  const app = require('../server');
  await postReview(app, {
    provider: 'gemini',
    apiKey: 'test-gemini-key-1234',
    stage: 'critic',
    question: SAMPLE_QUESTION,
    drafts: SAMPLE_DRAFTS
  });
  assert.ok(capturedUrl.includes(PROVIDERS.gemini.fastModel),
    `Critic must use fast model "${PROVIDERS.gemini.fastModel}", got: ${capturedUrl}`);
  assert.equal(capturedUrl.includes(PROVIDERS.gemini.strongModel), false,
    `Critic must not use strong model "${PROVIDERS.gemini.strongModel}"`);
  global.fetch = originalFetch;
});

// ── 12. Gemini judge uses the strong model ────────────────────────────────────

test('review/judge: gemini judge request uses the configured strong model', async () => {
  let capturedUrl = '';
  global.fetch = async (url) => {
    capturedUrl = url;
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify(VALID_JUDGE_RESPONSE) }] } }]
      }),
      body: { cancel: async () => {} }
    };
  };
  const app = require('../server');
  await postReview(app, {
    provider: 'gemini',
    apiKey: 'test-gemini-key-1234',
    stage: 'judge',
    question: SAMPLE_QUESTION,
    drafts: SAMPLE_DRAFTS,
    critique: 'Draft A has a weak claim.'
  });
  assert.ok(capturedUrl.includes(PROVIDERS.gemini.strongModel),
    `Judge must use strong model "${PROVIDERS.gemini.strongModel}", got: ${capturedUrl}`);
  assert.equal(capturedUrl.includes(PROVIDERS.gemini.fastModel), false,
    `Judge must not use fast model "${PROVIDERS.gemini.fastModel}"`);
  global.fetch = originalFetch;
});

// ── 13. Gemini judge: valid JSON response ─────────────────────────────────────

test('review/judge: works with gemini provider and returns valid winner and scores', async () => {
  global.fetch = makeFetchStub(200, {
    candidates: [{ content: { parts: [{ text: JSON.stringify(VALID_JUDGE_RESPONSE) }] } }]
  });
  const app = require('../server');
  const { status, body } = await postReview(app, {
    provider: 'gemini',
    apiKey: 'test-gemini-key-1234',
    stage: 'judge',
    question: SAMPLE_QUESTION,
    drafts: SAMPLE_DRAFTS,
    critique: 'Draft A has an off-by-one claim.'
  });
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.stage, 'judge');
  assert.equal(body.winner, 'B');
  assert.ok(typeof body.winnerText === 'string' && body.winnerText.length > 0);
  assert.ok(body.scores && body.scores.A && body.scores.B && body.scores.C);
  assert.equal('apiKey' in body, false);
  global.fetch = originalFetch;
});

// ── 14. Gemini judge: key never in response ───────────────────────────────────

test('review/judge: gemini response body never contains the submitted api key', async () => {
  const secretKey = 'gemini-judge-secret-key-abc';
  global.fetch = makeFetchStub(200, {
    candidates: [{ content: { parts: [{ text: JSON.stringify(VALID_JUDGE_RESPONSE) }] } }]
  });
  const app = require('../server');
  const { body } = await postReview(app, {
    provider: 'gemini',
    apiKey: secretKey,
    stage: 'judge',
    question: SAMPLE_QUESTION,
    drafts: SAMPLE_DRAFTS
  });
  assert.equal(JSON.stringify(body).includes(secretKey), false,
    'API key must not appear in the judge response');
  global.fetch = originalFetch;
});

// ── 15. Gemini critic: key never in response ──────────────────────────────────

test('review/critic: gemini response body never contains the submitted api key', async () => {
  const secretKey = 'gemini-critic-secret-key-xyz';
  global.fetch = makeFetchStub(200, {
    candidates: [{ content: { parts: [{ text: 'Draft B is the strongest.' }] } }]
  });
  const app = require('../server');
  const { status, body } = await postReview(app, {
    provider: 'gemini',
    apiKey: secretKey,
    stage: 'critic',
    question: SAMPLE_QUESTION,
    drafts: SAMPLE_DRAFTS
  });
  assert.equal(status, 200);
  assert.ok(typeof body.critique === 'string' && body.critique.length > 0);
  assert.equal(JSON.stringify(body).includes(secretKey), false,
    'API key must not appear in the critic response');
  global.fetch = originalFetch;
});

// ── 16. Judge: Gemini 400 with API_KEY_INVALID maps to 422 PROVIDER_AUTH_FAILED ─

test('review/judge: gemini 400 with API_KEY_INVALID maps to 422 PROVIDER_AUTH_FAILED', async () => {
  const secretKey = 'gemini-bad-judge-key-999';
  global.fetch = async () => ({
    ok: false,
    status: 400,
    text: async () => JSON.stringify({
      error: {
        code: 400,
        message: 'API key not valid.',
        details: [{ reason: 'API_KEY_INVALID' }]
      }
    }),
    body: { cancel: async () => {} }
  });

  const app = require('../server');
  const { status, body } = await postReview(app, {
    provider: 'gemini',
    apiKey: secretKey,
    stage: 'judge',
    question: SAMPLE_QUESTION,
    drafts: SAMPLE_DRAFTS
  });
  assert.equal(status, 422);
  assert.equal(body.error.code, 'PROVIDER_AUTH_FAILED');
  assert.equal(JSON.stringify(body).includes(secretKey), false, 'API key must not leak');
  global.fetch = originalFetch;
});

// ── 17. Judge: model unavailable (404) maps to 502 MODEL_UNAVAILABLE ──────────

test('review/judge: model unavailable (404) maps to 502 MODEL_UNAVAILABLE safely', async () => {
  const secretKey = 'gemini-key-model-missing-123';
  global.fetch = async () => ({
    ok: false,
    status: 404,
    text: async () => JSON.stringify({ error: { message: 'models/gemini-3.8-flash not found' } }),
    body: { cancel: async () => {} }
  });

  const app = require('../server');
  const { status, body } = await postReview(app, {
    provider: 'gemini',
    apiKey: secretKey,
    stage: 'judge',
    question: SAMPLE_QUESTION,
    drafts: SAMPLE_DRAFTS
  });
  assert.equal(status, 502);
  assert.equal(body.error.code, 'MODEL_UNAVAILABLE');
  assert.equal(JSON.stringify(body).includes(secretKey), false, 'API key must not leak');
  global.fetch = originalFetch;
});

// ── 18. Judge: 503 provider unavailable maps to 503 safely ───────────────────

test('review/judge: provider 503 maps to 503 PROVIDER_UNAVAILABLE safely', async () => {
  const secretKey = 'gemini-judge-key-503-test';
  global.fetch = async () => ({
    ok: false,
    status: 503,
    text: async () => JSON.stringify({ error: { message: 'The model is overloaded.' } }),
    body: { cancel: async () => {} }
  });

  const app = require('../server');
  const { status, body } = await postReview(app, {
    provider: 'gemini',
    apiKey: secretKey,
    stage: 'judge',
    question: SAMPLE_QUESTION,
    drafts: SAMPLE_DRAFTS,
    critique: 'Critique here.'
  });
  assert.equal(status, 503);
  assert.equal(body.error.code, 'PROVIDER_UNAVAILABLE');
  assert.ok(body.error.message.includes('unavailable') || body.error.message.includes('overloaded'));
  assert.equal(JSON.stringify(body).includes(secretKey), false, 'API key must not leak');
  global.fetch = originalFetch;
});

// ── 19. Judge: transient 503 recovers on automatic second attempt ─────────────

test('review/judge: transient 503 recovers on automatic second attempt', async () => {
  let attempt = 0;
  global.fetch = async () => {
    attempt++;
    if (attempt === 1) {
      return {
        ok: false,
        status: 503,
        text: async () => JSON.stringify({ error: { message: 'The model is overloaded.' } }),
        body: { cancel: async () => {} }
      };
    }
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify(VALID_JUDGE_RESPONSE) }] } }]
      }),
      body: { cancel: async () => {} }
    };
  };

  const app = require('../server');
  const { status, body } = await postReview(app, {
    provider: 'gemini',
    apiKey: 'gemini-key-12345678',
    stage: 'judge',
    question: SAMPLE_QUESTION,
    drafts: SAMPLE_DRAFTS,
    critique: 'Draft B is best.'
  });
  assert.equal(status, 200);
  assert.equal(body.winner, 'B');
  assert.equal(attempt, 2);
  global.fetch = originalFetch;
});

// ── 20. Judge: provider 500 maps to 502 PROVIDER_INTERNAL_ERROR ───────────────

test('review/judge: provider 500 maps to 502 PROVIDER_INTERNAL_ERROR safely', async () => {
  const secretKey = 'gemini-judge-500-key-xyz';
  global.fetch = async () => ({
    ok: false,
    status: 500,
    text: async () => JSON.stringify({ error: { message: 'Internal error encountered.' } }),
    body: { cancel: async () => {} }
  });

  const app = require('../server');
  const { status, body } = await postReview(app, {
    provider: 'gemini',
    apiKey: secretKey,
    stage: 'judge',
    question: SAMPLE_QUESTION,
    drafts: SAMPLE_DRAFTS
  });
  assert.equal(status, 502);
  assert.equal(body.error.code, 'PROVIDER_INTERNAL_ERROR');
  assert.equal(JSON.stringify(body).includes(secretKey), false, 'API key must not leak');
  global.fetch = originalFetch;
});

// ── 21. Judge: provider 429 maps to 429 PROVIDER_LIMIT_REACHED ───────────────

test('review/judge: provider 429 maps to 429 PROVIDER_LIMIT_REACHED safely', async () => {
  const secretKey = 'gemini-judge-429-key-xyz';
  global.fetch = async () => ({
    ok: false,
    status: 429,
    text: async () => JSON.stringify({ error: { message: 'Resource exhausted.' } }),
    body: { cancel: async () => {} }
  });

  const app = require('../server');
  const { status, body } = await postReview(app, {
    provider: 'gemini',
    apiKey: secretKey,
    stage: 'judge',
    question: SAMPLE_QUESTION,
    drafts: SAMPLE_DRAFTS
  });
  assert.equal(status, 429);
  assert.equal(body.error.code, 'PROVIDER_LIMIT_REACHED');
  assert.equal(JSON.stringify(body).includes(secretKey), false, 'API key must not leak');
  global.fetch = originalFetch;
});

// ── 22. Judge: oversized drafts and critique are safely bounded ───────────────

test('review/judge: oversized drafts and critique are bounded without error', async () => {
  let capturedBody = null;
  global.fetch = async (_url, options) => {
    capturedBody = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify(VALID_JUDGE_RESPONSE) }] } }]
      }),
      body: { cancel: async () => {} }
    };
  };

  const hugeDraft = 'x'.repeat(5500);
  const hugeCritique = 'c'.repeat(8000);
  const app = require('../server');
  const { status, body } = await postReview(app, {
    provider: 'gemini',
    apiKey: 'gemini-key-test-bounded',
    stage: 'judge',
    question: 'How to sort an array?',
    drafts: [
      { label: 'A', text: hugeDraft },
      { label: 'B', text: 'Short draft B.' }
    ],
    critique: hugeCritique
  });

  assert.equal(status, 200);
  assert.ok(capturedBody);
  const userText = capturedBody.contents[0].parts[0].text;
  assert.ok(userText.includes('[Truncated for length]'));
  assert.ok(capturedBody.generationConfig.maxOutputTokens >= 3000);
  global.fetch = originalFetch;
});


