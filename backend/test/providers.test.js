'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PROVIDERS, safeFailureForStatus } = require('../providers');

test('provider allowlist contains only supported providers with fixed HTTPS URLs', () => {
  assert.deepEqual(Object.keys(PROVIDERS).sort(), ['anthropic', 'gemini', 'openai']);
  for (const provider of Object.values(PROVIDERS)) {
    assert.equal(provider.url.startsWith('https://'), true);
    assert.equal(typeof provider.fastModel, 'string');
    assert.ok(provider.fastModel.length > 0);
    assert.equal(typeof provider.strongModel, 'string');
    assert.ok(provider.strongModel.length > 0);
  }
});

test('provider request builders do not accept a client-supplied URL or model', () => {
  const anthropic = PROVIDERS.anthropic.buildRequest('test-key-123456789');
  assert.equal(anthropic.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(anthropic.body.model, PROVIDERS.anthropic.fastModel);
  assert.equal(anthropic.headers['x-api-key'], 'test-key-123456789');

  const openai = PROVIDERS.openai.buildRequest('test-key-123456789');
  assert.equal(openai.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(openai.body.model, PROVIDERS.openai.fastModel);

  const gemini = PROVIDERS.gemini.buildRequest('test-key-123456789');
  assert.equal(gemini.url, `https://generativelanguage.googleapis.com/v1beta/models/${PROVIDERS.gemini.fastModel}:generateContent`);
  assert.equal(gemini.body.generationConfig.maxOutputTokens, 8);
  assert.equal(gemini.headers['x-goog-api-key'], 'test-key-123456789');
});

test('upstream errors are mapped to sanitized messages', () => {
  assert.equal(safeFailureForStatus(401).code, 'PROVIDER_AUTH_FAILED');
  assert.equal(safeFailureForStatus(429).code, 'PROVIDER_LIMIT_REACHED');
  assert.equal(safeFailureForStatus(503).code, 'PROVIDER_UNAVAILABLE');
  assert.equal(safeFailureForStatus(401).message.includes('test-key-123456789'), false);
});

test('gemini key-test request uses the configured fast model', async () => {
  const originalFetch = global.fetch;
  let capturedUrl = null;
  global.fetch = async (url) => {
    capturedUrl = url;
    return {
      ok: true,
      status: 200,
      body: { cancel: async () => {} }
    };
  };

  try {
    const { testProvider } = require('../providers');
    const result = await testProvider('gemini', 'test-gemini-key-123456');
    assert.equal(result.ok, true);
    assert.ok(capturedUrl.includes(PROVIDERS.gemini.fastModel),
      `Expected key-test URL to contain fast model "${PROVIDERS.gemini.fastModel}", got: ${capturedUrl}`);
    assert.equal(capturedUrl.includes(PROVIDERS.gemini.strongModel), false,
      `Key-test URL must not contain strong model "${PROVIDERS.gemini.strongModel}"`);
  } finally {
    global.fetch = originalFetch;
  }
});

test('gemini key-test: provider error is returned safely without revealing API key', async () => {
  const originalFetch = global.fetch;
  const secretKey = 'gemini-super-secret-key-12345';
  global.fetch = async () => ({
    ok: false,
    status: 400,
    text: async () => JSON.stringify({ error: { message: 'Some generic bad request' } }),
    body: { cancel: async () => {} }
  });

  try {
    const { testProvider } = require('../providers');
    const result = await testProvider('gemini', secretKey);
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
    assert.ok(result.failure);
    assert.equal(result.failure.code, 'MODEL_OR_REQUEST_UNAVAILABLE');
    assert.equal(JSON.stringify(result.failure).includes(secretKey), false,
      'Failure details must never reveal the API key');
  } finally {
    global.fetch = originalFetch;
  }
});

test('safeFailureForStatus accurately parses error bodies without echoing payloads or keys', () => {
  // Gemini invalid API key error body (HTTP 400)
  const geminiAuthErr = JSON.stringify({
    error: {
      code: 400,
      message: 'API key not valid. Please pass a valid API key.',
      status: 'INVALID_ARGUMENT',
      details: [{ reason: 'API_KEY_INVALID' }]
    }
  });
  const resAuth = safeFailureForStatus(400, geminiAuthErr);
  assert.equal(resAuth.code, 'PROVIDER_AUTH_FAILED');

  // Billing disabled error
  const billingErr = JSON.stringify({ error: { details: [{ reason: 'BILLING_DISABLED' }] } });
  const resBilling = safeFailureForStatus(400, billingErr);
  assert.equal(resBilling.code, 'PROVIDER_ACCESS_DENIED');

  // Quota / resource exhausted error
  const quotaErr = JSON.stringify({ error: { details: [{ reason: 'RESOURCE_EXHAUSTED' }] } });
  const resQuota = safeFailureForStatus(400, quotaErr);
  assert.equal(resQuota.code, 'PROVIDER_LIMIT_REACHED');

  // Model not found error
  const notFoundErr = JSON.stringify({ error: { message: 'models/gemini-foo is not found' } });
  const resNotFound = safeFailureForStatus(400, notFoundErr);
  assert.equal(resNotFound.code, 'MODEL_UNAVAILABLE');

  // Generic 400 fallback
  const resGeneric = safeFailureForStatus(400, '{"error": "something else"}');
  assert.equal(resGeneric.code, 'MODEL_OR_REQUEST_UNAVAILABLE');
});

test('callProvider: joins multiple parts in gemini responses', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => ({
      candidates: [{
        content: {
          parts: [
            { text: 'Part 1: Hello. ' },
            { text: 'Part 2: World.' }
          ]
        }
      }]
    }),
    body: { cancel: async () => {} }
  });

  try {
    const { callProvider } = require('../providers');
    const result = await callProvider('gemini', 'valid-test-key-12345', {
      systemPrompt: 'System',
      userMessage: 'User',
      tier: 'fast'
    });
    assert.equal(result, 'Part 1: Hello. Part 2: World.');
  } finally {
    global.fetch = originalFetch;
  }
});

