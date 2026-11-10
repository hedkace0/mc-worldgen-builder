/* ================= node types ================= */
const CATS = [
  ['input', 'Inputs', '--c-input'],
  ['noise', 'Noise', '--c-noise'],
  ['math', 'Math', '--c-math'],
  ['shape', 'Shaping', '--c-shape'],
  ['select', 'Selection', '--c-select'],
  ['util', 'Caching & blending', '--c-util'],
  ['out', 'Output', '--c-out'],
];
const CAT_COLOR = Object.fromEntries(CATS.map(([k, , c]) => [k, `var(${c})`]));
const TYPES = {};
function def(type, cat, title, rows = [], opts = {}) { TYPES[type] = { type, cat, title, rows, ...opts }; }
const IN = (key, label, dflt = 0, o = {}) => ({ kind: 'in', key, label: label || key, dflt, ...o });
const NUM = (key, label, dflt, o = {}) => ({ kind: 'num', key, label, dflt, ...o });
const ENUM = (key, label, options, dflt, o = {}) => ({ kind: 'enum', key, label, options, dflt, ...o });
const NOISE = (dflt = 'minecraft:cave_cheese') => ({ kind: 'noise', key: 'noise', label: 'noise', dflt });

def('constant', 'input', 'Constant', [NUM('value', 'value', 0)], { exportAs: (n) => num(n.v.value) });
def('reference', 'input', 'Reference', [{ kind: 'ref', key: 'id', label: 'id', dflt: 'minecraft:overworld/continents' }], { exportAs: (n) => n.v.id });
def('gradient', 'input', 'Gradient', [
  ENUM('axis', 'axis', ['x', 'y', 'z'], 'y'),
  ENUM('tiling', 'tiling', ['clamp_to_edge', 'repeat', 'mirrored_repeat'], 'clamp_to_edge', { omitDefault: true }),
  NUM('from_coordinate', 'from coord', -64, { int: true }), NUM('from_value', 'from value', 1),
  NUM('to_coordinate', 'to coord', 320, { int: true }), NUM('to_value', 'to value', -1),
]);
def('distance_to_point', 'input', 'Distance to point', [
  { kind: 'vec3', key: 'point', label: 'point', dflt: [0, 0, 0] },
  ENUM('metric', 'metric', ['euclidean', 'euclidean_squared', 'manhattan', 'chebyshev'], 'euclidean'),
]);
def('end_outer_islands', 'input', 'End outer islands');

def('noise', 'noise', 'Noise', [
  NOISE(), NUM('xz_scale', 'xz scale', 1), NUM('y_scale', 'y scale', 1),
  IN('shift_x', 'shift x', null, { optional: true }), IN('shift_y', 'shift y', null, { optional: true }), IN('shift_z', 'shift z', null, { optional: true }),
]);
def('shift_a', 'noise', 'Shift A', [NOISE('minecraft:offset')]);
def('shift_b', 'noise', 'Shift B', [NOISE('minecraft:offset')]);
def('shift', 'noise', 'Shift', [NOISE('minecraft:offset')]);
def('old_blended_noise', 'noise', 'Old blended noise', [
  NUM('xz_scale', 'xz scale', 0.25), NUM('y_scale', 'y scale', 0.125), NUM('xz_factor', 'xz factor', 80),
  NUM('y_factor', 'y factor', 160), NUM('smear_scale_multiplier', 'smear scale', 8),
]);

for (const [t, title, a, b] of [['add', 'Add', 0, 0], ['sub', 'Subtract', 0, 0], ['mul', 'Multiply', 1, 1], ['div', 'Divide', 1, 1], ['min', 'Min', 0, 0], ['max', 'Max', 0, 0]]) {
  def(t, 'math', title, [IN('left', 'left', a), IN('right', 'right', b)]);
}
def('pow', 'math', 'Power', [IN('base', 'base', 0), IN('exponent', 'exponent', 2)]);
def('lerp', 'math', 'Lerp', [IN('alpha', 'alpha', 0.5), IN('first', 'first', 0), IN('second', 'second', 1)]);

for (const [t, title] of [['abs', 'Abs'], ['square', 'Square'], ['cube', 'Cube'], ['sqrt', 'Square root'], ['half_negative', 'Half negative'],
  ['quarter_negative', 'Quarter negative'], ['squeeze', 'Squeeze'], ['reciprocal', 'Reciprocal'], ['negate', 'Negate'], ['log', 'Log'], ['sign', 'Sign']]) {
  def(t, 'shape', title, [IN('input', 'input', 0)]);
}
def('clamp', 'shape', 'Clamp', [IN('input', 'input', 0), NUM('min', 'min', -1), NUM('max', 'max', 1)]);
for (const [t, title] of [['floor', 'Floor'], ['round', 'Round'], ['ceil', 'Ceil'], ['truncate', 'Truncate']]) {
  def(t, 'shape', title, [IN('input', 'input', 0), IN('multiple', 'multiple', 1)]);
}

def('range_choice', 'select', 'Range choice', [
  IN('input', 'input', 0), NUM('min_inclusive', 'min (incl.)', 0), NUM('max_exclusive', 'max (excl.)', 1),
  IN('when_in_range', 'in range', 1), IN('when_out_of_range', 'out of range', 0),
]);
def('interval_select', 'select', 'Interval select', [], { custom: 'interval' });
def('spline', 'select', 'Spline', [], { custom: 'spline' });

def('cache', 'util', 'Cache', [IN('input', 'input', 0)]);
def('interpolated', 'util', 'Interpolated', [IN('input', 'input', 0), NUM('cell_size_xz', 'cell xz', 4, { int: true }), NUM('cell_size_y', 'cell y', 8, { int: true })]);
def('blend_density', 'util', 'Blend density', [IN('input', 'input', 0)]);
def('blend_alpha', 'util', 'Blend alpha');
def('blend_offset', 'util', 'Blend offset');
def('beardifier', 'util', 'Beardifier');
def('slice', 'util', 'Slice', [ENUM('axis', 'axis', ['x', 'y', 'z'], 'y'), NUM('coordinate', 'coordinate', 0, { int: true }), IN('input', 'input', 0)]);
def('find_top_surface', 'util', 'Find top surface', [
  IN('density', 'density', 0), IN('upper_bound', 'upper bound', 320), NUM('lower_bound', 'lower bound', -64, { int: true }), NUM('cell_height', 'cell height', 8, { int: true }),
]);
def('output', 'out', 'Final density', [IN('input', 'density', 0)], { noAdd: true });


/* ================= graph model ================= */
const G = { nodes: new Map(), edges: [], nextId: 1 };
let previewId = null;
const selection = new Set();

