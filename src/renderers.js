/* ================= renderers =================
   One renderer per registry. A renderer lists its modes (2d map, 3d voxels, a canvas it draws itself,
   or an info card), the controls each mode needs, and how to run. TARGET is the open file. */
let TARGET = null; // { path, reg, id, json, error, readOnly, dfJson }
const RENDERERS = {};
const typeOf = (o) => String((o && o.type) || '').replace(/^minecraft:/, '');

function setPreviewTarget(t, { keepMode = true } = {}) {
  const prevKey = PV.renderer && PV.renderer.key;
  TARGET = t;
  const R = t ? RENDERERS[t.reg] || RENDERERS.generic : null;
  $('#preview').classList.toggle('empty', !R);
  if (!R) {
    PV.renderer = null;
    Engine.cancel();
    setProgress(null);
    cv.hidden = ov.hidden = glHost.hidden = cardHost.hidden = readout.hidden = true;
    $('#legend').hidden = true;
    return;
  }
  const changed = !PV.renderer || R.key !== prevKey || !keepMode;
  PV.renderer = R;
  if (changed) {
    const modes = R.modes();
    const want = pv('mode:' + R.key, modes[0].id);
    setPreviewMode(modes.some((m) => m.id === want) ? want : modes[0].id, true);
  } else {
    // same renderer: modes may depend on content (e.g. flat vs noise dimensions)
    const modes = R.modes();
    if (!modes.some((m) => m.id === PV.mode)) setPreviewMode(modes[0].id, true);
    else { buildModeBar(); scheduleEval(80); }
  }
}
function buildModeBar() {
  const R = PV.renderer;
  const g = $('#mode-group');
  g.innerHTML = '';
  for (const m of R.modes()) {
    const b = h('button', { class: 'btn' + (m.id === PV.mode ? ' on' : ''), type: 'button' }, m.label);
    b.addEventListener('click', () => setPreviewMode(m.id));
    g.append(b);
  }
  $('#seed-wrap').hidden = !R.modes().find((m) => m.id === PV.mode && m.seed !== false && m.kind !== 'card');
}
function setPreviewMode(id, silent) {
  const R = PV.renderer;
  if (!R) return;
  const M = R.modes().find((m) => m.id === id) || R.modes()[0];
  PV.mode = M.id;
  PV.vals['mode:' + R.key] = M.id;
  savePv();
  buildModeBar();
  const kind = M.kind;
  cv.hidden = !(kind === '2d' || kind === 'canvas');
  ov.hidden = kind !== '2d';
  glHost.hidden = kind !== '3d';
  cardHost.hidden = kind !== 'card';
  $('#legend').hidden = true;
  if (kind === '2d') {
    M2.orient = M.orient;
    M2.key = R.key + ':' + M.id;
    M2.defaultScale = M.scale || 0.5;
    M2.maxScale = M.maxScale || 16;
    M2.prev = M2.cur = null;
  }
  M2.hover = null;
  buildControls(R.controls ? R.controls(M.id) : []);
  PV.note = '';
  setStatus('');
  updateReadout();
  if (kind === '2d') draw2d();
  if (kind === '3d') render3d();
  if (kind === 'canvas') clearCanvas();
  scheduleEval(silent ? 30 : 0);
}
function clearCanvas() {
  const { cw, ch } = stageSize();
  const dpr = Math.min(2, devicePixelRatio || 1);
  cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr);
  const c = cv.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.fillStyle = cssVar('--bg');
  c.fillRect(0, 0, cw, ch);
  return { c, cw, ch };
}
async function runPreview() {
  const R = PV.renderer;
  if (!R || !TARGET) return;
  const M = R.modes().find((m) => m.id === PV.mode);
  if (TARGET.error && !TARGET.dfJson) { setStatus('Fix the JSON error to update the preview: ' + TARGET.error, true); return; }
  if (TARGET.json === undefined && TARGET.lazy) { setStatus('Loading…'); return; }
  try {
    if (M.kind === '3d' && !(await init3d())) return;
    PV.note = '';
    await R.run(M.id, M);
  } catch (err) {
    setProgress(null);
    setStatus(friendlyError(err.message || err), true);
  }
}
function onPreviewResize() {
  const R = PV.renderer, M = R && R.modes().find((m) => m.id === PV.mode);
  if (!M) return;
  if (M.kind === '3d') resize3d();
  else if (M.kind === '2d') { draw2d(); scheduleEval(150); }
  else if (M.kind === 'canvas') { if (R.redraw) R.redraw(); else scheduleEval(150); }
}

/* ---------- shared helpers ---------- */
const WORLD_OPTIONS = () => {
  const out = [['minecraft:overworld', 'Overworld'], ['minecraft:the_nether', 'Nether'], ['minecraft:the_end', 'End']];
  for (const e of projectEntries('dimension')) if (!out.some((o) => o[0] === e.id)) out.push([e.id, e.id]);
  return out;
};
function settingsFrom(ref) {
  if (ref && typeof ref === 'object') return ref;
  const r = resolveRef('worldgen/noise_settings', ref);
  if (!r || r.json === undefined) throw new Error(`Unknown noise settings ${ref}`);
  if (r.error) throw new Error(`${ref} has a JSON error`);
  return r.json;
}
/** Generator context for a dimension JSON: noise settings, biome source and vertical range. */
function dimensionContext(dim) {
  if (!dim || typeof dim !== 'object') throw new Error('Not a dimension');
  const gen = dim.generator || {};
  const t = typeOf(gen);
  let dt = typeof dim.type === 'string' ? resolveJson('dimension_type', dim.type) : dim.type;
  if (t === 'flat') return { flat: gen.settings || {}, dt };
  if (t !== 'noise') throw new Error(`The ${t || 'unknown'} generator has no preview`);
  const settings = settingsFrom(gen.settings);
  const n = settings.noise || {};
  return { settings, source: gen.biome_source, minY: n.min_y ?? -64, height: n.height ?? 384, sea: settings.sea_level ?? 63, dt };
}
function worldContext(id) {
  const dim = resolveJson('dimension', id);
  if (!dim) throw new Error('Unknown dimension ' + id);
  return dimensionContext(dim);
}
const autoSourceFor = (settings) => {
  const b = String(settings.default_block && (settings.default_block.Name || settings.default_block)) || '';
  if (/netherrack/.test(b)) return { type: 'minecraft:multi_noise', preset: 'minecraft:nether' };
  if (/end_stone/.test(b)) return { type: 'minecraft:the_end' };
  return { type: 'minecraft:multi_noise', preset: 'minecraft:overworld' };
};
function paletteColors(names, { air = null } = {}) {
  return names.map((n) => (/(:|^)(air|cave_air|void_air)$/.test(n) ? air : blockColor(n)));
}

