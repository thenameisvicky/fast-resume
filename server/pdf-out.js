const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { execFileSync } = require('child_process');

const CANDIDATES = [
  process.env.JW_CHROME,
  'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser',
  'brave-browser', '/usr/bin/google-chrome', '/usr/bin/chromium',
].filter(Boolean);

let cached = null;

function findChrome() {
  if (cached) return cached;
  for (const c of CANDIDATES) {
    try {
      execFileSync('which', [c], { stdio: 'ignore' });
      cached = c;
      return c;
    } catch (e) { /* next */ }
  }
  throw new Error('no Chrome/Chromium found; set JW_CHROME');
}

// The modal can already print via the browser, but a one-click Download that
// never opens a print dialog is the whole point, so render server-side too.
function htmlToPdf(html) {
  return new Promise((resolve, reject) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobwire-'));
    const htmlFile = path.join(dir, 'resume.html');
    const pdfFile = path.join(dir, 'resume.pdf');
    fs.writeFileSync(htmlFile, html);

    const args = [
      '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
      '--no-pdf-header-footer', '--virtual-time-budget=12000',
      `--print-to-pdf=${pdfFile}`, `file://${htmlFile}`,
    ];

    execFile(findChrome(), args, { timeout: 60000 }, (err) => {
      try {
        if (!fs.existsSync(pdfFile)) {
          reject(err || new Error('chrome produced no pdf'));
          return;
        }
        resolve(fs.readFileSync(pdfFile));
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });
}

module.exports = { htmlToPdf, findChrome };
