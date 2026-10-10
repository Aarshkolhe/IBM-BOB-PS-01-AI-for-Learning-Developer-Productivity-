// Verify the exact Gemini REST API format for system_instruction and generateContent
// by checking the reference page directly
const r = await fetch('https://ai.google.dev/api/generate-content', {
  headers: { 'User-Agent': 'Mozilla/5.0' },
  signal: AbortSignal.timeout(12000)
});
console.log('generateContent API ref HTTP:', r.status);
const t = await r.text();

// Find system_instruction definition
const siIdx = t.indexOf('systemInstruction');
if (siIdx > 0) {
  const ctx = t.slice(Math.max(0, siIdx - 100), siIdx + 400)
    .replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
  console.log('systemInstruction def:', ctx.slice(0, 300));
}

// Also check old-style system_instruction
const si2Idx = t.indexOf('system_instruction');
if (si2Idx > 0) {
  const ctx = t.slice(Math.max(0, si2Idx - 100), si2Idx + 400)
    .replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
  console.log('\nsystem_instruction ref:', ctx.slice(0, 300));
}

// Find Content type definition to understand { parts: [...] }
const contentIdx = t.indexOf('"Content"');
if (contentIdx > 0) {
  const ctx = t.slice(contentIdx, contentIdx + 500)
    .replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
  console.log('\nContent type:', ctx.slice(0, 300));
}

// Check the curl example for generateContent to see exact format
const curlIdx = t.indexOf('curl');
if (curlIdx > 0) {
  const ctx = t.slice(curlIdx, curlIdx + 1000)
    .replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
  console.log('\nCurl example:', ctx.slice(0, 400));
}
