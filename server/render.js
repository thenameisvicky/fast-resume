// Geometry measured from the source PDF (Vigneshwaran_AIEngineer.pdf).
// Page A4 595.276x841.89pt, text block x=37.44 w=520.4 (section rule width).
const M = {
  pageW: 595.276,
  pageH: 841.89,
  marginX: 37.44,
  contentW: 520.4,
  marginTop: 36,
  nameSize: 17.2,
  bodySize: 10.9,
  headSize: 12,
  leading: 13.6,
  bulletIndent: 12.26,
  bulletHang: -1.44,

  // Vertical spacing, fitted against the original's baseline chain by
  // tools/verify-render.js. Each value is one gap in that chain.
  contactGap: -1.0,     // name baseline -> contact baseline
  secGap: 5.2,          // last body line -> next section heading
  firstSecGap: 10.8,    // contact line -> first section heading
  ruleTop: 1.2,         // heading -> rule
  ruleBottom: 4.4,      // rule -> first line of section body
  firstEntryGap: 3.5,   // section body start -> first entry
  entryGap: 2.0,        // entry -> entry
  bulletsGap: 5.1,      // role line -> first bullet
  projBulletsGap: 11.2, // project heading -> first bullet (wider in the source)
  bulletGap: 1.0,       // bullet -> bullet
  skillFirstGap: -0.3,  // rule -> first skill row
  sepGap: 6.7,          // space each side of the '|' in the contact line
};

const { fontFaceCss } = require('./fonts.js');
const { fitScript } = require('./fit.js');

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function css(fontBase) {
  return `
${fontFaceCss(fontBase)}

*{margin:0;padding:0;box-sizing:border-box}
@page{size:${M.pageW}pt ${M.pageH}pt;margin:0}
html,body{background:#fff}
.page{
  width:${M.pageW}pt;min-height:${M.pageH}pt;
  padding:${M.marginTop}pt ${M.marginX}pt;
  background:#fff;color:#000;
  font-family:'LMRoman10',serif;
  font-size:${M.bodySize}pt;
  line-height:${M.leading}pt;
  text-align:justify;
  -webkit-font-smoothing:antialiased;
}
.name{font-family:'LMRoman12',serif;font-size:${M.nameSize}pt;font-weight:700;text-align:center;line-height:${M.nameSize * 1.05}pt}
.contact{text-align:center;margin-top:${M.contactGap}pt}
.contact a{color:#000;text-decoration:none}
.contact .sep{margin:0 ${M.sepGap}pt}

.sec{margin-top:${M.secGap}pt}
.sec:first-of-type{margin-top:${M.firstSecGap}pt}
.sec > h2{
  font-family:'LMRoman12',serif;
  font-size:${M.headSize}pt;font-weight:700;text-align:left;
  line-height:${M.headSize * 1.15}pt;
}
.rule{border-bottom:0.4pt solid #000;margin-top:${M.ruleTop}pt;margin-bottom:${M.ruleBottom}pt}

.summary{margin-top:0}
.entry{margin-top:${M.entryGap}pt}
.rule + .entry{margin-top:${M.firstEntryGap}pt}
.row{display:flex;justify-content:space-between;align-items:baseline;gap:10pt;text-align:left}
.row .l{font-weight:700}
.row.sub .l{font-weight:400;font-style:italic}
.row .r{font-weight:inherit;font-style:inherit;white-space:nowrap;flex:none}
.row.sub .r{font-style:italic}
.proj-head{text-align:left}
.proj-head .nm{font-weight:700}
.proj-head .st{font-style:italic;margin-left:4pt}

ul{list-style:none;margin-top:${M.bulletsGap}pt}
.proj-head + ul{margin-top:${M.projBulletsGap}pt}
li{position:relative;padding-left:${M.bulletIndent}pt;margin-top:${M.bulletGap}pt}
li:first-child{margin-top:0}
li::before{content:'\\2022';position:absolute;left:${M.bulletHang}pt;top:0}

.skill{margin-top:0}
.rule + .skill{margin-top:${M.skillFirstGap}pt}
.skill .lb{font-weight:700}

[contenteditable]:focus{outline:1.5pt solid #2563eb;outline-offset:1pt;background:#eff6ff}
.jw-flag{background:#fee2e2;box-shadow:0 0 0 1pt #ef4444}
`;
}

