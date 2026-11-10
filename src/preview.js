/* ================= evaluation engine (worker) ================= */
const Engine = {
  worker: null, url: null, busy: false, reqId: 0, curId: 0, cb: null, main: null, ready: false, failed: false, sentVersion: -1,
  spawn() {
    try {
      if (!this.url) this.url = URL.createObjectURL(new Blob([$('#ds-src').textContent, '\n;\n', $('#engine-src').textContent], { type: 'text/javascript' }));
      const w = new Worker(this.url);
      this.worker = w;
      this.busy = false;
      this.sentVersion = -1;
      w.onmessage = (e) => this.onMsg(e.data);
      w.onerror = (e) => {
        e.preventDefault();
        if (!this.ready) this.useMainThread();
      };
      w.postMessage({ type: 'init', vanilla: VANILLA });
    } catch (err) {
      this.useMainThread();
    }
  },
  useMainThread() {
    if (this.main) return;
    if (this.worker) this.worker.terminate();
    this.worker = null;
    const s = document.createElement('script');
    s.textContent = $('#ds-src').textContent + '\n;\n' + $('#engine-src').textContent;
    document.head.append(s);
    this.main = window.__dfEngine;
    if (!this.main) { this.failed = true; return; }
    this.main.handle({ type: 'init', vanilla: VANILLA }, () => {});
    this.ready = true;
    if (this.pending) { const p = this.pending; this.pending = null; this.run(p.msg, p.cb); }
  },
  onMsg(d) {
    if (d.ready !== undefined) { this.ready = true; return; }
    if (d.id !== this.curId) return;
    if (d.done || d.error) this.busy = false;
    if (this.cb) this.cb(d);
  },
  cancel() {
    this.curId = -1;
    this.cb = null;
    if (this.busy && this.worker) { this.worker.terminate(); this.spawn(); }
  },
  run(msg, cb) {
    const id = ++this.reqId;
    this.curId = id;
    this.cb = cb;
    const full = { ...msg, id, projVersion: PJ.version, project: engineProjectData() };
    if (this.main) {
      setTimeout(() => {
        if (id !== this.curId) return;
        this.main.handle(full, (d) => { if (d.id === this.curId) cb(d); });
      }, 0);
      return;
    }
    if (!this.worker) { this.pending = { msg, cb }; return; }
    if (this.busy) { this.worker.terminate(); this.spawn(); }
    this.busy = true;
    this.worker.postMessage(full);
  },
};

/* ================= preview state & controls ================= */
const stage = $('#stage');
const cv = $('#cv2d'), ov = $('#cvov'), glHost = $('#gl-host'), cardHost = $('#card-host');
const readout = $('#readout');
const PV = {
  renderer: null, mode: null, evalTimer: 0, status: '', error: '', note: '',
  vals: {},
};
try { PV.vals = JSON.parse(store.get('wgw:pv') || '{}') || {}; } catch { PV.vals = {}; }
const pv = (k, d) => (PV.vals[k] === undefined ? d : PV.vals[k]);
const savePv = () => store.set('wgw:pv', JSON.stringify(PV.vals));
const DIMS = { overworld: [-64, 384, 63], nether: [0, 128, 32], end: [0, 256, 0] };

function seedValue() {
  const s = String($('#seed').value).trim();
  if (!s) return '0';
  if (/^-?\d+$/.test(s)) return BigInt.asIntN(64, BigInt(s)).toString();
  let hsh = 0; // Java String.hashCode, as Minecraft does for text seeds
  for (let i = 0; i < s.length; i++) hsh = (Math.imul(31, hsh) + s.charCodeAt(i)) | 0;
  return String(hsh);
}
function stageSize() {
  const r = stage.getBoundingClientRect();
  return { cw: Math.max(1, r.width), ch: Math.max(1, r.height) };
}
function scheduleEval(delay = 0) {
  clearTimeout(PV.evalTimer);
  PV.evalTimer = setTimeout(() => { if (PV.renderer) runPreview(); }, delay);
}
function setProgress(f) { $('#progress').style.width = f == null ? '0' : Math.round(f * 100) + '%'; }
function setStatus(text, err) {
  PV.status = err ? '' : text || '';
  PV.error = err ? text : '';
  renderStatus();
}
function renderStatus() {
  const el = $('#pv-status');
  el.innerHTML = '';
  if (PV.renderer && PV.renderer.statusExtra) { const x = PV.renderer.statusExtra(); if (x) el.append(x); }
  if (PV.error) el.append(h('span', { class: 'err' }, PV.error));
  else if (PV.status) el.append(h('span', {}, PV.status));
  if (PV.note && !PV.error) el.append(h('span', { class: 'note' }, PV.note));
}
function friendlyError(msg) {
  msg = String(msg);
  const m = /Missing key in (\S+): (\S+)/i.exec(msg);
  if (m) return `Unknown ${m[1].replace(/^minecraft:/, '').replace(/^worldgen\//, '').replace(/_/g, ' ')} ${m[2]}. Create it in the project or pick a vanilla one.`;
  return 'Could not evaluate: ' + msg;
}