/* ---------- density function views ---------- */
function dfLimits() {
  const d = ctlVal('dim', 'overworld');
  const [minY, height, sea] = DIMS[d] ? DIMS[d] : [ctlNum('min-y', -64), Math.max(16, ctlNum('height', 384)), ctlNum('sea', 63)];
  return { minY, maxY: minY + height, sea: DIMS[d] ? sea : ctlNum('sea', 63), height };
}
const SOLID = { stone: [127, 130, 136], deep: [77, 79, 87], grass: [106, 168, 79], water: [61, 111, 196], sky: [150, 186, 226], air: [36, 40, 48] };
function dfPaint(r) {
  const map = ctlVal('colormap', 'viridis');
  const auto = ctlVal('range', 'fixed') === 'auto' && Number.isFinite(r.min) && Number.isFinite(r.max) && r.max > r.min;
  const lo = auto ? r.min : -1, hi = auto ? r.max : 1;
  const inv = 255 / (hi - lo), lut = LUT[map] || LUT.viridis;
  const L = M2.limits || { sea: 63 };
  const water = ctlVal('water', true);
  const side = r.orient === 'side';
  const { w, step, a0 } = r.p;
  m2Paint(r, (i, x, j) => {
    const v = r.data[i];
    if (Number.isNaN(v)) return null;
    if (map === 'solid') {
      const wy = side ? a0 + j * step : r.p.fixed;
      if (v > 0) {
        const above = side ? r.data[i + w] : -1;
        return side && !(above > 0) && wy + step >= L.sea ? SOLID.grass : wy < 0 ? SOLID.deep : SOLID.stone;
      }
      return water && wy < L.sea ? SOLID.water : side ? SOLID.sky : SOLID.air;
    }
    let k = Math.round((v - lo) * inv);
    k = k < 0 ? 0 : k > 255 ? 255 : k;
    return [lut[k * 3], lut[k * 3 + 1], lut[k * 3 + 2]];
  });
  drawLegend(map === 'solid' ? null : lo, hi, map);
}
const dfHover = (s) => { if (!s) return '…'; const v = s.r.data[s.idx]; return Number.isNaN(v) ? '…' : (v >= 0 ? ' ' : '') + v.toFixed(5); };
function dfControls(mode, { worldCtl = true } = {}) {
  const c = [];
  if (mode === 'side') c.push({ key: 'slice-z', label: 'Z', type: 'number', def: 0, width: 70 });
  if (mode === 'top') c.push({ key: 'slice-y', label: 'Y', type: 'number', def: 64, width: 70 });
  if (mode === '3d') {
    c.push({ key: 'chunk-x', label: 'Chunk', type: 'number', def: 0, width: 56 }, { key: 'chunk-z', label: '', type: 'number', def: 0, width: 56 });
    c.push({ key: 'area', label: 'Area', type: 'select', def: '1', options: [['1', '1×1 chunk'], ['2', '2×2 chunks'], ['3', '3×3 chunks'], ['4', '4×4 chunks']] });
    c.push({ key: 'vox', label: 'Blocks', type: 'select', def: 'terrain', options: [['terrain', 'Terrain'], ['plain', 'Plain stone'], ['height', 'By height']], onChange: () => { if (V3.lastDf) dfMesh(V3.lastDf); } });
    c.push({ type: 'button', key: 'reset', label: 'Reset view', onClick: resetCamera });
  }
  if (worldCtl) {
    c.push({ key: 'dim', label: 'World', type: 'select', def: 'overworld', options: [['overworld', 'Overworld −64…320'], ['nether', 'Nether 0…128'], ['end', 'End 0…256'], ['custom', 'Custom']], onChange: () => { M2.views = {}; buildControls(PV.renderer.controls(PV.mode)); scheduleEval(0); } });
    if (ctlVal('dim', pv('dim', 'overworld')) === 'custom' || pv('dim') === 'custom') {
      c.push({ key: 'min-y', label: 'Min Y', type: 'number', def: -64, width: 64, step: 16 }, { key: 'height', label: 'Height', type: 'number', def: 384, width: 64, step: 16 }, { key: 'sea', label: 'Sea', type: 'number', def: 63, width: 56 });
    }
  }
  if (mode === 'side' || mode === 'top') {
    c.push({ key: 'colormap', label: 'Colors', type: 'select', def: 'viridis', options: [['viridis', 'Viridis'], ['gray', 'Grayscale'], ['diverge', 'Diverging'], ['solid', 'Solid / air']], onChange: repaint2d });
    c.push({ key: 'range', label: 'Range', type: 'select', def: 'fixed', options: [['fixed', '−1 … 1'], ['auto', 'Auto']], onChange: repaint2d });
  }
  c.push({ key: 'water', label: 'Water', type: 'check', def: true, onChange: () => { if (PV.mode === '3d' && V3.lastDf) dfMesh(V3.lastDf); else repaint2d(); } });
  return c;
}
function repaint2d() {
  const R = PV.renderer;
  for (const r of [M2.prev, M2.cur]) if (r && r.data && R.paint) R.paint(r);
  draw2d();
}
function dfMesh(res) {
  const { data, p } = res;
  const { sx, sy, sz, y0 } = p;
  const L = dfLimits();
  const mode = ctlVal('vox', 'terrain');
  const water = ctlVal('water', true);
  const N = sx * sy * sz;
  const I = (x, y, z) => (y * sz + z) * sx + x;
  const mat = new Uint8Array(N);
  if (mode === 'terrain') {
    for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
      let depth = 0, surf = 1;
      for (let y = sy - 1; y >= 0; y--) {
        const i = I(x, y, z);
        if (!(data[i] > 0)) { depth = 0; continue; }
        const wy = y0 + y;
        if (depth === 0) { const wet = y0 + y + 1 < L.sea; surf = wet ? (wy >= L.sea - 6 ? 5 : 6) : 3; mat[i] = surf; }
        else if (depth <= 3) mat[i] = surf === 3 ? 4 : surf;
        else mat[i] = wy < 0 || (wy < 8 && hash3(x, wy, z) * 8 > wy) ? 2 : 1;
        depth++;
      }
    }
  }
  const MAT = { 1: [0.53, 0.545, 0.57], 2: [0.31, 0.32, 0.355], 3: [0.43, 0.66, 0.30], 4: [0.47, 0.35, 0.24], 5: [0.86, 0.81, 0.62], 6: [0.55, 0.52, 0.50], 7: [0.80, 0.81, 0.84] };
  return buildVoxels({
    sx, sy, sz,
    kind: (i) => (data[i] > 0 ? 1 : water && y0 + Math.floor(i / (sx * sz)) < L.sea ? 2 : 0),
    color: (i, x, y, z, n) => {
      if (mode === 'plain') return MAT[7];
      if (mode === 'height') { const k = Math.round(Math.min(1, Math.max(0, y / sy)) * 255) * 3; return [LUT.viridis[k] / 255, LUT.viridis[k + 1] / 255, LUT.viridis[k + 2] / 255]; }
      return mat[i] === 3 && n[1] !== 1 ? [0.42, 0.47, 0.27] : MAT[mat[i]] || MAT[1];
    },
  });
}
/** Evaluates a density function JSON in the current mode. */
function runDensity(json, mode) {
  const L = dfLimits();
  M2.limits = L;
  const base = { json, seed: seedValue() };
  if (mode === '3d') {
    const n = Math.max(1, Math.min(4, +ctlVal('area', '1') || 1));
    const cx = Math.round(ctlNum('chunk-x', 0)), cz = Math.round(ctlNum('chunk-z', 0));
    const off = Math.floor((n - 1) / 2);
    const params = { x0: (cx - off) * 16, z0: (cz - off) * 16, sx: 16 * n, sz: 16 * n, y0: L.minY, sy: L.height };
    setProgress(0.02);
    Engine.run({ task: 'df', ...base, mode: '3d', params }, (d) => {
      if (d.error) { setProgress(null); setStatus(friendlyError(d.error), true); return; }
      if (d.progress != null) { setProgress(d.progress); return; }
      if (d.done) {
        setProgress(null);
        V3.lastDf = { data: d.data, p: params };
        const solid = dfMesh(V3.lastDf);
        setStatus(`${(params.sx * params.sy * params.sz).toLocaleString()} blocks in ${Math.round(d.ms)} ms · ${solid.toLocaleString()} solid · range ${fmt(d.min, 3)} … ${fmt(d.max, 3)}`);
      }
    });
    return;
  }
  const fixed = mode === 'side' ? Math.round(ctlNum('slice-z', 0)) : Math.round(ctlNum('slice-y', 64));
  run2d('df', { ...base, mode }, { fixed }, dfPaint, (r, d) => {
    setStatus(`${(r.p.w * r.p.h).toLocaleString()} samples${r.p.step > 1 ? ` (every ${r.p.step} blocks)` : ''} in ${Math.round(d.ms)} ms · range ${fmt(d.min, 3)} … ${fmt(d.max, 3)}`);
  });
}
RENDERERS['worldgen/density_function'] = {
  key: 'df',
  modes: () => [{ id: 'side', label: 'Side', kind: '2d', orient: 'side' }, { id: 'top', label: 'Top', kind: '2d', orient: 'top' }, { id: '3d', label: '3D chunk', kind: '3d' }],
  controls: (mode) => dfControls(mode),
  paint: dfPaint,
  hover: dfHover,
  run(mode) { runDensity(TARGET.dfJson !== undefined ? TARGET.dfJson : TARGET.json, mode); },
  statusExtra: () => (typeof dfStatusExtra === 'function' ? dfStatusExtra() : null),
};
RENDERERS['worldgen/noise'] = {
  key: 'noise',
  modes: () => [{ id: 'top', label: 'Top', kind: '2d', orient: 'top', scale: 1 }, { id: 'side', label: 'Side', kind: '2d', orient: 'side' }],
  controls: (mode) => [
    ...(mode === 'top' ? [{ key: 'slice-y', label: 'Y', type: 'number', def: 64, width: 70 }] : [{ key: 'slice-z', label: 'Z', type: 'number', def: 0, width: 70 }]),
    { key: 'nxz', label: 'xz scale', type: 'number', def: 1, width: 64, step: 0.1 },
    { key: 'ny', label: 'y scale', type: 'number', def: 1, width: 64, step: 0.1 },
    { key: 'colormap', label: 'Colors', type: 'select', def: 'viridis', options: [['viridis', 'Viridis'], ['gray', 'Grayscale'], ['diverge', 'Diverging']], onChange: repaint2d },
    { key: 'range', label: 'Range', type: 'select', def: 'fixed', options: [['fixed', '−1 … 1'], ['auto', 'Auto']], onChange: repaint2d },
  ],
  paint: dfPaint,
  hover: dfHover,
  run(mode) {
    const p = TARGET.json || {};
    M2.limits = { minY: -64, maxY: 320, height: 384 };
    const amps = Array.isArray(p.amplitude_modifiers) ? p.amplitude_modifiers : [];
    PV.note = `${amps.length} octave${amps.length === 1 ? '' : 's'} from ${p.base_octave ?? p.firstOctave ?? '?'}`;
    const fixed = mode === 'side' ? Math.round(ctlNum('slice-z', 0)) : Math.round(ctlNum('slice-y', 64));
    run2d('df', { json: { type: 'minecraft:noise', noise: TARGET.id, xz_scale: ctlNum('nxz', 1), y_scale: ctlNum('ny', 1) }, seed: seedValue(), mode }, { fixed }, dfPaint, (r, d) => {
      setStatus(`${(r.p.w * r.p.h).toLocaleString()} samples in ${Math.round(d.ms)} ms · range ${fmt(d.min, 3)} … ${fmt(d.max, 3)}`);
    });
  },
};

