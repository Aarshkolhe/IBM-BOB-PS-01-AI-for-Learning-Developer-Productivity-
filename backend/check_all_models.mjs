import { writeFileSync } from 'node:fs';

// Check the all-models page for complete list including legacy models
const r = await fetch('https://docs.anthropic.com/en/docs/about-claude/models/all-models', {
  headers: { 'User-Agent': 'Mozilla/5.0' },
  signal: AbortSignal.timeout(12000)
});
const t = await r.text();
console.log('HTTP', r.status, '- page length', t.length);

// Extract button text with model IDs
const btnMatches = t.match(/data-trigger-disabled="">([^<]+)<\/button>/g) || [];
const btnTexts = btnMatches.map(m => m.replace(/data-trigger-disabled="">/, '').replace(/<\/button>/, '').trim());
const claudeIds = [...new Set(btnTexts.filter(s => s.startsWith('claude-')))].sort();
console.log('All-models page direct API IDs:', JSON.stringify(claudeIds));

// Check if haiku-4-5 and opus-4-5 appear here
console.log('haiku-4-5 present:', claudeIds.some(id => id.includes('haiku-4-5')));
console.log('opus-4-5 present:', claudeIds.some(id => id.includes('opus-4-5')));
console.log('haiku-5-5 present:', claudeIds.some(id => id.includes('haiku-5-5')));
console.log('opus-5-5 present:', claudeIds.some(id => id.includes('opus-5-5')));
console.log('sonnet-4-5 present:', claudeIds.some(id => id.includes('sonnet-4-5')));

// Try to find the "Latest" label and surrounding context
const latestIdx = t.indexOf('Latest');
if (latestIdx > 0) {
  console.log('\nLatest context:', t.slice(latestIdx - 100, latestIdx + 300).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300));
}

writeFileSync('all_models_ids.txt', claudeIds.join('\n'));
console.log('\nWrote all_models_ids.txt with', claudeIds.length, 'IDs');
