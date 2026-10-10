'use strict';

require('dotenv').config();
const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const keysRouter = require('./routes/keys');
const { router: solverRouter } = require('./routes/solver');
const reviewRouter = require('./routes/review');
const tutorRouter = require('./routes/tutor');

const app = express();
const PORT = Number(process.env.PORT) || 3001;
const NODE_ENV = process.env.NODE_ENV || 'development';
const staticDir = [
  path.join(process.cwd(), 'public'),
  path.join(process.cwd(), 'frontend'),
  path.join(__dirname, '..', 'public'),
  path.join(__dirname, '..', 'frontend'),
  path.join(__dirname, 'frontend')
].find(dir => {
  try {
    return require('node:fs').existsSync(dir);
  } catch {
    return false;
  }
}) || path.join(__dirname, '..', 'frontend');

app.disable('x-powered-by');
app.set('trust proxy', 1);

const cspDirectives = {
  defaultSrc: ["'self'"],
  baseUri: ["'self'"],
  objectSrc: ["'none'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'"],
  imgSrc: ["'self'", 'data:'],
  connectSrc: ["'self'"],
  formAction: ["'self'"],
  frameAncestors: ["'none'"]
};
if (NODE_ENV === 'production') cspDirectives.upgradeInsecureRequests = [];

app.use(helmet({
  contentSecurityPolicy: { directives: cspDirectives },
  hsts: NODE_ENV === 'production' ? undefined : false,
  crossOriginResourcePolicy: { policy: 'same-origin' }
}));

// Serve the frontend from this same origin; no permissive CORS configuration is needed.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler(_req, res) {
    return res.status(429).json({
      error: { code: 'RATE_LIMITED', message: 'Too many requests. Wait a minute and try again.' }
    });
  }
});
app.use('/api', apiLimiter);
app.use(express.json({ limit: '100kb', strict: true }));

app.get('/api/health', (_req, res) => {
  res.status(200).json({ ok: true, phase: 4 });
});
app.use('/api/keys', keysRouter);
app.use('/api/solver', solverRouter);
app.use('/api/review', reviewRouter);
app.use('/api', tutorRouter);

app.use(express.static(staticDir, {
  index: 'index.html',
  etag: true,
  maxAge: 0,
  setHeaders(res) {
    // Avoid caching frontend assets in this small privacy-focused MVP.
    res.setHeader('Cache-Control', 'no-store');
  }
}));

app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({
      error: { code: 'NOT_FOUND', message: 'API route not found.' }
    });
  }
  return res.status(404).send('Not found');
});

app.use((error, _req, res, _next) => {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  if (error && error.type === 'entity.too.large') {
    return res.status(413).json({
      error: { code: 'BODY_TOO_LARGE', message: 'Request body exceeds the 100 KB limit.' }
    });
  }
  if (error instanceof SyntaxError && error.status === 400) {
    return res.status(400).json({
      error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' }
    });
  }
  // Do not print error objects: they may contain request or provider details.
  console.error('[http] request failed; returning sanitized 500 response');
  return res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected server error occurred.' }
  });
});

if (require.main === module) {
  const server = app.listen(PORT, () => {
    console.log(`TutorArena listening at http://localhost:${PORT}`);
    console.log('BYOK keys are supplied per request and are not stored by the server.');
  });
  server.requestTimeout = 35_000;
  server.headersTimeout = 40_000;
}

module.exports = app;
