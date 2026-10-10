import { writeFileSync } from 'node:fs';

async function fetchPage(url) {
  const r = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(12000)
  });
  console.log(`${url} → HTTP ${r.status}`);
  return r.text();
}

// ── OpenAI ─────────────────────────────────────────────────────────────────
const openai = await fetchPage('https://platform.openai.com/docs/models');
const gpt4o = [...new Set((openai.match(/gpt-4o(?:-mini)?(?:-[0-9]{4}-[0-9]{2}-[0-9]{2})?/g) || []))].sort();
const gpt4oMini = gpt4o.filter(m => m.includes('mini'));
const gpt4oFull = gpt4o.filter(m => !m.includes('mini'));
console.log('gpt-4o:', JSON.stringify(gpt4oFull));
console.log('gpt-4o-mini:', JSON.stringify(gpt4oMini));
// Check max_completion_tokens vs max_tokens for these models
const compTokCtx = (openai.match(/.{0,80}max_completion_tokens.{0,80}/g) || []).slice(0, 3);
compTokCtx.forEach(l => console.log('max_completion_tokens ctx:', l.trim().slice(0, 120)));
writeFileSync('openai_models.txt', gpt4o.join('\n'));

// ── Anthropic ──────────────────────────────────────────────────────────────
// The models overview page is React-rendered so apiId fields aren't present.
// Try the raw API reference page for the Messages API which lists current models.
const anthropicApiRef = await fetchPage('https://docs.anthropic.com/en/api/messages');
const claudeRefs = [...new Set((anthropicApiRef.match(/claude-(?:haiku|sonnet|opus)-[0-9-]+/g) || []))].sort();
console.log('\nAnthropic models on /api/messages:', JSON.stringify(claudeRefs));
writeFileSync('anthropic_models.txt', claudeRefs.join('\n'));

// Try the model list page 
const anthropicModels = await fetchPage('https://docs.anthropic.com/en/docs/about-claude/models/all-models');
const claudeAll = [...new Set((anthropicModels.match(/claude-(?:haiku|sonnet|opus)-[0-9][^"'\s<>]*/g) || []))].sort();
console.log('Anthropic all-models page:', JSON.stringify(claudeAll));
// Look for the latest API string patterns
const latestPat = [...new Set((anthropicModels.match(/claude-[a-z]+-[0-9]+-[0-9]+-20[0-9]{6}/g) || []))].sort();
console.log('Versioned IDs (with date):', JSON.stringify(latestPat));
writeFileSync('anthropic_all_models.txt', claudeAll.join('\n'));

// ── Gemini - check specific 2.5-flash page ──────────────────────────────────
const gemini25 = await fetchPage('https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash');
const g25ids = [...new Set((gemini25.match(/gemini-2\.5-flash[a-z0-9-]*/g) || []))].sort();
console.log('\nGemini 2.5-flash IDs:', JSON.stringify(g25ids));
// Look for the generateContent model string
const codeIds = [...gemini25.matchAll(/<code[^>]*>([^<]*generateContent[^<]*|[^<]*gemini-2[^<]*)<\/code>/g)].map(m => m[1].trim());
console.log('Code block refs:', JSON.stringify([...new Set(codeIds)].sort()));
writeFileSync('gemini_25_flash.txt', g25ids.join('\n'));
