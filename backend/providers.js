'use strict';

/**
 * Server-side provider allowlist. Never accept provider URLs or model IDs from a client.
 * Key-test requests deliberately use small outputs to minimize test cost.
 * Check provider documentation periodically for model lifecycle changes.
 *
 * Model tiers:
 *   fast   — used for solvers (lower cost, sufficient quality)
 *   strong — used for critic, judge, and tutor (better reasoning)
 */
const PROVIDERS = Object.freeze({
  anthropic: Object.freeze({
    label: 'Claude',
    url: 'https://api.anthropic.com/v1/messages',
    fastModel: 'claude-haiku-4-5',
    strongModel: 'claude-opus-4-5',
    /** Build a test request (minimal tokens, low cost). */
    buildRequest(apiKey) {
      return {
        url: this.url,
        headers: {
          'content-type': 'application/json',
          'anthropic-version': '2023-06-01',
          'x-api-key': apiKey
        },
        body: {
          model: this.fastModel,
          max_tokens: 8,
          messages: [{ role: 'user', content: 'Reply with OK.' }]
        }
      };
    }
  }),
  openai: Object.freeze({
    label: 'OpenAI',
    url: 'https://api.openai.com/v1/chat/completions',
    fastModel: 'gpt-4o-mini',
    strongModel: 'gpt-4o',
    buildRequest(apiKey) {
      return {
        url: this.url,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`
        },
        body: {
          model: this.fastModel,
          max_completion_tokens: 8,
          messages: [{ role: 'user', content: 'Reply with OK.' }]
        }
      };
    }
  }),
  gemini: Object.freeze({
    label: 'Gemini',
    // URL template — substitute {model} before calling.
    urlTemplate: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
    get url() {
      return this.urlTemplate.replace('{model}', this.fastModel);
    },
    fastModel: 'gemini-2.5-flash',
    strongModel: 'gemini-2.5-pro',
    buildRequest(apiKey) {
      return {
        url: this.url,
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': apiKey
        },
        body: {
          contents: [{ parts: [{ text: 'Reply with OK.' }] }],
          generationConfig: { maxOutputTokens: 8 }
        }
      };
    }
  })
});

const SAFE_FAILURES = Object.freeze({
  400: {
    code: 'MODEL_OR_REQUEST_UNAVAILABLE',
    message: 'The provider could not run the configured test request. The key may be valid, but this model or request may not be available to the account.'
  },
  401: {
    code: 'PROVIDER_AUTH_FAILED',
    message: 'The provider rejected this key. Check that it is correct and has API access.'
  },
  403: {
    code: 'PROVIDER_ACCESS_DENIED',
    message: 'The provider denied access. Check account permissions, API access, and billing settings.'
  },
  404: {
    code: 'MODEL_UNAVAILABLE',
    message: 'The configured model was not found or is unavailable to this account. The key may still be valid.'
  },
  429: {
    code: 'PROVIDER_LIMIT_REACHED',
    message: 'The provider rate limit or quota was reached. Check the provider account and try again later.'
  }
});

function safeFailureForStatus(status) {
  if (SAFE_FAILURES[status]) return SAFE_FAILURES[status];
  if (status >= 500) {
    return {
      code: 'PROVIDER_UNAVAILABLE',
      message: 'The provider is temporarily unavailable. Try again later.'
    };
  }
  return {
    code: 'KEY_TEST_FAILED',
    message: 'The connection test failed. Check the key and provider configuration, then try again.'
  };
}

async function testProvider(providerName, apiKey, timeoutMs = 30_000) {
  const provider = PROVIDERS[providerName];
  if (!provider) {
    const error = new Error('Unsupported provider');
    error.code = 'UNSUPPORTED_PROVIDER';
    throw error;
  }

  const request = provider.buildRequest(apiKey);
  const response = await fetch(request.url, {
    method: 'POST',
    headers: request.headers,
    body: JSON.stringify(request.body),
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'error'
  });

  // The upstream response content is not needed. Do not persist or log it.
  if (response.body) {
    response.body.cancel().catch(() => {});
  }

  return {
    ok: response.ok,
    status: response.status,
    failure: response.ok ? null : safeFailureForStatus(response.status)
  };
}

/**
 * Call a provider's chat API with a system prompt and user message.
 * Returns the text content of the first reply.
 * Throws a sanitized error on failure; never exposes the raw upstream body.
 */
async function callProvider(providerName, apiKey, { systemPrompt, userMessage, tier = 'fast', maxTokens = 1500, timeoutMs = 30_000 }) {
  const provider = PROVIDERS[providerName];
  if (!provider) throw Object.assign(new Error('Unsupported provider'), { code: 'UNSUPPORTED_PROVIDER' });

  const model = tier === 'strong' ? provider.strongModel : provider.fastModel;

  let url, headers, body;

  if (providerName === 'anthropic') {
    url = provider.url;
    headers = {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': apiKey
    };
    body = {
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }]
    };
  } else if (providerName === 'openai') {
    url = provider.url;
    headers = {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`
    };
    body = {
      model,
      max_completion_tokens: maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ]
    };
  } else if (providerName === 'gemini') {
    const geminiModel = model;
    url = provider.urlTemplate.replace('{model}', geminiModel);
    headers = {
      'content-type': 'application/json',
      'x-goog-api-key': apiKey
    };
    body = {
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts: [{ text: userMessage }] }],
      generationConfig: { maxOutputTokens: maxTokens }
    };
  } else {
    throw Object.assign(new Error('Unsupported provider'), { code: 'UNSUPPORTED_PROVIDER' });
  }

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'error'
    });
  } catch (fetchError) {
    const timedOut = fetchError && (fetchError.name === 'TimeoutError' || fetchError.name === 'AbortError');
    throw Object.assign(
      new Error(timedOut ? 'Provider request timed out' : 'Provider network error'),
      { code: timedOut ? 'PROVIDER_TIMEOUT' : 'PROVIDER_NETWORK_ERROR', safeMessage: timedOut
        ? 'The provider did not respond in time. Try again.'
        : 'Could not reach the provider. Check your network.' }
    );
  }

  if (!response.ok) {
    // Consume and discard the upstream body — never forward it.
    if (response.body) response.body.cancel().catch(() => {});
    const failure = safeFailureForStatus(response.status);
    throw Object.assign(new Error(`Provider HTTP ${response.status}`), {
      code: failure.code,
      safeMessage: failure.message,
      providerStatus: response.status
    });
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw Object.assign(new Error('Provider returned unparseable response'), {
      code: 'PROVIDER_BAD_RESPONSE',
      safeMessage: 'The provider returned an unexpected response. Try again.'
    });
  }

  // Extract text from provider-specific response shape.
  let text;
  if (providerName === 'anthropic') {
    text = Array.isArray(data.content) && data.content[0] && data.content[0].type === 'text'
      ? data.content[0].text
      : null;
  } else if (providerName === 'openai') {
    text = data.choices && data.choices[0] && data.choices[0].message && typeof data.choices[0].message.content === 'string'
      ? data.choices[0].message.content
      : null;
  } else if (providerName === 'gemini') {
    text = data.candidates && data.candidates[0] && data.candidates[0].content &&
      Array.isArray(data.candidates[0].content.parts) && data.candidates[0].content.parts[0]
      ? data.candidates[0].content.parts[0].text
      : null;
  }

  if (typeof text !== 'string' || text.trim().length === 0) {
    throw Object.assign(new Error('Provider returned empty response text'), {
      code: 'PROVIDER_EMPTY_RESPONSE',
      safeMessage: 'The provider returned an empty response. Try again.'
    });
  }

  return text.trim();
}

module.exports = { PROVIDERS, safeFailureForStatus, testProvider, callProvider };