/** Control specs: { key, label, type: 'number'|'select'|'check'|'text', def, options, width, step } */
function buildControls(specs) {
  const host = $('#pv-controls');
  host.innerHTML = '';
  host.hidden = !specs.length;
  for (const s of specs) {
    const id = 'pvc-' + s.key;
    let input;
    const val = pv(s.key, s.def);
    if (s.type === 'select') {
      input = h('select', { id }, (typeof s.options === 'function' ? s.options() : s.options).map((o) => {
        const [v, l] = Array.isArray(o) ? o : [o, o];
        return h('option', { value: v, selected: String(val) === String(v) }, l);
      }));
      if (![...input.options].some((o) => o.selected) && input.options.length) input.options[0].selected = true;
    } else if (s.type === 'check') {
      input = h('input', { id, type: 'checkbox', checked: !!val });
    } else if (s.type === 'button') {
      const b = h('button', { class: 'btn', type: 'button', style: { height: '26px' } }, s.label);
      b.addEventListener('click', s.onClick);
      host.append(b);
      continue;
    } else {
      input = h('input', { id, type: s.type === 'text' ? 'text' : 'number', value: val, step: s.step || 1, spellcheck: false });
      if (s.width) input.style.width = s.width + 'px';
    }
    const label = s.type === 'check' ? h('label', { class: 'ctl', for: id }, input, ' ' + s.label) : h('label', { class: 'ctl', for: id }, s.label + ' ', input);
    if (s.title) label.title = s.title;
    host.append(label);
    input.addEventListener(s.type === 'select' || s.type === 'check' ? 'change' : 'input', () => {
      PV.vals[s.key] = s.type === 'check' ? input.checked : s.type === 'number' ? input.value : input.value;
      savePv();
      if (s.onChange) s.onChange(PV.vals[s.key]);
      else scheduleEval(s.type === 'number' ? 200 : 0);
    });
  }
}
const ctlVal = (key, def) => { const el = $('#pvc-' + key); if (!el) return pv(key, def); return el.type === 'checkbox' ? el.checked : el.value; };
const ctlNum = (key, def) => num(ctlVal(key, def));

/* ---------- colour maps ---------- */
const MAPS = {
  viridis: [[0, 68, 1, 84], [0.25, 59, 82, 139], [0.5, 33, 145, 140], [0.75, 94, 201, 98], [1, 253, 231, 37]],
  gray: [[0, 0, 0, 0], [1, 255, 255, 255]],
  diverge: [[0, 33, 102, 172], [0.25, 103, 169, 207], [0.5, 247, 247, 247], [0.75, 239, 138, 98], [1, 178, 24, 43]],
};
const LUT = {};
for (const [k, stops] of Object.entries(MAPS)) {
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let j = 0;
    while (j < stops.length - 2 && t > stops[j + 1][0]) j++;
    const a = stops[j], b = stops[j + 1];
    const u = (t - a[0]) / (b[0] - a[0]);
    for (let c = 0; c < 3; c++) lut[i * 3 + c] = Math.round(a[c + 1] + (b[c + 1] - a[c + 1]) * u);
  }
  LUT[k] = lut;
}
function drawLegend(lo, hi, map) {
  const lg = $('#legend');
  lg.hidden = lo == null;
  if (lg.hidden) return;
  $('#lg-min').textContent = fmt(lo, 2);
  $('#lg-max').textContent = fmt(hi, 2);
  const c = $('#lg-bar').getContext('2d');
  const lut = LUT[map] || LUT.viridis;
  for (let i = 0; i < 90; i++) {
    const k = Math.round((i / 89) * 255) * 3;
    c.fillStyle = `rgb(${lut[k]},${lut[k + 1]},${lut[k + 2]})`;
    c.fillRect(i, 0, 1, 8);
  }
}