function newNode(type, x = 0, y = 0) {
  const T = TYPES[type];
  const n = { id: type === 'output' ? 'out' : 'n' + G.nextId++, type, x, y, v: {}, inl: {} };
  for (const r of T.rows) {
    if (r.kind === 'in') { if (r.dflt != null) n.inl[r.key] = r.dflt; }
    else n.v[r.key] = clone(r.dflt);
  }
  if (T.custom === 'spline') {
    n.inl.coordinate = 0;
    n.v.points = [{ location: -1, value: -1, derivative: 0 }, { location: 1, value: 1, derivative: 0 }];
  }
  if (T.custom === 'interval') {
    n.inl.input = 0;
    n.v.thresholds = [0];
    n.inl.fn0 = -1;
    n.inl.fn1 = 1;
  }
  G.nodes.set(n.id, n);
  return n;
}
const edgeInto = (dst, port) => G.edges.find((e) => e.dst === dst && e.port === port);
const portIsSpline = (n, key) => n.type === 'spline' && /^p\d+$/.test(key);
function inputsOf(id) {
  const n = G.nodes.get(id);
  return G.edges.filter((e) => e.dst === id).sort((a, b) => portOrder(n, a.port) - portOrder(n, b.port)).map((e) => e.src);
}
function portOrder(n, key) {
  const T = TYPES[n.type];
  const i = T.rows.findIndex((r) => r.key === key);
  if (i >= 0) return i;
  const m = /^(?:p|fn)(\d+)$/.exec(key);
  if (m) return 10 + +m[1];
  return key === 'coordinate' || key === 'input' ? 0 : 99;
}
function dependsOn(src, target) {
  // true if `src` (transitively) reads from `target`
  const stack = [src], seen = new Set();
  while (stack.length) {
    const id = stack.pop();
    if (id === target) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const e of G.edges) if (e.dst === id) stack.push(e.src);
  }
  return false;
}
function canConnect(src, dst, port) {
  if (src === dst) return false;
  const s = G.nodes.get(src), d = G.nodes.get(dst);
  if (!s || !d || s.type === 'output') return false;
  if (portIsSpline(d, port) && s.type !== 'spline') return false;
  if (dependsOn(src, dst)) return false;
  return true;
}
function connect(src, dst, port) {
  if (!canConnect(src, dst, port)) return false;
  G.edges = G.edges.filter((e) => !(e.dst === dst && e.port === port));
  G.edges.push({ src, dst, port });
  return true;
}
function disconnect(dst, port) { G.edges = G.edges.filter((e) => !(e.dst === dst && e.port === port)); }
function removeNode(id) {
  if (id === 'out') return;
  const affected = new Set(G.edges.filter((e) => e.src === id).map((e) => e.dst));
  G.edges = G.edges.filter((e) => e.src !== id && e.dst !== id);
  G.nodes.delete(id);
  selection.delete(id);
  if (previewId === id) previewId = null;
  const el = nodeEls.get(id);
  if (el) el.remove();
  nodeEls.delete(id);
  for (const a of affected) if (G.nodes.has(a)) renderNode(G.nodes.get(a));
}
function titleOf(id) {
  const n = G.nodes.get(id);
  if (!n) return '?';
  const T = TYPES[n.type];
  if (n.type === 'reference') return short(n.v.id);
  if (n.type === 'constant') return fmt(num(n.v.value));
  if (n.type === 'noise' || n.type.startsWith('shift')) return `${T.title} · ${short(n.v.noise)}`;
  return T.title;
}

/* ================= serialization & history ================= */
function serialize() {
  return JSON.stringify({
    nodes: [...G.nodes.values()].map(({ id, type, x, y, v, inl }) => ({ id, type, x: Math.round(x), y: Math.round(y), v, inl })),
    edges: G.edges, nextId: G.nextId,
  });
}
function deserialize(str) {
  const s = JSON.parse(str);
  G.nodes.clear();
  for (const n of s.nodes) if (TYPES[n.type]) G.nodes.set(n.id, { ...n, v: n.v || {}, inl: n.inl || {} });
  if (!G.nodes.has('out')) newNode('output', 0, 0);
  G.edges = (s.edges || []).filter((e) => G.nodes.has(e.src) && G.nodes.has(e.dst));
  G.nextId = s.nextId || 1;
  if (previewId && !G.nodes.has(previewId)) previewId = null;
  for (const id of [...selection]) if (!G.nodes.has(id)) selection.delete(id);
}
const history = { stack: [], idx: -1 };
function commit() {
  const s = serialize();
  if (history.stack[history.idx] === s) return;
  history.stack.splice(history.idx + 1);
  history.stack.push(s);
  if (history.stack.length > 120) history.stack.shift();
  history.idx = history.stack.length - 1;
  graphCommitted(s);
  updateHistoryButtons();
}
function undo() { if (history.idx > 0) { history.idx--; restore(history.stack[history.idx]); } }
function redo() { if (history.idx < history.stack.length - 1) { history.idx++; restore(history.stack[history.idx]); } }
function restore(s) {
  deserialize(s);
  graphCommitted(s);
  renderAll();
  graphChanged();
  updateHistoryButtons();
}
function updateHistoryButtons() {
  const u = $('#btn-undo'), r = $('#btn-redo');
  if (u) u.disabled = history.idx <= 0;
  if (r) r.disabled = history.idx >= history.stack.length - 1;
}

/* ================= export: graph -> density function JSON ================= */
function portValue(n, key, row, seen) {
  const e = edgeInto(n.id, key);
  if (e) return exportNode(e.src, seen);
  const v = n.inl[key];
  if (row && row.optional && (v === undefined || v === null || v === '')) return undefined;
  return num(v);
}
function splineObj(n, seen) {
  const points = n.v.points.map((p, i) => {
    const e = edgeInto(n.id, 'p' + i);
    let value = num(p.value);
    if (e) {
      const src = G.nodes.get(e.src);
      if (seen.has(src.id)) throw new Error('Loop in graph');
      seen.add(src.id);
      value = splineObj(src, seen);
      seen.delete(src.id);
    }
    return { location: num(p.location), value, derivative: num(p.derivative) };
  });
  points.sort((a, b) => a.location - b.location);
  return { coordinate: portValue(n, 'coordinate', null, seen), points };
}
function exportNode(id, seen = new Set()) {
  const n = G.nodes.get(id);
  if (!n) return 0;
  if (seen.has(id)) throw new Error('Loop in graph');
  seen.add(id);
  try {
    const T = TYPES[n.type];
    if (n.type === 'output') return portValue(n, 'input', null, seen);
    if (T.exportAs) return T.exportAs(n);
    const o = { type: 'minecraft:' + n.type };
    if (T.custom === 'spline') {
      o.spline = splineObj(n, seen);
      return o;
    }
    if (T.custom === 'interval') {
      o.input = portValue(n, 'input', null, seen);
      o.thresholds = n.v.thresholds.map((t) => num(t));
      o.functions = n.v.thresholds.concat([0]).map((_, i) => portValue(n, 'fn' + i, null, seen));
      return o;
    }
    for (const r of T.rows) {
      if (r.kind === 'in') {
        const v = portValue(n, r.key, r, seen);
        if (v !== undefined) o[r.key] = v;
      } else if (r.kind === 'num') o[r.key] = num(n.v[r.key], r);
      else if (r.kind === 'enum') { if (!(r.omitDefault && n.v[r.key] === r.dflt)) o[r.key] = n.v[r.key]; }
      else if (r.kind === 'noise' || r.kind === 'ref') o[r.key] = n.v[r.key];
      else if (r.kind === 'vec3') o[r.key] = (n.v[r.key] || [0, 0, 0]).map((x) => num(x));
    }
    return o;
  } finally {
    seen.delete(id);
  }
}

