// Rasterise the original PDF (via pdf.js) and the HTML render side by side so
// the format match can be eyeballed, not just measured.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SCRATCH = process.env.JW_SCRATCH || '/tmp';
const ROOT = path.join(__dirname, '..');

function shot(html, out, w, h) {
  const f = path.join(SCRATCH, 'shot.html');
  fs.writeFileSync(f, html);
  execFileSync('google-chrome', [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    '--allow-file-access-from-files', '--hide-scrollbars',
    '--force-device-scale-factor=2',
    `--window-size=${w},${h}`, '--virtual-time-budget=15000',
    `--screenshot=${out}`, `file://${f}`,
  ], { stdio: 'ignore' });
}

const A4_W = 794;
const A4_H = 1123;

// 1. original PDF -> canvas
const pdfjsLib = path.join(ROOT, 'node_modules/pdfjs-dist/legacy/build/pdf.js');
const worker = path.join(ROOT, 'node_modules/pdfjs-dist/legacy/build/pdf.worker.js');
const src = process.argv[2];
const b64 = fs.readFileSync(src).toString('base64');

shot(`<!doctype html><meta charset=utf-8>
<style>html,body{margin:0;background:#fff}canvas{display:block;width:${A4_W}px;height:${A4_H}px}</style>
<canvas id=c></canvas>
<script src="file://${pdfjsLib}"></script>
<script>
pdfjsLib.GlobalWorkerOptions.workerSrc = 'file://${worker}';
(async()=>{
  const b64 = '${b64}';
  const bin = atob(b64); const buf = new Uint8Array(bin.length);
  for (let i=0;i<bin.length;i++) buf[i]=bin.charCodeAt(i);
  const doc = await pdfjsLib.getDocument({data:buf}).promise;
  const page = await doc.getPage(1);
  const vp = page.getViewport({scale: ${A4_W} / 595.276 * 2});
  const c = document.getElementById('c');
  c.width = vp.width; c.height = vp.height;
  await page.render({canvasContext:c.getContext('2d'), viewport:vp}).promise;
  document.title = 'done';
})();
</script>`, path.join(SCRATCH, 'orig.png'), A4_W, A4_H);

// 2. our HTML render
const html = fs.readFileSync(path.join(SCRATCH, 'preview.html'), 'utf8')
  .replace('<body>', '<body style="margin:0">');
shot(html, path.join(SCRATCH, 'mine.png'), A4_W, A4_H);

console.log('wrote orig.png and mine.png to', SCRATCH);