/* ---------- terrain (noise settings, material rules, dimensions) ---------- */
function biomeOptions() {
  return [['auto', 'Biomes from the dimension'], ...allIds('worldgen/biome').map((id) => [id, short(id)])];
}
function terrainControls(mode, extra = []) {
  const c = [...extra];
  if (mode === 'side') c.push({ key: 'slice-z', label: 'Z', type: 'number', def: 0, width: 70 });
  if (mode === '3d') {
    c.push({ key: 'chunk-x', label: 'Chunk', type: 'number', def: 0, width: 56 }, { key: 'chunk-z', label: '', type: 'number', def: 0, width: 56 });
    c.push({ key: 'tarea', label: 'Area', type: 'select', def: '1', options: [['1', '1×1 chunk'], ['2', '2×2 chunks'], ['3', '3×3 chunks']] });
    c.push({ type: 'button', key: 'reset', label: 'Reset view', onClick: resetCamera });
    c.push({ key: 'water', label: 'Water', type: 'check', def: true, onChange: () => { if (V3.lastBlocks) meshBlocks(V3.lastBlocks, { showWater: ctlVal('water', true) }); } });
  }
  return c;
}
function terrainPaint(r) {
  $('#legend').hidden = true;
  const cols = paletteColors(r.palette || []);
  m2Paint(r, (i) => { const k = r.data[i]; return k === 65535 ? null : cols[k]; });
}
const terrainHover = (s) => { if (!s) return '…'; const k = s.r.data[s.idx]; return k === 65535 ? '…' : short((s.r.palette || [])[k] || '?'); };
/** ctx: { settings, source, fixedBiome } */
function runTerrain(ctx, mode) {
  const n = ctx.settings.noise || {};
  const minY = n.min_y ?? -64, height = n.height ?? 384;
  M2.limits = { minY, maxY: minY + height, sea: ctx.settings.sea_level ?? 63, height };
  const msg = { settings: ctx.settings, source: ctx.source || null, fixedBiome: ctx.fixedBiome || null, seed: seedValue() };
  if (mode === '3d') {
    const params = { cx: Math.round(ctlNum('chunk-x', 0)), cz: Math.round(ctlNum('chunk-z', 0)), n: Math.max(1, Math.min(3, +ctlVal('tarea', '1') || 1)) };
    setProgress(0.02);
    Engine.run({ task: 'terrain3d', ...msg, params }, (d) => {
      if (d.error) { setProgress(null); setStatus(friendlyError(d.error), true); return; }
      if (d.progress != null) { setProgress(d.progress); return; }
      if (d.done) {
        setProgress(null);
        V3.lastBlocks = d;
        const solid = meshBlocks(d, { showWater: ctlVal('water', true) });
        setStatus(`${params.n}×${params.n} chunk${params.n > 1 ? 's' : ''} in ${Math.round(d.ms)} ms · ${solid.toLocaleString()} solid blocks · ${d.palette.length - 1} block types`);
      }
    });
    return;
  }
  const fixed = Math.round(ctlNum('slice-z', 0));
  run2d('terrain', msg, { fixed, maxSamples: 160000 }, terrainPaint, (r, d) => {
    setStatus(`${(r.p.w * r.p.h).toLocaleString()} blocks${r.p.step > 1 ? ` (every ${r.p.step})` : ''} in ${Math.round(d.ms)} ms`);
  });
}
const TERRAIN_MODES = [{ id: 'side', label: 'Terrain slice', kind: '2d', orient: 'side', maxScale: 4 }, { id: '3d', label: '3D chunk', kind: '3d' }];
RENDERERS['worldgen/noise_settings'] = {
  key: 'ns',
  modes: () => TERRAIN_MODES,
  controls: (mode) => terrainControls(mode, [{ key: 'biome', label: 'Surface biome', type: 'select', def: 'auto', options: biomeOptions }]),
  paint: terrainPaint,
  hover: terrainHover,
  run(mode) {
    const settings = TARGET.json;
    const b = ctlVal('biome', 'auto');
    runTerrain({ settings, source: b === 'auto' ? autoSourceFor(settings) : null, fixedBiome: b === 'auto' ? null : b }, mode);
  },
};
RENDERERS['worldgen/material_rule'] = {
  key: 'mr',
  modes: () => [...TERRAIN_MODES, { id: 'info', label: 'Outline', kind: 'card' }],
  controls: (mode) => (mode === 'info' ? [] : terrainControls(mode, [
    { key: 'mr-ns', label: 'Terrain', type: 'select', def: 'minecraft:overworld', options: () => allIds('worldgen/noise_settings').map((i) => [i, short(i)]) },
    { key: 'biome', label: 'Biome', type: 'select', def: 'auto', options: biomeOptions },
  ])),
  paint: terrainPaint,
  hover: terrainHover,
  run(mode) {
    if (mode === 'info') { cardRule(); return; }
    const settings = clone(settingsFrom(ctlVal('mr-ns', 'minecraft:overworld')));
    settings.material_rule = TARGET.readOnly ? TARGET.id : TARGET.json;
    const b = ctlVal('biome', 'auto');
    PV.note = 'Using this rule as the whole material rule.';
    runTerrain({ settings, source: b === 'auto' ? autoSourceFor(settings) : null, fixedBiome: b === 'auto' ? null : b }, mode);
  },
};

