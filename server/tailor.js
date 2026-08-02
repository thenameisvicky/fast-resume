const { chatJson } = require('./ollama.js');
const { verifyRun, buildVocab, unattested } = require('./verify.js');

const RULES = `HARD RULES — these override everything else:
- You may ONLY restate facts that appear in the SOURCE text you are given.
- You may re-order, re-weight, drop, and re-word.
- You may adopt the job description's terminology ONLY when it names the same
  thing the source already describes.
- You may NEVER add a technology, tool, employer, metric, number, duration,
  team size, or outcome that is not in the SOURCE.
- If the job wants something the source does not show, leave it out. Do not
  imply it. Omission is correct; invention is a failure.
- Keep each rewritten bullet within ~10% of the original length.`;

async function readJd(jdText, llmOpts) {
  const out = await chatJson([
    { role: 'system', content: 'You extract structured data from job descriptions. Reply with JSON only.' },
    {
      role: 'user',
      content: `Extract from this job posting.

Return JSON:
{"title": string, "company": string|null, "seniority": string|null,
 "must_have": [string],   // concrete requirements, max 12, short noun phrases
 "nice_to_have": [string],
 "keywords": [string]}    // technologies/skills named, max 25, as written

JOB POSTING:
${jdText.slice(0, 9000)}`,
    },
  ], llmOpts);
  return {
    title: out.title || null,
    company: out.company || null,
    seniority: out.seniority || null,
    mustHave: out.must_have || [],
    niceToHave: out.nice_to_have || [],
    keywords: out.keywords || [],
  };
}

async function tailorSummary(facts, jd, llmOpts) {
  if (!facts.summary) return null;
  const out = await chatJson([
    { role: 'system', content: `You re-angle an existing resume summary toward a job. ${RULES}` },
    {
      role: 'user',
      content: `SOURCE SUMMARY (the only facts you may use):
${facts.summary.text}

TARGET ROLE: ${jd.title || 'unknown'}
WHAT THEY WANT: ${[...jd.mustHave, ...jd.keywords].join(', ')}

Rewrite the summary so the parts relevant to this role come first and use their
words where they already match. Same length. Return JSON: {"text": string}`,
    },
  ], llmOpts);
  return { id: facts.summary.id, text: String(out.text || facts.summary.text).trim() };
}

async function tailorBullets(label, bullets, jd, llmOpts) {
  if (!bullets || !bullets.length) return [];
  const src = bullets.map((b) => `${b.id}: ${b.text}`).join('\n');
  const out = await chatJson([
    { role: 'system', content: `You re-angle existing resume bullets toward a job. ${RULES}` },
    {
      role: 'user',
      content: `SOURCE BULLETS for "${label}" — each line is "id: text".
${src}

TARGET ROLE: ${jd.title || 'unknown'}
WHAT THEY WANT: ${[...jd.mustHave, ...jd.keywords].join(', ')}

Rewrite each bullet to lead with what this employer cares about. Return every
bullet exactly once. You may change their order. Each output object MUST carry
"from" = the id of the source bullet it was derived from.

Return JSON: {"bullets": [{"from": "<source id>", "text": "<rewritten>"}]}`,
    },
  ], llmOpts);
  const byId = new Map(bullets.map((b) => [b.id, b]));
  const seen = new Set();
  const result = [];
  for (const b of out.bullets || []) {
    const src0 = byId.get(b.from);
    if (!src0 || seen.has(b.from)) continue;
    seen.add(b.from);
    result.push({ id: src0.id, from: b.from, text: String(b.text || src0.text).trim() });
  }
  // Anything the model dropped stays, unchanged. Silent loss is worse than noise.
  for (const b of bullets) {
    if (!seen.has(b.id)) result.push({ id: b.id, from: b.id, text: b.text });
  }
  return result;
}

