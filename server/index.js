const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const store = require('./store.js');
const { renderHtml, renderBody, css, M } = require('./render.js');
const { ladder, availableHeight } = require('./fit.js');
const { importPdf } = require('./pdf-import.js');
const { tailorStream } = require('./tailor.js');
const { verifyRun } = require('./verify.js');
const { htmlToPdf } = require('./pdf-out.js');
const ollama = require('./ollama.js');

const PORT = Number(process.env.JW_PORT || 7788);
const HOST = '127.0.0.1';
const ROOT = path.join(__dirname, '..');

// Only the extension and our own setup page may talk to this server. A page you
// are browsing cannot forge Origin, so this keeps your resume off the open web.
function originAllowed(origin) {
  if (!origin) return true;
  if (origin.startsWith('chrome-extension://')) return true;
  if (origin.startsWith('moz-extension://')) return true;
  if (/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) return true;
  return false;
}

function cors(req, res) {
  const origin = req.headers.origin;
  if (!originAllowed(origin)) return false;
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  return true;
}

const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

function readBody(req, limit = 30 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const readJson = async (req) => JSON.parse((await readBody(req)).toString('utf8') || '{}');

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.otf': 'font/otf', '.json': 'application/json' };

function serveStatic(res, file) {
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { json(res, 404, { error: 'not found' }); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

async function handle(req, res, url) {
  const p = url.pathname;

  if (p === '/health') {
    const o = await ollama.health();
    const facts = store.readFacts();
    return json(res, 200, {
      ok: true,
      ollama: o,
      hasFacts: !!facts,
      factsName: facts ? facts.name : null,
      port: PORT,
    });
  }

  if (p === '/facts' && req.method === 'GET') {
    const facts = store.readFacts();
    return facts ? json(res, 200, facts) : json(res, 404, { error: 'no facts yet — run setup' });
  }

  if (p === '/facts' && req.method === 'PUT') {
    const facts = await readJson(req);
    if (!facts || !facts.name) return json(res, 400, { error: 'facts must have a name' });
    store.writeFacts(facts);
    return json(res, 200, { ok: true });
  }

  // Setup sends the PDF as base64 so we avoid multipart parsing entirely.
  if (p === '/import' && req.method === 'POST') {
    const { pdfBase64 } = await readJson(req);
    if (!pdfBase64) return json(res, 400, { error: 'pdfBase64 required' });
    const tmp = path.join(os.tmpdir(), `jobwire-import-${process.pid}.pdf`);
    fs.writeFileSync(tmp, Buffer.from(pdfBase64, 'base64'));
    try {
      const facts = await importPdf(tmp);
      return json(res, 200, facts);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }

  if (p === '/tailor' && req.method === 'POST') {
    const { jdText, url: sourceUrl, title } = await readJson(req);
    if (!jdText || jdText.trim().length < 80) {
      return json(res, 400, { error: 'job description too short to work with' });
    }
    const facts = store.readFacts();
    if (!facts) return json(res, 400, { error: 'no resume imported yet — open setup first' });

    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    const send = (ev) => res.write(`data: ${JSON.stringify(ev)}\n\n`);

    try {
      for await (const ev of tailorStream(facts, jdText)) {
        if (ev.type === 'done') {
          const id = store.newRunId(Date.now());
          ev.run.createdAt = new Date().toISOString();
          ev.run.sourceUrl = sourceUrl || null;
          ev.run.sourceTitle = title || null;
          store.writeRun(id, ev.run);
          send({ ...ev, runId: id });
        } else {
          send(ev);
        }
      }
    } catch (e) {
      send({ type: 'error', error: e.message });
    }
    return res.end();
  }

  const runMatch = p.match(/^\/run\/([A-Za-z0-9_-]+)(\/html|\/pdf|\/parts)?$/);
  if (runMatch) {
    const id = runMatch[1];
    const sub = runMatch[2];
    const run = store.readRun(id);
    if (!run) return json(res, 404, { error: 'no such run' });

    if (!sub && req.method === 'GET') return json(res, 200, run);

    // Edits from the modal are re-verified: a hand-edit is trusted, but we still
    // tell you if it introduced something your resume cannot support.
    if (!sub && req.method === 'PUT') {
      const edits = await readJson(req);
      const facts = store.readFacts();
      const merged = { ...run, ...edits, id };
      if (facts) verifyRun(merged, facts);
      merged.updatedAt = new Date().toISOString();
      store.writeRun(id, merged);
      return json(res, 200, merged);
    }

    // The extension preview runs under MV3's CSP, which forbids inline script.
    // It therefore assembles the page from these parts instead of /html.
    if (sub === '/parts') {
      return json(res, 200, {
        css: css(url.searchParams.get('fonts') || 'data'),
        body: renderBody(run, url.searchParams.get('edit') === '1'),
        ladder: ladder(M),
        availPt: availableHeight(M),
        metrics: M,
        verification: run.verification || null,
        gaps: run.gaps || [],
        jd: run.jd || null,
      });
    }

    if (sub === '/html') {
      const html = renderHtml(run, { fontBase: 'data', editable: url.searchParams.get('edit') === '1' });
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(html);
    }

    if (sub === '/pdf') {
      const html = renderHtml(run, { fontBase: 'data' });
      const pdf = await htmlToPdf(html);
      const who = String(run.name || 'resume').replace(/[^A-Za-z0-9]+/g, '_');
      const what = String((run.jd && run.jd.company) || run.sourceTitle || 'tailored').replace(/[^A-Za-z0-9]+/g, '_').slice(0, 40);
      res.writeHead(200, {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${who}_${what}.pdf"`,
      });
      return res.end(pdf);
    }
  }

  if (p === '/runs' && req.method === 'GET') return json(res, 200, store.listRuns());

  if (p === '/preview' && req.method === 'POST') {
    const facts = await readJson(req);
    const html = renderHtml(facts, { fontBase: 'data' });
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end(html);
  }

  if (p === '/' || p === '/setup') return serveStatic(res, path.join(ROOT, 'setup', 'index.html'));
  if (p.startsWith('/setup/')) return serveStatic(res, path.join(ROOT, 'setup', p.slice(7)));
  if (p.startsWith('/fonts/')) return serveStatic(res, path.join(ROOT, 'extension', 'fonts', p.slice(7)));

  return json(res, 404, { error: `no route ${p}` });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  if (!cors(req, res)) return json(res, 403, { error: 'origin not allowed' });
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  try {
    await handle(req, res, url);
  } catch (e) {
    if (!res.headersSent) json(res, 500, { error: e.message });
    else res.end();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`jobwire server  http://${HOST}:${PORT}`);
  console.log(`setup           http://${HOST}:${PORT}/setup`);
  ollama.health().then((h) => {
    if (!h.ok) console.log(`ollama          NOT REACHABLE (${h.error}) — start it with: ollama serve`);
    else if (!h.present) console.log(`ollama          up, but model ${h.using} missing — ollama pull ${h.using}`);
    else console.log(`ollama          up, using ${h.using}`);
  });
  console.log(store.readFacts() ? 'resume          loaded' : 'resume          NOT IMPORTED — open the setup page');
});