/* ================= 2D map view =================
   A pannable, zoomable window onto world coordinates. 'side' shows x across and y up at a fixed z;
   'top' shows x across and z down at a fixed y. Results are computed for the visible window at a
   sample step and painted into an offscreen canvas that is drawn under an overlay of ticks. */
const M2 = {
  orient: 'side', key: '', views: {},
  cur: null, prev: null, hover: null,
  limits: null,     // { minY, maxY, sea } for side views
};
function m2View() {
  const k = M2.key + ':' + M2.orient;
  if (!M2.views[k]) M2.views[k] = M2.orient === 'side' ? { cx: 8, cy: null, s: null } : { cx: 8, cz: 8, s: M2.defaultScale || 0.5 };
  return M2.views[k];
}
function m2Defaults() {
  const v = m2View();
  if (M2.orient === 'side' && v.s == null) {
    const { ch } = stageSize();
    const L = M2.limits || { minY: -64, maxY: 320 };
    v.s = ((L.maxY - L.minY) * 1.06) / ch;
    v.cy = (L.minY + L.maxY) / 2;
  }
}
function m2Window() {
  m2Defaults();
  const { cw, ch } = stageSize();
  const v = m2View();
  const left = v.cx - (cw * v.s) / 2;
  const top = M2.orient === 'side' ? v.cy + (ch * v.s) / 2 : v.cz - (ch * v.s) / 2;
  return { cw, ch, s: v.s, left, top };
}
/** Sample grid for the visible window. `maxSamples` bounds the work; `minStep`/`stepMul` snap the step. */
function m2Params({ maxSamples = 220000, minStep = 1, stepMul = 1, fixed = 0 } = {}) {
  const W = m2Window();
  const xmin = W.left, xmax = W.left + W.cw * W.s;
  let amin, amax;
  const L = M2.limits;
  if (M2.orient === 'side') {
    amin = W.top - W.ch * W.s; amax = W.top;
    if (L) { amin = Math.max(amin, L.minY); amax = Math.min(amax, L.maxY); }
  } else { amin = W.top; amax = W.top + W.ch * W.s; }
  if (amax <= amin) return null;
  let step = Math.max(minStep, Math.round(W.s / stepMul) * stepMul || stepMul);
  step = Math.max(step, minStep);
  while (((xmax - xmin) / step) * ((amax - amin) / step) > maxSamples) step *= 2;
  const x0 = Math.floor(xmin / step) * step;
  const w = Math.ceil((xmax - x0) / step) + 1;
  let a0;
  if (M2.orient === 'side' && L) a0 = L.minY + Math.floor((amin - L.minY) / step) * step;
  else a0 = Math.floor(amin / step) * step;
  let hh = Math.ceil((amax - a0) / step);
  if (M2.orient === 'side' && L) hh = Math.min(hh, Math.ceil((L.maxY - a0) / step));
  return { w, h: Math.max(1, hh), step, x0, a0, fixed };
}
function m2NewResult(p, extra) {
  const r = { orient: M2.orient, key: M2.key, p, data: null, ...extra };
  r.canvas = document.createElement('canvas');
  r.canvas.width = p.w;
  r.canvas.height = p.h;
  r.img = r.canvas.getContext('2d').createImageData(p.w, p.h);
  return r;
}
/** Paints r.data into r.img with `colorAt(index) -> [r,g,b] | null`. Row 0 of the data is the lowest y (side) or lowest z (top). */
function m2Paint(r, colorAt) {
  const { w, h } = r.p;
  const px = r.img.data;
  const side = r.orient === 'side';
  for (let j = 0; j < h; j++) {
    const row = side ? h - 1 - j : j;
    for (let i = 0; i < w; i++) {
      const o = (row * w + i) * 4;
      const c = colorAt(j * w + i, i, j);
      if (c) { px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = c[3] === undefined ? 255 : c[3]; }
      else px[o + 3] = 0;
    }
  }
  r.canvas.getContext('2d').putImageData(r.img, 0, 0);
}
function m2Blit(ctx, r, W) {
  if (!r || !r.canvas || r.orient !== M2.orient || r.key !== M2.key) return;
  const { w, h, step, x0, a0 } = r.p;
  const dx = (x0 - W.left) / W.s;
  const dy = r.orient === 'side' ? (W.top - (a0 + h * step)) / W.s : (a0 - W.top) / W.s;
  ctx.drawImage(r.canvas, dx, dy, (w * step) / W.s, (h * step) / W.s);
}
function niceStep(pxPerBlock, minPx) {
  for (const s of [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384]) if (s * pxPerBlock >= minPx) return s;
  return 32768;
}
function draw2d() {
  const R = PV.renderer, M = R && R.modes().find((m) => m.id === PV.mode);
  if (!M || M.kind !== '2d') return;
  const { cw, ch } = stageSize();
  const dpr = Math.min(2, devicePixelRatio || 1);
  for (const c of [cv, ov]) {
    if (c.width !== Math.round(cw * dpr) || c.height !== Math.round(ch * dpr)) { c.width = Math.round(cw * dpr); c.height = Math.round(ch * dpr); }
  }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = cssVar('--bg');
  ctx.fillRect(0, 0, cw, ch);
  const W = m2Window();
  m2Blit(ctx, M2.prev, W);
  if (M2.cur !== M2.prev) m2Blit(ctx, M2.cur, W);

  const o = ov.getContext('2d');
  o.setTransform(dpr, 0, 0, dpr, 0, 0);
  o.clearRect(0, 0, cw, ch);
  o.font = '11px "IBM Plex Mono", ui-monospace, monospace';
  o.lineWidth = 1;
  const L = M2.limits;
  if (M2.orient === 'side' && L) {
    o.fillStyle = cssVar('--panel');
    const yA = (W.top - L.maxY) / W.s, yB = (W.top - L.minY) / W.s;
    if (yA > 0) o.fillRect(0, 0, cw, yA);
    if (yB < ch) o.fillRect(0, yB, cw, ch - yB);
    if (L.sea != null) {
      const sy = (W.top - L.sea) / W.s;
      o.strokeStyle = 'rgba(80, 150, 255, 0.85)';
      o.setLineDash([6, 4]);
      o.beginPath(); o.moveTo(0, sy + 0.5); o.lineTo(cw, sy + 0.5); o.stroke();
      o.setLineDash([]);
      o.fillStyle = 'rgba(80, 150, 255, 0.95)';
      o.fillText(`sea ${L.sea}`, cw - 56, sy - 4);
    }
  }
  if (R.overlay) R.overlay(o, W);
  const tick = niceStep(1 / W.s, 46);
  o.fillStyle = cssVar('--fg-dim');
  o.strokeStyle = cssVar('--fg-dim');
  o.globalAlpha = 0.9;
  const a0 = M2.orient === 'side' ? W.top - W.ch * W.s : W.top;
  const a1 = M2.orient === 'side' ? W.top : W.top + W.ch * W.s;
  for (let a = Math.ceil(a0 / tick) * tick; a <= a1; a += tick) {
    const y = M2.orient === 'side' ? (W.top - a) / W.s : (a - W.top) / W.s;
    o.beginPath(); o.moveTo(0, Math.round(y) + 0.5); o.lineTo(6, Math.round(y) + 0.5); o.stroke();
    o.fillText(String(a), 9, y + 4);
  }
  const x1 = W.left + W.cw * W.s;
  for (let x = Math.ceil(W.left / tick) * tick; x <= x1; x += tick) {
    const sx = (x - W.left) / W.s;
    o.beginPath(); o.moveTo(Math.round(sx) + 0.5, ch); o.lineTo(Math.round(sx) + 0.5, ch - 6); o.stroke();
    o.fillText(String(x), sx + 3, ch - 8);
  }
  o.globalAlpha = 1;
  o.fillStyle = cssVar('--fg');
  o.fillText(M2.orient === 'side' ? 'x →   y ↑' : 'x →   z ↓', cw - 84, ch - 26);
  if (M2.hover) {
    const { bx, ba, step } = M2.hover;
    const sx = (bx - W.left) / W.s;
    const sy = M2.orient === 'side' ? (W.top - ba - step) / W.s : (ba - W.top) / W.s;
    o.strokeStyle = cssVar('--accent');
    o.lineWidth = 2;
    o.strokeRect(sx, sy, Math.max(3, step / W.s), Math.max(3, step / W.s));
  }
}
function m2Sample(r, bx, ba) {
  if (!r || !r.data || r.orient !== M2.orient || r.key !== M2.key) return undefined;
  const { w, h, step, x0, a0 } = r.p;
  const i = Math.floor((bx - x0) / step), j = Math.floor((ba - a0) / step);
  if (i < 0 || i >= w || j < 0 || j >= h) return undefined;
  return { idx: j * w + i, r };
}
function updateReadout() {
  const R = PV.renderer, M = R && R.modes().find((m) => m.id === PV.mode);
  if (M && M.kind === '3d') { readout.hidden = false; readout.textContent = 'drag: orbit · right-drag: pan · scroll: zoom'; return; }
  if (!M || M.kind !== '2d' || !M2.hover) { readout.hidden = true; return; }
  const { bx, ba } = M2.hover;
  const s = m2Sample(M2.cur, bx, ba) || m2Sample(M2.prev, bx, ba);
  const coords = M2.orient === 'side' ? `x ${bx}  y ${ba}` : `x ${bx}  z ${ba}`;
  const extra = R.hover ? R.hover(s, bx, ba) : '';
  readout.hidden = false;
  readout.textContent = coords + (extra ? '\n' + extra : '');
}
let sDrag = null;
stage.addEventListener('pointerdown', (ev) => {
  if (!m2Active()) return;
  sDrag = { x: ev.clientX, y: ev.clientY, v: { ...m2View() } };
  stage.setPointerCapture(ev.pointerId);
});
const m2Active = () => { const R = PV.renderer; const M = R && R.modes().find((m) => m.id === PV.mode); return !!(M && M.kind === '2d'); };
stage.addEventListener('pointermove', (ev) => {
  if (!m2Active()) return;
  const r = stage.getBoundingClientRect();
  const W = m2Window();
  if (sDrag) {
    const v = m2View();
    v.cx = sDrag.v.cx - (ev.clientX - sDrag.x) * W.s;
    if (M2.orient === 'side') v.cy = sDrag.v.cy + (ev.clientY - sDrag.y) * W.s;
    else v.cz = sDrag.v.cz - (ev.clientY - sDrag.y) * W.s;
    draw2d();
    scheduleEval(140);
  }
  const mx = ev.clientX - r.left, my = ev.clientY - r.top;
  const step = (M2.cur && M2.cur.p.step) || 1;
  const wx = W.left + mx * W.s;
  const wa = M2.orient === 'side' ? W.top - my * W.s : W.top + my * W.s;
  const base = M2.cur ? M2.cur.p : { x0: 0, a0: 0 };
  const bx = base.x0 + Math.floor((wx - base.x0) / step) * step;
  const ba = base.a0 + Math.floor((wa - base.a0) / step) * step;
  M2.hover = { bx, ba, step };
  updateReadout();
  if (!sDrag) draw2d();
});
stage.addEventListener('pointerup', () => { sDrag = null; });
stage.addEventListener('pointerleave', () => { if (m2Active()) { M2.hover = null; updateReadout(); draw2d(); } });
stage.addEventListener('wheel', (ev) => {
  if (!m2Active()) return;
  ev.preventDefault();
  const r = stage.getBoundingClientRect();
  const v = m2View();
  const W = m2Window();
  const mx = ev.clientX - r.left, my = ev.clientY - r.top;
  const wx = W.left + mx * W.s;
  const wa = M2.orient === 'side' ? W.top - my * W.s : W.top + my * W.s;
  const s = Math.min(M2.maxScale || 16, Math.max(1 / 24, v.s * Math.exp(ev.deltaY * 0.0015)));
  v.s = s;
  v.cx = wx - (mx - W.cw / 2) * s;
  if (M2.orient === 'side') v.cy = wa + (my - W.ch / 2) * s;
  else v.cz = wa - (my - W.ch / 2) * s;
  draw2d();
  scheduleEval(140);
}, { passive: false });

