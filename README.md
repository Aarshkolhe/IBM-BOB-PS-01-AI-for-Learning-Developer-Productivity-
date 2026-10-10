# TutorArena

**Author:** Aarsh Kolhe
**Problem Statement:** PS 01 — AI for Learning & Developer Productivity
**Current phase:** Phase 4 complete — Full pipeline with step-by-step tutor

TutorArena is a learning web app where multiple AI agents independently answer a question, a critic reviews the drafts, a judge selects the best answer and improves it, and a tutor teaches the final answer in small steps. Designed for students learning programming and computer science, and junior developers debugging code.

## What works now (Phase 4)

| Feature | Status |
|---|---|
| BYOK key entry for Claude, OpenAI, Gemini | ✅ |
| Key testing via `/api/keys/test` | ✅ |
| Keys held in browser memory only | ✅ |
| Three parallel solver calls | ✅ |
| Solver cards update independently | ✅ |
| Critic reviews all drafts (fast model) | ✅ |
| Judge scores and selects best answer (strong model) | ✅ |
| Degraded mode when critic fails | ✅ |
| Judge retry without re-running solvers | ✅ |
| All-solvers-failed detection and retry | ✅ |
| Score bars (correctness/clarity/completeness) | ✅ |
| New question / reset | ✅ |
| Stale-response guard (sessionId) | ✅ |
| No `innerHTML` for model output | ✅ |
| Keys never stored in Web Storage | ✅ |
| Keys never logged or echoed in responses | ✅ |
| Tutor: step-by-step teaching (4–6 steps) | ✅ |
| Tutor: progress bar (Step X of N) | ✅ |
| Tutor: Got it / Not clear buttons | ✅ |
| Tutor: re-explanation on Not clear (max 2×/step) | ✅ |
| Tutor: third Not clear shows pre-generated worked example | ✅ |
| Tutor: retry on JSON parse/schema failure | ✅ |
| Tutor: Retry tutor button on hard failure | ✅ |
| Recap + final check question | ✅ |
| Copy button (recap only) | ✅ |

## How it works

1. **Three solvers run in parallel.** Solver A is concise (Claude), Solver B explains from first principles (OpenAI), Solver C leads with an example (Gemini). With fewer keys, providers rotate across solvers using different prompts.
2. **The critic reviews all successful drafts.** It finds mistakes, gaps, and differences without selecting a winner.
3. **The judge selects and improves an answer.** It scores each draft on correctness, clarity, and completeness (1–10), then produces the final answer using the critic's findings.
4. **The tutor teaches the final answer in 4–6 steps.** Each step has a title, explanation, and worked example. Got it advances; Not clear fetches a simpler explanation (up to twice per step). A third Not clear shows the pre-generated worked example — no extra API call.
5. **Recap and copy.** After the last step a recap and final comprehension question are shown, with a copy button for the recap text.

The normal pipeline uses **6 model calls per run**: 3 parallel solvers + 1 critic + 1 judge + 1 tutor. Re-explanation calls are additional (max 2 per step).

## How IBM Bob / AI Was Used

1. **Solution Architecture & Multi-Agent Deliberation:** AI models are at the core of the product. TutorArena coordinates five discrete agent roles (3 Solvers, 1 Critic, 1 Judge) using prompt engineering tuned for adversarial code review, rubric scoring, and multi-perspective teaching.
2. **Accelerated Development with IBM Bob:** IBM Bob served as an intelligent developer productivity partner throughout the hackathon:
   - **Architectural Scaffolding:** Designed the zero-trust BYOK memory-only key lifecycle, preventing sensitive API tokens from leaking into Web Storage, server logs, or error payloads.
   - **Backend Implementation:** Assisted in implementing the Express 5 proxy routes, request validators, SSRF prevention allowlists, and graceful degradation handlers for API failures.
   - **Automated Test Suite:** Generated and verified 23 automated unit and integration tests using native `node:test` with 100% mocked network calls.
   - **Defensive UI/UX:** Guided the frontend implementation to ensure zero `innerHTML` rendering (pure `textContent`), live parallel state management, and instant abort handling (`sessionId`).

## BYOK: Bring Your Own API Key

Users supply their own API key for one or more providers:

| Provider | Auth | Model (fast) | Model (strong) |
|---|---|---|---|
| Anthropic Claude | `x-api-key` header | `claude-haiku-4-5` | `claude-opus-4-5` |
| OpenAI | `Authorization: Bearer` | `gpt-4o-mini` | `gpt-4o` |
| Google Gemini | `x-goog-api-key` header | `gemini-3.5-flash-lite` | `gemini-3.8-flash` |