/* ---------- biome maps ---------- */
const CLIMATE = ['temperature', 'humidity', 'continentalness', 'erosion', 'depth', 'weirdness'];
function biomePaint(r) {
  const layer = ctlVal('layer', 'biome');
  if (layer !== 'biome' && r.climate) {
    const k = CLIMATE.indexOf(layer);
    const lut = LUT.diverge;
    m2Paint(r, (i) => {
      let t = Math.round(((r.climate[i * 6 + k] + 1) / 2) * 255);
      t = t < 0 ? 0 : t > 255 ? 255 : t;
      return [lut[t * 3], lut[t * 3 + 1], lut[t * 3 + 2]];
    });
    drawLegend(-1, 1, 'diverge');
    return;
  }
  $('#legend').hidden = true;
  const cols = (r.palette || []).map(biomeColor);
  m2Paint(r, (i) => { const k = r.data[i]; return k === 65535 ? null : cols[k]; });
}
function biomeHover(s) {
  if (!s) return '…';
  const k = s.r.data[s.idx];
  if (k === 65535) return '…';
  let t = short((s.r.palette || [])[k] || '?');
  if (s.r.climate) {
    const c = s.r.climate.subarray(s.idx * 6, s.idx * 6 + 6);
    t += `\nT ${c[0].toFixed(2)}  H ${c[1].toFixed(2)}  C ${c[2].toFixed(2)}\nE ${c[3].toFixed(2)}  D ${c[4].toFixed(2)}  W ${c[5].toFixed(2)}`;
  }
  return t;
}
function runBiomeMap(ctx) {
  M2.limits = null;
  const y = Math.round(ctlNum('map-y', 64));
  run2d('biomes', { settings: ctx.settings, source: ctx.source, seed: seedValue() }, { fixed: y, maxSamples: 50000, minStep: 4, stepMul: 4 }, biomePaint, (r, d) => {
    const counts = new Map();
    for (const k of r.data) if (k !== 65535) counts.set(k, (counts.get(k) || 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, c]) => `${short(r.palette[k])} ${Math.round((c / r.data.length) * 100)}%`);
    setStatus(`${r.palette.length} biome${r.palette.length === 1 ? '' : 's'} · ${top.join(', ')} · ${Math.round(d.ms)} ms`);
  });
}
const mapControls = () => [
  { key: 'map-y', label: 'Y', type: 'number', def: 64, width: 64 },
  { key: 'layer', label: 'Show', type: 'select', def: 'biome', options: [['biome', 'Biomes'], ...CLIMATE.map((c) => [c, c[0].toUpperCase() + c.slice(1)])], onChange: repaint2d },
];

