// Tailoring may reorder, re-weight, drop and re-phrase what is already in
// facts.json. It may never introduce a technology, employer, metric or claim
// that is not attested there. These checks enforce that mechanically, so the
// guarantee does not rest on the model following instructions.

// Capitalised words that legitimately start sentences / connect clauses and so
// must not be treated as unattested proper nouns.
const COMMON = new Set(`a an the and or but of for to in on with within across using
built develop developed developing design designed implement implemented integrate
integrated create created led lead work worked ship shipped drove drive own owned
maintained maintain improved improve reduced reduce increased increase delivered
deliver enabled enable support supported migrated migrate refactored refactor
automated automate optimised optimized optimise optimize scaled scale wrote write
added add set up build building engineered engineer architected architect
production system systems service services pipeline pipelines feature features
platform api apis backend frontend full stack data database quality reliability
performance latency throughput team teams user users customer customers business
end to end real time based driven first class high low new existing multiple
various several this that these those it its their there they we i my our
experienced experience skills tools technologies including such as well also
while when where which who whom whose what how why if then than so because
is are was were be been being has have had do does did will would can could
may might must shall should not no yes all any some most many few more less
over under between during before after above below up down out off again
further once here both each other same own too very just only own`.split(/\s+/));

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9+#.]/g, '');

function collectText(facts) {
  const out = [];
  if (facts.name) out.push(facts.name);
  for (const c of facts.contacts || []) out.push(c.label);
  if (facts.summary) out.push(facts.summary.text);
  for (const e of facts.experience || []) {
    out.push(e.org, e.role, e.dates, e.location);
    for (const b of e.bullets || []) out.push(b.text);
  }
  for (const p of facts.projects || []) {
    out.push(p.name, p.stack);
    for (const b of p.bullets || []) out.push(b.text);
  }
  for (const s of facts.skills || []) {
    out.push(s.label);
    for (const i of s.items || []) out.push(i);
  }
  for (const e of facts.education || []) out.push(e.school, e.degree, e.dates, e.location);
  return out.filter(Boolean);
}

function buildVocab(facts) {
  const vocab = new Set();
  for (const text of collectText(facts)) {
    for (const tok of String(text).split(/[\s,;:()/|]+/)) {
      const n = norm(tok);
      if (n) vocab.add(n);
      // "SFTP-to-Azure" and "rule-based" also attest their parts.
      for (const part of tok.split(/[-–—]/)) {
        const p = norm(part);
        if (p) vocab.add(p);
      }
    }
  }
  return vocab;
}

