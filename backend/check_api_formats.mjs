import { writeFileSync } from 'node:fs';

async function fetchPage(url) {
  const r = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(12000)
  });
  console.log(`${url} -> HTTP ${r.status}`);
  return r.text();
}

// ── Check if haiku-4-5 / opus-4-5 are on a legacy or deprecated page ──────
const legacyPage = await fetchPage('https://docs.anthropic.com/en/docs/about-claude/models/legacy-models');
const legacyBtns = legacyPage.match(/data-trigger-disabled="">([^<]+)<\/button>/g) || [];
const legacyIds = [...new Set(legacyBtns.map(m => m.replace(/data-trigger-disabled="">/, '').replace(/<\/button>/, '').trim()).filter(s => s.startsWith('claude-')))].sort();
console.log('Legacy models page IDs:', JSON.stringify(legacyIds));

// ── Verify if haiku-4-5 is still accessible by checking the release notes ─
const releaseNotes = await fetchPage('https://docs.anthropic.com/en/docs/about-claude/models');
// Check the full page text for any indication of haiku-4-5 support vs deprecation
const low = releaseNotes.toLowerCase();
const h45count = (releaseNotes.match(/haiku-4-5/g) || []).length;
const h55count = (releaseNotes.match(/haiku-5-5/g) || []).length;
console.log(`haiku-4-5 appearances: ${h45count}, haiku-5-5 appearances: ${h55count}`);

// ── Verify the OpenAI max_completion_tokens is correct for gpt-4o ─────────
const openaiChat = await fetchPage('https://platform.openai.com/docs/api-reference/chat/create');
const maxCompTok = (openaiChat.match(/.{0,80}max_completion_tokens.{0,80}/g) || []).slice(0,3);
console.log('\nOpenAI max_completion_tokens contexts:');
maxCompTok.forEach(l => console.log(' ', l.trim().slice(0, 150)));
const maxTok = (openaiChat.match(/.{0,60}max_tokens.{0,60}/g) || []).slice(0,3);
console.log('OpenAI max_tokens contexts:');
maxTok.forEach(l => console.log(' ', l.trim().slice(0, 150)));

// ── Verify the Anthropic max_tokens is correct (not max_completion_tokens) ─
const anthropicMsg = await fetchPage('https://docs.anthropic.com/en/api/messages');
const antMaxTok = (anthropicMsg.match(/.{0,60}max_tokens.{0,60}/g) || []).slice(0,3);
console.log('\nAnthropic max_tokens contexts:');
antMaxTok.forEach(l => console.log(' ', l.trim().slice(0, 150)));
const antMaxComp = (anthropicMsg.match(/max_completion_tokens/g) || []).length;
console.log('Anthropic max_completion_tokens occurrences:', antMaxComp);

// ── Verify Gemini generationConfig.maxOutputTokens is correct ─────────────
const geminiRef = await fetchPage('https://ai.google.dev/gemini-api/docs/text-generation');
const geminiTok = (geminiRef.match(/.{0,60}maxOutputTokens.{0,60}/g) || []).slice(0,3);
console.log('\nGemini maxOutputTokens contexts:');
geminiTok.forEach(l => console.log(' ', l.trim().slice(0, 150)));
const geminiMaxComp = (geminiRef.match(/max_completion_tokens/g) || []).length;
console.log('Gemini max_completion_tokens occurrences:', geminiMaxComp);

// ── Check x-goog-api-key vs Authorization Bearer for Gemini ──────────────
const geminiAuth = await fetchPage('https://ai.google.dev/gemini-api/docs/api-key');
const authCtx = (geminiAuth.match(/.{0,60}x-goog-api-key.{0,60}/gi) || []).slice(0,3);
console.log('\nGemini x-goog-api-key contexts:');
authCtx.forEach(l => console.log(' ', l.trim().slice(0, 150)));
const bearerCtx = (geminiAuth.match(/.{0,60}Authorization.{0,60}/gi) || []).slice(0,3);
console.log('Gemini Authorization Bearer contexts:');
bearerCtx.forEach(l => console.log(' ', l.trim().slice(0, 150)));