/* ---------- dimensions & world presets ---------- */
function dimRenderer(key, getDim, extraControls = () => []) {
  return {
    key,
    modes() {
      let flat = false;
      try { const d = getDim(); flat = typeOf(d && d.generator) === 'flat'; } catch { /* handled on run */ }
      if (flat) return [{ id: 'layers', label: 'Layers', kind: 'card' }, { id: 'info', label: 'Info', kind: 'card' }];
      return [
        { id: 'biomes', label: 'Biome map', kind: '2d', orient: 'top', scale: 8, maxScale: 512 },
        { id: 'side', label: 'Terrain slice', kind: '2d', orient: 'side', maxScale: 4 },
        { id: '3d', label: '3D chunk', kind: '3d' },
        { id: 'info', label: 'Info', kind: 'card' },
      ];
    },
    controls(mode) {
      const ex = extraControls();
      if (mode === 'biomes') return [...ex, ...mapControls()];
      if (mode === 'side' || mode === '3d') return terrainControls(mode, ex);
      return ex;
    },
    paint(r) { if (PV.mode === 'biomes') biomePaint(r); else terrainPaint(r); },
    hover(s) { return PV.mode === 'biomes' ? biomeHover(s) : terrainHover(s); },
    run(mode) {
      const dim = getDim();
      if (mode === 'info') { cardDimension(dim); return; }
      if (mode === 'layers') { cardFlat(dimensionContext(dim).flat, dim); return; }
      const ctx = dimensionContext(dim);
      if (mode === 'biomes') runBiomeMap(ctx);
      else runTerrain(ctx, mode);
    },
  };
}
RENDERERS['dimension'] = dimRenderer('dim', () => TARGET.json);
RENDERERS['worldgen/world_preset'] = dimRenderer('wp', () => {
  const dims = (TARGET.json && TARGET.json.dimensions) || {};
  const k = ctlVal('wp-dim', Object.keys(dims)[0]);
  const d = dims[k] || dims[Object.keys(dims)[0]];
  if (!d) throw new Error('This preset has no dimensions');
  return typeof d === 'string' ? resolveJson('dimension', d) : d;
}, () => [{ key: 'wp-dim', label: 'Dimension', type: 'select', def: 'minecraft:overworld', options: () => Object.keys((TARGET.json && TARGET.json.dimensions) || {}).map((k) => [k, short(k)]), onChange: () => setPreviewTarget(TARGET, { keepMode: false }) }]);

