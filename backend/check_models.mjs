import { writeFileSync } from 'node:fs';

async function main() {
  // ── Anthropic models ─────────────────────────────────────────────────────
  try {
    const r = await fetch('https://docs.anthropic.com/en/docs/about-claude/models/overview', {
      signal: AbortSignal.timeout(12000)
    });
    const t = await r.text();
    // Extract apiId fields (full versioned IDs like claude-haiku-4-5-20251001)
    const apiIdMatches = t.match(/"apiId":"(claude-[^"]+)"/g) || [];
    const ids = apiIdMatches.map(m => m.slice(9, -1));
    // Also find "latest":true objects and extract their context
    const latestCtx = [];
    const latestRe = /"latest"\s*:\s*true/g;
    let m;
    while ((m = latestRe.exec(t)) !== null) {
      latestCtx.push(t.slice(Math.max(0, m.index - 200), m.index + 50));
    }
    writeFileSync('anthropic_check.txt', 
      'API IDs found:\n' + [...new Set(ids)].sort().join('\n') + 
      '\n\nLatest model contexts:\n' + latestCtx.join('\n---\n'));
    console.log('Anthropic: wrote anthropic_check.txt, found', ids.length, 'IDs');
  } catch(e) {
    console.log('Anthropic fetch error:', e.message);
  }

  // ── OpenAI models ────────────────────────────────────────────────────────
  try {
    const r = await fetch('https://platform.openai.com/docs/models', {
      signal: AbortSignal.timeout(12000)
    });
    const t = await r.text();
    const matches = t.match(/gpt-4[a-z0-9-]*/g) || [];
    const unique = [...new Set(matches)].sort();
    writeFileSync('openai_check.txt', 'GPT-4 model names found:\n' + unique.join('\n'));
    console.log('OpenAI: wrote openai_check.txt, found', unique.length, 'models');
  } catch(e) {
    console.log('OpenAI fetch error:', e.message);
  }

  // ── Gemini models ────────────────────────────────────────────────────────
  try {
    const r = await fetch('https://ai.google.dev/gemini-api/docs/models/gemini', {
      signal: AbortSignal.timeout(12000)
    });
    const t = await r.text();
    const matches = t.match(/gemini-[a-z0-9.-]+/g) || [];
    const unique = [...new Set(matches)].sort();
    writeFileSync('gemini_check.txt', 'Gemini model names found:\n' + unique.join('\n'));
    console.log('Gemini: wrote gemini_check.txt, found', unique.length, 'models');
    // Also check for 2.0 flash references
    const flash = t.match(/.{0,80}gemini-2.{0,80}/g) || [];
    flash.slice(0, 10).forEach(l => console.log('  flash ctx:', l.trim().slice(0, 100)));
  } catch(e) {
    console.log('Gemini fetch error:', e.message);
  }
}

main();
