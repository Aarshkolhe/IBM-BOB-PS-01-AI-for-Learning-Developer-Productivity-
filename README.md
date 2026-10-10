# TutorArena

**Author:** Aarsh Kolhe  
**Problem Statement:** PS 01 — AI for Learning & Developer Productivity  
**Current phase:** Phase 3 complete — Debate panel (solvers, critic, judge)

TutorArena is a learning web app where multiple AI agents independently answer a question, a critic reviews the drafts, a judge selects the best answer and improves it, and a tutor teaches the final answer in small steps. Designed for students learning programming and computer science, and junior developers debugging code.

## What works now (Phase 3)

| Feature | Status |
|---|---|
| BYOK key entry for Claude, OpenAI, Gemini | ✅ |
| Key testing via `/api/keys/test` | ✅ |
| Keys held in browser memory only | ✅ |
| Three parallel solver calls | ✅ |
| Solver cards update independently | ✅ |
| Critic reviews all drafts | ✅ |
| Judge scores and selects best answer | ✅ |
| Degraded mode when critic fails | ✅ |
| Judge retry without re-running solvers | ✅ |
| All-solvers-failed detection and retry | ✅ |
| Score bars (correctness/clarity/completeness) | ✅ |
| New question / reset | ✅ |
| Stale-response guard (sessionId) | ✅ |
| No `innerHTML` for model output | ✅ |
| Keys never stored in Web Storage | ✅ |
| Keys never logged or echoed in responses | ✅ |

**Not yet implemented (Phase 4):**
- Tutor step-by-step flow
- Got it / Not clear controls
- Re-explanation calls
- Recap and copy button

## How it works

1. **Three solvers run in parallel.** Solver A is concise (Claude), Solver B explains from first principles (OpenAI), Solver C leads with an example (Gemini). With fewer keys, providers rotate across solvers using different prompts.
2. **The critic reviews all successful drafts.** It finds mistakes, gaps, and differences between them without selecting a winner.
3. **The judge selects and improves an answer.** It scores each draft on correctness, clarity, and completeness (1–10), then produces the final answer using the critic's findings.
4. **Tutor (Phase 4).** Will split the answer into 4–6 teachable steps with comprehension checks.

The normal pipeline uses **5 model calls per run**: 3 parallel solvers + 1 critic + 1 judge. Re-explanation calls are additional (Phase 4).

## BYOK: Bring Your Own API Key

Users supply their own API key for one or more providers:

| Provider | Auth | Model (fast) | Model (strong) |
|---|---|---|---|
| Anthropic Claude | `x-api-key` header | `claude-haiku-4-5` | `claude-opus-4-5` |
| OpenAI | `Authorization: Bearer` | `gpt-4o-mini` | `gpt-4o` |
| Google Gemini | `x-goog-api-key` header | `gemini-2.5-flash` | `gemini-2.5-pro` |

**Model-tier assignment (matches original PRD):**
- Solvers (A, B, C): fast model.
- Critic: fast model.
- Judge: strong model.
- Tutor (Phase 4): strong model.

`gemini-1.5-flash` and `gemini-1.5-pro` were removed because Google shut down the Gemini 1.5 API in September 2025.

**Key-handling behavior:**
- Keys live in JavaScript `let` variables inside a closure — never in `localStorage`, `sessionStorage`, cookies, IndexedDB, or URLs.
- Page refresh clears all keys. The UI makes this visible.
- The browser sends keys only to the TutorArena backend over localhost (or HTTPS in production).
- The backend uses keys only while forwarding a single request. It does not log, persist, or return keys.
- Raw provider error bodies are never forwarded to the browser.

## Provider assignment

| Configuration | Solver A | Solver B | Solver C |
|---|---|---|---|
| All three keys | Claude (concise) | OpenAI (first-principles) | Gemini (example-driven) |
| Two keys | Rotated across A, B, C | — | — |
| One key | Same provider for all three, different prompts | — | — |

Critic preference: OpenAI → Claude → Gemini  
Judge preference: Claude → OpenAI → Gemini

When only one provider is configured, the UI labels each card with the actual provider and does not claim independent models competed.

## Setup

### Prerequisites

- Node.js ≥ 20 LTS

### Install and start

```bash
cd backend
npm install
npm start
```

Open **http://localhost:3001** in your browser.

For file-watch auto-restart during development:

```bash
npm run dev
```

### Run tests

```bash
cd backend
npm test
```

All 36 tests pass. No real API keys are required — provider HTTP calls are mocked in tests.

## API routes

All routes are served from the same origin as the frontend.

| Route | Purpose |
|---|---|
| `GET /api/health` | Health check. Returns `{ ok: true, phase: 3 }` |
| `POST /api/keys/test` | Test a provider key with a minimal request. Returns success/failure. |
| `POST /api/solver` | Run one solver with a specific style. |
| `POST /api/review` | Run critic or judge (controlled by `stage` field). |

### POST /api/solver

**Request:**
```json
{
  "provider": "anthropic",
  "apiKey": "USER_KEY",
  "question": "Why does my Python loop fail?",
  "style": "concise"
}
```

Allowed styles: `concise`, `first_principles`, `example_driven`

**Response (200):**
```json
{
  "ok": true,
  "provider": "anthropic",
  "providerLabel": "Claude",
  "style": "concise",
  "styleLabel": "Concise approach",
  "draft": "The answer text…"
}
```

### POST /api/review

