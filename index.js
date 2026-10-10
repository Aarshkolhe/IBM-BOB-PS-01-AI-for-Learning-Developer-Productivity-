'use strict';

// Vercel serverless / root entrypoint for TutorArena
const app = require('./backend/server');

if (require.main === module) {
  const PORT = Number(process.env.PORT) || 3001;
  const server = app.listen(PORT, () => {
    console.log(`TutorArena listening at http://localhost:${PORT}`);
    console.log('BYOK keys are supplied per request and are not stored by the server.');
  });
  server.requestTimeout = 35_000;
  server.headersTimeout = 40_000;
}

module.exports = app;