**Model-tier assignment (matches original PRD):**
- Solvers (A, B, C): fast model (`gemini-3.5-flash-lite`).
- Critic: fast model (`gemini-3.5-flash-lite`).
- Judge: strong model (`gemini-3.8-flash`).
- Tutor (Phase 4): strong model (`gemini-3.8-flash`).

Models reflect Google's current API documentation for new projects (`gemini-3.5-flash-lite` and `gemini-3.8-flash`), replacing deprecated 1.5/2.5 tier identifiers.

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

All 56 tests pass. No real API keys are required — provider HTTP calls are mocked in tests.

## API routes

All routes are served from the same origin as the frontend.

| Route | Purpose |
|---|---|
| `GET /api/health` | Health check. Returns `{ ok: true, phase: 4 }` |
| `POST /api/keys/test` | Test a provider key with a minimal request. Returns success/failure. |
| `POST /api/solver` | Run one solver with a specific style. |
| `POST /api/review` | Run critic or judge (controlled by `stage` field). |
| `POST /api/tutor` | Generate structured teaching steps from the judge's final answer. |
| `POST /api/reexplain` | Re-explain a specific step (simpler for count 1, worked example style for count 2). |

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
│   │   ├── review.js      # POST /api/review (critic + judge)
│   │   └── tutor.js       # POST /api/tutor + POST /api/reexplain
│   ├── test/
│   │   ├── providers.test.js
│   │   ├── solver.test.js
│   │   ├── review.test.js
│   │   └── tutor.test.js
│   ├── package.json
│   └── .env.example
└── frontend/
    ├── index.html         # Key setup + question + debate panel + tutor section
    ├── style.css          # Design tokens, all component styles including tutor
    └── app.js             # State machine, pipeline, tutor flow, reexplain loop
```

## Known limitations

- Keys must be re-entered after a page refresh.
- All provider model IDs are configured server-side; updating them requires a server restart.
- Provider rate limits, availability, model access, and pricing are controlled by each provider.
- Agent review reduces some errors but cannot guarantee correctness.
- Live Gemini API integration has not been smoke-tested with a real key (mocked tests only).

## Demo flow (Phase 4)

1. Enter at least one API key and click **Test & keep in memory**.
2. Type a buggy Python snippet and click **Start Learning**.
3. Watch the three solver cards complete independently with their provider labels.
4. Observe the critic's findings and the judge's score bars and selected answer.
5. The tutor section opens automatically. Read Step 1.
6. Click **Not clear** once to see a simpler re-explanation.
7. Click **Got it** to advance through remaining steps.
8. After the last step, read the recap and final check question; use the Copy button.
9. Click **New question** to reset and try a CS-concept question.

## Deployment checklist

- [ ] `.env`, real keys, `node_modules/` are in `.gitignore`.
- [ ] `.env.example` contains only placeholder values.
- [ ] HTTPS is enabled in production.
- [ ] CORS is configured for the intended origin only (currently same-origin serving makes CORS unnecessary).
- [ ] CSP and security headers verified with helmet.
- [ ] Rate limits, timeouts, and concurrency caps active.
- [ ] Keys and request bodies are not captured in platform logs.
- [ ] Invalid-key, quota, all-solver-failure, critic-failure, judge-failure, and bad-JSON states tested.

## Vercel deployment

TutorArena is fully configured for deployment on Vercel as a hybrid application:
- **Frontend**: Static files in `/frontend` are served directly by Vercel's global CDN.
- **Backend API**: The Express app in `/backend` runs as a Vercel Serverless Function via `/api/index.js` (with `maxDuration: 60s` for LLM multi-agent pipelines).

### Option 1 — Git Integration (Recommended)
1. Push this repository to GitHub:
   ```bash
   git add .
   git commit -m "Configure Vercel deployment"
   git push origin main
   ```
2. Open [Vercel Dashboard](https://vercel.com/new) and click **Import Project**.
3. Select your GitHub repository (`IBM-BOB-PS-01-AI-for-Learning-Developer-Productivity-`).
4. Keep the root directory as `./` (default) and framework as **Other**.
5. Click **Deploy**. Vercel will automatically read `vercel.json` and deploy both the frontend and API.

### Option 2 — Vercel CLI
```bash
npx vercel
```
Follow the interactive prompts to link and deploy the project.