/* ================= import: density function JSON -> graph ================= */
const LEGACY_CACHE = new Set(['flat_cache', 'cache_2d', 'cache_once', 'cache_all_in_cell']);
const UNARY = new Set(['abs', 'square', 'cube', 'sqrt', 'half_negative', 'quarter_negative', 'squeeze', 'reciprocal', 'negate', 'log', 'sign']);
const BINARY = new Set(['add', 'sub', 'mul', 'div', 'min', 'max']);
let importWarnings = [];
/** Converts pre-26.x density function JSON (1.18–1.21 style) into the current format. */
function normalize(obj) {
  if (obj == null || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  if (!obj.type && obj.coordinate !== undefined && obj.points) {
    return { coordinate: normalize(obj.coordinate), points: obj.points.map((p) => ({ ...p, value: normalize(p.value) })) };
  }
  const t = String(obj.type || '').replace(/^minecraft:/, '');
  const o = { ...obj };
  if (t === 'y_clamped_gradient') {
    return { type: 'minecraft:gradient', axis: 'y', from_coordinate: o.from_y, from_value: o.from_value, to_coordinate: o.to_y, to_value: o.to_value };
  }
  if (LEGACY_CACHE.has(t)) return { type: 'minecraft:cache', input: normalize(o.argument ?? o.input) };
  if (t === 'shifted_noise') {
    const r = { type: 'minecraft:noise', noise: o.noise, xz_scale: o.xz_scale, y_scale: o.y_scale };
    for (const k of ['shift_x', 'shift_y', 'shift_z']) if (o[k] !== undefined && o[k] !== 0) r[k] = normalize(o[k]);
    return r;
  }
  if (t === 'weird_scaled_sampler') {
    importWarnings.push('weird_scaled_sampler has no 26.x equivalent and was replaced by its plain noise.');
    return { type: 'minecraft:noise', noise: o.noise, xz_scale: 1, y_scale: 1 };
  }
  if (t === 'constant') return typeof o.argument === 'number' ? o.argument : (o.value ?? 0);
  if (BINARY.has(t)) return { type: o.type, left: normalize(o.argument1 ?? o.left), right: normalize(o.argument2 ?? o.right) };
  if (UNARY.has(t) || t === 'cache' || t === 'interpolated' || t === 'blend_density') {
    const r = { ...o, input: normalize(o.argument ?? o.input) };
    delete r.argument;
    return r;
  }
  if (t === 'spline') {
    const sp = o.spline;
    return { type: o.type, spline: typeof sp === 'object' ? normalize(sp) : sp };
  }
  for (const [k, v] of Object.entries(o)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) o[k] = normalize(v);
    if (Array.isArray(v) && k === 'functions') o[k] = v.map(normalize);
  }
  return o;
}

/** Builds nodes for a density function value. Returns {id} for a node or {num} for a bare number. */
function buildFrom(obj, created) {
  if (typeof obj === 'number') return { num: obj };
  if (typeof obj === 'string') {
    const n = newNode('reference');
    n.v.id = obj.includes(':') ? obj : 'minecraft:' + obj;
    created.push(n.id);
    return { id: n.id };
  }
  if (!obj || typeof obj !== 'object') return { num: 0 };
  const t = String(obj.type || '').replace(/^minecraft:/, '');
  const T = TYPES[t];
  if (!T || T.noAdd) {
    importWarnings.push(`Unknown type "${obj.type}" was replaced with 0.`);
    return { num: 0 };
  }
  if (t === 'constant') return { num: Number(obj.value ?? obj.argument ?? 0) };
  if (t === 'spline') {
    if (typeof obj.spline === 'number') return { num: obj.spline };
    return { id: buildSpline(obj.spline || {}, created) };
  }
  const n = newNode(t);
  created.push(n.id);
  const attach = (key, val, optional) => {
    if (val === undefined) {
      if (optional) delete n.inl[key];
      return;
    }
    const r = buildFrom(val, created);
    if (r.id) { G.edges.push({ src: r.id, dst: n.id, port: key }); delete n.inl[key]; }
    else n.inl[key] = r.num;
  };
  if (T.custom === 'interval') {
    n.v.thresholds = (obj.thresholds || []).map(Number);
    delete n.inl.fn0; delete n.inl.fn1;
    attach('input', obj.input);
    (obj.functions || []).forEach((f, i) => attach('fn' + i, f));
    for (let i = 0; i <= n.v.thresholds.length; i++) if (!edgeInto(n.id, 'fn' + i) && n.inl['fn' + i] === undefined) n.inl['fn' + i] = 0;
    return { id: n.id };
  }
  for (const r of T.rows) {
    if (r.kind === 'in') attach(r.key, obj[r.key], r.optional);
    else if (obj[r.key] !== undefined) {
      if (r.kind === 'vec3') n.v[r.key] = (obj[r.key] || [0, 0, 0]).slice(0, 3).map(Number);
      else if (r.kind === 'noise') n.v[r.key] = String(obj[r.key]).includes(':') ? obj[r.key] : 'minecraft:' + obj[r.key];
      else n.v[r.key] = obj[r.key];
    }
  }
  return { id: n.id };
}
function buildSpline(sp, created) {
  const n = newNode('spline');
  created.push(n.id);
  const c = buildFrom(sp.coordinate ?? 0, created);
  if (c.id) { G.edges.push({ src: c.id, dst: n.id, port: 'coordinate' }); delete n.inl.coordinate; }
  else n.inl.coordinate = c.num;
  n.v.points = (sp.points || []).map((p, i) => {
    const pt = { location: Number(p.location ?? 0), derivative: Number(p.derivative ?? 0), value: 0 };
    if (typeof p.value === 'number') pt.value = p.value;
    else if (p.value && typeof p.value === 'object') {
      const child = buildSpline(p.value, created);
      G.edges.push({ src: child, dst: n.id, port: 'p' + i });
    }
    return pt;
  });
  return n.id;
}
/** Adds a density function to the graph. Returns the id of its root node (a constant node for bare numbers). */
function importDensityFunction(json, created) {
  const r = buildFrom(normalize(clone(json)), created);
  if (r.id) return r.id;
  const n = newNode('constant');
  n.v.value = r.num;
  created.push(n.id);
  return n.id;
}

