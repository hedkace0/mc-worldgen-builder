/* ================= evaluation engine (worker) ================= */
const Engine = {
  worker: null, url: null, busy: false, reqId: 0, curId: 0, cb: null, main: null, ready: false, failed: false,
  spawn() {
    try {
      if (!this.url) this.url = URL.createObjectURL(new Blob([$('#ds-src').textContent, '\n;\n', $('#engine-src').textContent], { type: 'text/javascript' }));
      const w = new Worker(this.url);
      this.worker = w;
      this.busy = false;
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
    if (d.ready !== undefined) {
      this.ready = true;
      return;
    }
    if (d.id !== this.curId) return;
    if (d.done || d.error) this.busy = false;
    if (this.cb) this.cb(d);
  },
  run(msg, cb) {
    const id = ++this.reqId;
    this.curId = id;
    this.cb = cb;
    if (this.main) {
      setTimeout(() => {
        if (id !== this.curId) return;
        this.main.handle({ ...msg, id }, (d) => { if (d.id === this.curId) cb(d); });
      }, 0);
      return;
    }
    if (!this.worker) { this.pending = { msg, cb }; return; }
    if (this.busy) { this.worker.terminate(); this.spawn(); }
    this.busy = true;
    this.worker.postMessage({ ...msg, id });
  },
};

/* ================= preview state ================= */
const stage = $('#stage');
const cv = $('#cv2d'), ov = $('#cvov'), glHost = $('#gl-host');
const readout = $('#readout');
const P = {
  mode: '3d',
  side: { cx: 8, cy: null, s: null },
  top: { cx: 8, cz: 8, s: 0.5 },
  cur: null,   // result being computed / last computed for 2D
  prev: null,  // last complete 2D result (drawn underneath while recomputing)
  hover: null,
  evalTimer: 0,
  lastStats: '',
  error: '',
};
const DIMS = { overworld: [-64, 384, 63], nether: [0, 128, 32], end: [0, 256, 0] };
const minY = () => Math.round(num($('#min-y').value));
const worldH = () => Math.max(16, Math.round(num($('#height').value)));
const seaLevel = () => Math.round(num($('#sea').value));

function seedValue() {
  const s = $('#seed').value.trim();
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

/* ---------- color maps ---------- */
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
const SOLID = { stone: [127, 130, 136], deep: [77, 79, 87], grass: [106, 168, 79], dirt: [121, 89, 61], water: [61, 111, 196], sky: [150, 186, 226], air: [36, 40, 48] };

function valueRange(r) {
  if ($('#range-mode').value === 'auto' && r && Number.isFinite(r.min) && Number.isFinite(r.max) && r.max > r.min) return [r.min, r.max];
  return [-1, 1];
}
function drawLegend(r) {
  const lg = $('#legend');
  const map = $('#colormap').value;
  lg.hidden = P.mode === '3d' || map === 'solid';
  if (lg.hidden) return;
  const [lo, hi] = valueRange(r);
  $('#lg-min').textContent = fmt(lo, 2);
  $('#lg-max').textContent = fmt(hi, 2);
  const c = $('#lg-bar').getContext('2d');
  const lut = LUT[map];
  for (let i = 0; i < 90; i++) {
    const k = Math.round((i / 89) * 255) * 3;
    c.fillStyle = `rgb(${lut[k]},${lut[k + 1]},${lut[k + 2]})`;
    c.fillRect(i, 0, 1, 8);
  }
}

/* ---------- 2D views ---------- */
function ensureSideDefaults() {
  const { ch } = stageSize();
  if (P.side.s == null) {
    P.side.s = (worldH() * 1.06) / ch;
    P.side.cy = minY() + worldH() / 2;
  }
}
function windowOf(mode) {
  const { cw, ch } = stageSize();
  const v = P[mode];
  const left = v.cx - (cw * v.s) / 2;
  const top = mode === 'side' ? v.cy + (ch * v.s) / 2 : v.cz - (ch * v.s) / 2; // world Y at top edge / world Z at top edge
  return { cw, ch, s: v.s, left, top };
}
function params2d(mode) {
  const W = windowOf(mode);
  const xmin = W.left, xmax = W.left + W.cw * W.s;
  let amin, amax;
  if (mode === 'side') { amin = W.top - W.ch * W.s; amax = W.top; amin = Math.max(amin, minY()); amax = Math.min(amax, minY() + worldH()); }
  else { amin = W.top; amax = W.top + W.ch * W.s; }
  if (amax <= amin) return null;
  let step = Math.max(1, Math.round(W.s));
  while (((xmax - xmin) / step) * ((amax - amin) / step) > 220000) step *= 2;
  const x0 = Math.floor(xmin / step) * step;
  const w = Math.ceil((xmax - x0) / step) + 1;
  let a0;
  if (mode === 'side') a0 = minY() + Math.floor((amin - minY()) / step) * step;
  else a0 = Math.floor(amin / step) * step;
  let hh = Math.ceil((amax - a0) / step);
  if (mode === 'side') hh = Math.min(hh, Math.ceil((minY() + worldH() - a0) / step));
  const fixed = mode === 'side' ? Math.round(num($('#slice-z').value)) : Math.round(num($('#slice-y').value));
  return { w, h: Math.max(1, hh), step, x0, a0, fixed };
}
function paintResult(r) {
  const { w, h, step, a0 } = r.p;
  if (!r.canvas) {
    r.canvas = document.createElement('canvas');
    r.canvas.width = w;
    r.canvas.height = h;
    r.img = r.canvas.getContext('2d').createImageData(w, h);
  }
  const px = r.img.data;
  const map = $('#colormap').value;
  const [lo, hi] = valueRange(r);
  const inv = 255 / (hi - lo);
  const lut = LUT[map];
  const side = r.mode === 'side';
  const sea = seaLevel();
  const water = $('#show-water').checked;
  for (let j = 0; j < r.filled; j++) {
    const row = side ? h - 1 - j : j;
    const wy = side ? a0 + j * step : r.p.fixed;
    for (let i = 0; i < w; i++) {
      const v = r.data[j * w + i];
      const o = (row * w + i) * 4;
      let c;
      if (map === 'solid') {
        if (v > 0) {
          const above = side ? (j + 1 < r.filled ? r.data[(j + 1) * w + i] : -1) : -1;
          c = side && above <= 0 && wy + step >= sea ? SOLID.grass : wy < 0 ? SOLID.deep : SOLID.stone;
        } else c = water && wy < sea ? SOLID.water : side ? SOLID.sky : SOLID.air;
        px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2];
      } else {
        let k = Math.round((v - lo) * inv);
        k = k < 0 ? 0 : k > 255 ? 255 : k;
        if (!Number.isFinite(v)) k = 0;
        px[o] = lut[k * 3]; px[o + 1] = lut[k * 3 + 1]; px[o + 2] = lut[k * 3 + 2];
      }
      px[o + 3] = 255;
    }
  }
  r.canvas.getContext('2d').putImageData(r.img, 0, 0);
}
function blitResult(ctx, r, W) {
  if (!r || !r.canvas || r.mode !== P.mode) return;
  const { w, h, step, x0, a0 } = r.p;
  const dx = (x0 - W.left) / W.s;
  const dw = (w * step) / W.s;
  const dh = (h * step) / W.s;
  const dy = r.mode === 'side' ? (W.top - (a0 + h * step)) / W.s : (a0 - W.top) / W.s;
  if (r.filled < h && r !== P.prev) {
    // draw only computed rows so the previous image shows through underneath
    const sy = r.mode === 'side' ? h - r.filled : 0;
    const fy = r.mode === 'side' ? dy + (sy * step) / W.s : dy;
    ctx.drawImage(r.canvas, 0, sy, w, r.filled, dx, fy, dw, (r.filled * step) / W.s);
  } else ctx.drawImage(r.canvas, dx, dy, dw, dh);
}
function niceStep(pxPerBlock, minPx) {
  for (const s of [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096]) if (s * pxPerBlock >= minPx) return s;
  return 8192;
}
function draw2d() {
  if (P.mode === '3d') return;
  ensureSideDefaults();
  const { cw, ch } = stageSize();
  const dpr = Math.min(2, devicePixelRatio || 1);
  for (const c of [cv, ov]) {
    if (c.width !== Math.round(cw * dpr) || c.height !== Math.round(ch * dpr)) { c.width = Math.round(cw * dpr); c.height = Math.round(ch * dpr); }
  }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
  const css = getComputedStyle(document.documentElement);
  const col = (n) => css.getPropertyValue(n).trim();
  ctx.fillStyle = col('--bg');
  ctx.fillRect(0, 0, cw, ch);
  const W = windowOf(P.mode);
  blitResult(ctx, P.prev, W);
  if (P.cur !== P.prev) blitResult(ctx, P.cur, W);

  // overlay
  const o = ov.getContext('2d');
  o.setTransform(dpr, 0, 0, dpr, 0, 0);
  o.clearRect(0, 0, cw, ch);
  const ppb = 1 / W.s;
  o.font = '11px "IBM Plex Mono", ui-monospace, monospace';
  o.lineWidth = 1;
  if (P.mode === 'side') {
    const yTop = minY() + worldH();
    // outside the world's vertical range
    o.fillStyle = col('--panel');
    const yA = (W.top - yTop) / W.s, yB = (W.top - minY()) / W.s;
    if (yA > 0) o.fillRect(0, 0, cw, yA);
    if (yB < ch) o.fillRect(0, yB, cw, ch - yB);
    // sea level and y=0
    const sy = (W.top - seaLevel()) / W.s;
    o.strokeStyle = 'rgba(80, 150, 255, 0.85)';
    o.setLineDash([6, 4]);
    o.beginPath(); o.moveTo(0, sy + 0.5); o.lineTo(cw, sy + 0.5); o.stroke();
    o.setLineDash([]);
    o.fillStyle = 'rgba(80, 150, 255, 0.95)';
    o.fillText(`sea ${seaLevel()}`, cw - 56, sy - 4);
  }
  // axis ticks
  const tick = niceStep(ppb, 46);
  o.fillStyle = col('--fg-dim');
  o.strokeStyle = col('--fg-dim');
  o.globalAlpha = 0.9;
  const a0 = P.mode === 'side' ? W.top - W.ch * W.s : W.top;
  const a1 = P.mode === 'side' ? W.top : W.top + W.ch * W.s;
  for (let a = Math.ceil(a0 / tick) * tick; a <= a1; a += tick) {
    const y = P.mode === 'side' ? (W.top - a) / W.s : (a - W.top) / W.s;
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
  o.fillStyle = col('--fg');
  o.fillText(P.mode === 'side' ? 'x →   y ↑' : 'x →   z ↓', cw - 84, ch - 26);
  // hover block
  if (P.hover) {
    const { bx, ba } = P.hover;
    const step = (P.cur && P.cur.p.step) || 1;
    const sx = (bx - W.left) / W.s;
    const sy = P.mode === 'side' ? (W.top - ba - step) / W.s : (ba - W.top) / W.s;
    o.strokeStyle = col('--accent');
    o.lineWidth = 2;
    o.strokeRect(sx, sy, Math.max(3, step / W.s), Math.max(3, step / W.s));
  }
  drawLegend(P.prev || P.cur);
}
function sampleAt(r, bx, ba) {
  if (!r || r.mode !== P.mode) return undefined;
  const { w, step, x0, a0 } = r.p;
  const i = Math.floor((bx - x0) / step), j = Math.floor((ba - a0) / step);
  if (i < 0 || i >= w || j < 0 || j >= r.filled) return undefined;
  return r.data[j * w + i];
}
function updateReadout() {
  if (P.mode === '3d') {
    readout.hidden = false;
    readout.textContent = 'drag: orbit · right-drag: pan · scroll: zoom';
    return;
  }
  if (!P.hover) { readout.hidden = true; return; }
  const { bx, ba } = P.hover;
  const step = (P.cur && P.cur.p.step) || 1;
  const sbx = Math.floor(bx / step) * step;
  let v = sampleAt(P.cur, bx, ba);
  if (v === undefined) v = sampleAt(P.prev, bx, ba);
  const coords = P.mode === 'side'
    ? `x ${sbx}  y ${ba}  z ${Math.round(num($('#slice-z').value))}`
    : `x ${sbx}  y ${Math.round(num($('#slice-y').value))}  z ${ba}`;
  readout.hidden = false;
  readout.textContent = `${coords}\n${v === undefined ? '…' : (v >= 0 ? ' ' : '') + v.toFixed(5)}`;
}

/* ---------- 2D interaction ---------- */
let sDrag = null;
stage.addEventListener('pointerdown', (ev) => {
  if (P.mode === '3d') return;
  sDrag = { x: ev.clientX, y: ev.clientY, v: { ...P[P.mode] } };
  stage.setPointerCapture(ev.pointerId);
});
stage.addEventListener('pointermove', (ev) => {
  if (P.mode === '3d') return;
  const r = stage.getBoundingClientRect();
  const W = windowOf(P.mode);
  if (sDrag) {
    const v = P[P.mode];
    v.cx = sDrag.v.cx - (ev.clientX - sDrag.x) * W.s;
    if (P.mode === 'side') v.cy = sDrag.v.cy + (ev.clientY - sDrag.y) * W.s;
    else v.cz = sDrag.v.cz - (ev.clientY - sDrag.y) * W.s;
    draw2d();
    scheduleEval(140);
  }
  const mx = ev.clientX - r.left, my = ev.clientY - r.top;
  const bx = Math.floor(W.left + mx * W.s);
  const step = (P.cur && P.cur.p.step) || 1;
  let ba = P.mode === 'side' ? Math.floor(W.top - my * W.s) : Math.floor(W.top + my * W.s);
  ba = P.cur ? P.cur.p.a0 + Math.floor((ba - P.cur.p.a0) / step) * step : ba;
  P.hover = { bx: Math.floor(bx / step) * step, ba };
  updateReadout();
  if (!sDrag) draw2d();
});
stage.addEventListener('pointerup', () => { sDrag = null; });
stage.addEventListener('pointerleave', () => { if (P.mode !== '3d') { P.hover = null; updateReadout(); draw2d(); } });
stage.addEventListener('wheel', (ev) => {
  if (P.mode === '3d') return;
  ev.preventDefault();
  const r = stage.getBoundingClientRect();
  const v = P[P.mode];
  const W = windowOf(P.mode);
  const mx = ev.clientX - r.left, my = ev.clientY - r.top;
  const wx = W.left + mx * W.s;
  const wa = P.mode === 'side' ? W.top - my * W.s : W.top + my * W.s;
  const s = Math.min(16, Math.max(1 / 24, v.s * Math.exp(ev.deltaY * 0.0015)));
  v.s = s;
  v.cx = wx - (mx - W.cw / 2) * s;
  if (P.mode === 'side') v.cy = wa + (my - W.ch / 2) * s;
  else v.cz = wa - (my - W.ch / 2) * s;
  draw2d();
  scheduleEval(140);
}, { passive: false });

/* ================= 3D chunk pillar ================= */
const V3 = { ready: false, loading: null, theta: -0.62, phi: 0.42, radius: 500, target: null, fitKey: '', data: null };
function loadThree() {
  if (window.THREE) return Promise.resolve();
  if (!V3.loading) {
    V3.loading = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
      s.onload = res;
      s.onerror = () => rej(new Error('Could not load the 3D renderer (three.js) from cdnjs.'));
      document.head.append(s);
    });
  }
  return V3.loading;
}
async function init3d() {
  if (V3.ready) return true;
  try { await loadThree(); } catch (err) { P.error = err.message; renderStatus(); return false; }
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
function render3d() {
  if (!V3.ready || P.mode !== '3d') return;
  const { camera, target } = V3;
  const cp = Math.cos(V3.phi);
  camera.position.set(target.x + V3.radius * cp * Math.sin(V3.theta), target.y + V3.radius * Math.sin(V3.phi), target.z + V3.radius * cp * Math.cos(V3.theta));
  camera.lookAt(target);
  V3.renderer.setClearColor(getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#15171c');
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
      V3.radius = Math.min(6000, Math.max(8, pinch.r * (pinch.d / Math.max(1, d))));
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
    V3.radius = Math.min(6000, Math.max(8, V3.radius * Math.exp(ev.deltaY * 0.0012)));
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
const MAT = {
  1: [0.53, 0.545, 0.57],   // stone
  2: [0.31, 0.32, 0.355],   // deepslate
  3: [0.43, 0.66, 0.30],    // grass top
  4: [0.47, 0.35, 0.24],    // dirt
  5: [0.86, 0.81, 0.62],    // sand
  6: [0.55, 0.52, 0.50],    // gravel
  7: [0.80, 0.81, 0.84],    // plain
};
const GRASS_SIDE = [0.42, 0.47, 0.27];
function hash3(x, y, z) {
  let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
function buildMesh(data, p) {
  const T = V3.T;
  const { sx, sy, sz, y0 } = p;
  const N = sx * sy * sz;
  const sea = seaLevel();
  const showWater = $('#show-water').checked;
  const mode = $('#vox-colors').value;
  const solid = new Uint8Array(N);
  let solidCount = 0;
  for (let i = 0; i < N; i++) if (data[i] > 0) { solid[i] = 1; solidCount++; }
  const I = (x, y, z) => (y * sz + z) * sx + x;
  const S = (x, y, z) => x >= 0 && x < sx && y >= 0 && y < sy && z >= 0 && z < sz && solid[I(x, y, z)] === 1;
  const isWater = (x, y, z) => showWater && y >= 0 && y < sy && x >= 0 && x < sx && z >= 0 && z < sz && !solid[I(x, y, z)] && y0 + y < sea;

  // materials (column scan from the top, like a simple surface rule)
  const mat = new Uint8Array(N);
  if (mode === 'terrain') {
    for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
      let depth = 0, surf = 1;
      for (let y = sy - 1; y >= 0; y--) {
        const i = I(x, y, z);
        if (!solid[i]) { depth = 0; continue; }
        const wy = y0 + y;
        if (depth === 0) {
          const wet = y + 1 < sy && y0 + y + 1 < sea;
          surf = wet ? (wy >= sea - 6 ? 5 : 6) : 3;
          mat[i] = surf;
        } else if (depth <= 3) mat[i] = surf === 3 ? 4 : surf;
        else mat[i] = wy < 0 || (wy < 8 && hash3(x, wy, z) * 8 > wy) ? 2 : 1;
        depth++;
      }
    }
  }
  let faces = 0, wfaces = 0;
  for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
    if (solid[I(x, y, z)]) {
      for (const f of FACES) if (!S(x + f.n[0], y + f.n[1], z + f.n[2])) faces++;
    } else if (isWater(x, y, z)) {
      for (const f of FACES) {
        const nx = x + f.n[0], ny = y + f.n[1], nz = z + f.n[2];
        if (f.n[1] === -1 && ny < 0) continue;
        if (!S(nx, ny, nz) && !isWater(nx, ny, nz)) wfaces++;
      }
    }
  }
  const pos = new Float32Array(faces * 12), col = new Float32Array(faces * 12), idx = new Uint32Array(faces * 6);
  const wpos = new Float32Array(wfaces * 12), wcol = new Float32Array(wfaces * 12), widx = new Uint32Array(wfaces * 6);
  const ox = -sx / 2, oy = -sy / 2, oz = -sz / 2;
  let fi = 0, wi = 0;
  const ao = [0, 0, 0, 0];
  for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
    const i = I(x, y, z);
    if (solid[i]) {
      const wy = y0 + y;
      let base;
      if (mode === 'terrain') base = MAT[mat[i]];
      else if (mode === 'plain') base = MAT[7];
      else {
        const t = Math.min(1, Math.max(0, (wy - y0) / sy));
        const k = Math.round(t * 255) * 3;
        base = [LUT.viridis[k] / 255, LUT.viridis[k + 1] / 255, LUT.viridis[k + 2] / 255];
      }
      const jitter = 0.94 + hash3(x, wy, z) * 0.1;
      for (const f of FACES) {
        const nx = x + f.n[0], ny = y + f.n[1], nz = z + f.n[2];
        if (S(nx, ny, nz)) continue;
        const c = mode === 'terrain' && mat[i] === 3 && f.n[1] !== 1 ? GRASS_SIDE : base;
        // tangent axes for ambient occlusion
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
          const k = f.shade * AO[ao[v]] * jitter;
          col[o] = c[0] * k; col[o + 1] = c[1] * k; col[o + 2] = c[2] * k;
        }
        const b = fi * 4, q = fi * 6;
        if (ao[0] + ao[2] < ao[1] + ao[3]) { idx[q] = b + 1; idx[q + 1] = b + 2; idx[q + 2] = b + 3; idx[q + 3] = b + 1; idx[q + 4] = b + 3; idx[q + 5] = b; }
        else { idx[q] = b; idx[q + 1] = b + 1; idx[q + 2] = b + 2; idx[q + 3] = b; idx[q + 4] = b + 2; idx[q + 5] = b + 3; }
        fi++;
      }
    } else if (isWater(x, y, z)) {
      for (const f of FACES) {
        const nx = x + f.n[0], ny = y + f.n[1], nz = z + f.n[2];
        if (f.n[1] === -1 && ny < 0) continue;
        if (S(nx, ny, nz) || isWater(nx, ny, nz)) continue;
        for (let v = 0; v < 4; v++) {
          const cc = f.c[v];
          const o = wi * 12 + v * 3;
          wpos[o] = x + cc[0] + ox; wpos[o + 1] = y + cc[1] + oy - (f.n[1] === 1 ? 0.12 : 0) * cc[1]; wpos[o + 2] = z + cc[2] + oz;
          const k = f.shade;
          wcol[o] = 0.24 * k; wcol[o + 1] = 0.45 * k; wcol[o + 2] = 0.86 * k;
        }
        const b = wi * 4, q = wi * 6;
        widx[q] = b; widx[q + 1] = b + 1; widx[q + 2] = b + 2; widx[q + 3] = b; widx[q + 4] = b + 2; widx[q + 5] = b + 3;
        wi++;
      }
    }
  }
  // replace scene contents
  for (const ch of [...V3.scene.children]) {
    V3.scene.remove(ch);
    if (ch.geometry) ch.geometry.dispose();
    if (ch.material) ch.material.dispose();
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
  const css = getComputedStyle(document.documentElement);
  const lineCol = new T.Color(css.getPropertyValue('--fg-dim').trim() || '#888');
  const box = new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(sx, sy, sz)), new T.LineBasicMaterial({ color: lineCol, transparent: true, opacity: 0.45 }));
  V3.scene.add(box);
  // chunk borders on the floor/top for multi-chunk areas
  if (sx > 16) {
    const pts = [];
    for (let c = 16; c < sx; c += 16) {
      for (const yy of [oy, oy + sy]) {
        pts.push(ox + c, yy, oz, ox + c, yy, oz + sz, ox, yy, oz + c, ox + sx, yy, oz + c);
      }
    }
    const lg = new T.BufferGeometry();
    lg.setAttribute('position', new T.BufferAttribute(new Float32Array(pts), 3));
    V3.scene.add(new T.LineSegments(lg, new T.LineBasicMaterial({ color: lineCol, transparent: true, opacity: 0.3 })));
  }
  // focus on the terrain surface: mean height of the topmost solid block in each column
  let sum = 0, cols = 0;
  for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
    for (let y = sy - 1; y >= 0; y--) if (solid[I(x, y, z)]) { sum += y; cols++; break; }
  }
  V3.focusY = (cols ? sum / cols : sy / 2) + oy;
  const fitKey = `${sx}x${sy}x${sz}`;
  if (V3.fitKey !== fitKey) {
    V3.fitKey = fitKey;
    resetCamera();
  } else if (!V3.userMoved) {
    V3.target.set(0, V3.focusY, 0);
  }
  render3d();
  return solidCount;
}
function resetCamera() {
  if (!V3.ready) return;
  V3.userMoved = false;
  V3.theta = -0.62;
  V3.phi = 0.42;
  const sx = V3.data ? V3.data.p.sx : 16;
  V3.target.set(0, V3.focusY || 0, 0);
  const fov = (V3.camera.fov * Math.PI) / 180;
  V3.radius = (Math.max(64, sx * 2.4) / 2 / Math.tan(fov / 2)) * 1.1;
  render3d();
}

