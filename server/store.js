const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'data');
const RUNS = path.join(DATA, 'runs');
const FACTS = path.join(DATA, 'facts.json');

function ensure() {
  fs.mkdirSync(RUNS, { recursive: true });
}

function readFacts() {
  if (!fs.existsSync(FACTS)) return null;
  return JSON.parse(fs.readFileSync(FACTS, 'utf8'));
}

function writeFacts(facts) {
  ensure();
  fs.writeFileSync(FACTS, JSON.stringify(facts, null, 2));
  return facts;
}

function runPath(id) {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('bad run id');
  return path.join(RUNS, `${id}.json`);
}

function readRun(id) {
  const p = runPath(id);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeRun(id, run) {
  ensure();
  fs.writeFileSync(runPath(id), JSON.stringify(run, null, 2));
  return run;
}

function listRuns() {
  ensure();
  return fs.readdirSync(RUNS)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const run = JSON.parse(fs.readFileSync(path.join(RUNS, f), 'utf8'));
      return {
        id: f.replace(/\.json$/, ''),
        title: run.jd && run.jd.title,
        company: run.jd && run.jd.company,
        url: run.sourceUrl,
        at: run.createdAt,
      };
    })
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

// Counter-based so it stays sortable and never collides within a second.
function newRunId(now) {
  const stamp = new Date(now).toISOString().replace(/[-:T.]/g, '').slice(0, 15);
  let id = stamp;
  let n = 1;
  while (fs.existsSync(runPath(id))) id = `${stamp}-${++n}`;
  return id;
}

module.exports = { readFacts, writeFacts, readRun, writeRun, listRuns, newRunId, DATA, RUNS, FACTS, ensure };
