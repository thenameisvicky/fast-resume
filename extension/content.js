(() => {
  if (window.__jobwireLoaded) { window.__jobwireOpen(); return; }
  window.__jobwireLoaded = true;

  // ---------- JD extraction ----------

  const SITE_SELECTORS = [
    '#job-details',
    '.jobs-description__content',
    '.jobs-box__html-content',
    '.jobs-description-content__text',
    '[data-automation-id="jobPostingDescription"]',
    '#content .job__description',
    '.posting-page .section-wrapper',
    '[data-testid="job-description"]',
    '.job-description',
    '#jobDescriptionText',
    '.description__text',
    '.ashby-job-posting-right-pane',
    'article.posting',
  ];

  const BAD = /(^|\s)(nav|footer|header|aside|menu|sidebar|cookie|banner|advert|promo|related|similar|recommend)/i;

  function visibleText(el) {
    if (!el) return '';
    const t = el.innerText || '';
    return t.replace(/\n{3,}/g, '\n\n').trim();
  }

  function scoreNode(el) {
    const text = visibleText(el);
    const len = text.length;
    if (len < 400) return null;
    const cls = `${el.className || ''} ${el.id || ''}`;
    if (BAD.test(cls)) return null;
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;

    const blocks = el.querySelectorAll('p, li, br').length;
    const links = el.querySelectorAll('a').length;
    const linkText = [...el.querySelectorAll('a')].reduce((n, a) => n + (a.innerText || '').length, 0);
    const linkRatio = len ? linkText / len : 1;
    if (linkRatio > 0.45) return null;

    let score = len + blocks * 40 - links * 12;
    if (/job|posting|description|role|position|vacancy|career/i.test(cls)) score += 1500;
    return { el, text, score };
  }

  function extractJd() {
    const sel = String(window.getSelection() || '').trim();
    if (sel.length > 250) return { text: sel, how: 'your selection' };

    for (const q of SITE_SELECTORS) {
      const el = document.querySelector(q);
      const text = visibleText(el);
      if (text.length > 400) return { text, how: `page section (${q})` };
    }

    const candidates = [];
    const roots = document.querySelectorAll('main, article, [role="main"], section, div');
    for (const el of roots) {
      if (el.querySelectorAll('main, article').length) continue;
      const s = scoreNode(el);
      if (s) candidates.push(s);
    }
    if (!candidates.length) {
      const body = visibleText(document.body);
      return body.length > 400
        ? { text: body, how: 'whole page (rough)' }
        : { text: '', how: 'nothing found' };
    }
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];
    let chosen = best;
    for (const c of candidates) {
      if (c === best) continue;
      if (best.el.contains(c.el) && c.text.length > best.text.length * 0.85) chosen = c;
    }
    return { text: chosen.text, how: 'detected job section' };
  }

  // ---------- modal ----------

  const EXTEND_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>`;
  const COLLAPSE_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14h6v6M20 10h-6V4M14 10l7-7M10 14l-7 7"/></svg>`;
  const CLOSE_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;

  const CSS = `
:host{all:initial}
.wrap{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;
  justify-content:center;background:rgba(15, 23, 42, 0.75);backdrop-filter:blur(8px);
  font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  transition: background 0.3s, backdrop-filter 0.3s;}

.wrap.collapsed {
  position: fixed;
  inset: auto 16px auto auto;
  top: 16px;
  right: 16px;
  width: 380px;
  height: auto;
  background: transparent !important;
  backdrop-filter: none !important;
}

.box{background:#fff;color:#0f172a;width:min(1240px,95vw);height:min(880px,93vh);
  border-radius:16px;display:flex;flex-direction:column;overflow:hidden;
  box-shadow:0 25px 50px -12px rgba(0, 0, 0, 0.25);border:1px solid rgba(0,0,0,0.08);
  transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1), height 0.3s cubic-bezier(0.4, 0, 0.2, 1);}

.wrap.collapsed .box {
  width: 100%;
  height: auto;
  max-height: 90vh;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.15), 0 10px 10px -5px rgba(0, 0, 0, 0.08);
}

.top{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid #e2e8f0;flex:none;background:#ffffff}
.brand{font-weight:800;font-size:15px;letter-spacing:-.03em;color:#4f46e5;display:flex;align-items:center;gap:6px}
.brand::before{content:"";display:inline-block;width:8px;height:8px;background:#4f46e5;border-radius:50%}
.role{color:#64748b;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;font-weight:500;padding-right:8px}

.btn-header {
  border: 0;
  background: #f1f5f9;
  color: #64748b;
  border-radius: 50%;
  width: 28px;
  height: 28px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  flex: none;
}
.btn-header:hover {
  background: #e2e8f0;
  color: #0f172a;
  transform: scale(1.05);
}

.main{display:flex;flex:1;min-height:0}
.left{flex:1;min-width:0;background:#e2e8f0;overflow:auto;padding:24px;display:flex;justify-content:center;align-items:flex-start}
iframe{width:794px;height:1123px;border:0;background:#fff;box-shadow:0 8px 30px rgba(0,0,0,0.08);flex:none;border-radius:4px;overflow:hidden}
.right{width:340px;flex:none;border-left:1px solid #e2e8f0;overflow:auto;padding:20px;font-size:13px;background:#ffffff;display:flex;flex-direction:column;gap:20px}
.bot{display:flex;align-items:center;gap:12px;padding:14px 20px;border-top:1px solid #e2e8f0;flex:none;background:#ffffff}
.grow{flex:1}
button.act{border:0;border-radius:8px;padding:10px 18px;font-size:13px;font-weight:600;cursor:pointer;transition:all 0.2s}
.primary{background:linear-gradient(135deg, #4f46e5 0%, #6366f1 100%);color:#fff;box-shadow:0 4px 12px rgba(79, 70, 229, 0.2)}
.primary:hover{background:linear-gradient(135deg, #4338ca 0%, #4f46e5 100%);transform:translateY(-1px);box-shadow:0 6px 16px rgba(79, 70, 229, 0.3)}
.ghost{background:#f1f5f9;color:#334155}
.ghost:hover{background:#e2e8f0;color:#0f172a}
button:disabled{opacity:.45;cursor:not-allowed;transform:none !important;box-shadow:none !important}
.status{font-size:12.5px;color:#475569;display:flex;align-items:center;gap:8px;font-weight:500}
.spin{width:14px;height:14px;border:2px solid #cbd5e1;border-top-color:#4f46e5;border-radius:50%;animation:s .7s linear infinite}
@keyframes s{to{transform:rotate(360deg)}}
h4{margin:0;font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#64748b;font-weight:700}
.pill{display:inline-block;background:#f0f7ff;color:#0284c7;border:1px solid #e0f2fe;border-radius:6px;padding:3px 8px;margin:0 4px 4px 0;font-size:11.5px;font-weight:500}
.gap{display:inline-block;background:#fffbeb;color:#d97706;border:1px solid #fef3c7;border-radius:6px;padding:3px 8px;margin:0 4px 4px 0;font-size:11.5px;font-weight:500}
.warn{background:#fef2f2;color:#991b1b;border-radius:8px;padding:10px 12px;font-size:12px;line-height:1.45;border-left:4px solid #ef4444;border:1px solid #fee2e2;border-left-width:4px}
.ok{background:#f0fdf4;color:#166534;border-radius:8px;padding:10px 12px;font-size:12px;border-left:4px solid #22c55e;border:1px solid #dcfce7;border-left-width:4px}
.note{color:#64748b;font-size:11.5px;line-height:1.5}
.jdbox{width:100%;height:120px;font:12px/1.45 ui-monospace,monospace;border:1px solid #cbd5e1;border-radius:8px;padding:10px;resize:vertical;background:#fff;box-sizing:border-box}
.jdbox:focus{border-color:#6366f1;outline:none}
.fitbad{background:#fffbeb;color:#92400e;border-radius:8px;padding:10px 12px;font-size:12px;border-left:4px solid #f59e0b;border:1px solid #fef3c7;border-left-width:4px}

/* Input View Screen */
.input-view {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  padding: 24px;
  background: #f8fafc;
  box-sizing: border-box;
}
.input-card {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 24px;
  width: 100%;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
  display: flex;
  flex-direction: column;
  align-items: center;
  box-sizing: border-box;
}
.input-title {
  font-size: 18px;
  font-weight: 800;
  color: #0f172a;
  margin: 0 0 6px 0;
  letter-spacing: -0.02em;
  text-align: center;
}
.input-subtitle {
  font-size: 12.5px;
  color: #64748b;
  margin: 0 0 16px 0;
  text-align: center;
  line-height: 1.4;
}
.jd-input {
  width: 100%;
  height: 130px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  padding: 10px;
  margin-bottom: 16px;
  outline: none;
  resize: none;
  transition: all 0.2s;
  box-sizing: border-box;
  background: #f8fafc;
  line-height: 1.4;
}
.jd-input:focus {
  border-color: #6366f1;
  background: #fff;
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
}
.gen-btn {
  background: linear-gradient(135deg, #4f46e5 0%, #6366f1 100%);
  color: #fff;
  border: 0;
  border-radius: 8px;
  padding: 11px 22px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  box-shadow: 0 4px 10px rgba(79, 70, 229, 0.2);
  width: 100%;
  max-width: 180px;
  text-align: center;
}
.gen-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 14px rgba(79, 70, 229, 0.28);
}
.gen-btn:active {
  transform: translateY(0);
}

/* Info Icon and Tooltip */
.info-container {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 14px;
  font-size: 11.5px;
  color: #64748b;
  position: relative;
  cursor: pointer;
  user-select: none;
}
.info-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #e2e8f0;
  color: #475569;
  font-weight: bold;
  font-size: 10px;
}
.info-tooltip {
  visibility: hidden;
  width: 260px;
  background: #1e293b;
  color: #f8fafc;
  text-align: left;
  border-radius: 8px;
  padding: 12px;
  position: absolute;
  z-index: 1000;
  bottom: 130%;
  left: 50%;
  transform: translateX(-50%);
  opacity: 0;
  transition: opacity 0.2s;
  box-shadow: 0 10px 20px rgba(0, 0, 0, 0.25);
  font-weight: normal;
  line-height: 1.45;
  border: 1px solid rgba(255,255,255,0.08);
}
.info-tooltip::after {
  content: "";
  position: absolute;
  top: 100%;
  left: 50%;
  margin-left: -5px;
  border-width: 5px;
  border-style: solid;
  border-color: #1e293b transparent transparent transparent;
}
.info-container:hover .info-tooltip {
  visibility: visible;
  opacity: 1;
}
.tooltip-title {
  font-weight: 700;
  margin-bottom: 6px;
  color: #38bdf8;
  font-size: 12px;
}
.tooltip-step {
  margin: 4px 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  background: rgba(255, 255, 255, 0.12);
  padding: 3px 6px;
  border-radius: 4px;
  font-size: 10.5px;
  color: #e2e8f0;
}

/* Progress Container */
.progress-container {
  display: none;
  width: 100%;
  flex-direction: column;
  align-items: center;
}
.progress-bar-bg {
  width: 100%;
  height: 8px;
  background: #e2e8f0;
  border-radius: 9999px;
  overflow: hidden;
  margin-bottom: 12px;
  position: relative;
}
.progress-bar-fill {
  width: 0%;
  height: 100%;
  background: linear-gradient(90deg, #4f46e5 0%, #3b82f6 100%);
  border-radius: 9999px;
  transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  position: relative;
}
.progress-bar-fill::after {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  background: linear-gradient(
    90deg,
    rgba(255, 255, 255, 0) 0%,
    rgba(255, 255, 255, 0.3) 50%,
    rgba(255, 255, 255, 0) 100%
  );
  animation: sh 1.5s infinite;
}
@keyframes sh {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}
.progress-text {
  font-size: 20px;
  font-weight: 800;
  color: #0f172a;
  margin-bottom: 6px;
}
.progress-sub {
  font-size: 12px;
  color: #64748b;
  font-weight: 500;
  text-align: center;
}

/* Complete Container */
.complete-container {
  display: none;
  width: 100%;
  flex-direction: column;
  align-items: center;
}
.complete-icon {
  font-size: 40px;
  color: #10b981;
  margin-bottom: 10px;
  animation: scIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}
@keyframes scIn {
  0% { transform: scale(0); }
  100% { transform: scale(1); }
}
.complete-text {
  font-size: 18px;
  font-weight: 800;
  color: #0f172a;
  margin-bottom: 6px;
}
.complete-sub {
  font-size: 13px;
  color: #64748b;
  margin-bottom: 16px;
  text-align: center;
  line-height: 1.45;
}
.btn-group {
  display: flex;
  gap: 12px;
  width: 100%;
  justify-content: center;
}
.complete-btn {
  border: 0;
  border-radius: 8px;
  padding: 11px 22px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  flex: 1;
  max-width: 140px;
  text-align: center;
}
.btn-preview {
  background: #1e293b;
  color: #fff;
  box-shadow: 0 4px 10px rgba(30, 41, 59, 0.1);
}
.btn-preview:hover {
  background: #0f172a;
  transform: translateY(-1px);
}
.btn-download {
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  color: #fff;
  box-shadow: 0 4px 10px rgba(16, 185, 129, 0.15);
}
.btn-download:hover {
  background: linear-gradient(135deg, #059669 0%, #047857 100%);
  transform: translateY(-1px);
}

/* Error Container */
.error-container {
  display: none;
  width: 100%;
  flex-direction: column;
  align-items: center;
}
.error-title {
  font-size: 16px;
  font-weight: 800;
  color: #dc2626;
  margin-bottom: 6px;
}
.error-msg {
  font-size: 12px;
  color: #ef4444;
  margin-bottom: 14px;
  text-align: center;
  background: #fef2f2;
  border: 1px solid #fee2e2;
  padding: 10px 12px;
  border-radius: 8px;
  width: 100%;
  box-sizing: border-box;
  line-height: 1.45;
}
.error-setup-info {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 14px;
  text-align: left;
  width: 100%;
  box-sizing: border-box;
  font-size: 12px;
  color: #475569;
  line-height: 1.5;
}
.error-setup-info .tooltip-step {
  background: #0f172a;
  color: #38bdf8;
  font-weight: 500;
  display: block;
  margin: 4px 0 8px 0;
}
.btn-back {
  background: #f1f5f9;
  color: #475569;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  padding: 8px 16px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}
.btn-back:hover {
  background: #e2e8f0;
  color: #0f172a;
}
`;

  let host, root, port, runId = null;
  let isExtended = false;
  let showEditor = false;

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function updateProgress(percentage, subText) {
    const fill = $('progress-bar-fill');
    const text = $('progress-text');
    const sub = $('progress-sub');
    if (fill) fill.style.width = `${percentage}%`;
    if (text) text.textContent = `${percentage}%`;
    if (sub) sub.textContent = subText || '';
  }

  function updateViewVisibility() {
    const inputView = $('input-view');
    const main = $('main-view');
    const bot = $('bot-view');
    
    if (isExtended && showEditor) {
      inputView.style.display = 'none';
      main.style.display = 'flex';
      bot.style.display = 'flex';
    } else {
      inputView.style.display = 'flex';
      main.style.display = 'none';
      bot.style.display = 'none';
    }
  }

  function toggleExtend() {
    isExtended = !isExtended;
    const wrap = root.querySelector('.wrap');
    const extendBtn = $('extend-btn');

    if (isExtended) {
      wrap.classList.remove('collapsed');
      wrap.classList.add('extended');
      if (extendBtn) extendBtn.innerHTML = COLLAPSE_SVG;
    } else {
      wrap.classList.remove('extended');
      wrap.classList.add('collapsed');
      if (extendBtn) extendBtn.innerHTML = EXTEND_SVG;
      showEditor = false;
    }
    updateViewVisibility();
  }

  function build() {
    host = document.createElement('div');
    host.id = 'jobwire-host';
    root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = CSS;
    root.appendChild(style);

    const wrap = el('div', 'wrap collapsed');
    const box = el('div', 'box');

    const top = el('div', 'top');
    top.append(el('div', 'brand', 'jobwire'));
    const role = el('div', 'role', 'reading this page…');
    role.id = 'role';
    
    const extendBtn = el('button', 'btn-header btn-extend');
    extendBtn.id = 'extend-btn';
    extendBtn.innerHTML = EXTEND_SVG;
    extendBtn.onclick = toggleExtend;

    const x = el('button', 'btn-header btn-close');
    x.innerHTML = CLOSE_SVG;
    x.onclick = close;
    top.append(role, extendBtn, x);

    // --- Input View ---
    const inputView = el('div', 'input-view');
    inputView.id = 'input-view';

    const card = el('div', 'input-card');
    card.append(el('h2', 'input-title', 'Tailor Your Resume'));
    card.append(el('p', 'input-subtitle', 'Paste the job description below to align your resume facts.'));

    const jdTextarea = el('textarea', 'jd-input');
    jdTextarea.id = 'jd-input-box';
    jdTextarea.placeholder = 'Paste job description details here...';
    card.append(jdTextarea);

    const genBtn = el('button', 'gen-btn', 'Generate');
    genBtn.id = 'gen-btn';
    card.append(genBtn);

    // Setup Recommendation Info Badge with hover tooltip
    const infoContainer = el('div', 'info-container');
    infoContainer.innerHTML = `
      <span>Local server setup</span>
      <span class="info-icon">i</span>
      <div class="info-tooltip">
        <div class="tooltip-title">How to start the server:</div>
        <div>1. Open terminal in project root</div>
        <div class="tooltip-step">npm run dev</div>
        <div>2. Ensure Ollama is running</div>
        <div class="tooltip-step">ollama serve</div>
        <div>3. Load resume facts in setup</div>
        <div class="tooltip-step">http://127.0.0.1:7788/setup</div>
      </div>
    `;
    card.append(infoContainer);

    // Progress container (initially hidden)
    const progContainer = el('div', 'progress-container');
    progContainer.id = 'progress-container';
    
    const progText = el('div', 'progress-text', '0%');
    progText.id = 'progress-text';
    
    const progBarBg = el('div', 'progress-bar-bg');
    const progBarFill = el('div', 'progress-bar-fill');
    progBarFill.id = 'progress-bar-fill';
    progBarBg.append(progBarFill);
    
    const progSub = el('div', 'progress-sub', 'Starting...');
    progSub.id = 'progress-sub';
    
    progContainer.append(progText, progBarBg, progSub);
    card.append(progContainer);

    // Complete container (initially hidden)
    const compContainer = el('div', 'complete-container');
    compContainer.id = 'complete-container';
    
    const compIcon = el('div', 'complete-icon', '✓');
    const compText = el('div', 'complete-text', 'Inference Complete');
    const compSub = el('div', 'complete-sub', 'Inference complete! Please review and check.');
    
    const btnGroup = el('div', 'btn-group');
    const prevBtn = el('button', 'complete-btn btn-preview', 'Preview');
    prevBtn.onclick = () => {
      showEditor = true;
      isExtended = true;
      wrap.classList.remove('collapsed');
      wrap.classList.add('extended');
      if (extendBtn) extendBtn.innerHTML = COLLAPSE_SVG;
      updateViewVisibility();
    };
    const dlBtn = el('button', 'complete-btn btn-download', 'Download PDF');
    dlBtn.id = 'complete-dl';
    dlBtn.onclick = onDownload;
    
    btnGroup.append(prevBtn, dlBtn);
    compContainer.append(compIcon, compText, compSub, btnGroup);
    card.append(compContainer);

    // Error container (initially hidden)
    const errContainer = el('div', 'error-container');
    errContainer.id = 'error-container';
    
    const errTitle = el('div', 'error-title', 'Tailoring Failed');
    const errMsg = el('div', 'error-msg', 'An error occurred during inference.');
    errMsg.id = 'error-msg-text';
    
    const errSetup = el('div', 'error-setup-info');
    errSetup.innerHTML = `
      <div style="font-weight: 700; margin-bottom: 6px; color: #0f172a;">To start the local jobwire server:</div>
      <div style="margin-bottom: 4px;">1. Run in project directory:</div>
      <div class="tooltip-step">npm run dev</div>
      <div style="margin-bottom: 4px;">2. Ensure Ollama is running:</div>
      <div class="tooltip-step">ollama serve</div>
      <div style="margin-bottom: 4px;">3. Load your resume facts:</div>
      <a href="http://127.0.0.1:7788/setup" target="_blank" style="color: #4f46e5; font-weight: 600; text-decoration: none;">http://127.0.0.1:7788/setup</a>
    `;
    
    const backBtn = el('button', 'btn-back', 'Back to Edit');
    backBtn.onclick = () => {
      errContainer.style.display = 'none';
      jdTextarea.style.display = 'block';
      genBtn.style.display = 'block';
      infoContainer.style.display = 'flex';
    };
    
    errContainer.append(errTitle, errMsg, errSetup, backBtn);
    card.append(errContainer);

    inputView.append(card);

    // --- Main View (split screen) ---
    const main = el('div', 'main');
    main.id = 'main-view';
    main.style.display = 'none';

    const left = el('div', 'left');
    const frame = document.createElement('iframe');
    frame.id = 'frame';
    frame.setAttribute('scrolling', 'no');
    left.append(frame);
    const right = el('div', 'right');
    right.id = 'right';
    main.append(left, right);

    // --- Bottom controls ---
    const bot = el('div', 'bot');
    bot.id = 'bot-view';
    bot.style.display = 'none';

    const status = el('div', 'status');
    status.id = 'status';
    const save = el('button', 'act ghost', 'Update');
    save.id = 'save'; save.disabled = true; save.onclick = onSave;
    const dl = el('button', 'act primary', 'Download PDF');
    dl.id = 'dl'; dl.disabled = true; dl.onclick = onDownload;
    bot.append(status, el('div', 'grow'), save, dl);

    box.append(top, inputView, main, bot);
    wrap.append(box);
    root.append(wrap);
    document.documentElement.append(host);

    // Generate click handler
    genBtn.onclick = () => {
      const jdText = jdTextarea.value.trim();
      if (jdText.length < 80) {
        alert('Job description too short to work with (must be at least 80 characters).');
        return;
      }
      jdTextarea.style.display = 'none';
      genBtn.style.display = 'none';
      infoContainer.style.display = 'none';
      errContainer.style.display = 'none';
      progContainer.style.display = 'flex';
      updateProgress(0, 'Initializing inference...');
      start(jdText, false);
    };

    wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
    document.addEventListener('keydown', onKey, true);
  }

  const $ = (id) => root.getElementById(id);

  function onKey(e) {
    if (e.key === 'Escape' && host) { e.stopPropagation(); close(); }
  }

  function close() {
    document.removeEventListener('keydown', onKey, true);
    if (port) { try { port.disconnect(); } catch (e) { /* already gone */ } port = null; }
    if (host) host.remove();
    host = null;
  }

  function setStatus(text, busy) {
    const s = $('status');
    if (!s) return;
    s.innerHTML = '';
    if (busy) s.append(el('div', 'spin'));
    s.append(el('span', null, text));
  }

  function renderPanel(data) {
    const right = $('right');
    if (!right) return;
    right.innerHTML = '';
    const { jd, gaps, verification, fit } = data;

    if (fit && !fit.fits) {
      right.append(el('div', 'fitbad',
        `Content runs ${fit.overflowPt}pt past one page even after compression. Cut a bullet.`));
    } else if (fit && fit.compressed) {
      right.append(el('div', 'fitbad', 'Squeezed slightly to hold one page.'));
    }

    if (jd) {
      right.append(el('h4', null, 'They are hiring for'));
      right.append(el('div', null, `${jd.title || 'unknown role'}${jd.company ? ` · ${jd.company}` : ''}`));
      if (jd.mustHave && jd.mustHave.length) {
        right.append(el('h4', null, 'What they asked for'));
        const w = el('div');
        for (const k of jd.mustHave.slice(0, 12)) w.append(el('span', 'pill', k));
        right.append(w);
      }
    }

    const flagged = (verification && verification.flagged) || [];
    const rejected = (verification && verification.rejected) || [];
    right.append(el('h4', null, 'Honesty check'));
    if (!flagged.length && !rejected.length) {
      right.append(el('div', 'ok', 'Every line traces back to your resume.'));
    } else {
      for (const r of rejected) {
        right.append(el('div', 'warn', `Dropped — ${r.issues[0].detail}. Your original wording was kept.`));
      }
      for (const f of flagged) {
        right.append(el('div', 'warn', `Check this: ${f.issues[0].detail}`));
      }
    }

    if (gaps && gaps.length) {
      right.append(el('h4', null, 'You do not have these'));
      const g = el('div');
      for (const k of gaps.slice(0, 14)) g.append(el('span', 'gap', k));
      right.append(g);
      right.append(el('div', 'note',
        'Deliberately left out of the resume. Do not claim them — use them to decide whether to apply, or to prepare answers.'));
    }

    const details = el('details');
    const summary = el('summary', null, 'Job Description Used');
    summary.style.cursor = 'pointer';
    summary.style.fontWeight = '700';
    summary.style.fontSize = '11px';
    summary.style.textTransform = 'uppercase';
    summary.style.letterSpacing = '.08em';
    summary.style.color = '#4f46e5';
    summary.style.outline = 'none';

    const ta = el('textarea', 'jdbox');
    ta.value = data.jdText || '';
    ta.id = 'jdtext';
    ta.style.marginTop = '8px';

    const redo = el('button', 'act ghost', 'Re-run with this text');
    redo.style.marginTop = '8px';
    redo.style.width = '100%';
    redo.onclick = () => {
      $('main-view').style.display = 'none';
      $('bot-view').style.display = 'none';
      $('input-view').style.display = 'flex';
      $('jd-input-box').value = ta.value;
      $('jd-input-box').style.display = 'none';
      $('gen-btn').style.display = 'none';
      $('complete-container').style.display = 'none';
      $('progress-container').style.display = 'flex';
      updateProgress(0, 'Re-running inference...');
      start(ta.value, true);
    };

    details.append(summary, ta, redo);
    right.append(details);
  }

  let lastData = {};

  function onFrameMessage(e) {
    const m = e.data || {};
    if (m.type === 'jw-fit') {
      lastData.fit = m.fit;
      renderPanel(lastData);
    }
    if (m.type === 'jw-edits') {
      chrome.runtime.sendMessage({ type: 'jw-save', runId, edits: m.edits }, (r) => {
        if (!r || !r.ok) { setStatus(`could not save: ${(r && r.error) || 'unknown'}`, false); return; }
        lastData.verification = r.run.verification;
        renderPanel(lastData);
        setStatus('saved', false);
        $('frame').contentWindow.postMessage({ type: 'jw-reload' }, '*');
      });
    }
  }

  function onSave() {
    setStatus('saving…', true);
    $('frame').contentWindow.postMessage({ type: 'jw-collect' }, '*');
  }

  function onDownload() {
    chrome.runtime.sendMessage({ type: 'jw-download', runId }, () => setStatus('downloaded', false));
  }

  function start(jdText, isRerun) {
    runId = null;
    $('save').disabled = true;
    $('dl').disabled = true;
    updateProgress(5, 'Reading job description...');

    port = chrome.runtime.connect({ name: 'jobwire' });
    port.onMessage.addListener((ev) => {
      if (ev.type === 'status') {
        if (ev.stage === 'reading-jd') {
          updateProgress(8, 'Reading job description (Loading Ollama model - can take up to 60s)...');
        } else if (ev.stage.startsWith('tailoring')) {
          const detail = ev.stage.replace('tailoring section ', 'Tailoring ');
          const done = ev.done || 0;
          const total = ev.total || 1;
          const percent = 15 + Math.round((done / total) * 75);
          updateProgress(percent, `${detail} (running Ollama)...`);
        } else if (ev.stage === 'verifying') {
          updateProgress(95, 'Verifying formatting and facts...');
        } else {
          updateProgress(10, ev.stage);
        }
        setStatus(ev.stage, true);
      }
      if (ev.type === 'warn') {
        setStatus(`${ev.section} kept as-is (${ev.error})`, true);
      }
      if (ev.type === 'jd') {
        lastData.jd = ev.jd;
        $('role').textContent = `${ev.jd.title || 'this role'}${ev.jd.company ? ` · ${ev.jd.company}` : ''}`;
        renderPanel(lastData);
      }
      if (ev.type === 'section') {
        const percent = 15 + Math.round((ev.done / ev.total) * 75);
        updateProgress(percent, `Tailored ${ev.label} (${ev.done}/${ev.total})`);
        setStatus(`${ev.label} (${ev.done}/${ev.total})`, true);
      }
      if (ev.type === 'error') {
        setStatus(ev.error, false);
        $('progress-container').style.display = 'none';
        $('error-msg-text').textContent = ev.error;
        $('error-container').style.display = 'flex';
        
        if (/no resume imported/.test(ev.error)) {
          const b = el('button', 'act primary', 'Open setup');
          b.onclick = () => chrome.runtime.sendMessage({ type: 'jw-open-setup' });
          $('error-msg-text').append(document.createElement('br'), b);
        }
      }
      if (ev.type === 'done') {
        runId = ev.runId;
        lastData = { ...lastData, jd: ev.run.jd, gaps: ev.run.gaps, verification: ev.run.verification, jdText };
        renderPanel(lastData);
        chrome.runtime.sendMessage({ type: 'jw-base' }, ({ base }) => {
          $('frame').src = `${chrome.runtime.getURL('preview.html')}?run=${ev.runId}&base=${encodeURIComponent(base)}`;
        });
        $('save').disabled = false;
        $('dl').disabled = false;
        setStatus('ready — click any line to edit it', false);
        
        updateProgress(100, 'Tailoring complete');
        $('progress-container').style.display = 'none';
        $('complete-container').style.display = 'flex';
      }
    });
    port.postMessage({
      type: 'tailor',
      payload: { jdText, url: location.href, title: document.title },
    });
    if (isRerun) lastData.jdText = jdText;
  }

  window.__jobwireOpen = () => {
    if (host) return;
    build();
    window.addEventListener('message', onFrameMessage);
    const jd = extractJd();
    lastData = { jdText: jd.text };
    
    if (jd.text && jd.text.length >= 80) {
      $('jd-input-box').value = jd.text;
    }
    $('role').textContent = jd.text ? `from ${jd.how}` : 'waiting for job description';
  };

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'jw-open') window.__jobwireOpen();
  });

  window.__jobwireOpen();
})();