/* ================= running evaluations ================= */
function previewJson() {
  return exportNode(previewId && G.nodes.has(previewId) ? previewId : 'out');
}
function scheduleEval(delay = 0) {
  clearTimeout(P.evalTimer);
  P.evalTimer = setTimeout(runEval, delay);
}
function setProgress(f) { $('#progress').style.width = f == null ? '0' : Math.round(f * 100) + '%'; }
async function runEval() {
  let json;
  try { json = previewJson(); } catch (err) { P.error = err.message; renderStatus(); return; }
  const base = { json, seed: seedValue(), noises: G.noises, noisesVersion: JSON.stringify(G.noises) };
  if (P.mode === '3d') {
    if (!(await init3d())) return;
    const n = Math.max(1, Math.min(4, +$('#chunk-size').value || 1));
    const cx = Math.round(num($('#chunk-x').value)), cz = Math.round(num($('#chunk-z').value));
    const off = Math.floor((n - 1) / 2);
    const params = { x0: (cx - off) * 16, z0: (cz - off) * 16, sx: 16 * n, sz: 16 * n, y0: minY(), sy: worldH() };
    setProgress(0.02);
    Engine.run({ ...base, mode: '3d', params }, (d) => {
      if (d.error) { P.error = d.error; setProgress(null); renderStatus(); return; }
      if (d.progress != null) { setProgress(d.progress); return; }
      if (d.done) {
        setProgress(null);
        P.error = '';
        V3.data = { data: d.data, p: params };
        const solidCount = buildMesh(d.data, params);
        P.lastStats = `${(params.sx * params.sy * params.sz).toLocaleString()} blocks in ${Math.round(d.ms)} ms · ${solidCount.toLocaleString()} solid · range ${fmt(d.min, 3)} … ${fmt(d.max, 3)}`;
        renderStatus();
      }
    });
    return;
  }
  ensureSideDefaults();
  const mode = P.mode;
  const p = params2d(mode);
  if (!p) { draw2d(); return; }
  const r = { mode, p, data: new Float32Array(p.w * p.h), filled: 0, min: Infinity, max: -Infinity };
  P.cur = r;
  setProgress(0.02);
  Engine.run({ ...base, mode, params: p }, (d) => {
    if (P.cur !== r) return;
    if (d.error) { P.error = d.error; setProgress(null); renderStatus(); return; }
    if (d.partial) {
      r.data.set(d.data, d.row * p.w);
      r.filled = d.row + d.rows;
      r.min = d.min; r.max = d.max;
      setProgress(r.filled / p.h);
      paintResult(r);
      draw2d();
      return;
    }
    if (d.done) {
      r.data = d.data;
      r.filled = p.h;
      r.min = d.min; r.max = d.max;
      setProgress(null);
      P.error = '';
      paintResult(r);
      P.prev = r;
      draw2d();
      updateReadout();
      P.lastStats = `${(p.w * p.h).toLocaleString()} samples${p.step > 1 ? ` (every ${p.step} blocks)` : ''} in ${Math.round(d.ms)} ms · range ${fmt(d.min, 3)} … ${fmt(d.max, 3)}`;
      renderStatus();
    }
  });
}
function renderStatus() {
  const el = $('#pv-status');
  el.innerHTML = '';
  if (previewId && G.nodes.has(previewId)) {
    const t = h('span', { class: 'target' }, 'Previewing ', h('b', {}, titleOf(previewId)));
    const b = h('button', { type: 'button' }, 'show final density');
    b.addEventListener('click', () => setPreview(null));
    t.append(b);
    el.append(t);
  }
  if (P.error) el.append(h('span', { class: 'err' }, friendlyError(P.error)));
  else if (P.lastStats) el.append(h('span', {}, P.lastStats));
}
function friendlyError(msg) {
  const m = /Missing key (.+?) in registry (\S+)/i.exec(msg) || /(\S+:\S+).*not.*found/i.exec(msg);
  if (m && m[2] && m[2].includes('noise')) return `Unknown noise ${m[1]}. Pick one from the list or define it under Noises.`;
  if (m && m[2] && m[2].includes('density_function')) return `Unknown density function ${m[1]}. Only vanilla references can be previewed.`;
  return 'Could not evaluate: ' + msg;
}
function setPreview(id) {
  const old = previewId;
  previewId = id;
  for (const nid of [old, id]) if (nid && G.nodes.has(nid)) renderNode(G.nodes.get(nid));
  redrawWires();
  renderStatus();
  scheduleEval(0);
}
function rerender2dColors() {
  for (const r of [P.prev, P.cur]) if (r && r.canvas) paintResult(r);
  draw2d();
}
