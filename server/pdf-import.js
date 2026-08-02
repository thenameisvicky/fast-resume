const fs = require('fs');
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');

const LINE_TOL = 2.5;
const RUN_GAP = 3.2;
const RIGHT_EDGE_TOL = 3;

function fontStyle(name, size, fontMap) {
  const real = fontMap[name] || '';
  return {
    bold: /Bold|CMBX|SFBX|CMB|CMCSC/i.test(real),
    italic: /Italic|Oblique|CMSL|SL/i.test(real),
    size,
  };
}

async function readItems(file) {
  const data = new Uint8Array(fs.readFileSync(file));
  // verbosity 0 = errors only; pdfjs otherwise warns about canvas polyfills it
  // does not need here (we read text, never rasterise) straight onto stdout.
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true, verbosity: 0 }).promise;
  const pages = [];
  const fontMap = {};
  const links = [];

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();

    // commonObjs only carries real font names once the operator list is built.
    await page.getOperatorList();

    for (const it of content.items) {
      if (!it.fontName || fontMap[it.fontName]) continue;
      try {
        const obj = page.commonObjs.get(it.fontName);
        if (obj && obj.name) fontMap[it.fontName] = obj.name;
      } catch (e) { /* font not yet resolved */ }
    }

    for (const a of await page.getAnnotations()) {
      if (a.url) links.push({ url: a.url, rect: a.rect, page: p });
    }

    const items = content.items
      .filter((i) => i.str.trim())
      .map((i) => ({
        str: i.str,
        x: i.transform[4],
        y: i.transform[5],
        w: i.width,
        size: Math.hypot(i.transform[2], i.transform[3]),
        font: i.fontName,
      }));

    pages.push({ items, width: viewport.width, height: viewport.height });
  }

  return { pages, fontMap, links };
}

function groupLines(items, fontMap) {
  const buckets = [];
  for (const it of items) {
    let b = buckets.find((k) => Math.abs(k.y - it.y) <= LINE_TOL);
    if (!b) { b = { y: it.y, items: [] }; buckets.push(b); }
    b.items.push(it);
  }
  buckets.sort((a, b) => b.y - a.y);

  return buckets.map((b) => {
    b.items.sort((a, z) => a.x - z.x);

    const runs = [];
    let cur = null;
    for (const it of b.items) {
      const st = fontStyle(it.font, it.size, fontMap);
      const gap = cur ? it.x - (cur.x + cur.w) : 0;
      const sameStyle = cur && cur.bold === st.bold && cur.italic === st.italic
        && Math.abs(cur.size - st.size) < 0.4;
      if (cur && sameStyle && gap < RUN_GAP) {
        cur.text += it.str;
        cur.w = it.x + it.w - cur.x;
      } else {
        cur = { text: it.str, x: it.x, w: it.w, ...st };
        runs.push(cur);
      }
    }
    for (const r of runs) r.end = r.x + r.w;

    return {
      y: b.y,
      x: b.items[0].x,
      runs,
      text: runs.map((r) => r.text).join(''),
      maxSize: Math.max(...runs.map((r) => r.size)),
      allBold: runs.every((r) => r.bold),
    };
  });
}

// LaTeX right-aligns dates/locations to the text-block edge. Split the line
// into left/right at the largest inter-run gap, but only when a run actually
// lands on the right margin.
function splitAligned(line, rightEdge) {
  const runs = line.runs;
  if (runs.length < 2) return { left: line.text.trim(), right: '' };
  const last = runs[runs.length - 1];
  if (Math.abs(last.end - rightEdge) > RIGHT_EDGE_TOL) {
    return { left: line.text.trim(), right: '' };
  }

  let splitAt = runs.length - 1;
  let best = -1;
  for (let i = 1; i < runs.length; i++) {
    const gap = runs[i].x - runs[i - 1].end;
    if (gap >= best) { best = gap; splitAt = i; }
  }
  return {
    left: runs.slice(0, splitAt).map((r) => r.text).join('').trim(),
    right: runs.slice(splitAt).map((r) => r.text).join('').trim(),
  };
}

const DICT = (() => {
  for (const p of ['/usr/share/dict/words', '/usr/share/dict/american-english']) {
    try {
      return new Set(fs.readFileSync(p, 'utf8').toLowerCase().split('\n'));
    } catch (e) { /* absent */ }
  }
  return null;
})();

