// Verify Gemini system_instruction exact format
const r = await fetch('https://ai.google.dev/gemini-api/docs/system-instructions', {
  headers: { 'User-Agent': 'Mozilla/5.0' },
  signal: AbortSignal.timeout(12000)
});
const t = await r.text();

// Find the JSON examples with system_instruction
const jsonCtx = t.match(/.{0,300}system_instruction.{0,300}/g) || [];
jsonCtx.slice(0, 5).forEach(c => {
  const clean = c
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
  console.log('SI ctx:', clean.slice(0, 250));
  console.log('---');
});

// Also check the REST API format specifically
const restSection = t.indexOf('REST');
if (restSection > 0) {
  const ctx = t.slice(restSection, restSection + 2000)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  console.log('\nREST section:', ctx.slice(0, 500));
}