// Tokens worth checking: proper nouns, acronyms, camelCase, versions, numbers.
function checkableTokens(text) {
  const out = [];
  const words = String(text).split(/[\s,;:()/|]+/);
  for (let i = 0; i < words.length; i++) {
    const raw = words[i].replace(/[.]$/, '');
    if (!raw) continue;
    for (const piece of raw.split(/[-–—]/)) {
      if (!piece) continue;
      const bare = piece.replace(/[^A-Za-z0-9+#.%]/g, '');
      if (!bare) continue;
      const isNumeric = /\d/.test(bare);
      const isAcronym = /^[A-Z0-9+#.]{2,}$/.test(bare);
      const isCamel = /^[a-z]+[A-Z]/.test(bare) || /[a-z][A-Z]/.test(bare);
      const isProper = /^[A-Z]/.test(bare);
      if (!(isNumeric || isAcronym || isCamel || isProper)) continue;
      if (!isNumeric && COMMON.has(bare.toLowerCase())) continue;
      out.push(bare);
    }
  }
  return out;
}

function unattested(text, vocab) {
  const bad = [];
  for (const tok of checkableTokens(text)) {
    if (!vocab.has(norm(tok))) bad.push(tok);
  }
  return [...new Set(bad)];
}

function indexSources(facts) {
  const byId = new Map();
  if (facts.summary) byId.set(facts.summary.id, facts.summary.text);
  for (const e of facts.experience || []) {
    for (const b of e.bullets || []) byId.set(b.id, b.text);
  }
  for (const p of facts.projects || []) {
    for (const b of p.bullets || []) byId.set(b.id, b.text);
  }
  for (const s of facts.skills || []) byId.set(s.id, (s.items || []).join(', '));
  return byId;
}

// A rewritten bullet must still be a rewrite. If it shares almost no content
// words with its cited source, the citation is decorative and we reject it.
function overlapRatio(a, b) {
  const setA = new Set(String(a).toLowerCase().split(/\W+/).filter((w) => w.length > 3 && !COMMON.has(w)));
  const setB = new Set(String(b).toLowerCase().split(/\W+/).filter((w) => w.length > 3 && !COMMON.has(w)));
  if (!setA.size) return 0;
  let hit = 0;
  for (const w of setA) if (setB.has(w)) hit++;
  return hit / setA.size;
}

const MIN_OVERLAP = 0.34;

function checkBullet(out, facts, vocab, sources) {
  const issues = [];
  if (out.id && sources.has(out.id) && out.text === sources.get(out.id)) {
    return [];
  }
  const src = out.from ? sources.get(out.from) : null;
  if (!out.from) {
    issues.push({ level: 'reject', kind: 'no-citation', detail: 'bullet cites no source fact' });
  } else if (!src) {
    issues.push({ level: 'reject', kind: 'bad-citation', detail: `unknown source id ${out.from}` });
  } else {
    const ov = overlapRatio(out.text, src);
    if (ov < MIN_OVERLAP) {
      issues.push({
        level: 'reject',
        kind: 'weak-citation',
        detail: `only ${Math.round(ov * 100)}% content overlap with ${out.from}`,
        source: src,
      });
    }
  }
  const bad = unattested(out.text, vocab);
  if (bad.length) {
    issues.push({
      level: 'flag',
      kind: 'unattested',
      detail: `not found anywhere in your resume: ${bad.join(', ')}`,
      tokens: bad,
    });
  }
  return issues;
}

// Rejected items are dropped and the original is restored; flagged items are
// kept but marked red in the modal for a human decision.
function verifyRun(run, facts) {
  const vocab = buildVocab(facts);
  const sources = indexSources(facts);
  const report = { rejected: [], flagged: [], checked: 0 };

  const scrub = (list, restoreFrom) => (list || []).map((b) => {
    report.checked++;
    const issues = checkBullet(b, facts, vocab, sources);
    const fatal = issues.filter((i) => i.level === 'reject');
    const flags = issues.filter((i) => i.level === 'flag');
    if (fatal.length) {
      const original = sources.get(b.from) || sources.get(b.id) || restoreFrom(b);
      report.rejected.push({ id: b.id, text: b.text, issues: fatal, restored: original });
      return original ? { ...b, text: original, reverted: true } : null;
    }
    if (flags.length) {
      report.flagged.push({ id: b.id, text: b.text, issues: flags });
      return { ...b, flags: flags.map((f) => f.tokens).flat().filter(Boolean) };
    }
    return b;
  }).filter(Boolean);

  if (run.summary) {
    const s = run.summary;
    report.checked++;
    const bad = unattested(s.text, vocab);
    const srcText = facts.summary ? facts.summary.text : '';
    const ov = overlapRatio(s.text, srcText);
    if (ov < 0.25) {
      report.rejected.push({ id: 'summary', text: s.text, issues: [{ kind: 'weak-citation', detail: 'summary drifted from your own summary' }], restored: srcText });
      run.summary = { ...s, text: srcText, reverted: true };
    } else if (bad.length) {
      report.flagged.push({ id: 'summary', text: s.text, issues: [{ kind: 'unattested', detail: bad.join(', '), tokens: bad }] });
      run.summary = { ...s, flags: bad };
    }
  }

  for (const e of run.experience || []) e.bullets = scrub(e.bullets, () => null);
  for (const p of run.projects || []) p.bullets = scrub(p.bullets, () => null);

  // Skills may only ever be a re-ordering / subset of the master list.
  const masterSkills = new Map();
  for (const s of facts.skills || []) masterSkills.set(s.label, new Set((s.items || []).map(norm)));
  for (const s of run.skills || []) {
    const allowed = masterSkills.get(s.label);
    if (!allowed) { s.items = []; continue; }
    const kept = [];
    for (const item of s.items || []) {
      if (allowed.has(norm(item))) kept.push(item);
      else report.rejected.push({ id: s.id, text: item, issues: [{ kind: 'invented-skill', detail: `"${item}" is not in your skills` }] });
    }
    s.items = kept;
  }

  run.verification = report;
  return run;
}

module.exports = { verifyRun, buildVocab, unattested, checkableTokens, overlapRatio, collectText };