// LaTeX hyphenation is visually identical to a real hyphen. "con-/tainerized"
// must lose its hyphen; "write-/confirmation" must keep it. Resolve what we
// can, flag the rest for review in setup rather than guessing silently.
function joinHyphen(prev, next) {
  const stem = prev.slice(0, -1);
  const tailWord = next.split(/\s/)[0];
  const merged = (stem.match(/[A-Za-z]+$/) || [''])[0] + tailWord;
  if (DICT) {
    if (DICT.has(merged.toLowerCase())) return { text: stem + next, ambiguous: false };
    return { text: prev + next, ambiguous: false };
  }
  return { text: stem + next, ambiguous: true, alt: prev + next };
}

function joinWrapped(parts) {
  let text = '';
  const flags = [];
  for (const part of parts) {
    if (!text) { text = part; continue; }
    if (/[A-Za-z]-$/.test(text)) {
      const r = joinHyphen(text, part);
      text = r.text;
      if (r.ambiguous) flags.push({ resolved: r.text, alternative: r.alt });
    } else {
      text += ' ' + part;
    }
  }
  return { text: text.replace(/\s+/g, ' ').trim(), flags };
}

function parse(lines, rightEdge, links) {
  const nameLine = lines[0];
  const name = nameLine.text.trim();

  const contactLine = lines[1];
  const contactParts = contactLine.text.split('|').map((s) => s.trim()).filter(Boolean);
  const contacts = contactParts.map((label) => {
    const slug = label.replace(/[^A-Za-z]/g, '');
    const link = links.find((l) => {
      if (/^mailto:/.test(l.url)) return l.url.slice(7) === label;
      if (slug.length < 3) return false;
      return new RegExp(slug, 'i').test(l.url.replace(/[^A-Za-z]/g, ''));
    });
    return { label, url: link ? link.url : null };
  });

  const headerSize = nameLine.maxSize;
  const sections = [];
  let cur = null;
  for (const line of lines.slice(2)) {
    const isHeader = line.allBold && line.maxSize > 11.5 && line.maxSize < headerSize
      && line.runs.length === 1;
    if (isHeader) {
      cur = { title: line.text.trim(), lines: [] };
      sections.push(cur);
    } else if (cur) {
      cur.lines.push(line);
    }
  }

  let bid = 0;
  const nextId = (p) => `${p}-${++bid}`;
  const warnings = [];

  const readBullets = (chunk) => {
    const bullets = [];
    let acc = null;
    for (const line of chunk) {
      const t = line.text.trim();
      if (t.startsWith('•')) {
        if (acc) bullets.push(acc);
        acc = [t.replace(/^•\s*/, '')];
      } else if (acc) {
        acc.push(t);
      }
    }
    if (acc) bullets.push(acc);
    return bullets.map((parts) => {
      const { text, flags } = joinWrapped(parts);
      for (const f of flags) warnings.push({ type: 'hyphen', ...f });
      return { id: nextId('b'), text };
    });
  };

  const out = { name, contacts, summary: null, experience: [], projects: [], skills: [], education: [] };

  for (const sec of sections) {
    const key = sec.title.toLowerCase();
    const chunk = sec.lines;

    if (/summary|objective|profile/.test(key)) {
      const { text, flags } = joinWrapped(chunk.map((l) => l.text.trim()));
      for (const f of flags) warnings.push({ type: 'hyphen', ...f });
      out.summary = { id: nextId('s'), text, sectionTitle: sec.title };
      continue;
    }

    if (/experience|employment/.test(key)) {
      const entries = [];
      let i = 0;
      while (i < chunk.length) {
        const line = chunk[i];
        if (line.text.trim().startsWith('•') || !line.runs.some((r) => r.bold)) { i++; continue; }
        const a = splitAligned(line, rightEdge);
        const roleLine = chunk[i + 1];
        const isNewEntry = roleLine && !roleLine.text.trim().startsWith('•')
          && roleLine.runs.some((r) => r.bold) && Math.abs(roleLine.x - line.x) < 2;
        const hasRoleLine = roleLine && !roleLine.text.trim().startsWith('•') && !isNewEntry;
        const b = hasRoleLine ? splitAligned(roleLine, rightEdge) : { left: '', right: '' };
        let j = hasRoleLine ? i + 2 : i + 1;
        const body = [];
        while (j < chunk.length) {
          const nxt = chunk[j];
          const startsEntry = !nxt.text.trim().startsWith('•')
            && nxt.runs.some((r) => r.bold) && Math.abs(nxt.x - line.x) < 2;
          if (startsEntry) break;
          body.push(nxt); j++;
        }
        entries.push({
          id: nextId('e'),
          org: a.left, dates: a.right,
          role: b.left, location: b.right,
          bullets: readBullets(body),
        });
        i = j;
      }
      out.experience = entries;
      out.experienceTitle = sec.title;
      continue;
    }

    if (/project/.test(key)) {
      const entries = [];
      if (chunk[0] && chunk[0].text.trim().startsWith('•')) {
        entries.push({
          id: nextId('p'),
          name: '',
          stack: '',
          bullets: readBullets(chunk),
        });
      } else {
        let i = 0;
        while (i < chunk.length) {
          const line = chunk[i];
          if (line.text.trim().startsWith('•')) { i++; continue; }
          const boldRuns = line.runs.filter((r) => r.bold && !r.italic);
          const italRuns = line.runs.filter((r) => r.italic);
          let j = i + 1;
          const body = [];
          while (j < chunk.length && chunk[j].text.trim().startsWith('•')
            || (j < chunk.length && !chunk[j].runs.some((r) => r.bold) && body.length)) {
            body.push(chunk[j]); j++;
          }
          entries.push({
            id: nextId('p'),
            name: boldRuns.map((r) => r.text).join('').trim(),
            stack: italRuns.map((r) => r.text).join('').trim(),
            bullets: readBullets(body),
          });
          i = j;
        }
      }
      out.projects = entries;
      out.projectsTitle = sec.title;
      continue;
    }

    if (/skill|technolog/.test(key)) {
      const groups = [];
      let acc = null;
      for (const line of chunk) {
        const lead = line.runs[0];
        if (lead && lead.bold && (/:/.test(lead.text) || line.runs.length > 1)) {
          if (acc) groups.push(acc);
          acc = {
            label: lead.text.replace(/:\s*$/, '').trim(),
            parts: [line.runs.slice(1).map((r) => r.text).join('').trim()],
          };
        } else if (acc) {
          acc.parts.push(line.text.trim());
        }
      }
      if (acc) groups.push(acc);
      out.skills = groups.map((g) => {
        const { text, flags } = joinWrapped(g.parts);
        for (const f of flags) warnings.push({ type: 'hyphen', ...f });
        return {
          id: nextId('k'),
          label: g.label,
          items: text.split(',').map((s) => s.trim()).filter(Boolean),
        };
      });
      out.skillsTitle = sec.title;
      continue;
    }

    if (/education/.test(key)) {
      const entries = [];
      let i = 0;
      while (i < chunk.length) {
        const a = splitAligned(chunk[i], rightEdge);
        const nextLine = chunk[i + 1];
        const isTwoLine = nextLine && !/^\d{4}/.test(nextLine.text.trim()) && !nextLine.runs.some(r => r.bold && /20\d\d/.test(r.text));
        if (isTwoLine) {
          const b = splitAligned(nextLine, rightEdge);
          entries.push({
            id: nextId('d'),
            school: a.left, dates: a.right,
            degree: b.left, location: b.right,
          });
          i += 2;
        } else {
          entries.push({
            id: nextId('d'),
            school: a.left, dates: a.right,
            degree: '', location: '',
          });
          i += 1;
        }
      }
      out.education = entries;
      out.educationTitle = sec.title;
    }
  }

  out.warnings = warnings;
  return out;
}

