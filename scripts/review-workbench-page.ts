/** 審核工作台的樣式和頁面程式。全部內嵌進輸出的 HTML，所以不連網、不需伺服器。 */

export const PAGE_CSS = String.raw`
:root {
  --ink: #26221f; --muted: #6b645d; --line: #ddd5ca; --paper: #fbf8f3; --card: #fff;
  --plum: #6d3f63; --green: #2f5d4a; --ochre: #a8681b; --warn: #8a3b12; --warn-bg: #fdf0e3;
  --agree: #2f6b4d; --agree-bg: #e6f2eb; --revise: #9a4a14; --revise-bg: #fbe9d8;
  --ui: "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", system-ui, -apple-system, "Segoe UI", sans-serif;
  --voice: "Noto Serif TC", "Songti TC", "PMingLiU", Georgia, "Times New Roman", serif;
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
html { scroll-padding-top: 9rem; }
body { margin: 0; background: var(--paper); color: var(--ink); font: 16px/1.65 var(--ui); }
.top { position: sticky; top: 0; z-index: 10; background: #fffdf9; border-bottom: 1px solid var(--line); padding: .6rem 1rem; }
.top-row { display: flex; flex-wrap: wrap; gap: .5rem 1rem; align-items: center; max-width: 80rem; margin: 0 auto; }
.top h1 { font-size: 1.05rem; margin: 0; flex: 1 1 14rem; }
.progress { display: flex; align-items: center; gap: .6rem; flex: 1 1 14rem; font-weight: 600; }
.bar { flex: 1; height: .6rem; background: #e9e2d8; border-radius: .3rem; overflow: hidden; min-width: 5rem; }
.bar > i { display: block; height: 100%; width: 0; background: var(--green); transition: width .2s; }
.top label { font-size: .88rem; color: var(--muted); display: inline-flex; gap: .3rem; align-items: center; }
button { font: inherit; cursor: pointer; border: 1px solid var(--line); background: #fff; color: var(--ink); border-radius: .4rem; padding: .35rem .8rem; min-height: 2.5rem; }
button:hover { border-color: #b9ad9d; }
button:focus-visible, input:focus-visible, summary:focus-visible { outline: 3px solid #5a8fd6; outline-offset: 2px; }
.copy { background: var(--ochre); border-color: var(--ochre); color: #fff; font-weight: 600; }
.copy:hover { background: #8d5614; }
#toast { max-width: 80rem; margin: .3rem auto 0; font-size: .9rem; min-height: 1.3em; color: var(--agree); }
#toast.err { color: var(--warn); }
#fallback { display: none; max-width: 80rem; margin: .4rem auto 0; }
#fallback.on { display: block; }
#fallback textarea { width: 100%; min-height: 8rem; font: .85rem/1.4 ui-monospace, Menlo, Consolas, monospace; }
main { max-width: 80rem; margin: 0 auto; padding: 1rem; }
.intro { background: var(--card); border: 1px solid var(--line); border-radius: .6rem; padding: .8rem 1rem; margin-bottom: 1rem; font-size: .95rem; }
.intro p { margin: .2rem 0; }
.navlist { display: flex; flex-wrap: wrap; gap: .4rem; list-style: none; padding: 0; margin: .5rem 0 0; }
.navlist a { display: inline-block; padding: .25rem .6rem; border: 1px solid var(--line); border-radius: 2rem; text-decoration: none; color: var(--ink); background: #fff; font-size: .9rem; }
.navlist .n { color: var(--muted); }
.module > h2 { margin: 2.5rem 0 .3rem; font-size: 1.35rem; border-bottom: 2px solid var(--green); padding-bottom: .3rem; }
.module h3 { margin: 2rem 0 .5rem; font-size: 1.05rem; color: var(--green); }
.module h4 { margin: 1.4rem 0 .4rem; font-size: .95rem; color: var(--muted); }
.item { background: var(--card); border: 1px solid var(--line); border-left: 6px solid #cfc6b8; border-radius: .6rem; margin: .8rem 0; overflow: hidden; }
.item.is-agree { border-left-color: var(--agree); }
.item.is-revise { border-left-color: var(--revise); }
.item[data-flagged] { background: #fffdfa; }
.item > header { display: flex; flex-wrap: wrap; gap: .3rem .8rem; align-items: baseline; padding: .5rem .9rem; background: #f6f1e9; border-bottom: 1px solid var(--line); }
.item .kind { font-weight: 700; font-size: .9rem; }
.item code { font: .78rem ui-monospace, Menlo, Consolas, monospace; color: var(--muted); word-break: break-all; }
.flags { padding: .5rem .9rem 0; display: flex; flex-direction: column; gap: .3rem; }
.flag { font-size: .88rem; background: var(--warn-bg); color: var(--warn); border: 1px solid #efcfae; border-radius: .4rem; padding: .25rem .6rem; }
.flag summary { cursor: pointer; }
.flag blockquote { margin: .4rem 0 .2rem; padding: .3rem .6rem; border-left: 3px solid #d9a773; background: #fff; color: var(--ink); font-size: .9rem; }
.flag .src { color: var(--muted); font-size: .8rem; }
.hint { font-size: .8rem; color: var(--muted); padding: .3rem .9rem 0; }
.pair { display: grid; grid-template-columns: 1fr 1fr; gap: 0; }
.col { padding: .7rem .9rem; min-width: 0; overflow-wrap: anywhere; }
.col + .col { border-left: 1px dashed var(--line); }
.col .lang { display: inline-block; font-size: .72rem; letter-spacing: .06em; color: #fff; background: #8b8176; border-radius: .25rem; padding: 0 .4rem; margin-bottom: .3rem; }
.col .lang.zh { background: #5b6f86; }
.col p { margin: .3rem 0; }
.col .missing { color: var(--warn); font-style: italic; }
.voice { font-family: var(--voice); }
.label { display: block; font-size: .78rem; font-weight: 700; color: var(--muted); margin-top: .6rem; text-transform: none; }
.who-client { color: var(--plum); font-weight: 700; }
.who-therapist { color: var(--green); font-weight: 700; }
ol.criteria { margin: .2rem 0 .2rem 1.2rem; padding: 0; }
ul.opts { list-style: none; margin: .3rem 0; padding: 0; }
ul.opts li { margin: .35rem 0; padding: .4rem .6rem; border: 1px solid var(--line); border-radius: .4rem; background: #fcfaf6; }
.fit { display: inline-block; font-size: .75rem; font-weight: 700; border-radius: .25rem; padding: 0 .4rem; margin-right: .4rem; color: #fff; }
.fit.strong { background: var(--green); } .fit.workable { background: #8a7a2d; } .fit.weak { background: #9b4b3a; }
.note { color: var(--muted); font-size: .92rem; margin-top: .2rem; }
mark { background: #ffd9a8; color: inherit; padding: 0 .1em; border-radius: .15em; }
.turn-row .pair { border-top: 1px solid #f0eae0; }
.turn-row { margin: 0 0 .2rem; }
.decide { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; padding: .6rem .9rem; border-top: 1px solid var(--line); background: #faf6ef; }
.decide button[aria-pressed="true"].agree { background: var(--agree); border-color: var(--agree); color: #fff; font-weight: 700; }
.decide button[aria-pressed="true"].revise { background: var(--revise); border-color: var(--revise); color: #fff; font-weight: 700; }
.decide input { flex: 1 1 14rem; min-width: 0; font: inherit; padding: .4rem .6rem; border: 1px solid var(--line); border-radius: .4rem; min-height: 2.5rem; }
.decide input:disabled { background: #f1ede6; }
.module-item .mod-copy { margin-left: auto; }
.stats { color: var(--muted); font-size: .9rem; }
body.only-flagged .item:not(.module-item):not([data-flagged]), body.only-flagged .turn-row, body.only-flagged .session-head, body.only-flagged .module h4, body.only-flagged .module h3 { display: none; }
body.only-undecided .item:not(.module-item).is-agree, body.only-undecided .item:not(.module-item).is-revise, body.only-undecided .turn-row, body.only-undecided .session-head, body.only-undecided .module h4, body.only-undecided .module h3 { display: none; }
@media (max-width: 720px) {
  body { font-size: 15.5px; }
  .pair { grid-template-columns: 1fr; }
  .col + .col { border-left: 0; border-top: 1px dashed var(--line); }
  .top { padding: .4rem .7rem; }
  .top h1 { display: none; }
  .top-row { gap: .3rem .8rem; }
  .top .progress { flex: 1 1 100%; }
  .top label { font-size: .8rem; }
  .top button { min-height: 2.2rem; padding: .2rem .7rem; }
  html { scroll-padding-top: 7rem; }
  main { padding: .6rem; }
  .decide button { flex: 1 1 8rem; }
}
@media print { .top, .decide { display: none; } }
`;

