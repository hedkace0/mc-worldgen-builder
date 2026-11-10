/* ================= JSON code editor =================
   A textarea over a highlighted <pre>. Ctrl/Cmd-click on an id opens the referenced file; typing inside a
   string suggests ids from the project and vanilla, narrowed by the key it belongs to. */
const CodeEd = {
  ta: $('#code-ta'), hl: $('#code-hl'), gut: $('#code-gutter'), wrap: $('#code'),
  readOnly: false, onChange: null, err: null, hlTimer: 0, ac: null,
};
function codeOpen(text, { readOnly = false, onChange = null, message = false } = {}) {
  const C = CodeEd;
  if (message) {
    C.readOnly = true; C.onChange = null; C.ta.readOnly = true; C.ta.value = text; C.err = null;
    $('#code-err').hidden = true;
    C.hl.textContent = text; C.gut.textContent = '';
    return;
  }
  C.readOnly = readOnly;
  C.onChange = onChange;
  C.ta.readOnly = readOnly;
  C.ta.value = text;
  C.wrap.classList.toggle('ro', readOnly);
  C.ta.scrollTop = 0;
  codeLint();
  codeHighlight();
}
function codeSetText(text) {
  if (CodeEd.ta.value === text) return;
  const { selectionStart: a, selectionEnd: b, scrollTop } = CodeEd.ta;
  CodeEd.ta.value = text;
  CodeEd.ta.setSelectionRange(Math.min(a, text.length), Math.min(b, text.length));
  CodeEd.ta.scrollTop = scrollTop;
  codeLint();
  codeHighlight();
}
function codeLint() {
  const text = CodeEd.ta.value;
  CodeEd.err = null;
  try { JSON.parse(text); } catch (err) {
    const m = /position (\d+)/.exec(err.message) || /column (\d+)/.exec(err.message);
    let line = null;
    const lm = /line (\d+)/.exec(err.message);
    if (lm) line = +lm[1];
    else if (m) line = text.slice(0, +m[1]).split('\n').length;
    CodeEd.err = { msg: err.message.replace(/^JSON\.parse: /, ''), line };
  }
  const bar = $('#code-err');
  bar.hidden = !CodeEd.err;
  if (CodeEd.err) bar.textContent = (CodeEd.err.line ? `Line ${CodeEd.err.line}: ` : '') + CodeEd.err.msg;
}
const TOK_RE = /("(?:\\.|[^"\\\n])*"?)(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b/g;
function codeHighlight() {
  const text = CodeEd.ta.value;
  const lines = text.split('\n').length;
  // gutter
  let g = '';
  for (let i = 1; i <= lines; i++) g += (CodeEd.err && CodeEd.err.line === i ? '<b>' + i + '</b>' : i) + '\n';
  CodeEd.gut.innerHTML = g;
  if (text.length > 400000) { CodeEd.hl.textContent = text + '\n'; return; }
  let out = '', last = 0;
  TOK_RE.lastIndex = 0;
  let m;
  while ((m = TOK_RE.exec(text))) {
    out += esc(text.slice(last, m.index));
    if (m[1]) {
      if (m[2]) out += `<span class="tk">${esc(m[1])}</span>${m[2]}`;
      else {
        const inner = m[1].slice(1, -1);
        const isId = ID_RE.test(inner) && inner.includes(':');
        out += `<span class="${isId ? 'ts tid' : 'ts'}">${esc(m[1])}</span>`;
      }
    } else if (m[3]) out += `<span class="tn">${m[3]}</span>`;
    else out += `<span class="tb">${m[4]}</span>`;
    last = TOK_RE.lastIndex;
  }
  out += esc(text.slice(last));
  if (CodeEd.err && CodeEd.err.line) {
    const ls = out.split('\n');
    if (ls[CodeEd.err.line - 1] !== undefined) ls[CodeEd.err.line - 1] = `<span class="terr">${ls[CodeEd.err.line - 1] || ' '}</span>`;
    out = ls.join('\n');
  }
  CodeEd.hl.innerHTML = out + '\n';
  codeSyncScroll();
}
function codeSyncScroll() {
  CodeEd.hl.style.transform = `translate(${-CodeEd.ta.scrollLeft}px, ${-CodeEd.ta.scrollTop}px)`;
  CodeEd.gut.style.transform = `translateY(${-CodeEd.ta.scrollTop}px)`;
}
CodeEd.ta.addEventListener('scroll', () => { codeSyncScroll(); acClose(); });
CodeEd.ta.addEventListener('input', () => {
  if (CodeEd.readOnly) return;
  codeLint();
  clearTimeout(CodeEd.hlTimer);
  if (CodeEd.ta.value.length < 60000) codeHighlight();
  else CodeEd.hlTimer = setTimeout(codeHighlight, 200);
  if (CodeEd.onChange) CodeEd.onChange(CodeEd.ta.value);
  acUpdate();
});
function codeReplace(a, b, text, caretA, caretB) {
  const ta = CodeEd.ta;
  ta.setSelectionRange(a, b);
  // execCommand keeps the browser's undo stack; fall back to setRangeText
  if (!document.execCommand || !document.execCommand('insertText', false, text)) {
    ta.setRangeText(text, a, b, 'end');
    ta.dispatchEvent(new Event('input'));
  }
  if (caretA != null) ta.setSelectionRange(caretA, caretB ?? caretA);
}
CodeEd.ta.addEventListener('keydown', (ev) => {
  const ta = CodeEd.ta;
  if (CodeEd.ac && acKey(ev)) return;
  if ((ev.ctrlKey || ev.metaKey) && ev.key === ' ') { ev.preventDefault(); acUpdate(true); return; }
  if ((ev.ctrlKey || ev.metaKey) && ev.shiftKey && ev.key.toLowerCase() === 'f') { ev.preventDefault(); codeFormat(); return; }
  if (CodeEd.readOnly) return;
  const v = ta.value, a = ta.selectionStart, b = ta.selectionEnd;
  if (ev.key === 'Tab') {
    ev.preventDefault();
    const ls = v.lastIndexOf('\n', a - 1) + 1;
    if (a === b && !ev.shiftKey) { codeReplace(a, b, '  '); return; }
    const le = v.indexOf('\n', b - (b > a && v[b - 1] === '\n' ? 1 : 0));
    const end = le < 0 ? v.length : le;
    const block = v.slice(ls, end);
    const nb = ev.shiftKey ? block.replace(/^ {1,2}/gm, '') : block.replace(/^/gm, '  ');
    codeReplace(ls, end, nb, ls, ls + nb.length);
    return;
  }
  if (ev.key === 'Enter' && !ev.shiftKey && !ev.ctrlKey && !ev.metaKey) {
    ev.preventDefault();
    const ls = v.lastIndexOf('\n', a - 1) + 1;
    const indent = /^[ \t]*/.exec(v.slice(ls, a))[0];
    const prev = v.slice(ls, a).trimEnd().slice(-1);
    const next = v.slice(b).match(/^[ \t]*(.)/);
    if (prev === '{' || prev === '[') {
      const closing = next && ((prev === '{' && next[1] === '}') || (prev === '[' && next[1] === ']'));
      const ins = '\n' + indent + '  ' + (closing ? '\n' + indent : '');
      codeReplace(a, b, ins, a + indent.length + 3);
    } else codeReplace(a, b, '\n' + indent);
  }
});
/** The string literal around offset `pos`, with the JSON key it is the value of. */
function stringAt(text, pos) {
  const ls = text.lastIndexOf('\n', pos - 1) + 1;
  const le = text.indexOf('\n', pos);
  const line = text.slice(ls, le < 0 ? text.length : le);
  const re = /"(?:\\.|[^"\\])*"?/g;
  let m;
  while ((m = re.exec(line))) {
    const s = ls + m.index, e = s + m[0].length;
    if (pos > s && pos <= e) {
      const after = text.slice(e).match(/^\s*:/);
      if (after) return null; // a key
      const before = text.slice(Math.max(0, s - 400), s);
      const km = /"([A-Za-z0-9_]+)"\s*:\s*(?:\[[^\]]*)?$/.exec(before);
      return { start: s, end: e, value: m[0].replace(/^"|"$/g, ''), key: km ? km[1] : '', closed: m[0].length > 1 && m[0].endsWith('"') };
    }
  }
  return null;
}
function regsForKey(key) {
  if (KEY_REGS[key]) return KEY_REGS[key];
  if (DF_KEYS.has(key)) return ['worldgen/density_function'];
  if (key === 'type' && TARGET && TARGET.reg === 'dimension') return ['dimension_type'];
  return null;
}
CodeEd.ta.addEventListener('click', (ev) => {
  if (!(ev.ctrlKey || ev.metaKey)) return;
  const s = stringAt(CodeEd.ta.value, CodeEd.ta.selectionStart);
  if (!s || !s.value.includes(':')) return;
  ev.preventDefault();
  const id = s.value;
  if (id.startsWith('#')) { openRef('tags/worldgen/biome', id.slice(1)); return; }
  const regs = regsForKey(s.key) || REGISTRIES.map((r) => r.key);
  for (const r of regs) if (resolveRef(r, id)) { openRef(r, id); return; }
  toast(`${id} isn't a file in the project or vanilla data`);
});
CodeEd.wrap.addEventListener('pointermove', (ev) => CodeEd.wrap.classList.toggle('mod', ev.ctrlKey || ev.metaKey));