**Critic request (`stage: "critic"`):**
```json
{
  "provider": "openai",
  "apiKey": "USER_KEY",
  "stage": "critic",
  "question": "Why does my Python loop fail?",
  "drafts": [
    { "label": "A", "text": "Draft A text…" },
    { "label": "B", "text": "Draft B text…" },
    { "label": "C", "text": "Draft C text…" }
  ]
}
```

**Critic response (200):**
```json
{ "ok": true, "stage": "critic", "provider": "openai", "providerLabel": "OpenAI", "critique": "Findings…" }
```

**Judge request (`stage: "judge"`):**
```json
{
  "provider": "anthropic",
  "apiKey": "USER_KEY",
  "stage": "judge",
  "question": "…",
  "drafts": [ … ],
  "critique": "optional critic output"
}
```

**Judge response (200):**
```json
{
  "ok": true,
  "stage": "judge",
  "winner": "B",
  "winnerText": "Improved final answer…",
  "scores": {
    "A": { "correctness": 7, "clarity": 8, "completeness": 6, "reason": "…" },
    "B": { "correctness": 9, "clarity": 8, "completeness": 9, "reason": "…" },
    "C": { "correctness": 8, "clarity": 7, "completeness": 8, "reason": "…" }
  },
  "degraded": false
}
```

`degraded: true` when no critique was provided (critic failure scenario).

### Error shape

All errors use:
```json
{ "error": { "code": "ERROR_CODE", "message": "Human-readable safe message." } }
```

Common codes: `INVALID_REQUEST`, `PROVIDER_AUTH_FAILED`, `PROVIDER_LIMIT_REACHED`, `PROVIDER_TIMEOUT`, `JUDGE_INVALID_JSON`, `JUDGE_SCHEMA_ERROR`, `SERVER_BUSY`, `RATE_LIMITED`.

## Security controls

| Control | Enforcement point |
|---|---|
| 100 KB JSON body limit | Express middleware |
| 12,000-char question limit | Route-level validation (express-validator) |
| Provider URL allowlist (no SSRF) | Server-side; client sends only provider name |
| Model ID allowlist | Server-side; no client-controllable model IDs |
| 30 req/min rate limit | express-rate-limit on all `/api/` routes |
| 12 key-test requests/min | Separate tighter limiter on `/api/keys/test` |
| Max 8 concurrent provider calls | Counter in route handlers |
| Request timeouts | 30 s for solvers, 45 s for critic/judge |
| Helmet CSP, HSTS, security headers | helmet middleware |
| No key logging | Explicit pattern in all catch blocks |
| No raw upstream error forwarding | Safe error mapping in providers.js |
| textContent only for model output | All DOM writes use textContent or createElement |
| No innerHTML for untrusted content | Entire frontend avoids innerHTML |
| CORS not needed | Frontend served from same origin |

## Failure handling

| Scenario | Behaviour |
|---|---|
| One solver fails | Continue with successful drafts; label failed card |
| All solvers fail | Show error banner with Retry action |
| Critic fails | Enter degraded mode; judge runs without critique; card labeled |
| Judge fails | Show Retry judge button; drafts and critique are reused |
| Judge returns bad JSON | 422 returned; frontend shows retry action |
| Invalid key | 422 with `PROVIDER_AUTH_FAILED`; no auto-retry |
| Quota/billing error | 429 with `PROVIDER_LIMIT_REACHED`; no auto-retry |
| Timeout | 504 with `PROVIDER_TIMEOUT` |
| User resets | All outstanding requests aborted; sessionId incremented to discard stale responses |

## Project structure

```
.
├── backend/
│   ├── server.js          # Express entry point, middleware, health check
│   ├── providers.js       # Provider allowlist, callProvider(), testProvider()
│   ├── routes/
│   │   ├── keys.js        # POST /api/keys/test
│   │   ├── solver.js      # POST /api/solver
│   │   └── review.js      # POST /api/review (critic + judge)
│   ├── test/
│   │   ├── providers.test.js
│   │   ├── solver.test.js
│   │   └── review.test.js
│   ├── package.json
│   └── .env.example
└── frontend/
    ├── index.html         # All sections: key setup + question input + debate panel
    ├── style.css          # Design tokens, provider cards, agent cards, score grid
    └── app.js             # State machine, parallel solver orchestration, UI logic
```

## Known limitations

- Keys must be re-entered after a page refresh.
- All provider model IDs are configured server-side; updating them requires a server restart.
- Provider rate limits, availability, model access, and pricing are controlled by each provider.
- Agent review reduces some errors but cannot guarantee correctness.
- Phase 4 (tutor, comprehension checks, recap) is not yet implemented.

## Demo flow (Phase 3)

1. Enter API keys for one or more providers and click **Test & keep in memory**.
2. Type a buggy Python snippet in the question box and click **Start Learning**.
3. Watch the three solver cards complete independently with their provider labels.
4. Observe the critic's findings and the judge's score bars and selected answer.
5. Click **New question** to reset and try a CS-concept question.
6. Test a failed provider by clearing a key and rerunning — the remaining solvers continue.

## Deployment checklist

- [ ] `.env`, real keys, `node_modules/` are in `.gitignore`.
- [ ] `.env.example` contains only placeholder values.
- [ ] HTTPS is enabled in production.
- [ ] CORS is configured for the intended origin only (currently same-origin serving makes CORS unnecessary).
- [ ] CSP and security headers verified with helmet.
- [ ] Rate limits, timeouts, and concurrency caps active.
- [ ] Keys and request bodies are not captured in platform logs.
- [ ] Invalid-key, quota, all-solver-failure, critic-failure, judge-failure, and bad-JSON states tested.