async function orderSkills(facts, jd, llmOpts) {
  const groups = facts.skills || [];
  if (!groups.length) return [];
  const payload = groups.map((g) => `${g.id} | ${g.label}: ${(g.items || []).join(', ')}`).join('\n');
  const out = await chatJson([
    { role: 'system', content: 'You re-order existing resume skills. You never add skills. Reply JSON only.' },
    {
      role: 'user',
      content: `SKILL GROUPS (id | label: items):
${payload}

TARGET ROLE: ${jd.title || 'unknown'}
WHAT THEY WANT: ${[...jd.mustHave, ...jd.keywords].join(', ')}

Within each group, re-order the items so the ones this job asks for come first.
Do NOT add, rename, or remove any item. Return every group.

Return JSON: {"groups": [{"id": string, "items": [string]}]}`,
    },
  ], llmOpts);
  const byId = new Map(groups.map((g) => [g.id, g]));
  const result = [];
  for (const g of out.groups || []) {
    const src = byId.get(g.id);
    if (!src) continue;
    result.push({ id: src.id, label: src.label, items: g.items || src.items });
  }
  for (const g of groups) if (!result.find((r) => r.id === g.id)) result.push(g);
  return result;
}

function findGaps(facts, jd) {
  const vocab = buildVocab(facts);
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9+#.]/g, '');
  const gaps = [];
  for (const kw of [...new Set([...jd.mustHave, ...jd.keywords])]) {
    const parts = String(kw).split(/[\s,/]+/).filter(Boolean);
    const hit = parts.some((p) => vocab.has(norm(p)));
    if (!hit) gaps.push(kw);
  }
  return gaps;
}

// Yields progress events so the modal can fill in section by section instead of
// blocking on the whole run.
//
// Every section depends only on the parsed JD, never on another section, so
// after the JD is read they all run concurrently. On a CPU-only laptop this is
// the difference between one slow round and seven.
async function* tailorStream(facts, jdText, llmOpts) {
  yield { type: 'status', stage: 'reading-jd' };
  const jd = await readJd(jdText, llmOpts);
  yield { type: 'jd', jd };

  const run = {
    name: facts.name,
    contacts: facts.contacts,
    summary: null,
    experience: [],
    projects: [],
    skills: [],
    education: facts.education,
    experienceTitle: facts.experienceTitle,
    projectsTitle: facts.projectsTitle,
    skillsTitle: facts.skillsTitle,
    educationTitle: facts.educationTitle,
    layout: facts.layout,
  };

  const experience = (facts.experience || []).map((e) => ({ ...e }));
  const projects = (facts.projects || []).map((p) => ({ ...p }));

  const tasks = [
    { key: 'summary', label: 'summary', run: () => tailorSummary(facts, jd, llmOpts) },
    { key: 'skills', label: 'skills', run: () => orderSkills(facts, jd, llmOpts) },
    ...experience.map((e, i) => ({
      key: 'experience', label: e.org, index: i,
      run: () => tailorBullets(`${e.role} at ${e.org}`, e.bullets, jd, llmOpts),
    })),
    ...projects.map((p, i) => ({
      key: 'projects', label: p.name, index: i,
      run: () => tailorBullets(`${p.name} (${p.stack})`, p.bullets, jd, llmOpts),
    })),
  ];

  run.experience = experience;
  run.projects = projects;

  let done = 0;
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    yield {
      type: 'status',
      stage: `tailoring section "${task.label}" (${i + 1}/${tasks.length})`,
      done,
      total: tasks.length
    };

    let value, error;
    try {
      value = await task.run();
    } catch (e) {
      error = e;
    }

    done++;
    if (error) {
      yield { type: 'warn', section: task.label, error: error.message };
    } else if (task.key === 'summary') {
      run.summary = value;
    } else if (task.key === 'skills') {
      run.skills = value;
    } else if (task.key === 'experience') {
      experience[task.index].bullets = value;
    } else if (task.key === 'projects') {
      projects[task.index].bullets = value;
    }
    yield {
      type: 'section', key: task.key, label: task.label,
      done, total: tasks.length,
      value: task.key === 'summary' ? run.summary
        : task.key === 'skills' ? run.skills
          : task.key === 'experience' ? run.experience : run.projects,
    };
  }

  if (!run.summary && facts.summary) run.summary = { id: facts.summary.id, text: facts.summary.text };
  if (!run.skills.length) run.skills = facts.skills || [];

  yield { type: 'status', stage: 'verifying' };
  verifyRun(run, facts);
  run.gaps = findGaps(facts, jd);
  run.jd = jd;

  yield { type: 'done', run };
}

module.exports = { tailorStream, readJd, findGaps, tailorBullets, tailorSummary, orderSkills };
