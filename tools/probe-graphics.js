const fs = require('fs');
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
const OPS = pdfjs.OPS;

async function main() {
  const data = new Uint8Array(fs.readFileSync(process.argv[2]));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
  const page = await doc.getPage(1);
  const ops = await page.getOperatorList();

  const names = {};
  for (const k of Object.keys(OPS)) names[OPS[k]] = k;

  const counts = {};
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const rects = [];
  let cur = null;

  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i];
    const name = names[fn] || fn;
    counts[name] = (counts[name] || 0) + 1;

    if (name === 'save') stack.push(ctm.slice());
    if (name === 'restore') ctm = stack.pop() || ctm;
    if (name === 'transform') ctm = args.slice();
    if (name === 'constructPath') {
      const [pathOps, pathArgs] = args;
      cur = { pathOps, pathArgs };
    }
    if ((name === 'fill' || name === 'eoFill' || name === 'stroke') && cur) {
      rects.push({ op: name, ctm: ctm.slice(), ...cur });
      cur = null;
    }
  }

  console.log('=== OP COUNTS ===');
  console.log(Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: ${v}`).join('\n'));

  console.log('\n=== PATHS (candidate rules) ===');
  for (const r of rects.slice(0, 40)) {
    const a = r.pathArgs;
    console.log(`${r.op} ops=[${r.pathOps.join(',')}] ctm=[${r.ctm.map(n => +n.toFixed(2)).join(',')}] args=[${Array.from(a).map(n => +n.toFixed(1)).join(',')}]`);
  }

  const ann = await page.getAnnotations();
  console.log('\n=== LINK ANNOTATIONS ===');
  for (const a of ann) {
    if (a.url) console.log(`${a.url}  rect=[${a.rect.map(n => +n.toFixed(1)).join(',')}]`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