function ed(id, text, editable) {
  const attr = editable ? ` contenteditable="true" spellcheck="false" data-jw="${esc(id)}"` : '';
  return `<span${attr}>${esc(text)}</span>`;
}

function bullets(list, editable) {
  if (!list || !list.length) return '';
  return `<ul>${list.map((b) => `<li>${ed(b.id, b.text, editable)}</li>`).join('')}</ul>`;
}

function section(title, inner) {
  if (!inner) return '';
  return `<section class="sec"><h2>${esc(title)}</h2><div class="rule"></div>${inner}</section>`;
}

function renderBody(facts, editable) {
  const parts = [];

  parts.push(`<div class="name">${esc(facts.name)}</div>`);

  const contact = (facts.contacts || []).map((c) => (
    c.url ? `<a href="${esc(c.url)}">${esc(c.label)}</a>` : esc(c.label)
  )).join('<span class="sep">|</span>');
  parts.push(`<div class="contact">${contact}</div>`);

  if (facts.summary) {
    parts.push(section(
      facts.summary.sectionTitle || 'Summary',
      `<div class="summary">${ed(facts.summary.id, facts.summary.text, editable)}</div>`,
    ));
  }

  if (facts.experience && facts.experience.length) {
    const inner = facts.experience.map((e) => `
      <div class="entry">
        <div class="row"><span class="l">${ed(e.id + ':org', e.org, editable)}</span><span class="r">${esc(e.dates)}</span></div>
        <div class="row sub"><span class="l">${ed(e.id + ':role', e.role, editable)}</span><span class="r">${esc(e.location)}</span></div>
        ${bullets(e.bullets, editable)}
      </div>`).join('');
    parts.push(section(facts.experienceTitle || 'Experience', inner));
  }

  if (facts.projects && facts.projects.length) {
    const inner = facts.projects.map((p) => `
      <div class="entry">
        <div class="proj-head"><span class="nm">${ed(p.id + ':name', p.name, editable)}</span><span class="st">${ed(p.id + ':stack', p.stack, editable)}</span></div>
        ${bullets(p.bullets, editable)}
      </div>`).join('');
    parts.push(section(facts.projectsTitle || 'Personal Projects', inner));
  }

  if (facts.skills && facts.skills.length) {
    const inner = facts.skills.map((s) => `
      <div class="skill"><span class="lb">${esc(s.label)}:</span> ${ed(s.id, (s.items || []).join(', '), editable)}</div>
    `).join('');
    parts.push(section(facts.skillsTitle || 'Skills', inner));
  }

  if (facts.education && facts.education.length) {
    const inner = facts.education.map((e) => `
      <div class="entry">
        <div class="row"><span class="l">${esc(e.school)}</span><span class="r">${esc(e.dates)}</span></div>
        <div class="row sub"><span class="l">${esc(e.degree)}</span><span class="r">${esc(e.location)}</span></div>
      </div>`).join('');
    parts.push(section(facts.educationTitle || 'Education', inner));
  }

  return parts.join('\n');
}

function renderHtml(facts, opts = {}) {
  const fontBase = opts.fontBase || './fonts';
  const editable = !!opts.editable;
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(facts.name)}</title>
<style>${css(fontBase)}</style></head>
<body><div class="page" id="jw-page">${renderBody(facts, editable)}</div>
<script>${fitScript(M)}</script></body></html>`;
}

module.exports = { renderHtml, renderBody, css, M };

if (require.main === module) {
  const facts = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
  process.stdout.write(renderHtml(facts, { fontBase: process.argv[3] || './fonts' }));
}