/* ---------- multi-noise parameter lists ---------- */
const PLOT = { r: null };
RENDERERS['worldgen/multi_noise_biome_source_parameter_list'] = {
  key: 'mnp',
  modes: () => [{ id: 'biomes', label: 'Biome map', kind: '2d', orient: 'top', scale: 8, maxScale: 512 }, { id: 'plot', label: 'Climate plot', kind: 'canvas', seed: false }],
  controls(mode) {
    if (mode === 'biomes') return [{ key: 'mnp-ns', label: 'Terrain', type: 'select', def: 'minecraft:overworld', options: () => allIds('worldgen/noise_settings').map((i) => [i, short(i)]) }, ...mapControls()];
    const axis = (key, def) => ({ key, label: key === 'px' ? 'X axis' : 'Y axis', type: 'select', def, options: CLIMATE.map((c) => [c, c]) });
    return [axis('px', 'temperature'), axis('py', 'humidity'), ...CLIMATE.map((c) => ({ key: 'fix-' + c, label: c.slice(0, 4), type: 'number', def: { continentalness: 0.3, erosion: 0.25, weirdness: 0.4 }[c] || 0, width: 58, step: 0.05, title: `${c} (when not an axis)` }))];
  },
  paint: biomePaint,
  hover: biomeHover,
  run(mode) {
    if (mode === 'biomes') {
      const settings = settingsFrom(ctlVal('mnp-ns', 'minecraft:overworld'));
      runBiomeMap({ settings, source: { type: 'minecraft:multi_noise', preset: TARGET.id } });
      return;
    }
    const { cw, ch } = stageSize();
    const size = Math.max(64, Math.min(320, Math.floor(Math.min(cw, ch) - 60)));
    const fixed = Object.fromEntries(CLIMATE.map((c) => [c, ctlNum('fix-' + c, { continentalness: 0.3, erosion: 0.25, weirdness: 0.4 }[c] || 0)]));
    const params = { w: size, h: size, xAxis: ctlVal('px', 'temperature'), yAxis: ctlVal('py', 'humidity'), fixed, range: [-1.2, 1.2] };
    const list = TARGET.json && Array.isArray(TARGET.json.biomes) ? { biomes: TARGET.json.biomes } : { list: TARGET.id };
    Engine.run({ task: 'climate', ...list, params }, (d) => {
      if (d.error) { setStatus(friendlyError(d.error), true); return; }
      PLOT.r = { ...d, params };
      this.redraw();
      setStatus(`${d.palette.length} biomes in this slice of climate space`);
    });
  },
  redraw() {
    const r = PLOT.r;
    const { c, cw, ch } = clearCanvas();
    if (!r) return;
    const { w: pw, h: ph, xAxis, yAxis, range } = r.params;
    const size = Math.min(cw - 70, ch - 60);
    const ox = 56, oy = 16;
    const img = new ImageData(pw, ph);
    const cols = r.palette.map(biomeColor);
    for (let i = 0; i < pw * ph; i++) { const k = cols[r.data[i]]; img.data[i * 4] = k[0]; img.data[i * 4 + 1] = k[1]; img.data[i * 4 + 2] = k[2]; img.data[i * 4 + 3] = 255; }
    const tmp = h('canvas', { width: pw, height: ph });
    tmp.getContext('2d').putImageData(img, 0, 0);
    c.imageSmoothingEnabled = false;
    c.drawImage(tmp, ox, oy, size, size);
    c.fillStyle = cssVar('--fg-dim');
    c.font = '11px "IBM Plex Mono", monospace';
    for (const v of [-1, -0.5, 0, 0.5, 1]) {
      const t = (v - range[0]) / (range[1] - range[0]);
      c.fillText(v.toFixed(1), ox + t * size - 10, oy + size + 14);
      c.fillText(v.toFixed(1), ox - 34, oy + (1 - t) * size + 4);
    }
    c.fillStyle = cssVar('--fg');
    c.fillText(xAxis + ' →', ox + size - 120, oy + size + 30);
    c.save(); c.translate(14, oy + 120); c.rotate(-Math.PI / 2); c.fillText(yAxis + ' →', 0, 0); c.restore();
    PLOT.box = { ox, oy, size };
  },
  canvasHover(mx, my) {
    const r = PLOT.r, b = PLOT.box;
    if (!r || !b) return '';
    const u = (mx - b.ox) / b.size, v = (my - b.oy) / b.size;
    if (u < 0 || u >= 1 || v < 0 || v >= 1) return '';
    const i = Math.floor(u * r.params.w), j = Math.floor(v * r.params.h);
    const rg = r.params.range;
    return `${short(r.palette[r.data[j * r.params.w + i]])}\n${r.params.xAxis} ${(rg[0] + u * (rg[1] - rg[0])).toFixed(2)}  ${r.params.yAxis} ${(rg[1] - v * (rg[1] - rg[0])).toFixed(2)}`;
  },
};

