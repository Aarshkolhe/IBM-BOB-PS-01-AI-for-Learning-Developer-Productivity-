'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { body, validationResult, matchedData } = require('express-validator');
const { PROVIDERS, testProvider } = require('../providers');

const router = express.Router();
const allowedProviders = Object.keys(PROVIDERS);
const PROVIDER_TIMEOUT_MS = 30_000;
const MAX_CONCURRENT_PROVIDER_CALLS = 4;
let activeProviderCalls = 0;

const keyTestLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 12,
  standardHeaders: true,
  legacyHeaders: false,
  handler(_req, res) {
    return res.status(429).json({
      error: {
        code: 'KEY_TEST_RATE_LIMITED',
        message: 'Too many key tests. Wait a minute before trying again.'
      }
    });
  }
});

router.post(
  '/test',
  keyTestLimiter,
  body('provider').isString().isIn(allowedProviders),
  body('apiKey').isString().isLength({ min: 10, max: 512 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Choose a supported provider and enter an API key between 10 and 512 characters.'
        }
      });
    }

    const { provider, apiKey } = matchedData(req, { locations: ['body'] });
    if (activeProviderCalls >= MAX_CONCURRENT_PROVIDER_CALLS) {
      return res.status(503).json({
        error: {
          code: 'SERVER_BUSY',
          message: 'The connection tester is busy. Try again shortly.'
        }
      });
    }

    activeProviderCalls += 1;
    try {
      const result = await testProvider(provider, apiKey, PROVIDER_TIMEOUT_MS);
      if (!result.ok) {
        const clientStatus = result.status === 429 ? 429 : result.status >= 500 ? 502 : 422;
        return res.status(clientStatus).json({ error: result.failure });
      }

      // Never echo the key, upstream payload, headers, or model output to the client.
      return res.status(200).json({
        ok: true,
        provider,
        message: `${PROVIDERS[provider].label} API connection successful for this page session.`
      });
    } catch (error) {
      // Intentionally log only a fixed provider identifier and a coarse failure category.
      // Never log error.message, request bodies, provider response bodies, or headers.
      const timedOut = error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      console.warn(`[keys/test] provider=${provider} failure=${timedOut ? 'timeout' : 'network'}`);
      return res.status(timedOut ? 504 : 502).json({
        error: {
          code: timedOut ? 'PROVIDER_TIMEOUT' : 'PROVIDER_NETWORK_ERROR',
          message: timedOut
            ? 'The provider did not respond within 30 seconds. Try again.'
            : 'Could not reach the provider. Check your network and try again.'
        }
      });
    } finally {
      activeProviderCalls -= 1;
    }
  }
);

module.exports = router;
