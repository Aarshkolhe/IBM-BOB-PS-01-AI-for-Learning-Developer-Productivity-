import { writeFileSync } from 'node:fs';

async function fetchPage(url) {
  const r = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    redirect: 'follow',
    signal: AbortSignal.timeout(12000)
  });
  console.log(`${url} -> HTTP ${r.status}`);
  return r.text();
}

// ── Anthropic: try their release notes / model IDs page ─────────────────────
const anthropicMain = await fetchPage('https://docs.anthropic.com/en/docs/about-claude/models');
// Look for versioned model IDs (with date suffix like 20250219)
const datedIds = [...new Set(anthropicMain.match(/claude-(?:haiku|sonnet|opus)-[0-9]+-[0-9]+-20[0-9]{6}/g) || [])].sort();
console.log('Anthropic dated model IDs:', JSON.stringify(datedIds));

// Also try the Next.js API route that powers the page 
const lines = anthropicMain.split('\n');
// Find lines containing haiku or opus version info
const modelLines = lines.filter(l => /claude-(?:haiku|opus)-[0-9]/.test(l));
modelLines.slice(0, 20).forEach(l => console.log('MODEL LINE:', l.trim().slice(0, 200)));

// ── Try Anthropic API reference page which often has example curl with model IDs ─
const anthropicCurl = await fetchPage('https://docs.anthropic.com/en/api/getting-started');
const curlModels = [...new Set(anthropicCurl.match(/claude-[a-z]+-[0-9-]+/g) || [])].sort();
console.log('\nAnthropic getting-started models:', JSON.stringify(curlModels));

// ── Check the Gemini 2.0 flash page for exact API model ID ─────────────────
const gemini20 = await fetchPage('https://ai.google.dev/gemini-api/docs/models/gemini-2.0-flash');
const g20ids = [...new Set(gemini20.match(/gemini-2\.0-flash[a-z0-9-]*/g) || [])].sort();
console.log('\nGemini 2.0-flash IDs:', JSON.stringify(g20ids));

// ── Check Gemini 2.5-pro for strong model recommendation ──────────────────
const gemini25pro = await fetchPage('https://ai.google.dev/gemini-api/docs/models/gemini-2.5-pro');
const g25proIds = [...new Set(gemini25pro.match(/gemini-2\.5-pro[a-z0-9-]*/g) || [])].sort();
console.log('Gemini 2.5-pro IDs:', JSON.stringify(g25proIds));

// Write summary
writeFileSync('model_verification.txt', [
  'ANTHROPIC:',
  '  Dated IDs found: ' + JSON.stringify(datedIds),
  '  Getting-started refs: ' + JSON.stringify(curlModels),
  '',
  'GEMINI 2.0-flash IDs: ' + JSON.stringify(g20ids),
  'GEMINI 2.5-pro IDs: ' + JSON.stringify(g25proIds),
].join('\n'));
console.log('\nWrote model_verification.txt');