/** Runs a 2D task for the visible window and paints partial and final results. */
function run2d(task, msg, paramsOpts, paint, onDone) {
  const p = m2Params(paramsOpts);
  if (!p) { draw2d(); return; }
  const r = m2NewResult(p);
  M2.cur = r;
  setProgress(0.02);
  Engine.run({ task, ...msg, params: p }, (d) => {
    if (M2.cur !== r) return;
    if (d.error) { setProgress(null); setStatus(friendlyError(d.error), true); return; }
    if (d.partial) {
      r.data = d.data; r.palette = d.palette; r.min = d.min; r.max = d.max;
      paint(r);
      draw2d();
      return;
    }
    if (d.done) {
      Object.assign(r, d, { data: d.data });
      setProgress(null);
      paint(r);
      M2.prev = r;
      draw2d();
      updateReadout();
      PV.note = d.note || '';
      if (onDone) onDone(r, d);
    }
  });
}

/* ================= 3D voxel view ================= */
const V3 = { ready: false, loading: null, theta: -0.62, phi: 0.42, radius: 500, target: null, fitKey: '', data: null, focusY: 0, sx: 16 };
function loadThree() {
  if (window.THREE) return Promise.resolve();
  if (!V3.loading) {
    V3.loading = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
      s.onload = res;
      s.onerror = () => { V3.loading = null; rej(new Error('Could not load the 3D renderer (three.js) from cdnjs.')); };
      document.head.append(s);
    });
  }
  return V3.loading;
}
async function init3d() {
  if (V3.ready) return true;
  try { await loadThree(); } catch (err) { setStatus(err.message, true); return false; }
  if (V3.ready) return true;
  const T = window.THREE;
  const renderer = new T.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
  glHost.append(renderer.domElement);
  renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(35, 1, 0.5, 20000);
  Object.assign(V3, { T, renderer, scene, camera, target: new T.Vector3(), ready: true });
  bind3dControls(renderer.domElement);
  resize3d();
  return true;
}
function resize3d() {
  if (!V3.ready) return;
  const { cw, ch } = stageSize();
  V3.renderer.setSize(cw, ch, false);
  V3.camera.aspect = cw / ch;
  V3.camera.updateProjectionMatrix();
  render3d();
}
function is3dMode() { const R = PV.renderer; const M = R && R.modes().find((m) => m.id === PV.mode); return !!(M && M.kind === '3d'); }
function render3d() {
  if (!V3.ready || !is3dMode()) return;
  const { camera, target } = V3;
  const cp = Math.cos(V3.phi);
  camera.position.set(target.x + V3.radius * cp * Math.sin(V3.theta), target.y + V3.radius * Math.sin(V3.phi), target.z + V3.radius * cp * Math.cos(V3.theta));
  camera.lookAt(target);
  V3.renderer.setClearColor(cssVar('--bg') || '#15171c');
  V3.renderer.render(V3.scene, camera);
}
function bind3dControls(el) {
  const ptrs = new Map();
  let last = null, pinch = null;
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  el.addEventListener('pointerdown', (ev) => {
    el.setPointerCapture(ev.pointerId);
    ptrs.set(ev.pointerId, [ev.clientX, ev.clientY]);
    last = { x: ev.clientX, y: ev.clientY, pan: ev.button === 2 || ev.shiftKey || ev.button === 1 };
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), r: V3.radius };
    }
  });
  el.addEventListener('pointermove', (ev) => {
    if (!ptrs.has(ev.pointerId)) return;
    ptrs.set(ev.pointerId, [ev.clientX, ev.clientY]);
    if (ptrs.size === 2 && pinch) {
      const [a, b] = [...ptrs.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      V3.radius = Math.min(6000, Math.max(4, pinch.r * (pinch.d / Math.max(1, d))));
      render3d();
      return;
    }
    const dx = ev.clientX - last.x, dy = ev.clientY - last.y;
    last.x = ev.clientX; last.y = ev.clientY;
    if (last.pan) {
      const T = V3.T;
      const k = V3.radius * 0.0016;
      const right = new T.Vector3().setFromMatrixColumn(V3.camera.matrix, 0);
      const up = new T.Vector3().setFromMatrixColumn(V3.camera.matrix, 1);
      V3.target.addScaledVector(right, -dx * k).addScaledVector(up, dy * k);
      V3.userMoved = true;
    } else {
      V3.theta -= dx * 0.008;
      V3.phi = Math.min(1.55, Math.max(-1.55, V3.phi + dy * 0.008));
    }
    render3d();
  });
  const up = (ev) => { ptrs.delete(ev.pointerId); if (ptrs.size < 2) pinch = null; };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    V3.radius = Math.min(6000, Math.max(4, V3.radius * Math.exp(ev.deltaY * 0.0012)));
    render3d();
  }, { passive: false });
}