/* ================= layout ================= */
function nodeSize(id) {
  const el = nodeEls.get(id);
  return el ? [el.offsetWidth, el.offsetHeight] : [190, 80];
}
/** Lays out the tree feeding `rootId` leftwards from the root. Returns set of placed ids. */
function layoutTree(rootId, only) {
  const GAPX = 56, GAPY = 18;
  const depth = new Map(), nextY = [], placed = new Set();
  const order = [];
  function place(id, d) {
    placed.add(id);
    depth.set(id, d);
    const kids = inputsOf(id).filter((k) => !placed.has(k) && (!only || only.has(k)));
    nextY[d] = nextY[d] ?? 0;
    nextY[d + 1] = Math.max(nextY[d + 1] ?? 0, nextY[d]);
    for (const k of kids) place(k, d + 1);
    const [, hh] = nodeSize(id);
    const n = G.nodes.get(id);
    let y = nextY[d];
    if (kids.length) {
      const first = G.nodes.get(kids[0]), last = G.nodes.get(kids[kids.length - 1]);
      const span = (first.y + last.y + nodeSize(last.id)[1]) / 2;
      y = Math.max(y, span - hh / 2);
    }
    n.y = y;
    nextY[d] = y + hh + GAPY;
    order.push(id);
  }
  place(rootId, 0);
  const colW = [];
  for (const id of order) { const d = depth.get(id); colW[d] = Math.max(colW[d] || 0, nodeSize(id)[0]); }
  const colX = [0];
  for (let d = 1; d < colW.length; d++) colX[d] = colX[d - 1] - (colW[d] || 0) - GAPX;
  for (const id of order) {
    const n = G.nodes.get(id);
    const d = depth.get(id);
    n.x = d === 0 ? 0 : colX[d] + (colW[d] - nodeSize(id)[0]);
  }
  return placed;
}
function tidy() {
  const placed = layoutTree('out');
  let maxY = -Infinity, minX = Infinity;
  for (const id of placed) { const n = G.nodes.get(id); maxY = Math.max(maxY, n.y + nodeSize(id)[1]); minX = Math.min(minX, n.x); }
  let y = maxY + 80;
  // stray trees (nothing reads from their root): lay each out and stack below the main tree
  for (const n of G.nodes.values()) {
    if (placed.has(n.id) || G.edges.some((e) => e.src === n.id)) continue;
    const sub = layoutTree(n.id, new Set([...G.nodes.keys()].filter((k) => !placed.has(k))));
    let sMinY = Infinity, sMaxY = -Infinity;
    for (const id of sub) { const m = G.nodes.get(id); sMinY = Math.min(sMinY, m.y); sMaxY = Math.max(sMaxY, m.y + nodeSize(id)[1]); }
    for (const id of sub) { const m = G.nodes.get(id); m.y += y - sMinY; placed.add(id); }
    y += sMaxY - sMinY + 50;
  }
  for (const n of G.nodes.values()) if (!placed.has(n.id)) { n.x = minX; n.y = y; y += nodeSize(n.id)[1] + 30; }
}

/* ================= editor view ================= */
const editor = $('#editor');
const world = $('#world');
const wiresSvg = $('#wires');
const nodeEls = new Map();
const view = { x: 0, y: 0, z: 1 };
let viewTouched = false;
const SVGNS = 'http://www.w3.org/2000/svg';