/** 頁面程式。決定存在 localStorage；存不了時改存在記憶體，頁面照常可用。 */
export const PAGE_JS = String.raw`
(function () {
  'use strict';
  var data = JSON.parse(document.getElementById('wb-data').textContent);
  var memory = {};
  var states = {};
  var storageOk = true;

  function keyOf(m) { return 'clinicmind-review:' + data.stage + ':' + m.slug + ':' + m.version; }
  function load(m) {
    try {
      var raw = window.localStorage.getItem(keyOf(m));
      if (raw) { var v = JSON.parse(raw); if (v && typeof v === 'object') return v; }
    } catch (e) { storageOk = false; }
    return memory[m.slug] || {};
  }
  function save(m) {
    memory[m.slug] = states[m.slug];
    try { window.localStorage.setItem(keyOf(m), JSON.stringify(states[m.slug])); }
    catch (e) { storageOk = false; showStorageWarning(); }
  }
  function showStorageWarning() {
    var el = document.getElementById('storage-warning');
    if (el) el.hidden = false;
  }

  var modBySlug = {};
  data.modules.forEach(function (m) { modBySlug[m.slug] = m; states[m.slug] = load(m); });

  function article(id) { return document.querySelector('article.item[data-id="' + id + '"]'); }

  function paint(m) {
    var st = states[m.slug];
    m.ids.forEach(function (id) {
      var el = article(id);
      if (!el) return;
      var rec = st[id];
      var status = rec && rec.status;
      el.classList.toggle('is-agree', status === 'agree');
      el.classList.toggle('is-revise', status === 'revise');
      if (status) el.setAttribute('data-decided', ''); else el.removeAttribute('data-decided');
      el.querySelectorAll('.decide button[data-act]').forEach(function (b) {
        b.setAttribute('aria-pressed', String(b.getAttribute('data-act') === status));
      });
      var input = el.querySelector('.decide input');
      input.disabled = !status;
      input.placeholder = status ? '一句備註（選填）' : '先按「同意」或「要修改」';
      var wanted = (rec && rec.note) || '';
      if (document.activeElement !== input && input.value !== wanted) input.value = wanted;
    });
  }

  function counts(m) {
    var st = states[m.slug], seen = 0;
    m.ids.forEach(function (id) { if (st[id] && st[id].status) seen++; });
    return { seen: seen, total: m.ids.length };
  }

  function updateProgress() {
    var seen = 0, total = 0;
    data.modules.forEach(function (m) {
      var c = counts(m);
      seen += c.seen; total += c.total;
      var n = document.querySelector('[data-nav-count="' + m.slug + '"]');
      if (n) n.textContent = c.seen + '／' + c.total;
    });
    document.getElementById('seen').textContent = String(seen);
    document.getElementById('total').textContent = String(total);
    document.getElementById('bar').style.width = (total ? Math.round(seen * 100 / total) : 0) + '%';
  }

  function payload(m) {
    var st = states[m.slug], decisions = [];
    m.ids.forEach(function (id) {
      var r = st[id];
      if (r && r.status) decisions.push({ id: id, status: r.status, note: r.note || '' });
    });
    return { stage: data.stage, module: m.slug, version: m.version, decisions: decisions };
  }

  function legacyCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', '');
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return legacyCopy(text); });
    }
    return Promise.resolve(legacyCopy(text));
  }

  function toast(msg, isErr) {
    var t = document.getElementById('toast');
    t.textContent = msg; t.className = isErr ? 'err' : '';
  }

  function doCopy(list, label) {
    var obj = list.length === 1 ? payload(list[0]) : list.map(payload);
    var text = JSON.stringify(obj, null, 2);
    var fb = document.getElementById('fallback');
    copyText(text).then(function (ok) {
      if (ok) {
        fb.classList.remove('on');
        toast('已複製' + label + '。到對話框按貼上，就能傳給 Claude。');
      } else {
        fb.classList.add('on');
        var ta = fb.querySelector('textarea');
        ta.value = text; ta.focus(); ta.select();
        toast('這個瀏覽器不讓網頁直接複製。下面的文字已經選好，請按 Ctrl+C（Mac 是 ⌘+C）複製。', true);
      }
    });
  }

  document.addEventListener('click', function (ev) {
    var b = ev.target.closest && ev.target.closest('button');
    if (!b) return;
    if (b.id === 'copy-all') { doCopy(data.modules, '全部決定'); return; }
    if (b.hasAttribute('data-copy-module')) { doCopy([modBySlug[b.getAttribute('data-copy-module')]], '這個模組的決定'); return; }
    var act = b.getAttribute('data-act');
    if (!act) return;
    var el = b.closest('article.item');
    var m = modBySlug[el.getAttribute('data-module')];
    var id = el.getAttribute('data-id');
    var st = states[m.slug];
    var rec = st[id] || { status: '', note: '' };
    if (rec.status === act) { delete st[id]; } else { rec.status = act; st[id] = rec; }
    save(m); paint(m); updateProgress();
  });

  document.addEventListener('input', function (ev) {
    var input = ev.target;
    if (!input.matches || !input.matches('.decide input')) return;
    var el = input.closest('article.item');
    var m = modBySlug[el.getAttribute('data-module')];
    var id = el.getAttribute('data-id');
    var rec = states[m.slug][id];
    if (!rec) return;
    rec.note = input.value;
    save(m);
  });

  document.getElementById('only-flagged').addEventListener('change', function (e) { document.body.classList.toggle('only-flagged', e.target.checked); });
  document.getElementById('only-undecided').addEventListener('change', function (e) { document.body.classList.toggle('only-undecided', e.target.checked); });

  data.modules.forEach(paint);
  updateProgress();
  document.body.setAttribute('data-ready', '');
})();
`;
