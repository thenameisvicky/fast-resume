const { readItems, groupLines } = require('../server/pdf-import.js');

async function lines(file) {
  const { pages, fontMap } = await readItems(file);
  const out = [];
  for (const p of pages) {
    for (const l of groupLines(p.items, fontMap)) {
      out.push({
        page: pages.indexOf(p) + 1,
        y: +l.y.toFixed(1),
        x: +l.x.toFixed(1),
        end: +Math.max(...l.runs.map((r) => r.end)).toFixed(1),
        size: +l.maxSize.toFixed(1),
        text: l.text.replace(/\s+/g, ' ').trim(),
      });
    }
  }
  return out;
}

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

async function main() {
  const [origFile, newFile] = process.argv.slice(2);
  const a = await lines(origFile);
  const b = await lines(newFile);

  console.log(`original: ${a.length} lines, ${new Set(a.map(l => l.page)).size} page(s)`);
  console.log(`rendered: ${b.length} lines, ${new Set(b.map(l => l.page)).size} page(s)\n`);

  const pad = (s, n) => String(s).padStart(n);
  console.log(`${pad('ORIG y', 7)} ${pad('NEW y', 7)} ${pad('dy', 6)} ${pad('dx', 6)} ${pad('dsz', 5)}  text`);
  console.log('-'.repeat(100));

  const used = new Set();
  let maxDy = 0; let maxDx = 0; const missing = [];

  for (const la of a) {
    let match = null;
    for (let i = 0; i < b.length; i++) {
      if (used.has(i)) continue;
      if (norm(b[i].text) === norm(la.text)) { match = i; break; }
    }
    if (match === null) {
      for (let i = 0; i < b.length; i++) {
        if (used.has(i)) continue;
        const na = norm(la.text); const nb = norm(b[i].text);
        if (na.length > 12 && (nb.startsWith(na.slice(0, 14)) || na.startsWith(nb.slice(0, 14)))) { match = i; break; }
      }
    }
    if (match === null) {
      missing.push(la);
      console.log(`${pad(la.y, 7)} ${pad('--', 7)} ${pad('', 6)} ${pad('', 6)} ${pad('', 5)}  ~ ${la.text.slice(0, 60)}`);
      continue;
    }
    used.add(match);
    const lb = b[match];
    const dy = +(lb.y - la.y).toFixed(1);
    const dx = +(lb.x - la.x).toFixed(1);
    const dsz = +(lb.size - la.size).toFixed(1);
    maxDy = Math.max(maxDy, Math.abs(dy));
    maxDx = Math.max(maxDx, Math.abs(dx));
    const flag = Math.abs(dy) > 6 || Math.abs(dx) > 2 || Math.abs(dsz) > 0.3 ? '  <<<' : '';
    console.log(`${pad(la.y, 7)} ${pad(lb.y, 7)} ${pad(dy, 6)} ${pad(dx, 6)} ${pad(dsz, 5)}  ${la.text.slice(0, 52)}${flag}`);
  }

  // Baseline-to-baseline deltas between consecutive matched lines. Each row is
  // one CSS spacing constant; err is how much to remove from it.
  console.log('\n=== GAP CHAIN (orig vs rendered baseline deltas) ===');
  console.log(`${pad('origD', 7)} ${pad('newD', 7)} ${pad('err', 6)}  from -> to`);
  console.log('-'.repeat(100));
  const chain = [];
  for (const la of a) {
    let mi = null;
    for (let i = 0; i < b.length; i++) {
      if (norm(b[i].text) === norm(la.text)) { mi = i; break; }
    }
    if (mi !== null) chain.push({ o: la, n: b[mi] });
  }
  for (let i = 1; i < chain.length; i++) {
    const od = +(chain[i - 1].o.y - chain[i].o.y).toFixed(1);
    const nd = +(chain[i - 1].n.y - chain[i].n.y).toFixed(1);
    if (nd < 0) continue;
    const err = +(nd - od).toFixed(1);
    const mark = Math.abs(err) > 0.6 ? '  <<<' : '';
    console.log(`${pad(od, 7)} ${pad(nd, 7)} ${pad(err, 6)}  ${chain[i - 1].o.text.slice(0, 24)} -> ${chain[i].o.text.slice(0, 34)}${mark}`);
  }

  const extra = b.filter((_, i) => !used.has(i));
  console.log('\n=== SUMMARY ===');
  console.log(`max |dy| = ${maxDy.toFixed(1)}pt   max |dx| = ${maxDx.toFixed(1)}pt`);
  console.log(`unmatched in original: ${missing.length}`);
  console.log(`extra in rendered: ${extra.length}`);
  for (const e of extra) console.log(`   + y=${e.y} ${e.text.slice(0, 60)}`);
  const pagesNew = new Set(b.map((l) => l.page)).size;
  console.log(pagesNew > 1 ? `\nFAIL: rendered spills to ${pagesNew} pages` : '\nOK: single page');
}

main().catch((e) => { console.error(e); process.exit(1); });