function applyView() {
  world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.z})`;
  const s = 24 * view.z, S = s * 5;
  editor.style.backgroundSize = `${S}px ${S}px, ${S}px ${S}px, ${s}px ${s}px, ${s}px ${s}px`;
  editor.style.backgroundPosition = `${view.x}px ${view.y}px`;
  $('#zoom-chip').textContent = Math.round(view.z * 100) + '%';
}
function toWorld(cx, cy) {
  const r = editor.getBoundingClientRect();
  return [(cx - r.left - view.x) / view.z, (cy - r.top - view.y) / view.z];
}
function fitView() {
  if (!G.nodes.size) return;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of G.nodes.values()) {
    const [w, hh] = nodeSize(n.id);
    x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x + w); y1 = Math.max(y1, n.y + hh);
  }
  const r = editor.getBoundingClientRect();
  if (r.width < 40 || r.height < 40) return;
  viewTouched = false;
  const pad = 50;
  const z = Math.min(1, Math.max(0.05, Math.min((r.width - pad * 2) / (x1 - x0), (r.height - pad * 2) / (y1 - y0))));
  view.z = z;
  view.x = r.width / 2 - ((x0 + x1) / 2) * z;
  view.y = r.height / 2 - ((y0 + y1) / 2) * z;
  applyView();
}

/* ---------- node rendering ---------- */
function numberInput(value, onInput, opts = {}) {
  const inp = h('input', { type: 'number', step: 'any', value: value ?? '', placeholder: opts.placeholder || '0', class: opts.cls });
  if (opts.title) inp.title = opts.title;
  inp.addEventListener('input', () => { onInput(inp.value); graphChanged(true); });
  inp.addEventListener('change', commit);
  return inp;
}
function inRow(n, key, label, opts = {}) {
  const e = edgeInto(n.id, key);
  const port = h('div', { class: 'port in' + (e ? ' connected' : '') + (opts.spline ? ' spline' : ''), title: opts.spline ? 'Accepts a Spline node (nested spline)' : 'Density function input' });
  port.dataset.node = n.id;
  port.dataset.port = key;
  n._ports[key] = port;
  const row = h('div', { class: 'row in-row' }, port, h('span', { class: 'lbl' }, label));
  if (e) row.append(h('span', { class: 'linked' }, '← ' + titleOf(e.src)));
  else if (opts.inline !== false) {
    row.append(numberInput(n.inl[key], (v) => {
      if (v === '') { if (opts.optional) delete n.inl[key]; else n.inl[key] = 0; }
      else n.inl[key] = Number(v);
    }, { placeholder: opts.optional ? 'none' : '0' }));
  }
  return row;
}
function fieldRow(n, r) {
  const row = h('div', { class: 'row' }, h('span', { class: 'lbl' }, r.label));
  if (r.kind === 'num') {
    row.append(numberInput(n.v[r.key], (v) => { n.v[r.key] = v === '' ? 0 : Number(v); }));
  } else if (r.kind === 'enum') {
    const sel = h('select', {}, r.options.map((o) => h('option', { value: o, selected: n.v[r.key] === o }, o)));
    sel.addEventListener('change', () => { n.v[r.key] = sel.value; graphChanged(); commit(); });
    row.append(sel);
  } else if (r.kind === 'noise' || r.kind === 'ref') {
    const ids = allIds(r.kind === 'noise' ? 'worldgen/noise' : 'worldgen/density_function').filter((id) => !(r.kind === 'ref' && id === DF_SELF.id));
    const cur = n.v[r.key];
    const known = ids.includes(cur);
    const opts = ids.map((id) => h('option', { value: id, selected: id === cur }, short(id)));
    if (!known) opts.unshift(h('option', { value: cur, selected: true }, short(cur) + ' (missing)'));
    const sel = h('select', { class: 'wide' + (known ? '' : ' bad') }, opts);
    sel.addEventListener('change', () => {
      n.v[r.key] = sel.value;
      renderNode(n);
      refreshDependents(n.id);
      graphChanged(); commit();
    });
    row.firstChild.remove();
    row.append(sel);
    const reg = r.kind === 'noise' ? 'worldgen/noise' : 'worldgen/density_function';
    if (known) {
      const open = h('button', { class: 'mini icon', type: 'button', title: 'Open ' + short(cur), html: ICON.open });
      open.addEventListener('click', () => openRef(reg, cur));
      row.append(open);
    }
    if (r.kind === 'ref' && resolveJson(reg, cur) !== undefined) {
      const btn = h('button', { class: 'mini', type: 'button', title: 'Replace this reference with its definition' }, 'Expand');
      btn.addEventListener('click', () => expandReference(n.id));
      row.append(btn);
    }
  } else if (r.kind === 'vec3') {
    const v = n.v[r.key] || [0, 0, 0];
    row.append(h('span', { class: 'vec' }, [0, 1, 2].map((i) => numberInput(v[i], (x) => { v[i] = x === '' ? 0 : Number(x); n.v[r.key] = v; }, { title: 'xyz'[i] }))));
  }
  return row;
}
function renderNode(n) {
  const T = TYPES[n.type];
  n._ports = {};
  const old = nodeEls.get(n.id);
  const el = h('div', { class: 'node' + (selection.has(n.id) ? ' sel' : ''), style: { left: n.x + 'px', top: n.y + 'px', '--cat': CAT_COLOR[T.cat] } });
  el.dataset.id = n.id;
  const head = h('div', { class: 'node-head', title: n.type === 'output' ? 'The function you export' : 'minecraft:' + n.type });
  head.append(h('span', { class: 'node-title' }, T.title));
  if (n.type !== 'output') {
    const eye = h('button', { class: 'node-btn' + (previewId === n.id ? ' on' : ''), type: 'button', title: 'Preview this node', html: ICON.eye });
    eye.addEventListener('click', () => { setPreview(previewId === n.id ? null : n.id); });
    const del = h('button', { class: 'node-btn', type: 'button', title: 'Delete node', html: ICON.x });
    del.addEventListener('click', () => { removeNode(n.id); redrawWires(); graphChanged(); commit(); });
    const out = h('div', { class: 'port out' + (G.edges.some((e) => e.src === n.id) ? ' connected' : '') + (n.type === 'spline' ? ' spline' : ''), title: 'Output: drag to an input' });
    out.dataset.node = n.id;
    out.dataset.out = '1';
    n._out = out;
    head.append(eye, del, out);
  }
  const body = h('div', { class: 'node-body' });
  if (T.custom === 'spline') renderSplineBody(n, body);
  else if (T.custom === 'interval') renderIntervalBody(n, body);
  else for (const r of T.rows) body.append(r.kind === 'in' ? inRow(n, r.key, r.label, r) : fieldRow(n, r));
  if (!T.rows.length && !T.custom) body.append(h('div', { class: 'hint' }, n.type === 'end_outer_islands' ? 'Seeded End island shape' : 'Constant outside of blending'));
  el.append(head, body);
  for (const inp of el.querySelectorAll('input, select, button')) inp.addEventListener('pointerdown', (e) => e.stopPropagation());
  if (old) old.replaceWith(el); else world.append(el);
  nodeEls.set(n.id, el);
  return el;
}
function refreshDependents(id) {
  for (const e of G.edges) if (e.src === id) renderNode(G.nodes.get(e.dst));
  redrawWires();
}

function renderIntervalBody(n, body) {
  body.append(inRow(n, 'input', 'input'));
  const th = n.v.thresholds;
  for (let i = 0; i <= th.length; i++) {
    const lbl = i === 0 ? `below ${fmt(num(th[0]))}` : i === th.length ? `from ${fmt(num(th[i - 1]))}` : `${fmt(num(th[i - 1]))} … ${fmt(num(th[i]))}`;
    body.append(inRow(n, 'fn' + i, lbl));
    if (i < th.length) {
      const row = h('div', { class: 'row' }, h('span', { class: 'lbl' }, `threshold ${i}`));
      const inp = numberInput(th[i], (v) => { th[i] = v === '' ? 0 : Number(v); });
      inp.addEventListener('change', () => renderNode(n));
      row.append(inp);
      body.append(row);
    }
  }
  const add = h('button', { class: 'mini', type: 'button' }, '+ interval');
  add.addEventListener('click', () => {
    th.push(th.length ? num(th[th.length - 1]) + 0.5 : 0);
    n.inl['fn' + th.length] = 0;
    renderNode(n); redrawWires(); graphChanged(); commit();
  });
  const rm = h('button', { class: 'mini', type: 'button', disabled: th.length < 1 }, '− interval');
  rm.addEventListener('click', () => {
    if (!th.length) return;
    disconnect(n.id, 'fn' + th.length);
    delete n.inl['fn' + th.length];
    th.pop();
    renderNode(n); redrawWires(); graphChanged(); commit();
  });
  body.append(h('div', { class: 'row' }, add, rm));
}

function renderSplineBody(n, body) {
  body.append(inRow(n, 'coordinate', 'coordinate'));
  body.append(h('div', { class: 'pt-head' }, h('span', {}, 'location'), h('span', {}, 'value'), h('span', {}, 'derivative')));
  n.v.points.forEach((p, i) => {
    const e = edgeInto(n.id, 'p' + i);
    const port = h('div', { class: 'port in spline' + (e ? ' connected' : ''), title: 'Nested spline: connect a Spline node' });
    port.dataset.node = n.id;
    port.dataset.port = 'p' + i;
    n._ports['p' + i] = port;
    const row = h('div', { class: 'row pt-row' }, port, h('span', { class: 'pt-idx' }, i));
    const draw = () => drawSplinePlot(n);
    row.append(numberInput(p.location, (v) => { p.location = v === '' ? 0 : Number(v); draw(); }));
    if (e) row.append(h('input', { type: 'text', value: 'nested', disabled: true, title: 'Value comes from a nested spline' }));
    else row.append(numberInput(p.value, (v) => { p.value = v === '' ? 0 : Number(v); draw(); }));
    row.append(numberInput(p.derivative, (v) => { p.derivative = v === '' ? 0 : Number(v); draw(); }));
    const rm = h('button', { class: 'node-btn', type: 'button', title: 'Remove point', html: ICON.x });
    rm.addEventListener('click', () => {
      disconnect(n.id, 'p' + i);
      for (const ed of G.edges) {
        const m = ed.dst === n.id && /^p(\d+)$/.exec(ed.port);
        if (m && +m[1] > i) ed.port = 'p' + (+m[1] - 1);
      }
      n.v.points.splice(i, 1);
      renderNode(n); redrawWires(); graphChanged(); commit();
    });
    row.append(rm);
    body.append(row);
  });
  const add = h('button', { class: 'mini', type: 'button' }, '+ point');
  add.addEventListener('click', () => {
    const last = n.v.points[n.v.points.length - 1];
    n.v.points.push({ location: last ? num(last.location) + 0.5 : 0, value: last ? num(last.value) : 0, derivative: 0 });
    renderNode(n); redrawWires(); graphChanged(); commit();
  });
  body.append(h('div', { class: 'row' }, add, h('span', { class: 'hint', style: { padding: 0 } }, 'points are sorted on export')));
  const cv = h('canvas', { class: 'spline-plot', width: 232 * 2, height: 64 * 2, style: { width: '232px', height: '64px' } });
  n._plot = cv;
  body.append(cv);
  requestAnimationFrame(() => drawSplinePlot(n));
}
function evalSpline(pts, x) {
  // Minecraft CubicSpline.MultiPoint with numeric values only
  const n = pts.length;
  if (!n) return 0;
  let i = -1;
  for (let k = 0; k < n; k++) if (pts[k].l <= x) i = k;
  if (i < 0) return pts[0].v + pts[0].d * (x - pts[0].l);
  if (i === n - 1) return pts[i].v + pts[i].d * (x - pts[i].l);
  const a = pts[i], b = pts[i + 1];
  const dl = b.l - a.l;
  const t = (x - a.l) / dl;
  const p0 = a.d * dl - (b.v - a.v), p1 = -b.d * dl + (b.v - a.v);
  const lerp = (t2, u, w) => u + t2 * (w - u);
  return lerp(t, a.v, b.v) + t * (1 - t) * lerp(t, p0, p1);
}
function drawSplinePlot(n) {
  const cv = n._plot;
  if (!cv || !cv.isConnected) return;
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);
  const cs = getComputedStyle(document.documentElement);
  const nested = new Set(G.edges.filter((e) => e.dst === n.id && /^p\d+$/.test(e.port)).map((e) => +e.port.slice(1)));
  const pts = n.v.points.map((p, i) => ({ l: num(p.location), v: num(p.value), d: num(p.derivative), nested: nested.has(i) })).sort((a, b) => a.l - b.l);
  if (!pts.length) return;
  const numeric = pts.filter((p) => !p.nested);
  let lx = pts[0].l, hx = pts[pts.length - 1].l;
  if (hx - lx < 1e-6) { lx -= 1; hx += 1; }
  const padX = (hx - lx) * 0.12;
  lx -= padX; hx += padX;
  const xs = [];
  for (let k = 0; k <= 120; k++) xs.push(lx + (hx - lx) * k / 120);
  const ys = numeric.length ? xs.map((x) => evalSpline(numeric, x)) : [0];
  let ly = Math.min(...ys, ...numeric.map((p) => p.v)), hy = Math.max(...ys, ...numeric.map((p) => p.v));
  if (hy - ly < 1e-6) { ly -= 1; hy += 1; }
  const padY = (hy - ly) * 0.15;
  ly -= padY; hy += padY;
  const X = (x) => ((x - lx) / (hx - lx)) * W, Y = (y) => H - ((y - ly) / (hy - ly)) * H;
  ctx.strokeStyle = cs.getPropertyValue('--line').trim();
  ctx.lineWidth = 2;
  if (ly < 0 && hy > 0) { ctx.beginPath(); ctx.moveTo(0, Y(0)); ctx.lineTo(W, Y(0)); ctx.stroke(); }
  if (numeric.length) {
    ctx.strokeStyle = cs.getPropertyValue('--c-select').trim();
    ctx.lineWidth = 3;
    ctx.beginPath();
    xs.forEach((x, k) => (k ? ctx.lineTo(X(x), Y(ys[k])) : ctx.moveTo(X(x), Y(ys[k]))));
    ctx.stroke();
  }
  for (const p of pts) {
    ctx.beginPath();
    ctx.arc(X(p.l), p.nested ? H / 2 : Y(p.v), 5, 0, Math.PI * 2);
    if (p.nested) { ctx.strokeStyle = cs.getPropertyValue('--fg-dim').trim(); ctx.lineWidth = 2; ctx.stroke(); }
    else { ctx.fillStyle = cs.getPropertyValue('--fg').trim(); ctx.fill(); }
  }
}

/* ---------- wires ---------- */
function portCenter(el) {
  const r = el.getBoundingClientRect();
  return toWorld(r.left + r.width / 2, r.top + r.height / 2);
}
function wirePath(x1, y1, x2, y2) {
  const dx = Math.max(40, Math.abs(x2 - x1) * 0.5);
  return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
}
function redrawWires() {
  const frag = document.createDocumentFragment();
  for (const e of G.edges) {
    const s = G.nodes.get(e.src), d = G.nodes.get(e.dst);
    if (!s || !d || !s._out || !d._ports || !d._ports[e.port]) continue;
    const [x1, y1] = portCenter(s._out);
    const [x2, y2] = portCenter(d._ports[e.port]);
    const p = document.createElementNS(SVGNS, 'path');
    p.setAttribute('d', wirePath(x1, y1, x2, y2));
    let cls = portIsSpline(d, e.port) ? 'spline-wire' : '';
    if (selection.has(e.src) || selection.has(e.dst)) cls += ' hl';
    if (cls) p.setAttribute('class', cls);
    frag.append(p);
  }
  for (const p of $$('path:not(.temp)', wiresSvg)) p.remove();
  wiresSvg.prepend(frag);
}
function renderAll() {
  for (const el of nodeEls.values()) el.remove();
  nodeEls.clear();
  for (const n of G.nodes.values()) renderNode(n);
  redrawWires();
  updateCount();
}
function updateCount() { $('#count-chip').textContent = `${G.nodes.size} node${G.nodes.size === 1 ? '' : 's'}`; }
function setSelection(ids) {
  selection.clear();
  for (const id of ids) selection.add(id);
  for (const [id, el] of nodeEls) el.classList.toggle('sel', selection.has(id));
  redrawWires();
}

/* ---------- interaction ---------- */
let drag = null;
let tempWire = null;

editor.addEventListener('pointerdown', (ev) => {
  closeMenus();
  const port = ev.target.closest('.port');
  const head = ev.target.closest('.node-head');
  const nodeEl = ev.target.closest('.node');
  if (ev.button === 2) return;
  if (port) {
    ev.preventDefault();
    startWireDrag(ev, port);
    return;
  }
  if (head && !ev.target.closest('button')) {
    const id = nodeEl.dataset.id;
    if (ev.shiftKey || ev.metaKey || ev.ctrlKey) {
      if (selection.has(id)) selection.delete(id); else selection.add(id);
      setSelection([...selection]);
    } else if (!selection.has(id)) setSelection([id]);
    const starts = [...selection].map((sid) => [sid, G.nodes.get(sid).x, G.nodes.get(sid).y]);
    drag = { kind: 'node', sx: ev.clientX, sy: ev.clientY, starts, moved: false };
    editor.setPointerCapture(ev.pointerId);
    return;
  }
  if (nodeEl) {
    const id = nodeEl.dataset.id;
    if (!selection.has(id)) setSelection([id]);
    return;
  }
  if (ev.shiftKey) {
    const r = editor.getBoundingClientRect();
    const mq = h('div', { class: 'marquee' });
    editor.append(mq);
    drag = { kind: 'marquee', sx: ev.clientX, sy: ev.clientY, el: mq, r };
  } else {
    drag = { kind: 'pan', sx: ev.clientX, sy: ev.clientY, vx: view.x, vy: view.y, moved: false };
    editor.classList.add('panning');
  }
  editor.setPointerCapture(ev.pointerId);
});
editor.addEventListener('pointermove', (ev) => {
  if (tempWire) { updateTempWire(ev); return; }
  if (!drag) return;
  const dx = ev.clientX - drag.sx, dy = ev.clientY - drag.sy;
  if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
  if (drag.kind === 'pan') {
    view.x = drag.vx + dx; view.y = drag.vy + dy;
    viewTouched = true;
    applyView();
  } else if (drag.kind === 'node') {
    for (const [id, x, y] of drag.starts) {
      const n = G.nodes.get(id);
      n.x = x + dx / view.z; n.y = y + dy / view.z;
      const el = nodeEls.get(id);
      el.style.left = n.x + 'px'; el.style.top = n.y + 'px';
    }
    redrawWires();
  } else if (drag.kind === 'marquee') {
    const x = Math.min(ev.clientX, drag.sx) - drag.r.left, y = Math.min(ev.clientY, drag.sy) - drag.r.top;
    Object.assign(drag.el.style, { left: x + 'px', top: y + 'px', width: Math.abs(dx) + 'px', height: Math.abs(dy) + 'px' });
  }
});
editor.addEventListener('pointerup', (ev) => {
  if (tempWire) { finishWireDrag(ev); return; }
  if (!drag) return;
  if (drag.kind === 'pan') {
    editor.classList.remove('panning');
    if (!drag.moved) setSelection([]);
  } else if (drag.kind === 'node') {
    if (drag.moved) commit();
  } else if (drag.kind === 'marquee') {
    const a = toWorld(Math.min(ev.clientX, drag.sx), Math.min(ev.clientY, drag.sy));
    const b = toWorld(Math.max(ev.clientX, drag.sx), Math.max(ev.clientY, drag.sy));
    const hit = [...G.nodes.values()].filter((n) => {
      const [w, hh] = nodeSize(n.id);
      return n.x < b[0] && n.x + w > a[0] && n.y < b[1] && n.y + hh > a[1];
    }).map((n) => n.id);
    setSelection([...selection, ...hit]);
    drag.el.remove();
  }
  drag = null;
});
editor.addEventListener('pointercancel', () => { if (drag && drag.el) drag.el.remove(); drag = null; editor.classList.remove('panning'); });
editor.addEventListener('wheel', (ev) => {
  if (ev.target.closest('.menu')) return;
  ev.preventDefault();
  const r = editor.getBoundingClientRect();
  const mx = ev.clientX - r.left, my = ev.clientY - r.top;
  const factor = Math.exp(-ev.deltaY * (ev.ctrlKey ? 0.01 : 0.0015));
  const z = Math.min(2, Math.max(0.05, view.z * factor));
  view.x = mx - (mx - view.x) * (z / view.z);
  view.y = my - (my - view.y) * (z / view.z);
  view.z = z;
  viewTouched = true;
  applyView();
}, { passive: false });
// keep the whole graph in view while the editor resizes, until the user pans or zooms
new ResizeObserver(() => { if (!viewTouched) fitView(); }).observe(editor);
editor.addEventListener('contextmenu', (ev) => {
  if (ev.target.closest('input, select, textarea')) return;
  ev.preventDefault();
  openAddMenu(ev.clientX, ev.clientY);
});
let lastPointer = [0, 0];
editor.addEventListener('pointermove', (ev) => { lastPointer = [ev.clientX, ev.clientY]; });

/* ---------- wire dragging ---------- */
function startWireDrag(ev, port) {
  const nodeId = port.dataset.node;
  let from;
  if (port.dataset.out) {
    from = { src: nodeId };
  } else {
    const key = port.dataset.port;
    const e = edgeInto(nodeId, key);
    if (e) {
      // pick up an existing wire from its input end
      disconnect(nodeId, key);
      renderNode(G.nodes.get(nodeId));
      from = { src: e.src, picked: true };
    } else {
      from = { dst: nodeId, port: key };
    }
  }
  const path = document.createElementNS(SVGNS, 'path');
  path.setAttribute('class', 'temp');
  wiresSvg.append(path);
  tempWire = { from, path, pointerId: ev.pointerId };
  editor.setPointerCapture(ev.pointerId);
  updateTempWire(ev);
  redrawWires();
}
function portUnder(ev) {
  const el = document.elementFromPoint(ev.clientX, ev.clientY);
  return el && el.closest ? el.closest('.port') : null;
}
function updateTempWire(ev) {
  const [mx, my] = toWorld(ev.clientX, ev.clientY);
  const f = tempWire.from;
  for (const p of $$('.port.target')) p.classList.remove('target');
  const over = portUnder(ev);
  if (f.src) {
    const s = G.nodes.get(f.src);
    const [x1, y1] = portCenter(s._out);
    let x2 = mx, y2 = my;
    if (over && !over.dataset.out && canConnect(f.src, over.dataset.node, over.dataset.port)) { over.classList.add('target'); [x2, y2] = portCenter(over); }
    tempWire.path.setAttribute('d', wirePath(x1, y1, x2, y2));
  } else {
    const d = G.nodes.get(f.dst);
    const [x2, y2] = portCenter(d._ports[f.port]);
    let x1 = mx, y1 = my;
    if (over && over.dataset.out && canConnect(over.dataset.node, f.dst, f.port)) { over.classList.add('target'); [x1, y1] = portCenter(over); }
    tempWire.path.setAttribute('d', wirePath(x1, y1, x2, y2));
  }
}
function finishWireDrag(ev) {
  const f = tempWire.from;
  tempWire.path.remove();
  for (const p of $$('.port.target')) p.classList.remove('target');
  const over = portUnder(ev);
  tempWire = null;
  if (f.src && over && !over.dataset.out) {
    if (connect(f.src, over.dataset.node, over.dataset.port)) finishConnect([over.dataset.node, f.src]);
    else if (f.picked) { renderNode(G.nodes.get(f.src)); redrawWires(); graphChanged(); commit(); }
    return;
  }
  if (f.dst && over && over.dataset.out) {
    if (connect(over.dataset.node, f.dst, f.port)) finishConnect([f.dst, over.dataset.node]);
    return;
  }
  if (f.picked) {
    // dropped a picked-up wire on empty space: it stays disconnected
    renderNode(G.nodes.get(f.src));
    redrawWires(); graphChanged(); commit();
    return;
  }
  const onEmpty = !over && ev.target.closest && !ev.target.closest('.node');
  const el = document.elementFromPoint(ev.clientX, ev.clientY);
  if (onEmpty || (el && !el.closest('.node'))) {
    openAddMenu(ev.clientX, ev.clientY, f);
  }
}
function finishConnect(ids) {
  for (const id of ids) renderNode(G.nodes.get(id));
  redrawWires();
  graphChanged();
  commit();
}

/* ---------- add-node menu & pickers ---------- */
let openMenuEl = null;
function closeMenus() { if (openMenuEl) { openMenuEl.remove(); openMenuEl = null; } }
document.addEventListener('pointerdown', (ev) => {
  if (openMenuEl && !openMenuEl.contains(ev.target) && !ev.target.closest('#btn-presets, #btn-add')) closeMenus();
}, true);
function openPicker({ x, y, groups, onPick, placeholder, cls = 'menu' }) {
  closeMenus();
  const input = h('input', { type: 'text', placeholder, spellcheck: false, 'aria-label': placeholder });
  const list = h('div', { class: 'menu-list', role: 'listbox' });
  const menu = h('div', { class: cls }, input, list);
  document.body.append(menu);
  openMenuEl = menu;
  let items = [], act = 0;
  function render() {
    const q = input.value.trim().toLowerCase();
    list.innerHTML = '';
    items = [];
    for (const g of groups) {
      const its = g.items.filter((it) => !q || (it.label + ' ' + (it.sub || '') + ' ' + (it.keys || '')).toLowerCase().includes(q));
      if (!its.length) continue;
      list.append(h('div', { class: 'menu-cat', style: { '--cat': g.color || 'var(--fg-dim)' } }, h('i'), g.name));
      for (const it of its) {
        const el = h('div', { class: 'menu-item', role: 'option' }, h('span', {}, it.label), it.sub ? h('small', {}, it.sub) : null);
        const idx = items.length;
        el.addEventListener('pointerenter', () => { act = idx; mark(); });
        el.addEventListener('click', () => { closeMenus(); onPick(it.value); });
        items.push({ it, el });
        list.append(el);
      }
    }
    act = Math.min(act, Math.max(0, items.length - 1));
    mark();
  }
  function mark() { items.forEach((o, i) => o.el.classList.toggle('act', i === act)); if (items[act]) items[act].el.scrollIntoView({ block: 'nearest' }); }
  input.addEventListener('input', () => { act = 0; render(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { act = Math.min(items.length - 1, act + 1); mark(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { act = Math.max(0, act - 1); mark(); e.preventDefault(); }
    else if (e.key === 'Enter') { const o = items[act]; if (o) { closeMenus(); onPick(o.it.value); } e.preventDefault(); }
    else if (e.key === 'Escape') { closeMenus(); }
    e.stopPropagation();
  });
  render();
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  menu.style.left = Math.max(8, Math.min(x, innerWidth - mw - 8)) + 'px';
  menu.style.top = Math.max(8, Math.min(y, innerHeight - mh - 8)) + 'px';
  input.focus();
}
function openAddMenu(cx, cy, pending) {
  const splineOnly = pending && pending.dst && portIsSpline(G.nodes.get(pending.dst), pending.port);
  const groups = CATS.filter(([k]) => k !== 'out').map(([k, name]) => ({
    name, color: CAT_COLOR[k],
    items: Object.values(TYPES).filter((T) => T.cat === k && !T.noAdd && (!splineOnly || T.type === 'spline'))
      .map((T) => ({ label: T.title, sub: T.type, value: T.type, keys: T.type.replace(/_/g, ' ') })),
  }));
  openPicker({
    x: cx, y: cy, groups, placeholder: 'Search node types…',
    onPick: (type) => {
      const [wx, wy] = toWorld(cx, cy);
      const n = newNode(type, wx - (pending && pending.dst ? 190 : 0), wy - 16);
      renderNode(n);
      if (pending && pending.src) {
        const key = firstInputKey(n);
        if (key) connect(pending.src, n.id, key);
        renderNode(n);
        renderNode(G.nodes.get(pending.src));
      } else if (pending && pending.dst) {
        connect(n.id, pending.dst, pending.port);
        renderNode(n);
        renderNode(G.nodes.get(pending.dst));
        const el = nodeEls.get(n.id);
        n.x = wx - el.offsetWidth - 30;
        el.style.left = n.x + 'px';
      }
      setSelection([n.id]);
      updateCount();
      graphChanged();
      commit();
    },
  });
}
function firstInputKey(n) {
  const T = TYPES[n.type];
  if (T.custom === 'spline') return 'coordinate';
  if (T.custom === 'interval') return 'input';
  const r = T.rows.find((x) => x.kind === 'in');
  return r ? r.key : null;
}

/* ---------- reference expansion ---------- */
function expandReference(id) {
  const n = G.nodes.get(id);
  const json = resolveJson('worldgen/density_function', n.v.id);
  if (json === undefined) return;
  importWarnings = [];
  const created = [];
  const root = importDensityFunction(json, created);
  for (const e of G.edges) if (e.src === id) e.src = root;
  for (const cid of created) renderNode(G.nodes.get(cid));
  const only = new Set(created);
  layoutTree(root, only);
  const rn = G.nodes.get(root);
  const [rw] = nodeSize(root);
  const [ow] = nodeSize(id);
  const dx = n.x + ow - rw - rn.x, dy = n.y - rn.y;
  for (const cid of created) { const m = G.nodes.get(cid); m.x += dx; m.y += dy; }
  // push existing nodes left of the reference further left to make room
  let minX = Infinity;
  for (const cid of created) minX = Math.min(minX, G.nodes.get(cid).x);
  const shift = n.x - minX - ow;
  if (shift > 0) {
    for (const m of G.nodes.values()) if (!only.has(m.id) && m.x < n.x - 10) m.x -= shift;
  }
  removeNode(id);
  renderAll();
  setSelection(created);
  graphChanged();
  commit();
  toast(`Expanded ${short(n.v.id)} into ${created.length} node${created.length === 1 ? '' : 's'}`);
}

/* ---------- loading whole graphs ---------- */
function loadDensityFunction(json, { fit = true } = {}) {
  importWarnings = [];
  G.nodes.clear();
  G.edges = [];
  G.nextId = 1;
  previewId = null;
  selection.clear();
  const out = newNode('output', 0, 0);
  const created = [];
  const root = importDensityFunction(json, created);
  if (G.nodes.get(root).type === 'constant' && created.length === 1) {
    G.nodes.delete(root);
    out.inl.input = typeof json === 'number' ? json : 0;
  } else {
    G.edges.push({ src: root, dst: 'out', port: 'input' });
    delete out.inl.input;
  }
  renderAll();
  tidy();
  renderAll();
  if (fit) fitView();
  graphChanged();
  commit();
  if (importWarnings.length) toast(importWarnings[0]);
}

function duplicateSelection() {
  const ids = [...selection].filter((id) => id !== 'out');
  if (!ids.length) return;
  const map = new Map();
  for (const id of ids) {
    const n = G.nodes.get(id);
    const c = newNode(n.type, n.x + 30, n.y + 30);
    c.v = clone(n.v);
    c.inl = clone(n.inl);
    map.set(id, c.id);
  }
  for (const e of [...G.edges]) {
    if (map.has(e.dst) && map.has(e.src)) G.edges.push({ src: map.get(e.src), dst: map.get(e.dst), port: e.port });
  }
  for (const nid of map.values()) renderNode(G.nodes.get(nid));
  setSelection([...map.values()]);
  updateCount();
  graphChanged();
  commit();
}

document.addEventListener('keydown', (ev) => {
  if (!dfActive()) return;
  const tag = (document.activeElement && document.activeElement.tagName) || '';
  if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
  if ($('.modal-back')) return;
  const mod = ev.ctrlKey || ev.metaKey;
  if (mod && ev.key.toLowerCase() === 'z') { ev.preventDefault(); if (ev.shiftKey) redo(); else undo(); return; }
  if (mod && ev.key.toLowerCase() === 'y') { ev.preventDefault(); redo(); return; }
  if (mod && ev.key.toLowerCase() === 'd') { ev.preventDefault(); duplicateSelection(); return; }
  if (mod && ev.key.toLowerCase() === 'a' && editor.matches(':hover')) { ev.preventDefault(); setSelection([...G.nodes.keys()]); return; }
  if ((ev.key === 'Delete' || ev.key === 'Backspace') && selection.size) {
    ev.preventDefault();
    for (const id of [...selection]) removeNode(id);
    redrawWires(); updateCount(); graphChanged(); commit();
    return;
  }
  if (ev.key === ' ' && editor.matches(':hover')) { ev.preventDefault(); openAddMenu(lastPointer[0], lastPointer[1]); return; }
  if (ev.key === 'f' && editor.matches(':hover')) fitView();
  if (ev.key === 'Escape') { closeMenus(); setSelection([]); }
});