/* ---------- structure sets ---------- */
const SS = { r: null };
RENDERERS['worldgen/structure_set'] = {
  key: 'ss',
  modes: () => [{ id: 'map', label: 'Placement map', kind: '2d', orient: 'top', scale: 16, maxScale: 512 }, { id: 'info', label: 'Info', kind: 'card' }],
  controls: (mode) => (mode === 'info' ? [] : [
    { key: 'ss-world', label: 'World', type: 'select', def: 'minecraft:overworld', options: WORLD_OPTIONS },
    { key: 'ss-check', label: 'Check biomes', type: 'check', def: true },
    { key: 'map-y', label: 'Y', type: 'number', def: 64, width: 60 },
  ]),
  paint(r) {
    if (!r.bgData) return;
    const cols = r.bgPalette.map((n) => { const c = biomeColor(n); return [c[0], c[1], c[2], 150]; });
    m2Paint(r, (i) => cols[r.bgData[i]]);
  },
  hover(s, bx, ba) {
    const r = M2.prev;
    if (!r || !r.list) return '';
    let best = null, bd = Infinity;
    for (const e of r.list) { const d = Math.hypot(e.x - bx, e.z - ba); if (d < bd) { bd = d; best = e; } }
    const W = m2Window();
    if (!best || bd / W.s > 14) return `chunk ${Math.floor(bx / 16)} ${Math.floor(ba / 16)}`;
    return `${short(best.id)}${best.ok ? '' : ' (biome rejects it)'}\nx ${best.x}  z ${best.z}${best.biome ? '\n' + short(best.biome) : ''}`;
  },
  overlay(o, W) {
    const r = M2.prev;
    if (!r || !r.list || r.key !== M2.key) return;
    const ppb = 1 / W.s;
    // spacing grid for random spread placement
    if (r.spacing && r.spacing * 16 * ppb > 10) {
      o.strokeStyle = cssVar('--line-strong');
      o.globalAlpha = 0.6;
      const g = r.spacing * 16;
      for (let x = Math.floor(W.left / g) * g; x < W.left + W.cw * W.s; x += g) { const sx = (x - W.left) * ppb; o.beginPath(); o.moveTo(sx + 0.5, 0); o.lineTo(sx + 0.5, W.ch); o.stroke(); }
      for (let z = Math.floor(W.top / g) * g; z < W.top + W.ch * W.s; z += g) { const sy = (z - W.top) * ppb; o.beginPath(); o.moveTo(0, sy + 0.5); o.lineTo(W.cw, sy + 0.5); o.stroke(); }
      o.globalAlpha = 1;
    }
    const ids = [...new Set(r.list.map((e) => e.id))];
    for (const e of r.list) {
      const sx = (e.x - W.left) * ppb, sy = (e.z - W.top) * ppb;
      if (sx < -10 || sy < -10 || sx > W.cw + 10 || sy > W.ch + 10) continue;
      const col = hashColor(e.id);
      const rad = Math.max(3, Math.min(7, 16 * ppb / 2));
      o.beginPath();
      o.arc(sx, sy, rad, 0, Math.PI * 2);
      o.fillStyle = e.ok ? rgbCss(col) : 'transparent';
      o.fill();
      o.lineWidth = 1.5;
      o.strokeStyle = e.ok ? cssVar('--fg') : cssVar('--fg-dim');
      o.stroke();
    }
    // legend of structures
    o.font = '11px "IBM Plex Sans", sans-serif';
    let y = 18;
    for (const id of ids.slice(0, 8)) {
      o.fillStyle = rgbCss(hashColor(id));
      o.fillRect(W.cw - 150, y - 8, 9, 9);
      o.fillStyle = cssVar('--fg');
      o.fillText(short(id), W.cw - 136, y);
      y += 15;
    }
  },
  run(mode) {
    if (mode === 'info') { cardStructureSet(); return; }
    M2.limits = null;
    const W = m2Window();
    const cx0 = Math.floor(W.left / 16) - 1, cz0 = Math.floor(W.top / 16) - 1;
    const cx1 = Math.ceil((W.left + W.cw * W.s) / 16) + 1, cz1 = Math.ceil((W.top + W.ch * W.s) / 16) + 1;
    const check = ctlVal('ss-check', true);
    const conc = typeOf(TARGET.json && TARGET.json.placement) === 'concentric_rings';
    let ctx = null;
    if (check || conc) ctx = worldContext(ctlVal('ss-world', 'minecraft:overworld'));
    if (ctx && ctx.flat) ctx = null;
    let step = 16;
    while (((cx1 - cx0) * 16 / step) * ((cz1 - cz0) * 16 / step) > 24000) step *= 2;
    const bg = check && ctx ? { x0: cx0 * 16, z0: cz0 * 16, w: Math.ceil((cx1 - cx0) * 16 / step), h: Math.ceil((cz1 - cz0) * 16 / step), step } : null;
    const r = m2NewResult(bg ? { w: bg.w, h: bg.h, step, x0: bg.x0, a0: bg.z0 } : { w: 1, h: 1, step: 1, x0: 0, a0: 0 });
    M2.cur = r;
    setProgress(0.05);
    Engine.run({ task: 'structures', set: TARGET.json, settings: ctx && ctx.settings, source: ctx && ctx.source, check: check && !!ctx, seed: seedValue(), params: { cx0, cz0, cx1, cz1, y: Math.round(ctlNum('map-y', 64)) }, bg }, (d) => {
      if (M2.cur !== r) return;
      setProgress(null);
      if (d.error) { setStatus(friendlyError(d.error), true); return; }
      r.list = d.list;
      r.spacing = d.spacing;
      if (d.bg) { r.bgData = d.bg.data; r.bgPalette = d.bg.palette; r.data = d.bg.data; this.paint(r); }
      M2.prev = r;
      draw2d();
      const ok = d.list.filter((e) => e.ok).length;
      setStatus(`${ok} structure${ok === 1 ? '' : 's'} in view${d.list.length > ok ? ` · ${d.list.length - ok} attempts rejected by biome` : ''}${d.spacing ? ` · spacing ${d.spacing}, separation ${d.separation} chunks` : ''} · ${Math.round(d.ms)} ms`);
    });
  },
};

