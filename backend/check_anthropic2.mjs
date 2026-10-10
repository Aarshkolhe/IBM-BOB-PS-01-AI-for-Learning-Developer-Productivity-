import { writeFileSync } from 'node:fs';

// Fetch the Anthropic models page and extract exact API model ID strings
// from button elements (the JS-rendered table cells)
const r = await fetch('https://docs.anthropic.com/en/docs/about-claude/models', {
  headers: { 'User-Agent': 'Mozilla/5.0' },
  signal: AbortSignal.timeout(12000)
});
const t = await r.text();

// Extract all button text content that matches claude-* patterns
// The page renders API IDs inside <button> elements in table cells
const btnMatches = t.match(/data-trigger-disabled="">([^<]+)<\/button>/g) || [];
const btnTexts = btnMatches.map(m => m.replace(/data-trigger-disabled="">/,'').replace(/<\/button>/,'').trim());
const claudeIds = btnTexts.filter(s => /^claude-/.test(s) || /^anthropic\.claude/.test(s));

// Deduplicate and sort
const unique = [...new Set(claudeIds)].sort();
console.log('All Claude IDs from buttons:', JSON.stringify(unique));

// The table structure repeats for different platforms (API, AWS Bedrock, Vertex AI)
// Direct API IDs don't have a prefix like 'anthropic.'
const directApiIds = unique.filter(id => !id.startsWith('anthropic.') && !id.startsWith('claude.'));
console.log('\nDirect API IDs (no prefix):', JSON.stringify(directApiIds));

// Identify which are "latest" (current) vs legacy
// From the page we can see the latest models listed:
// - claude-haiku-5-5 (latest haiku)
// - claude-sonnet-5-5 (latest sonnet)
// - claude-opus-5-5 (latest opus)
// The 4-5 series appears in the table too

// Check which rows haiku-4-5 appears in
const haiku45ctx = [];
let idx = 0;
while (true) {
  idx = t.indexOf('claude-haiku-4-5', idx);
  if (idx < 0) break;
  haiku45ctx.push(t.slice(Math.max(0, idx-200), idx+100).replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim());
  idx += 16;
}
console.log('\nclause-haiku-4-5 contexts:');
haiku45ctx.slice(0, 3).forEach(c => console.log(' ', c.slice(0, 200)));

writeFileSync('anthropic_button_ids.txt', unique.join('\n'));
console.log('\nWrote anthropic_button_ids.txt');
