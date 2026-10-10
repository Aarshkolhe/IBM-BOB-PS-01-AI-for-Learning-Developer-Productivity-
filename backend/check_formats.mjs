import { writeFileSync } from 'node:fs';

// Final verification: confirm the system_instruction format for Gemini
const geminiSI = await fetch('https://ai.google.dev/gemini-api/docs/system-instructions', {
  headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(12000)
});
const siText = await geminiSI.text();
console.log('Gemini system-instructions page HTTP:', geminiSI.status);
// Find system_instruction format
const siCtx = siText.match(/.{0,100}system_instruction.{0,100}/g) || [];
siCtx.slice(0,5).forEach(l => console.log('SI ctx:', l.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().slice(0, 150)));

// Verify Gemini 2.0-flash GA and model ID format
const g20page = await fetch('https://ai.google.dev/gemini-api/docs/models/gemini-2.0-flash', {
  headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(12000)
});
const g20text = await g20page.text();
console.log('\nGemini 2.0-flash page HTTP:', g20page.status);
const g20code = g20text.match(/<code[^>]*>gemini-2\.0-flash[^<]*<\/code>/g) || [];
console.log('2.0-flash code refs:', JSON.stringify([...new Set(g20code.map(s => s.replace(/<[^>]+>/g,'')))]));

// Check Anthropic system prompt format  
const antSys = await fetch('https://docs.anthropic.com/en/api/messages', {
  headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(12000)
});
const antSysText = await antSys.text();
// Find how system is passed
const sysCtx = antSysText.match(/.{0,80}"system".{0,80}/g) || [];
sysCtx.slice(0, 4).forEach(l => console.log('\nAnthropic system ctx:', l.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().slice(0, 180)));

// Check Anthropic anthropic-version header
const versionCtx = antSysText.match(/.{0,60}anthropic-version.{0,60}/g) || [];
versionCtx.slice(0, 3).forEach(l => console.log('anthropic-version ctx:', l.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().slice(0, 150)));