/* ---------- placed features ---------- */
const PF = { r: null };
RENDERERS['worldgen/placed_feature'] = {
  key: 'pf',
  modes: () => [{ id: 'top', label: 'Top', kind: 'canvas' }, { id: 'side', label: 'Side', kind: 'canvas' }, { id: 'info', label: 'Info', kind: 'card' }],
  controls: (mode) => (mode === 'info' ? [] : [
    { key: 'pf-n', label: 'Area', type: 'select', def: '4', options: [['1', '1 chunk'], ['2', '2×2 chunks'], ['4', '4×4 chunks'], ['8', '8×8 chunks'], ['16', '16×16 chunks']] },
    { key: 'pf-surface', label: 'Surface Y', type: 'number', def: 64, width: 60, title: 'Heightmap placement assumes flat ground at this height' },
    { key: 'dim', label: 'World', type: 'select', def: 'overworld', options: [['overworld', 'Overworld −64…320'], ['nether', 'Nether 0…128'], ['end', 'End 0…256']] },
  ]),
  run(mode) {
    if (mode === 'info') { cardPlaced(); return; }
    const d = DIMS[ctlVal('dim', 'overworld')] || DIMS.overworld;
    const params = { n: +ctlVal('pf-n', '4'), surfaceY: Math.round(ctlNum('pf-surface', 64)), minY: d[0], height: d[1], seaLevel: d[2] };
    Engine.run({ task: 'placement', placed: TARGET.json, seed: seedValue(), params }, (res) => {
      if (res.error) { setStatus(friendlyError(res.error), true); return; }
      PF.r = { ...res, params };
      this.redraw();
      const n = res.data.length / 3;
      PV.note = res.skipped.length ? `Not simulated (always pass): ${res.skipped.join(', ')}` : '';
      setStatus(`${n.toLocaleString()} placement${n === 1 ? '' : 's'} · ${(n / (params.n * params.n)).toFixed(2)} per chunk`);
    });
  },
  redraw() {
    const r = PF.r;
    const { c, cw, ch } = clearCanvas();
    if (!r) return;
    const { n, minY, height } = r.params;
    const side = PV.mode === 'side';
    const pad = 36;
    const span = n * 16;
    const c0 = -Math.floor(n / 2) * 16;
    const sw = cw - pad * 2, sh = ch - pad * 2;
    const sc = side ? Math.min(sw / span, (sh / height) * 6) : Math.min(sw, sh) / span; // side: x may stretch up to 6×
    const scY = side ? sh / height : sc;
    const W = span * sc, H = (side ? height : span) * scY;
    const ox = (cw - W) / 2, oy = (ch - H) / 2;
    c.fillStyle = cssVar('--panel-2');
    c.fillRect(ox, oy, W, H);
    c.strokeStyle = cssVar('--line');
    c.lineWidth = 1;
    for (let i = 0; i <= n; i++) {
      const x = ox + i * 16 * sc;
      c.beginPath(); c.moveTo(x + 0.5, oy); c.lineTo(x + 0.5, oy + H); c.stroke();
      if (!side) { const y = oy + i * 16 * sc; c.beginPath(); c.moveTo(ox, y + 0.5); c.lineTo(ox + W, y + 0.5); c.stroke(); }
    }
    c.fillStyle = cssVar('--fg-dim');
    c.font = '11px "IBM Plex Mono", monospace';
    if (side) {
      for (let y = Math.ceil(minY / 64) * 64; y <= minY + height; y += 64) {
        const py = oy + H - (y - minY) * scY;
        c.fillText(String(y), ox - 32, py + 4);
        c.strokeStyle = cssVar('--line');
        c.beginPath(); c.moveTo(ox, py + 0.5); c.lineTo(ox + W, py + 0.5); c.stroke();
      }
    }
    const lut = LUT.viridis;
    const d = r.data;
    const rad = Math.max(1.5, Math.min(4, Math.min(sc, scY) * 0.6));
    for (let i = 0; i < d.length; i += 3) {
      const x = d[i] - c0, y = d[i + 1], z = d[i + 2] - c0;
      const t = Math.max(0, Math.min(255, Math.round(((y - minY) / height) * 255)));
      c.fillStyle = `rgb(${lut[t * 3]},${lut[t * 3 + 1]},${lut[t * 3 + 2]})`;
      const px = ox + (x + 0.5) * sc, py = side ? oy + H - (y - minY + 0.5) * scY : oy + (z + 0.5) * sc;
      c.beginPath(); c.arc(px, py, rad, 0, Math.PI * 2); c.fill();
    }
    c.fillStyle = cssVar('--fg');
    c.fillText(side ? 'x →   y ↑' : 'x →   z ↓', ox + W - 70, oy + H + 18);
    drawLegend(minY, minY + height, 'viridis');
  },
};

/* ---------- configured features (3D, approximate) ---------- */
RENDERERS['worldgen/feature'] = {
  key: 'cf',
  modes: () => [{ id: '3d', label: '3D', kind: '3d' }, { id: 'info', label: 'Info', kind: 'card' }],
  controls: (mode) => (mode === '3d' ? [{ type: 'button', key: 'reset', label: 'Reset view', onClick: resetCamera }] : []),
  run(mode) {
    if (mode === 'info') { cardFeature(); return; }
    const res = featureVoxels(TARGET.json, seedValue());
    if (!res) { clear3d(); setStatus(`No 3D preview for ${typeOf(TARGET.json) || 'this'} features yet. See Info.`); return; }
    const solid = meshBlocks(res, {});
    setStatus(`${res.label} · ${solid} blocks${res.approx ? ' · approximate shape' : ''}`);
  },
};

/* ---------- info cards for everything else ---------- */
const cardOnly = (key, fn) => ({ key, modes: () => [{ id: 'info', label: 'Info', kind: 'card' }], run: fn });
RENDERERS['worldgen/biome'] = cardOnly('bi', () => cardBiome());
RENDERERS['dimension_type'] = cardOnly('dt', () => cardDimType());
RENDERERS['worldgen/flat_level_generator_preset'] = cardOnly('flat', () => cardFlat(TARGET.json && TARGET.json.settings, null, TARGET.json));
RENDERERS['worldgen/structure'] = cardOnly('st', () => cardStructure());
RENDERERS['worldgen/template_pool'] = cardOnly('tp', () => cardPool());
RENDERERS['worldgen/processor_list'] = cardOnly('pl', () => cardGeneric());
RENDERERS['worldgen/carver'] = cardOnly('cv', () => cardGeneric());
RENDERERS['worldgen/material_condition'] = cardOnly('mc', () => cardRule());
RENDERERS['worldgen/block_state_provider'] = cardOnly('bsp', () => cardGeneric());
RENDERERS['tags/worldgen/biome'] = cardOnly('tag', () => cardTag());
RENDERERS.generic = cardOnly('gen', () => cardGeneric());
RENDERERS.pack = cardOnly('pack', () => cardPack());
