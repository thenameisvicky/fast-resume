const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'extension', 'fonts');

const FACES = [
  { family: 'LMRoman10', file: 'lmroman10-regular.otf', weight: 400, style: 'normal' },
  { family: 'LMRoman10', file: 'lmroman10-bold.otf', weight: 700, style: 'normal' },
  { family: 'LMRoman10', file: 'lmroman10-italic.otf', weight: 400, style: 'italic' },
  { family: 'LMRoman12', file: 'lmroman12-bold.otf', weight: 700, style: 'normal' },
];

const cache = {};

function dataUri(file) {
  if (!cache[file]) {
    const b64 = fs.readFileSync(path.join(DIR, file)).toString('base64');
    cache[file] = `data:font/otf;base64,${b64}`;
  }
  return cache[file];
}

// base === 'data' inlines the fonts so the HTML is self-contained (needed for
// headless printing and for injecting into an arbitrary page). Otherwise base
// is a URL prefix, e.g. chrome.runtime.getURL('fonts').
function fontFaceCss(base) {
  return FACES.map((f) => {
    const src = base === 'data'
      ? `url('${dataUri(f.file)}') format('opentype')`
      : `url('${base}/${f.file}') format('opentype')`;
    return `@font-face{font-family:'${f.family}';src:${src};`
      + `font-weight:${f.weight};font-style:${f.style};font-display:block}`;
  }).join('\n');
}

module.exports = { fontFaceCss, FACES, DIR };
