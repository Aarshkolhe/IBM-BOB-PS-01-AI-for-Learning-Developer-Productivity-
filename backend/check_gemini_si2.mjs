// Verify Gemini generateContent system_instruction exact REST format
// Check the v1beta reference that's actually used by generateContent
const pages = [
  'https://ai.google.dev/api/generate-content#v1beta.GenerationConfig',
  'https://ai.google.dev/gemini-api/docs/text-generation',
  'https://ai.google.dev/api/rest/v1beta/models/generateContent',
];

for (const url of pages) {
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) });
  console.log(`\n${url} -> HTTP ${r.status}`);
  const t = await r.text();
  
  // Find system_instruction/systemInstruction usage
  for (const kw of ['system_instruction', 'systemInstruction']) {
    const idx = t.indexOf(kw);
    if (idx > 0) {
      const ctx = t.slice(Math.max(0, idx - 100), idx + 500)
        .replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
      console.log(`${kw}:`, ctx.slice(0, 400));
    }
  }
  
  // Find if there's a generateContent REST example
  const gcIdx = t.indexOf('generateContent');
  if (gcIdx > 0 && t.indexOf('"system') > 0) {
    const jsonEx = t.match(/\{[^}]*"system[^}]*\}/g) || [];
    jsonEx.slice(0, 2).forEach(j => console.log('JSON ex:', j.replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim().slice(0, 200)));
  }
}
