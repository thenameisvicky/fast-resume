// Compare LaTeX's glyph advances (from the source PDF) against Chrome's
// rendering of the same strings in the Latin Modern webfont.
const fs = require('fs');
const { execFileSync } = require('child_process');
const { readItems, groupLines } = require('../server/pdf-import.js');

const SCRATCH = process.env.JW_SCRATCH || '/tmp';

async function main() {
  const { pages, fontMap } = await readItems(process.argv[2]);
  const lines = groupLines(pages[0].items, fontMap);
  const RIGHT = Math.max(...lines.flatMap((l) => l.runs.map((r) => r.end)));

  const samples = [];
  for (const l of lines) {
    for (const r of l.runs) {
      const t = r.text.trim();
      if (t.length < 18) continue;
      samples.push({
        text: r.text,
        pdfWidth: +r.w.toFixed(2),
        size: +r.size.toFixed(2),
        bold: r.bold,
        italic: r.italic,
        justified: Math.abs(r.end - RIGHT) < 1.2,
      });
    }
  }

  const { fontFaceCss } = require('../server/fonts.js');

  const html = `<!doctype html><meta charset="utf-8">
<style>
${fontFaceCss('data')}
span{font-family:'LMRoman10',serif;white-space:pre}
</style>
<div id="host"></div><pre id="out"></pre>
<script>
const S = ${JSON.stringify(samples)};
// Fonts are only fetched once something uses them, so document.fonts.ready
// resolves instantly on an empty page. Force each face in explicitly.
Promise.all([
  document.fonts.load("10.91pt 'LMRoman10'"),
  document.fonts.load("bold 10.91pt 'LMRoman10'"),
  document.fonts.load("italic 10.91pt 'LMRoman10'"),
  document.fonts.load("bold 12pt 'LMRoman12'"),
]).then(() => {
  const host = document.getElementById('host');
  const res = S.map((s) => {
    const el = document.createElement('span');
    el.textContent = s.text;
    el.style.fontSize = s.size + 'pt';
    el.style.fontWeight = s.bold ? '700' : '400';
    el.style.fontStyle = s.italic ? 'italic' : 'normal';
    host.appendChild(el);
    const w = el.getBoundingClientRect().width * 72 / 96;
    return { text: s.text.slice(0, 40), pdf: s.pdfWidth, css: +w.toFixed(2),
             ratio: +(w / s.pdfWidth).toFixed(4), size: s.size,
             justified: s.justified,
             style: (s.bold ? 'B' : '') + (s.italic ? 'I' : '') || 'R' };
  });
  document.getElementById('out').textContent = 'JSONSTART' + JSON.stringify(res) + 'JSONEND';
});
</script>`;

  const file = `${SCRATCH}/measure.html`;
  fs.writeFileSync(file, html);

  const dom = execFileSync('google-chrome', [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    '--virtual-time-budget=6000', '--dump-dom', `file://${file}`,
  ], { encoding: 'utf8', maxBuffer: 40 * 1024 * 1024 });

  const m = dom.match(/JSONSTART(.*?)JSONEND/s);
  if (!m) { console.error('no measurement payload'); process.exit(1); }
  const res = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'"));

  console.log(`${'style'.padEnd(6)}${'size'.padStart(6)}${'pdf'.padStart(9)}${'css'.padStart(9)}${'ratio'.padStart(8)}  text`);
  for (const r of res) {
    if (r.justified) continue;
    console.log(`${r.style.padEnd(6)}${String(r.size).padStart(6)}${String(r.pdf).padStart(9)}${String(r.css).padStart(9)}${String(r.ratio).padStart(8)}  ${r.text}`);
  }

  const byStyle = {};
  for (const r of res) {
    if (r.justified) continue;
    (byStyle[r.style] = byStyle[r.style] || []).push(r.ratio);
  }
  console.log('\n=== MEAN RATIO (css / latex), NATURAL-WIDTH LINES ONLY ===');
  for (const [k, v] of Object.entries(byStyle)) {
    const mean = v.reduce((a, b) => a + b, 0) / v.length;
    const min = Math.min(...v); const max = Math.max(...v);
    console.log(`${k}: n=${v.length} mean=${mean.toFixed(4)} min=${min.toFixed(4)} max=${max.toFixed(4)}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
