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
