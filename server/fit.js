// LaTeX can shrink inter-word space to pull a line back; Chrome only ever
// stretches, so identical text can wrap one line earlier and spill a page.
// This walks a small compression ladder until the content fits one page,
// then reports what it had to do so the UI can warn.
// Shared by the print path and the extension preview so the two can never
// disagree about how much a page was compressed.
function ladder(M) {
  return [
    { ws: 0, lh: M.leading },
    { ws: -0.15, lh: M.leading },
    { ws: -0.3, lh: M.leading },
    { ws: -0.45, lh: M.leading },
    { ws: -0.45, lh: M.leading - 0.2 },
    { ws: -0.6, lh: M.leading - 0.4 },
    { ws: -0.7, lh: M.leading - 0.6 },
  ];
}

function availableHeight(M) {
  return M.pageH - M.marginTop * 2;
}

function fitScript(M) {
  const avail = availableHeight(M);
  return `
(function(){
  var AVAIL = ${avail};
  var LADDER = ${JSON.stringify(ladder(M))};
  function contentHeight(page){
    var kids = page.children, bottom = 0;
    var top = page.getBoundingClientRect().top + ${M.marginTop} * 96 / 72;
    for (var i = 0; i < kids.length; i++) {
      var r = kids[i].getBoundingClientRect();
      if (r.bottom > bottom) bottom = r.bottom;
    }
    return (bottom - top) * 72 / 96;
  }
  window.jwFit = function(){
    var page = document.getElementById('jw-page');
    if (!page) return null;
    var used = 0, step = 0;
    for (step = 0; step < LADDER.length; step++) {
      page.style.wordSpacing = LADDER[step].ws + 'pt';
      page.style.lineHeight = LADDER[step].lh + 'pt';
      used = contentHeight(page);
      if (used <= AVAIL) break;
    }
    var overflow = used > AVAIL;
    if (step >= LADDER.length) step = LADDER.length - 1;
    var state = {
      fits: !overflow,
      compressed: step > 0,
      step: step,
      usedPt: Math.round(used * 10) / 10,
      availPt: Math.round(AVAIL * 10) / 10,
      overflowPt: Math.round(Math.max(0, used - AVAIL) * 10) / 10
    };
    window.__jwFit = state;
    document.documentElement.setAttribute('data-jw-fit', overflow ? 'overflow' : (step > 0 ? 'compressed' : 'exact'));
    try { window.dispatchEvent(new CustomEvent('jw-fit', {detail: state})); } catch (e) {}
    return state;
  };
  if (document.readyState === 'complete') { setTimeout(window.jwFit, 0); }
  else { window.addEventListener('load', function(){ setTimeout(window.jwFit, 0); }); }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function(){ setTimeout(window.jwFit, 0); });
})();
`;
}

module.exports = { fitScript, ladder, availableHeight };
