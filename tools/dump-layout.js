const fs = require('fs');
const path = require('path');
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');

async function main() {
  const file = process.argv[2];
  const data = new Uint8Array(fs.readFileSync(file));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();

    console.log(`\n===== PAGE ${p} (${viewport.width.toFixed(1)} x ${viewport.height.toFixed(1)}) =====`);

    const items = content.items
      .filter((i) => i.str.trim())
      .map((i) => ({
        str: i.str,
        x: +i.transform[4].toFixed(1),
        y: +i.transform[5].toFixed(1),
        size: +Math.hypot(i.transform[2], i.transform[3]).toFixed(1),
        font: i.fontName,
        w: +i.width.toFixed(1),
      }));

    const lines = new Map();
    for (const it of items) {
      const key = Math.round(it.y);
      let bucket = null;
      for (const k of lines.keys()) if (Math.abs(k - key) <= 2) bucket = k;
      if (bucket === null) bucket = key;
      if (!lines.has(bucket)) lines.set(bucket, []);
      lines.get(bucket).push(it);
    }

    const ordered = [...lines.entries()].sort((a, b) => b[0] - a[0]);
    for (const [y, group] of ordered) {
      group.sort((a, b) => a.x - b.x);
      const text = group.map((g) => g.str).join('');
      const meta = group.map((g) => `${g.font}@${g.size}`);
      const uniq = [...new Set(meta)].join(',');
      console.log(`y=${String(y).padStart(4)} x=${String(group[0].x).padStart(5)} [${uniq}] ${text}`);
    }
  }

  const fonts = new Set();
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const c = await page.getTextContent();
    for (const i of c.items) if (i.fontName) fonts.add(i.fontName);
    const ops = await page.getOperatorList();
    void ops;
    const commonObjs = page.commonObjs;
    for (const f of fonts) {
      try {
        const obj = commonObjs.get(f);
        if (obj) fonts.add(`${f} => ${obj.name}`);
      } catch (e) { /* not resolved */ }
    }
  }
  console.log('\n===== FONTS =====');
  console.log([...fonts].join('\n'));
}

main().catch((e) => { console.error(e); process.exit(1); });