async function importPdf(file) {
  console.log(`[Import] Starting PDF parsing of file: ${file}`);
  const { pages, fontMap, links } = await readItems(file);
  console.log(`[Import] Read ${pages.length} page(s) and resolved ${Object.keys(fontMap).length} font(s).`);
  const page = pages[0];
  const all = pages.flatMap((p) => p.items);
  console.log(`[Import] Grouping ${all.length} text items into lines...`);
  const lines = groupLines(all, fontMap);
  console.log(`[Import] Grouped into ${lines.length} lines. Extracting edges...`);

  const rightEdge = Math.max(...lines.flatMap((l) => l.runs.map((r) => r.end)));
  const bodyLines = lines.filter((l) => !l.text.trim().startsWith('•'));
  const leftEdge = Math.min(...bodyLines.map((l) => l.x));

  console.log(`[Import] Parsing lines into facts JSON structure...`);
  const facts = parse(lines, rightEdge, links);
  facts.layout = {
    pageWidth: page.width,
    pageHeight: page.height,
    marginLeft: +leftEdge.toFixed(2),
    contentWidth: +(rightEdge - leftEdge).toFixed(2),
  };
  console.log(`[Import] Successfully parsed facts for: "${facts.name}". Warnings count: ${facts.warnings.length}`);
  return facts;
}

module.exports = { importPdf, groupLines, readItems };

if (require.main === module) {
  importPdf(process.argv[2])
    .then((f) => console.log(JSON.stringify(f, null, 2)))
    .catch((e) => { console.error(e); process.exit(1); });
}