/* ---------- id autocomplete ---------- */
function acCandidates(key, q) {
  let regs = regsForKey(key);
  const list = [];
  const add = (reg, ids, prefix = '') => { for (const id of ids) list.push({ reg, id: prefix + id }); };
  if (q.startsWith('#')) { add('tags/worldgen/biome', allIds('tags/worldgen/biome'), '#'); }
  else {
    if (!regs) regs = REGISTRIES.map((r) => r.key);
    for (const r of regs) add(r, allIds(r));
    if (regs.includes('worldgen/biome') && key !== 'biome') add('tags/worldgen/biome', allIds('tags/worldgen/biome'), '#');
  }
  const ql = q.toLowerCase();
  const scored = [];
  const seen = new Set();
  for (const c of list) {
    const k = c.reg + c.id;
    if (seen.has(k)) continue;
    seen.add(k);
    const i = c.id.indexOf(ql), j = short(c.id).indexOf(ql);
    if (ql && i < 0) continue;
    scored.push([j === 0 || i === 0 ? 0 : 1, c.id.length, c]);
  }
  scored.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return scored.slice(0, 40).map((x) => x[2]);
}
function caretXY() {
  const ta = CodeEd.ta;
  const pos = ta.selectionStart;
  const before = ta.value.slice(0, pos);
  const line = before.split('\n').length - 1;
  const col = pos - (before.lastIndexOf('\n') + 1);
  const cs = getComputedStyle(ta);
  const lh = parseFloat(cs.lineHeight) || 18;
  const cw = CodeEd.charW || (CodeEd.charW = (() => { const c = document.createElement('canvas').getContext('2d'); c.font = `${cs.fontSize} ${cs.fontFamily}`; return c.measureText('0000000000').width / 10; })());
  const r = ta.getBoundingClientRect();
  return { x: r.left + parseFloat(cs.paddingLeft) + col * cw - ta.scrollLeft, y: r.top + parseFloat(cs.paddingTop) + (line + 1) * lh - ta.scrollTop };
}
function acUpdate(force) {
  if (CodeEd.readOnly) return acClose();
  const ta = CodeEd.ta;
  if (ta.selectionStart !== ta.selectionEnd) return acClose();
  const s = stringAt(ta.value, ta.selectionStart);
  if (!s) return acClose();
  const q = ta.value.slice(s.start + 1, ta.selectionStart);
  if (!force && (q.length < 1 || /\s/.test(q))) return acClose();
  const regs = regsForKey(s.key);
  if (!force && !regs && !q.includes(':') && q.length < 3) return acClose();
  const items = acCandidates(s.key, q);
  if (!items.length || (items.length === 1 && items[0].id === q)) return acClose();
  if (!CodeEd.ac) {
    CodeEd.ac = { el: h('div', { class: 'ac', role: 'listbox' }), idx: 0 };
    document.body.append(CodeEd.ac.el);
  }
  const A = CodeEd.ac;
  A.items = items; A.s = s; A.idx = Math.min(A.idx, items.length - 1);
  A.el.innerHTML = '';
  items.forEach((c, i) => {
    const it = h('div', { class: 'ac-item' + (i === A.idx ? ' act' : '') }, h('i', { style: { background: `var(${(REG[c.reg] || {}).color || '--c-util'})` } }), h('span', {}, c.id), h('small', {}, REG[c.reg] ? regLabel1(c.reg) : ''));
    it.addEventListener('pointerdown', (e) => { e.preventDefault(); A.idx = i; acAccept(); });
    A.el.append(it);
  });
  const p = caretXY();
  A.el.style.left = Math.min(p.x, innerWidth - 340) + 'px';
  A.el.style.top = Math.min(p.y + 2, innerHeight - 220) + 'px';
}
function acKey(ev) {
  const A = CodeEd.ac;
  if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
    ev.preventDefault();
    A.idx = (A.idx + (ev.key === 'ArrowDown' ? 1 : -1) + A.items.length) % A.items.length;
    [...A.el.children].forEach((c, i) => c.classList.toggle('act', i === A.idx));
    A.el.children[A.idx].scrollIntoView({ block: 'nearest' });
    return true;
  }
  if (ev.key === 'Enter' || ev.key === 'Tab') { ev.preventDefault(); acAccept(); return true; }
  if (ev.key === 'Escape') { ev.preventDefault(); acClose(); return true; }
  return false;
}
function acAccept() {
  const A = CodeEd.ac;
  if (!A) return;
  const c = A.items[A.idx];
  const s = stringAt(CodeEd.ta.value, CodeEd.ta.selectionStart) || A.s;
  acClose();
  const end = s.closed ? s.end : s.end;
  const text = '"' + c.id + '"';
  codeReplace(s.start, end, text, s.start + text.length);
}
function acClose() { if (CodeEd.ac) { CodeEd.ac.el.remove(); CodeEd.ac = null; } }
CodeEd.ta.addEventListener('blur', () => setTimeout(acClose, 120));
function codeFormat() {
  if (CodeEd.readOnly) return;
  try {
    const t = JSON.stringify(JSON.parse(CodeEd.ta.value), null, 2) + '\n';
    codeReplace(0, CodeEd.ta.value.length, t, 0);
  } catch (err) { toast('Fix the JSON error before formatting'); }
}