const FACES = [
  { n: [1, 0, 0], c: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], shade: 0.8 },
  { n: [-1, 0, 0], c: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]], shade: 0.8 },
  { n: [0, 1, 0], c: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]], shade: 1.0 },
  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], shade: 0.5 },
  { n: [0, 0, 1], c: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]], shade: 0.66 },
  { n: [0, 0, -1], c: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]], shade: 0.66 },
];
const AO = [0.48, 0.66, 0.83, 1];
function hash3(x, y, z) {
  let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
/** Builds a voxel mesh. `kind(i)` returns 0 for empty, 1 for solid and 2 for translucent (water);
    `color(i, x, y, z, face)` returns [r,g,b] in 0..1 for solid voxels. */
function buildVoxels({ sx, sy, sz, kind, color, water, boxLines = true, chunkLines = true }) {
  const T = V3.T;
  const N = sx * sy * sz;
  const k = new Uint8Array(N);
  for (let i = 0; i < N; i++) k[i] = kind(i);
  const I = (x, y, z) => (y * sz + z) * sx + x;
  const S = (x, y, z) => x >= 0 && x < sx && y >= 0 && y < sy && z >= 0 && z < sz && k[I(x, y, z)] === 1;
  const Wt = (x, y, z) => x >= 0 && x < sx && y >= 0 && y < sy && z >= 0 && z < sz && k[I(x, y, z)] === 2;
  let faces = 0, wfaces = 0, solidCount = 0;
  for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
    const v = k[I(x, y, z)];
    if (v === 1) { solidCount++; for (const f of FACES) if (!S(x + f.n[0], y + f.n[1], z + f.n[2])) faces++; }
    else if (v === 2) for (const f of FACES) { const nx = x + f.n[0], ny = y + f.n[1], nz = z + f.n[2]; if (f.n[1] === -1 && ny < 0) continue; if (!S(nx, ny, nz) && !Wt(nx, ny, nz)) wfaces++; }
  }
  const pos = new Float32Array(faces * 12), col = new Float32Array(faces * 12), idx = new Uint32Array(faces * 6);
  const wpos = new Float32Array(wfaces * 12), wcol = new Float32Array(wfaces * 12), widx = new Uint32Array(wfaces * 6);
  const ox = -sx / 2, oy = -sy / 2, oz = -sz / 2;
  let fi = 0, wi = 0;
  const ao = [0, 0, 0, 0];
  const wc = water || [0.24, 0.45, 0.86];
  for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
    const i = I(x, y, z);
    if (k[i] === 1) {
      const jitter = 0.94 + hash3(x, y, z) * 0.1;
      for (const f of FACES) {
        const nx = x + f.n[0], ny = y + f.n[1], nz = z + f.n[2];
        if (S(nx, ny, nz)) continue;
        const c = color(i, x, y, z, f.n);
        const ax = f.n[0] !== 0 ? [1, 2] : f.n[1] !== 0 ? [0, 2] : [0, 1];
        for (let v = 0; v < 4; v++) {
          const cc = f.c[v];
          const d = [0, 0, 0], e = [0, 0, 0];
          d[ax[0]] = cc[ax[0]] ? 1 : -1;
          e[ax[1]] = cc[ax[1]] ? 1 : -1;
          const s1 = S(nx + d[0], ny + d[1], nz + d[2]) ? 1 : 0;
          const s2 = S(nx + e[0], ny + e[1], nz + e[2]) ? 1 : 0;
          const cr = S(nx + d[0] + e[0], ny + d[1] + e[1], nz + d[2] + e[2]) ? 1 : 0;
          ao[v] = s1 && s2 ? 0 : 3 - (s1 + s2 + cr);
          const o = fi * 12 + v * 3;
          pos[o] = x + cc[0] + ox; pos[o + 1] = y + cc[1] + oy; pos[o + 2] = z + cc[2] + oz;
          const kk = f.shade * AO[ao[v]] * jitter;
          col[o] = c[0] * kk; col[o + 1] = c[1] * kk; col[o + 2] = c[2] * kk;
        }
        const b = fi * 4, q = fi * 6;
        if (ao[0] + ao[2] < ao[1] + ao[3]) { idx[q] = b + 1; idx[q + 1] = b + 2; idx[q + 2] = b + 3; idx[q + 3] = b + 1; idx[q + 4] = b + 3; idx[q + 5] = b; }
        else { idx[q] = b; idx[q + 1] = b + 1; idx[q + 2] = b + 2; idx[q + 3] = b; idx[q + 4] = b + 2; idx[q + 5] = b + 3; }
        fi++;
      }
    } else if (k[i] === 2) {
      for (const f of FACES) {
        const nx = x + f.n[0], ny = y + f.n[1], nz = z + f.n[2];
        if (f.n[1] === -1 && ny < 0) continue;
        if (S(nx, ny, nz) || Wt(nx, ny, nz)) continue;
        for (let v = 0; v < 4; v++) {
          const cc = f.c[v];
          const o = wi * 12 + v * 3;
          wpos[o] = x + cc[0] + ox; wpos[o + 1] = y + cc[1] + oy - (f.n[1] === 1 ? 0.12 : 0) * cc[1]; wpos[o + 2] = z + cc[2] + oz;
          wcol[o] = wc[0] * f.shade; wcol[o + 1] = wc[1] * f.shade; wcol[o + 2] = wc[2] * f.shade;
        }
        const b = wi * 4, q = wi * 6;
        widx[q] = b; widx[q + 1] = b + 1; widx[q + 2] = b + 2; widx[q + 3] = b; widx[q + 4] = b + 2; widx[q + 5] = b + 3;
        wi++;
      }
    }
  }
  for (const c of [...V3.scene.children]) {
    V3.scene.remove(c);
    if (c.geometry) c.geometry.dispose();
    if (c.material) c.material.dispose();
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.BufferAttribute(pos, 3));
  g.setAttribute('color', new T.BufferAttribute(col, 3));
  g.setIndex(new T.BufferAttribute(idx, 1));
  V3.scene.add(new T.Mesh(g, new T.MeshBasicMaterial({ vertexColors: true, side: T.DoubleSide })));
  if (wfaces) {
    const wg = new T.BufferGeometry();
    wg.setAttribute('position', new T.BufferAttribute(wpos, 3));
    wg.setAttribute('color', new T.BufferAttribute(wcol, 3));
    wg.setIndex(new T.BufferAttribute(widx, 1));
    const wm = new T.Mesh(wg, new T.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5, depthWrite: false, side: T.DoubleSide }));
    wm.renderOrder = 2;
    V3.scene.add(wm);
  }
  const lineCol = new T.Color(cssVar('--fg-dim') || '#888');
  if (boxLines) V3.scene.add(new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(sx, sy, sz)), new T.LineBasicMaterial({ color: lineCol, transparent: true, opacity: 0.45 })));
  if (chunkLines && sx > 16) {
    const pts = [];
    for (let c = 16; c < sx; c += 16) for (const yy of [oy, oy + sy]) pts.push(ox + c, yy, oz, ox + c, yy, oz + sz, ox, yy, oz + c, ox + sx, yy, oz + c);
    const lg = new T.BufferGeometry();
    lg.setAttribute('position', new T.BufferAttribute(new Float32Array(pts), 3));
    V3.scene.add(new T.LineSegments(lg, new T.LineBasicMaterial({ color: lineCol, transparent: true, opacity: 0.3 })));
  }
  let sum = 0, cols = 0;
  for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
    for (let y = sy - 1; y >= 0; y--) if (k[I(x, y, z)] === 1) { sum += y; cols++; break; }
  }
  V3.focusY = (cols ? sum / cols : sy / 2) + oy;
  V3.sx = Math.max(sx, sz);
  const fitKey = `${PV.renderer && PV.renderer.key}|${sx}x${sy}x${sz}`;
  if (V3.fitKey !== fitKey) { V3.fitKey = fitKey; resetCamera(); }
  else if (!V3.userMoved) V3.target.set(0, V3.focusY, 0);
  render3d();
  return solidCount;
}
function resetCamera() {
  if (!V3.ready) return;
  V3.userMoved = false;
  V3.theta = -0.62;
  V3.phi = 0.42;
  V3.target.set(0, V3.focusY || 0, 0);
  const fov = (V3.camera.fov * Math.PI) / 180;
  V3.radius = (Math.max(V3.sx < 16 ? 24 : 96, V3.sx * 2.6) / 2 / Math.tan(fov / 2)) * 1.1;
  render3d();
}
function clear3d() {
  if (!V3.ready) return;
  for (const c of [...V3.scene.children]) { V3.scene.remove(c); if (c.geometry) c.geometry.dispose(); if (c.material) c.material.dispose(); }
  render3d();
}
/** Mesh for a palette volume from the worker (block names). */
function meshBlocks(d, { showWater = true } = {}) {
  const { sx, sy, sz } = d.dims;
  const cols = d.palette.map((n) => { const c = blockColor(n); return c ? [c[0] / 255, c[1] / 255, c[2] / 255] : null; });
  const fluid = d.palette.map((n) => /water|lava/.test(n));
  const lava = d.palette.map((n) => /lava/.test(n));
  const grassSide = [0.47, 0.35, 0.24];
  const grass = d.palette.map((n) => /grass_block|mycelium|podzol/.test(n));
  return buildVoxels({
    sx, sy, sz,
    kind: (i) => { const p = d.data[i]; if (!cols[p]) return 0; if (fluid[p]) return lava[p] ? 1 : showWater ? 2 : 0; return 1; },
    color: (i, x, y, z, n) => { const p = d.data[i]; return grass[p] && n[1] !== 1 ? grassSide : cols[p]; },
  });
}
