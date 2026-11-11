/* ================= configured feature previews =================
   Features are placed into a small virtual world around the origin (0,0,0): optionally a ground plane
   below (y < 0), a ceiling above, or nothing. Shapes follow the vanilla algorithms where they are known
   (trees, ores, huge mushrooms and fungi, spikes, End features, chorus, bamboo, piles, disks, lakes…);
   the rest are marked approximate. Nested placed features run their placement modifiers against the
   virtual world, so patches, block predicates and environment scans behave sensibly. */
const FT = {};
const isAirName = (n) => !n || /(^|:)(air|cave_air|void_air)$/.test(n);
const isFluidName = (n) => /(^|:)(water|lava)$/.test(n || '');
const PLANT_RE = /^(short_grass|tall_grass|short_dry_grass|tall_dry_grass|fern|large_fern|dead_bush|bush|firefly_bush|vine|snow|azalea|flowering_azalea|dandelion|poppy|cornflower|lily_of_the_valley|wither_rose|sunflower|lilac|rose_bush|peony|lily_pad|sugar_cane|spore_blossom|seagrass|tall_seagrass|kelp|kelp_plant|moss_carpet|pale_moss_carpet|pale_hanging_moss|hanging_roots|leaf_litter|cocoa|bamboo_sapling|small_dripleaf|big_dripleaf|big_dripleaf_stem|glow_lichen|sculk_vein|cactus_flower|bee_nest|shelf_mushroom)$|(_sapling|_flower|_roots|_vines|_vines_plant|_mushroom|_fungus|_sprouts|_pickle|_carpet|petals|wildflowers|torch|propagule|_bud|amethyst_cluster|_coral|_coral_fan|_coral_wall_fan|_tulip|orchid|allium|bluet|daisy|pitcher_plant|torchflower|eyeblossom)$/;
const isPlantName = (n) => PLANT_RE.test(String(n || '').replace(/^minecraft:/, '').replace(/\[.*$/, ''));
const HORIZ = [[0, 0, -1], [1, 0, 0], [0, 0, 1], [-1, 0, 0]]; // north, east, south, west
const DIRS6 = { up: [0, 1, 0], down: [0, -1, 0], north: [0, 0, -1], south: [0, 0, 1], east: [1, 0, 0], west: [-1, 0, 0] };

function frng(seed) {
  let a = hashStr(String(seed)) || 1;
  const next = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return {
    nextFloat: next, nextDouble: next,
    nextInt(n) { return n <= 0 ? 0 : Math.floor(next() * n); },
    nextBool() { return next() < 0.5; },
    between(a, b) { return b < a ? a : a + Math.floor(next() * (b - a + 1)); },
    horiz() { return HORIZ[Math.floor(next() * 4)]; },
    shuffle(arr) { const x = arr.slice(); for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; },
  };
}
/** Int providers (and plain numbers). */
function ip(p, R) {
  if (typeof p === 'number') return Math.floor(p);
  if (!p || typeof p !== 'object') return 0;
  switch (typeOf(p)) {
    case 'constant': return p.value | 0;
    case 'uniform': return R.between(p.min_inclusive, p.max_inclusive);
    case 'biased_to_bottom': return p.min_inclusive + R.nextInt(R.nextInt(p.max_inclusive - p.min_inclusive + 1) + 1);
    case 'clamped': return Math.min(p.max_inclusive, Math.max(p.min_inclusive, ip(p.source, R)));
    case 'clamped_normal': {
      const g = Math.sqrt(-2 * Math.log(1 - R.nextDouble())) * Math.cos(2 * Math.PI * R.nextDouble());
      return Math.round(Math.min(p.max_inclusive, Math.max(p.min_inclusive, p.mean + g * p.deviation)));
    }
    case 'trapezoid': { const range = p.max - p.min, half = (range - (p.plateau || 0)) >> 1; return p.min + R.between(0, range - half) + R.between(0, half); }
    case 'weighted_list': {
      const dist = p.distribution || [];
      let r = R.nextInt(dist.reduce((s, d) => s + (d.weight || 1), 0) || 1);
      for (const d of dist) if ((r -= d.weight || 1) < 0) return ip(d.data, R);
      return 0;
    }
    default: return p.min_inclusive ?? p.min ?? 0;
  }
}
/** Float providers. */
function fp(p, R) {
  if (typeof p === 'number') return p;
  if (!p || typeof p !== 'object') return 0;
  const t = typeOf(p);
  if (t === 'uniform') return p.min_inclusive + R.nextFloat() * (p.max_exclusive - p.min_inclusive);
  if (t === 'trapezoid') { const d = p.max - p.min, h = (d - p.plateau) / 2; return p.min + R.nextFloat() * (d - h) + R.nextFloat() * h; }
  if (t === 'clamped_normal') return Math.min(p.max, Math.max(p.min, p.mean + p.deviation * (R.nextFloat() - 0.5) * 2));
  return p.value ?? p.min_inclusive ?? 0;
}

/* ---------- the virtual world ---------- */
class FWorld {
  constructor(R, ground) {
    this.R = R; this.m = new Map(); this.g = ground; this.skipped = new Set(); this.approx = false; this.label = '';
    this.depth = 0; this.count = 0;
  }
  groundAt(x, y, z) {
    const g = this.g;
    if ((g.mode === 'floor' || g.mode === 'cave') && y < 0) return y === -1 ? g.top : g.under;
    if ((g.mode === 'ceiling' || g.mode === 'cave') && y >= g.ceilY) return g.ceil;
    return 'minecraft:air';
  }
  get(x, y, z) { const k = x + ',' + y + ',' + z; return this.m.has(k) ? this.m.get(k) : this.groundAt(x, y, z); }
  set(x, y, z, name) { if (this.count++ > 400000) return; this.m.set(x + ',' + y + ',' + z, name); }
  empty(x, y, z) { const n = this.get(x, y, z); return isAirName(n) || (this.g.underwater && /water$/.test(n)); }
  replaceable(x, y, z) { const n = this.get(x, y, z); return isAirName(n) || isFluidName(n) || isPlantName(n); }
  solid(x, y, z) { const n = this.get(x, y, z); return !isAirName(n) && !isFluidName(n) && !isPlantName(n); }
}
const pAdd = (p, d, k = 1) => [p[0] + d[0] * k, p[1] + d[1] * k, p[2] + d[2] * k];

/** Picks a block state name from a block state provider (or a state, a block id, or a provider id). */
function pickState(p, R, W, pos, depth = 0) {
  if (depth > 8 || p == null) return 'minecraft:stone';
  if (typeof p === 'string') {
    const ref = resolveJson('worldgen/block_state_provider', p);
    return ref !== undefined && depth === 0 ? pickState(ref, R, W, pos, depth + 1) : normId(p);
  }
  if (p.Name || p.id) return normId(p.Name || p.id);
  const t = typeOf(p);
  if (t === 'weighted') {
    const es = p.entries || [];
    let r = R.nextInt(es.reduce((s, e) => s + (e.weight || 1), 0) || 1);
    for (const e of es) if ((r -= e.weight || 1) < 0) return pickState(e.data, R, W, pos, depth + 1);
  }
  if (t === 'rule_based') {
    for (const rule of p.rules || []) if (testPred(rule.if_true, W, pos)) return pickState(rule.then, R, W, pos, depth + 1);
    return p.fallback ? pickState(p.fallback, R, W, pos, depth + 1) : null;
  }
  if (Array.isArray(p.states) && p.states.length) return pickState(p.states[R.nextInt(p.states.length)], R, W, pos, depth + 1);
  for (const k of ['state', 'source', 'default_state', 'fallback', 'low_states', 'high_states']) {
    if (p[k]) return pickState(Array.isArray(p[k]) ? p[k][0] : p[k], R, W, pos, depth + 1);
  }
  return 'minecraft:stone';
}
/** Block predicates against the virtual world. Tags are approximated: air-like and replaceable tags
    match empty cells, other tags match solid ground. */
function testPred(p, W, pos) {
  if (!p) return true;
  const at = p.offset ? pAdd(pos, p.offset) : pos;
  const n = () => W.get(at[0], at[1], at[2]);
  const list = (v) => (Array.isArray(v) ? v : [v]).map(normId);
  switch (typeOf(p)) {
    case 'true': case 'inside_world_bounds': case 'height_range': case 'unobstructed': return true;
    case 'not': return !testPred(p.predicate, W, at === pos ? pos : pos);
    case 'all_of': return (p.predicates || []).every((q) => testPred(q, W, pos));
    case 'any_of': return (p.predicates || []).some((q) => testPred(q, W, pos));
    case 'matching_blocks': {
      const bl = list(p.blocks || []), cur = n();
      if (isAirName(cur)) return bl.some((b) => isAirName(b) || /water$/.test(b));
      return bl.includes(normId(cur).replace(/\[.*/, ''));
    }
    case 'matching_block_tag': {
      const tag = String(p.tag || '');
      if (/air|replaceable|leaves|features_cannot/.test(tag) && !/cannot/.test(tag)) return W.replaceable(at[0], at[1], at[2]);
      if (/cannot/.test(tag)) return false;
      return W.solid(at[0], at[1], at[2]);
    }
    case 'matching_fluids': return isAirName(n()) || isFluidName(n());
    case 'solid': case 'has_sturdy_face': return W.solid(at[0], at[1], at[2]);
    case 'replaceable': return W.replaceable(at[0], at[1], at[2]);
    case 'would_survive': return W.empty(at[0], at[1], at[2]) && W.solid(at[0], at[1] - 1, at[2]);
    default: return true;
  }
}

/* ---------- placement modifiers for nested placed features ---------- */
function runPlacement(mods, origin, W) {
  const R = W.R;
  let list = [origin];
  for (const m of mods || []) {
    const t = typeOf(m), out = [];
    for (const p of list) {
      switch (t) {
        case 'count': case 'count_on_every_layer': { const k = ip(m.count, R); for (let i = 0; i < k; i++) out.push(p.slice()); break; }
        case 'noise_based_count': case 'noise_threshold_count': { const k = t === 'noise_threshold_count' ? Math.round(((m.below_noise || 0) + (m.above_noise || 0)) / 2) : Math.max(1, Math.round(m.noise_to_count_ratio / 2)); for (let i = 0; i < k; i++) out.push(p.slice()); break; }
        case 'rarity_filter': if (R.nextFloat() < 1 / Math.max(1, m.chance || 1)) out.push(p); break;
        case 'random_chance': if (R.nextFloat() < (m.chance ?? 1)) out.push(p); break;
        case 'in_square': out.push([p[0] + R.nextInt(16) - 8, p[1], p[2] + R.nextInt(16) - 8]); break;
        case 'offset': out.push([p[0] + ip(m.x, R), p[1] + ip(m.y, R), p[2] + ip(m.z, R)]); break;
        case 'random_offset': out.push([p[0] + ip(m.xz_spread, R), p[1] + ip(m.y_spread, R), p[2] + ip(m.xz_spread, R)]); break;
        case 'fixed_placement': for (const q of m.positions || []) out.push([q[0], q[1], q[2]]); break;
        case 'block_predicate_filter': if (testPred(m.predicate, W, p)) out.push(p); break;
        case 'heightmap': {
          let y = 40;
          while (y > -40 && !W.solid(p[0], y - 1, p[2])) y--;
          out.push([p[0], y, p[2]]);
          break;
        }
        case 'environment_scan': {
          const d = m.direction_of_search === 'up' ? 1 : -1;
          let q = p.slice(), ok = false;
          if (!testPred(m.allowed_search_condition, W, q)) break;
          for (let i = 0; i < (m.max_steps || 0); i++) {
            if (testPred(m.target_condition, W, q)) { ok = true; break; }
            q = [q[0], q[1] + d, q[2]];
            if (!testPred(m.allowed_search_condition, W, q)) break;
          }
          if (ok || testPred(m.target_condition, W, q)) out.push(q);
          break;
        }
        case 'cuboid': {
          const sxz = Math.max(1, ip(m.xz_size, R)), sy = Math.max(1, ip(m.y_size, R));
          const a = -Math.floor((sxz - 1) / 2), b = a + sxz - 1;
          for (let x = a; x <= b; x++) for (let y = 0; y < sy; y++) for (let z = a; z <= b; z++) {
            const faces = (x === a || x === b) + (y === 0 || y === sy - 1) + (z === a || z === b);
            if (faces === 0 ? m.include_interior : faces >= 2 ? m.include_edges : true) out.push([p[0] + x, p[1] + y, p[2] + z]);
          }
          break;
        }
        case 'biome': case 'surface_water_depth_filter': case 'surface_relative_threshold_filter': case 'height_range': out.push(p); break;
        default: W.skipped.add(t); out.push(p);
      }
    }
    list = out;
    if (list.length > 3000) list.length = 3000;
  }
  return list;
}
/** Places a feature reference: a placed-feature id, a feature id, an inline placed feature or an inline feature. */
function placeAny(ref, pos, W, configured = false) {
  if (W.depth > 16) return false;
  W.depth++;
  try {
    if (typeof ref === 'string') {
      // inside a placed feature, an id names a configured feature; elsewhere it names a placed feature
      const pf = configured ? undefined : resolveJson('worldgen/placed_feature', ref);
      if (pf) return placeAny(pf, pos, W);
      const f = resolveJson('worldgen/feature', ref);
      if (f) return placeFeature(f, pos, W);
      W.skipped.add('missing ' + ref);
      return false;
    }
    if (ref && ref.feature !== undefined && !ref.type) {
      let any = false;
      for (const p of runPlacement(ref.placement, pos, W)) any = placeAny(ref.feature, p, W, true) || any;
      return any;
    }
    return placeFeature(ref, pos, W);
  } finally { W.depth--; }
}
function placeFeature(j, pos, W) {
  if (!j) return false;
  const t = typeOf(j);
  const fn = FT[t];
  if (!fn) { W.skipped.add(t); return false; }
  return fn(j.config || j, pos, W) !== false;
}

/* ---------- selectors & composites ---------- */
FT.random_selector = (c, p, W) => {
  for (const e of c.features || []) if (W.R.nextFloat() < e.chance) return placeAny(e.feature, p, W);
  return placeAny(c.default, p, W);
};
FT.simple_random_selector = (c, p, W) => { const fs = c.features || []; return fs.length ? placeAny(fs[W.R.nextInt(fs.length)], p, W) : false; };
FT.weighted_random_selector = (c, p, W) => {
  const fs = c.features || [];
  let r = W.R.nextInt(fs.reduce((s, e) => s + (e.weight || 1), 0) || 1);
  for (const e of fs) if ((r -= e.weight || 1) < 0) return placeAny(e.data, p, W);
  return false;
};
FT.random_boolean_selector = (c, p, W) => placeAny(W.R.nextBool() ? c.feature_true : c.feature_false, p, W);
FT.overlay = FT.sequence = (c, p, W) => { let any = false; for (const f of [].concat(c.features || [])) any = placeAny(f, p, W) || any; return any; };
FT.no_op = () => true;

/* ---------- simple shapes ---------- */
const DOUBLE_PLANT = /(tall_grass|large_fern|sunflower|lilac|rose_bush|peony|tall_seagrass|pitcher_plant|small_dripleaf|tall_dry_grass)$/;
FT.simple_block = (c, p, W) => {
  const s = pickState(c.to_place, W.R, W, p);
  if (!s) return false;
  W.set(p[0], p[1], p[2], s);
  if (DOUBLE_PLANT.test(s)) W.set(p[0], p[1] + 1, p[2], s);
  return true;
};
FT.block_column = (c, p, W) => {
  const d = DIRS6[c.direction || 'up'] || DIRS6.up;
  const layers = (c.layers || []).map((l) => ({ n: Math.max(0, ip(l.height, W.R)), l }));
  let total = layers.reduce((s, l) => s + l.n, 0), q = p.slice();
  let free = 0;
  for (; free < total; free++) { if (!testPred(c.allowed_placement, W, pAdd(p, d, free))) break; }
  if (free < total) {
    // trim layers, starting from the tip if prioritize_tip, else from the base
    let cut = total - free;
    const order = c.prioritize_tip ? layers.slice(0, -1) : layers.slice().reverse();
    for (const l of order) { const k = Math.min(l.n, cut); l.n -= k; cut -= k; }
  }
  for (const l of layers) for (let i = 0; i < l.n; i++) { W.set(q[0], q[1], q[2], pickState(l.l.provider, W.R, W, q)); q = pAdd(q, d); }
  return true;
};
FT.ore = (c, p, W) => {
  const R = W.R, size = c.size || 8;
  const state = pickState((c.targets && c.targets[0] && c.targets[0].state) || 'minecraft:iron_ore', R, W, p);
  W.label = `Ore blob, size ${size}`;
  const f = R.nextFloat() * Math.PI, g = size / 8;
  const x0 = p[0] + Math.sin(f) * g, x1 = p[0] - Math.sin(f) * g, z0 = p[2] + Math.cos(f) * g, z1 = p[2] - Math.cos(f) * g;
  const y0 = p[1] + R.nextInt(3) - 2, y1 = p[1] + R.nextInt(3) - 2;
  const ds = [];
  for (let k = 0; k < size; k++) {
    const t = k / size;
    const h = (R.nextDouble() * size) / 16;
    ds.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, z0 + (z1 - z0) * t, ((Math.sin(Math.PI * t) + 1) * h + 1) / 2]);
  }
  // drop spheres fully contained in another, as vanilla does
  for (let a = 0; a < size - 1; a++) {
    if (ds[a][3] <= 0) continue;
    for (let b = a + 1; b < size; b++) {
      if (ds[b][3] <= 0) continue;
      const dx = ds[a][0] - ds[b][0], dy = ds[a][1] - ds[b][1], dz = ds[a][2] - ds[b][2], dr = ds[a][3] - ds[b][3];
      if (dr * dr > dx * dx + dy * dy + dz * dz) { if (dr > 0) ds[b][3] = -1; else ds[a][3] = -1; }
    }
  }
  for (const [cx, cy, cz, r] of ds) {
    if (r <= 0) continue;
    for (let x = Math.floor(cx - r); x <= Math.max(Math.floor(cx + r), Math.floor(cx - r)); x++) {
      const a = (x + 0.5 - cx) / r;
      if (a * a >= 1) continue;
      for (let y = Math.floor(cy - r); y <= Math.max(Math.floor(cy + r), Math.floor(cy - r)); y++) {
        const b = (y + 0.5 - cy) / r;
        if (a * a + b * b >= 1) continue;
        for (let z = Math.floor(cz - r); z <= Math.max(Math.floor(cz + r), Math.floor(cz - r)); z++) {
          const e = (z + 0.5 - cz) / r;
          if (a * a + b * b + e * e < 1) W.set(x, y, z, state);
        }
      }
    }
  }
  return true;
};
FT.scattered_ore = (c, p, W) => {
  const R = W.R, n = R.nextInt((c.size || 1) + 1);
  const state = pickState((c.targets && c.targets[0] && c.targets[0].state) || 'minecraft:stone', R, W, p);
  W.label = `Scattered ore, up to ${c.size} blocks`;
  const off = (r) => Math.round((R.nextFloat() - R.nextFloat()) * r);
  for (let i = 0; i < n; i++) { const r = Math.min(i, 7); W.set(p[0] + off(r), p[1] + off(r), p[2] + off(r), state); }
  return true;
};
FT.disk = (c, p, W) => {
  const R = W.R, r = ip(c.radius, R), hh = c.half_height ?? 1;
  for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++) {
    if (x * x + z * z > r * r) continue;
    for (let y = p[1] + hh; y >= p[1] - hh; y--) if (W.solid(p[0] + x, y, p[2] + z)) W.set(p[0] + x, y, p[2] + z, pickState(c.state_provider, R, W, [p[0] + x, y, p[2] + z]));
  }
  return true;
};
FT.block_blob = (c, p, W) => {
  const R = W.R;
  let o = p.slice();
  for (let i = 0; i < 3; i++) {
    const j = R.nextInt(2), k = R.nextInt(2), l = R.nextInt(2);
    const f = (j + k + l) * 0.333 + 0.5;
    for (let x = -j; x <= j; x++) for (let y = -k; y <= k; y++) for (let z = -l; z <= l; z++) if (x * x + y * y + z * z <= f * f) W.set(o[0] + x, o[1] + y, o[2] + z, pickState(c.state, R, W, o));
    o = [o[0] - 1 + R.nextInt(2), o[1] - R.nextInt(2), o[2] - 1 + R.nextInt(2)];
  }
  return true;
};
FT.block_pile = (c, p, W) => {
  const R = W.R, i = 2 + R.nextInt(2), j = 2 + R.nextInt(2);
  for (let y = 0; y <= 1; y++) for (let x = -i; x <= i; x++) for (let z = -j; z <= j; z++) {
    const q = [p[0] + x, p[1] + y, p[2] + z];
    const place = x * x + z * z <= R.nextFloat() * 10 - R.nextFloat() * 6 || R.nextFloat() < 0.031;
    if (place && W.empty(...q) && W.solid(q[0], q[1] - 1, q[2])) W.set(...q, pickState(c.state_provider, R, W, q));
  }
  return true;
};
FT.netherrack_replace_blobs = (c, p, W) => {
  const r = ip(c.radius, W.R);
  W.label = `Replace blob, radius ${r}`;
  for (let x = -r; x <= r; x++) for (let y = -r; y <= r; y++) for (let z = -r; z <= r; z++) if (Math.abs(x) + Math.abs(y) + Math.abs(z) <= r) W.set(p[0] + x, p[1] + y, p[2] + z, pickState(c.state, W.R, W, p));
  return true;
};
FT.delta_feature = (c, p, W) => {
  const R = W.R, rim = R.nextDouble() < 0.9;
  const ri = rim ? ip(c.rim_size, R) : 0, rj = rim ? ip(c.rim_size, R) : 0, both = rim && ri && rj;
  const k = ip(c.size, R), l = ip(c.size, R), m = Math.max(k, l);
  for (let x = -k; x <= k; x++) for (let z = -l; z <= l; z++) {
    if (Math.abs(x) + Math.abs(z) > m) continue;
    if (both) W.set(p[0] + x, p[1] - 1, p[2] + z, pickState(c.rim, R, W, p));
    W.set(p[0] + x + ri, p[1] - 1, p[2] + z + rj, pickState(c.contents, R, W, p));
  }
  return true;
};
FT.spring_feature = (c, p, W) => {
  W.label = 'Fluid spring in a wall';
  const wall = (c.valid_blocks && normId(Array.isArray(c.valid_blocks) ? c.valid_blocks[0] : c.valid_blocks)) || 'minecraft:stone';
  for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) if (z < 1 || (x === 0 && y === 0 ? false : true)) if (!(x === 0 && y === 0 && z === 0)) W.set(p[0] + x, p[1] + y, p[2] + z, wall);
  W.set(p[0], p[1], p[2] + 1, 'minecraft:air');
  W.set(p[0], p[1], p[2], pickState(c.state, W.R, W, p));
  return true;
};
FT.lake = (c, p, W) => {
  const R = W.R, cells = new Uint8Array(2048), i = R.nextInt(4) + 4;
  for (let j = 0; j < i; j++) {
    const d = R.nextDouble() * 6 + 3, e = R.nextDouble() * 4 + 2, f = R.nextDouble() * 6 + 3;
    const g = R.nextDouble() * (16 - d - 2) + 1 + d / 2, hh = R.nextDouble() * (8 - e - 4) + 2 + e / 2, k = R.nextDouble() * (16 - f - 2) + 1 + f / 2;
    for (let x = 1; x < 15; x++) for (let z = 1; z < 15; z++) for (let y = 1; y < 7; y++) {
      const a = (x - g) / (d / 2), b = (y - hh) / (e / 2), q = (z - k) / (f / 2);
      if (a * a + b * b + q * q < 1) cells[(x * 16 + z) * 8 + y] = 1;
    }
  }
  const at = (x, z, y) => x >= 0 && x < 16 && z >= 0 && z < 16 && y >= 0 && y < 8 && cells[(x * 16 + z) * 8 + y];
  const fluid = pickState(c.fluid, R, W, p), barrier = pickState(c.barrier, R, W, p);
  W.label = `Lake of ${short(fluid)}`;
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) for (let y = 0; y < 8; y++) {
    const wx = p[0] + x - 8, wz = p[2] + z - 8, wy = p[1] + y - 4;
    if (at(x, z, y)) W.set(wx, wy, wz, y >= 4 ? 'minecraft:air' : fluid);
    else if (y < 4 && (at(x + 1, z, y) || at(x - 1, z, y) || at(x, z + 1, y) || at(x, z - 1, y) || at(x, z, y + 1) || at(x, z, y - 1))) W.set(wx, wy, wz, barrier);
  }
  return true;
};

/* ---------- trees ---------- */
function treePlace(c, origin, W) {
  const R = W.R, tp = c.trunk_placer || {}, fpc = c.foliage_placer || {};
  const tt = typeOf(tp), ft = typeOf(fpc);
  const height = (tp.base_height || 0) + R.nextInt((tp.height_rand_a || 0) + 1) + R.nextInt((tp.height_rand_b || 0) + 1);
  const trunk = (q) => pickState(c.trunk_provider || 'minecraft:oak_log', R, W, q);
  const leafState = (q) => pickState(c.foliage_provider || 'minecraft:oak_leaves', R, W, q);
  const logs = [], leaves = [];
  const log = (x, y, z) => {
    if (!W.replaceable(x, y, z) && !/leaves/.test(W.get(x, y, z))) return false;
    W.set(x, y, z, trunk([x, y, z])); logs.push([x, y, z]); return true;
  };
  const dirt = (x, y, z) => { if (c.below_trunk_provider && W.solid(x, y, z)) W.set(x, y, z, pickState(c.below_trunk_provider, R, W, [x, y, z])); };
  const leaf = (x, y, z) => { if (W.replaceable(x, y, z)) { W.set(x, y, z, leafState([x, y, z])); leaves.push([x, y, z]); } };
  const [ox, oy, oz] = origin;

  // foliage height and radius
  let fh;
  switch (ft) {
    case 'acacia_foliage_placer': fh = 0; break;
    case 'dark_oak_foliage_placer': fh = 4; break;
    case 'mega_pine_foliage_placer': fh = ip(fpc.crown_height, R); break;
    case 'spruce_foliage_placer': fh = Math.max(4, height - ip(fpc.trunk_height, R)); break;
    case 'random_spread_foliage_placer': fh = fpc.foliage_height ?? 2; break;
    default: fh = ip(fpc.height, R);
  }
  let fr = ip(fpc.radius, R);
  if (ft === 'pine_foliage_placer') fr += R.nextInt(Math.max(Math.min(height - fh, 2) + 1, 1));

  /* trunk placers -> foliage attachments [x, y, z, radiusOffset, doubleTrunk] */
  const att = [];
  switch (tt) {
    case 'forking_trunk_placer': {
      dirt(ox, oy - 1, oz);
      const d = R.horiz(), i = height - R.nextInt(4) - 1;
      let j = 3 - R.nextInt(3), x = ox, z = oz, top = null;
      for (let l = 0; l < height; l++) { if (l >= i && j > 0) { x += d[0]; z += d[2]; j--; } if (log(x, oy + l, z)) top = oy + l + 1; }
      if (top != null) att.push([x, top, z, 1, false]);
      x = ox; z = oz;
      const d2 = R.horiz();
      if (d2 !== d) {
        const o = i - R.nextInt(2) - 1;
        let n = 1 + R.nextInt(3); top = null;
        for (let q = o; q < height && n > 0; q++, n--) if (q >= 1) { x += d2[0]; z += d2[2]; if (log(x, oy + q, z)) top = oy + q + 1; }
        if (top != null) att.push([x, top, z, 0, false]);
      }
      break;
    }
    case 'giant_trunk_placer': case 'mega_jungle_trunk_placer': {
      for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1]]) dirt(ox + a, oy - 1, oz + b);
      for (let i = 0; i < height; i++) { log(ox, oy + i, oz); if (i < height - 1) { log(ox + 1, oy + i, oz); log(ox + 1, oy + i, oz + 1); log(ox, oy + i, oz + 1); } }
      att.push([ox, oy + height, oz, 0, true]);
      if (tt === 'mega_jungle_trunk_placer') {
        for (let i = height - 2 - R.nextInt(4); i > height / 2; i -= 2 + R.nextInt(4)) {
          const f = R.nextFloat() * Math.PI * 2;
          let jx = 0, kz = 0;
          for (let l = 0; l < 5; l++) { jx = Math.trunc(1.5 + Math.cos(f) * l); kz = Math.trunc(1.5 + Math.sin(f) * l); log(ox + jx, oy + i - 3 + Math.trunc(l / 2), oz + kz); }
          att.push([ox + jx, oy + i, oz + kz, -2, false]);
        }
      }
      break;
    }
    case 'dark_oak_trunk_placer': {
      for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1]]) dirt(ox + a, oy - 1, oz + b);
      const d = R.horiz(), i = height - R.nextInt(4);
      let j = 2 - R.nextInt(3), n = ox, o = oz;
      const top = oy + height - 1;
      for (let q = 0; q < height; q++) {
        if (q >= i && j > 0) { n += d[0]; o += d[2]; j--; }
        const y = oy + q;
        log(n, y, o); log(n + 1, y, o); log(n, y, o + 1); log(n + 1, y, o + 1);
      }
      att.push([n, top, o, 0, true]);
      for (let q = -1; q <= 2; q++) for (let r = -1; r <= 2; r++) {
        if ((q < 0 || q > 1 || r < 0 || r > 1) && R.nextInt(3) <= 0) {
          const s = R.nextInt(3) + 2;
          for (let t = 0; t < s; t++) log(ox + q, top - t - 1, oz + r);
          att.push([ox + q, top, oz + r, 0, false]);
        }
      }
      break;
    }
    case 'fancy_trunk_placer': {
      dirt(ox, oy - 1, oz);
      const jh = height + 2, k = Math.floor(jh * 0.618);
      const lc = Math.min(1, Math.floor(1.382 + Math.pow(jh / 13, 2)));
      const m = oy + k;
      const coords = [[ox, oy + jh - 5, oz, m]];
      const shape = (h, y) => { if (y < h * 0.3) return -1; const f = h / 2, g = f - y; let r = Math.sqrt(f * f - g * g); if (g === 0) r = f; else if (Math.abs(g) >= f) return 0; return r * 0.5; };
      const limb = (a, b, place) => {
        const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const steps = Math.max(Math.abs(d[0]), Math.abs(d[1]), Math.abs(d[2]));
        for (let s = 0; s <= steps; s++) {
          const t = steps ? s / steps : 0;
          const q = [Math.floor(a[0] + 0.5 + d[0] * t), Math.floor(a[1] + 0.5 + d[1] * t), Math.floor(a[2] + 0.5 + d[2] * t)];
          if (place) log(...q);
          else if (!W.replaceable(...q) && !/log|leaves/.test(W.get(...q))) return false;
        }
        return true;
      };
      for (let n = jh - 5; n >= 0; n--) {
        const f = shape(jh, n);
        if (f < 0) continue;
        for (let o = 0; o < lc; o++) {
          const g = f * (R.nextFloat() + 0.328), hh = R.nextFloat() * 2 * Math.PI;
          const b = [ox + Math.floor(g * Math.sin(hh) + 0.5), oy + n - 1, oz + Math.floor(g * Math.cos(hh) + 0.5)];
          if (limb(b, [b[0], b[1] + 5, b[2]], false)) {
            const dx = ox - b[0], dz = oz - b[2];
            const t = b[1] - Math.sqrt(dx * dx + dz * dz) * 0.381;
            const u = t > m ? m : Math.trunc(t);
            if (limb([ox, u, oz], b, false)) coords.push([b[0], b[1], b[2], u]);
          }
        }
      }
      limb([ox, oy, oz], [ox, oy + k, oz], true);
      for (const [x, y, z, base] of coords) {
        if ((x !== ox || base !== y || z !== oz) && base - oy >= jh * 0.2) limb([ox, base, oz], [x, y, z], true);
        att.push([x, y, z, 0, false]);
      }
      break;
    }
    case 'bending_trunk_placer': {
      dirt(ox, oy - 1, oz);
      const d = R.horiz(), top = height - 1;
      let x = ox, y = oy, z = oz;
      for (let j = 0; j <= top; j++) {
        if (j + 1 >= top + R.nextInt(2)) { x += d[0]; z += d[2]; }
        log(x, y, z);
        if (j >= (tp.min_height_for_leaves ?? 1)) att.push([x, y, z, 0, false]);
        y++;
      }
      const bl = ip(tp.bend_length, R);
      for (let k = 0; k <= bl; k++) { log(x, y, z); att.push([x, y, z, 0, false]); x += d[0]; z += d[2]; }
      break;
    }
    case 'upwards_branching_trunk_placer': {
      for (let i = 0; i < height; i++) {
        const y = oy + i;
        if (log(ox, y, oz) && i < height - 1 && R.nextFloat() < (tp.place_branch_per_log_probability ?? 0.5)) {
          const d = R.horiz();
          const kk = ip(tp.extra_branch_length, R);
          const bp = Math.max(0, kk - ip(tp.extra_branch_length, R) - 1);
          let steps = ip(tp.extra_branch_steps, R);
          let bx = ox, bz = oz, by = y + bp;
          for (let l = bp; l < height && steps > 0; l++, steps--) {
            if (l >= 1) { const yy = y + l; bx += d[0]; bz += d[2]; by = yy; if (log(bx, yy, bz)) by = yy + 1; att.push([bx, by, bz, 0, false]); }
          }
          if (by - y > 1) { att.push([bx, by, bz, 0, false]); att.push([bx, by - 2, bz, 0, false]); }
        }
        if (i === height - 1) att.push([ox, y + 1, oz, 0, false]);
      }
      break;
    }
    case 'cherry_trunk_placer': {
      dirt(ox, oy - 1, oz);
      const i = Math.max(0, height - 1 + ip(tp.branch_start_offset_from_top, R));
      let j = Math.max(0, height - 1 + ip(tp.branch_start_offset_from_top, R));
      if (j >= i) j++;
      const k = ip(tp.branch_count, R), three = k === 3, two = k >= 2;
      const l = three ? height : two ? Math.max(i, j) + 1 : i + 1;
      for (let m = 0; m < l; m++) log(ox, oy + m, oz);
      if (three) att.push([ox, oy + l, oz, 0, false]);
      const branch = (d, start, below) => {
        let x = ox, y = oy + start, z = oz;
        const endY = oy + height - 1 + ip(tp.branch_end_offset_from_top, R);
        const bl = below || endY < oy + start;
        const len = ip(tp.branch_horizontal_length, R) + (bl ? 1 : 0);
        const end = [ox + d[0] * len, endY, oz + d[2] * len];
        for (let s = 0; s < (bl ? 2 : 1); s++) { x += d[0]; z += d[2]; log(x, y, z); }
        const vy = end[1] > y ? 1 : -1;
        for (let guard = 0; guard < 64; guard++) {
          const md = Math.abs(end[0] - x) + Math.abs(end[1] - y) + Math.abs(end[2] - z);
          if (md === 0) break;
          if (R.nextFloat() < Math.abs(end[1] - y) / md) y += vy; else { x += d[0]; z += d[2]; }
          log(x, y, z);
        }
        att.push([end[0], end[1] + 1, end[2], 0, false]);
      };
      const d = R.horiz();
      branch(d, i, i < l - 1);
      if (two) branch([-d[0], 0, -d[2]], j, j < l - 1);
      break;
    }
    case 'poplar_trunk_placer': {
      // 26.3 placer; shape approximated: a straight trunk with short side branches below the crown
      W.approx = true;
      dirt(ox, oy - 1, oz);
      for (let i = 0; i < height; i++) log(ox, oy + i, oz);
      const nb = ip(tp.branch_amount, R), top = height - (tp.trunk_height_above_branches ?? 4);
      for (let b = 0; b < nb; b++) { const d = R.horiz(); const y = oy + Math.max(2, top - R.nextInt(3)); log(ox + d[0], y, oz + d[2]); }
      att.push([ox, oy + height, oz, 0, false]);
      break;
    }
    default: {
      if (tt !== 'straight_trunk_placer') { W.approx = true; W.skipped.add(tt); }
      dirt(ox, oy - 1, oz);
      for (let i = 0; i < height; i++) log(ox, oy + i, oz);
      att.push([ox, oy + height, oz, 0, false]);
    }
  }

  /* foliage placers */
  const row = (a, range, ly, large, skip) => {
    const ex = large ? 1 : 0;
    for (let x = -range; x <= range + ex; x++) for (let z = -range; z <= range + ex; z++) {
      const lx = large ? Math.min(Math.abs(x), Math.abs(x - 1)) : Math.abs(x);
      const lz = large ? Math.min(Math.abs(z), Math.abs(z - 1)) : Math.abs(z);
      if (skip(lx, ly, lz, range, large, x, z)) continue;
      leaf(a[0] + x, a[1] + ly, a[2] + z);
    }
  };
  for (const a of att) {
    const ro = a[3], large = a[4];
    const off = ip(fpc.offset, R);
    switch (ft) {
      case 'blob_foliage_placer': case 'fancy_foliage_placer': case 'bush_foliage_placer': {
        for (let y = off; y >= off - fh; y--) {
          let r;
          if (ft === 'blob_foliage_placer') r = Math.max(fr + ro - 1 - Math.trunc(y / 2), 0);
          else if (ft === 'bush_foliage_placer') r = fr + ro - 1 - y;
          else r = fr + (y !== off && y !== off - fh ? 1 : 0);
          row(a, r, y, large, (lx, ly, lz, range) => {
            if (ft === 'fancy_foliage_placer') return (lx + 0.5) ** 2 + (lz + 0.5) ** 2 > range * range;
            if (ft === 'bush_foliage_placer') return lx === range && lz === range && R.nextInt(2) === 0;
            return lx === range && lz === range && (R.nextInt(2) === 0 || ly === 0);
          });
        }
        break;
      }
      case 'acacia_foliage_placer': {
        const b = [a[0], a[1] + off, a[2]];
        const skip = (lx, ly, lz, range) => (ly === 0 ? (lx > 1 || lz > 1) && lx !== 0 && lz !== 0 : lx === range && lz === range && range > 0);
        row(b, fr + ro, -1 - fh, large, skip);
        row(b, fr - 1, -fh, large, skip);
        row(b, fr + ro - 1, 0, large, skip);
        break;
      }
      case 'dark_oak_foliage_placer': {
        const b = [a[0], a[1] + off, a[2]];
        const skip = (lx, ly, lz, range, lg, x, z) => {
          if (ly === 0 && lg && (x === -range || x >= range) && (z === -range || z >= range)) return true;
          if (ly === -1 && !lg) return lx === range && lz === range;
          if (ly === 1) return lx + lz > range * 2 - 2;
          return false;
        };
        if (large) {
          row(b, fr + 2, -1, large, skip); row(b, fr + 3, 0, large, skip); row(b, fr + 2, 1, large, skip);
          if (R.nextBool()) row(b, fr, 2, large, skip);
        } else { row(b, fr + 2, -1, large, skip); row(b, fr + 1, 0, large, skip); }
        break;
      }
      case 'mega_pine_foliage_placer': {
        let prev = 0;
        for (let y = a[1] - fh + off; y <= a[1] + off; y++) {
          const k = a[1] - y;
          const l = fr + ro + Math.floor((k / fh) * 3.5);
          const m = k > 0 && l === prev && (y & 1) === 0 ? l + 1 : l;
          row([a[0], y, a[2]], m, 0, large, (lx, ly, lz, range) => lx + lz >= 7 || lx * lx + lz * lz > range * range);
          prev = l;
        }
        break;
      }
      case 'jungle_foliage_placer': {
        const n = large ? fh : 1 + R.nextInt(2);
        for (let y = off; y >= off - n; y--) row(a, fr + ro + 1 - y, y, large, (lx, ly, lz, range) => lx + lz >= 7 || lx * lx + lz * lz > range * range);
        break;
      }
      case 'spruce_foliage_placer': {
        let i = R.nextInt(2), j = 1, k = 0;
        for (let y = off; y >= -fh; y--) {
          row(a, i, y, large, (lx, ly, lz, range) => lx === range && lz === range && range > 0);
          if (i >= j) { i = k; k = 1; j = Math.min(j + 1, fr + ro); } else i++;
        }
        break;
      }
      case 'pine_foliage_placer': {
        let i = 0;
        for (let y = off; y >= off - fh; y--) {
          row(a, i, y, large, (lx, ly, lz, range) => lx === range && lz === range && range > 0);
          if (i >= 1 && y === off - fh + 1) i--; else if (i < fr + ro) i++;
        }
        break;
      }
      case 'random_spread_foliage_placer': {
        const n = fpc.leaf_placement_attempts ?? 50, hh = fh || 2, r = Math.max(1, fr);
        for (let i = 0; i < n; i++) leaf(a[0] + R.nextInt(r) - R.nextInt(r), a[1] + R.nextInt(hh) - R.nextInt(hh), a[2] + R.nextInt(r) - R.nextInt(r));
        break;
      }
      case 'cherry_foliage_placer': {
        const b = [a[0], a[1] + off, a[2]];
        const i = fr + ro - 1;
        const skip = (lx, ly, lz, range) => {
          if (ly === -1 && (lx === range || lz === range) && R.nextFloat() < (fpc.wide_bottom_layer_hole_chance ?? 0)) return true;
          const corner = lx === range && lz === range;
          if (range > 2) return corner || (lx + lz > range * 2 - 2 && R.nextFloat() < (fpc.corner_hole_chance ?? 0));
          return corner && R.nextFloat() < (fpc.corner_hole_chance ?? 0);
        };
        row(b, i - 2, fh - 3, large, skip);
        row(b, i - 1, fh - 4, large, skip);
        for (let y = fh - 5; y >= 0; y--) row(b, i, y, large, skip);
        for (const [r, y] of [[i, -1], [i - 1, -2]]) {
          row(b, r, y, large, skip);
          for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++) {
            if (Math.abs(x) !== r && Math.abs(z) !== r) continue;
            const q = [b[0] + x, b[1] + y, b[2] + z];
            if (!/leaves/.test(W.get(...q))) continue;
            if (R.nextFloat() < (fpc.hanging_leaves_chance ?? 0)) { leaf(q[0], q[1] - 1, q[2]); if (R.nextFloat() < (fpc.hanging_leaves_extension_chance ?? 0)) leaf(q[0], q[1] - 2, q[2]); }
          }
        }
        break;
      }
      case 'poplar_foliage_placer': {
        // 26.3 placer, approximated as a tall narrow crown around the top of the trunk
        W.approx = true;
        const half = Math.max(2, fr), w = Math.max(1, Math.round(fh / 2.5));
        const cy = a[1] - Math.floor(half / 2);
        for (let y = -half; y <= half; y++) {
          const t = y / half;
          const r = Math.max(0, Math.round(w * Math.sqrt(Math.max(0, 1 - t * t)) + 0.3));
          for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++) {
            if (x * x + z * z > r * r + 1) continue;
            if ((Math.abs(x) === r || Math.abs(z) === r) && R.nextFloat() < (fpc.side_hole_chance ?? 0)) continue;
            leaf(a[0] + x, cy + y, a[2] + z);
          }
        }
        break;
      }
      default:
        W.approx = true; W.skipped.add(ft);
        for (let y = 0; y >= -2; y--) row(a, 2, y, large, () => false);
    }
  }

  /* root placer (mangrove) — approximate */
  if (c.root_placer) {
    W.approx = true;
    const rp = c.root_placer;
    const roots = pickState(rp.root_provider || 'minecraft:mangrove_roots', R, W, origin);
    const n = 3 + R.nextInt(3);
    for (let i = 0; i < n; i++) {
      const d = R.horiz(), len = 2 + R.nextInt(4);
      let x = ox, y = oy + R.nextInt(3), z = oz;
      for (let s = 0; s < len + 2; s++) { if (s < len) { x += d[0]; z += d[2]; } y--; W.set(x, y, z, roots); if (y < oy - 2) break; }
    }
  }

  /* decorators */
  for (const dec of c.decorators || []) {
    const t = typeOf(dec);
    const prob = dec.probability ?? 1;
    switch (t) {
      case 'beehive': {
        if (!(R.nextFloat() < prob) || !logs.length) break;
        const ly = leaves.length ? Math.min(...leaves.map((q) => q[1])) - 1 : logs[0][1] + 2;
        const lg = logs.find((q) => q[1] === Math.max(oy + 1, Math.min(ly, logs[logs.length - 1][1]))) || logs[0];
        const d = HORIZ[R.nextInt(4)];
        if (W.empty(lg[0] + d[0], lg[1], lg[2] + d[2])) W.set(lg[0] + d[0], lg[1], lg[2] + d[2], 'minecraft:bee_nest');
        break;
      }
      case 'trunk_vine':
        for (const q of logs) for (const d of HORIZ) if (R.nextInt(3) > 0 && W.empty(q[0] + d[0], q[1], q[2] + d[2])) W.set(q[0] + d[0], q[1], q[2] + d[2], 'minecraft:vine');
        break;
      case 'leave_vine':
        for (const q of leaves) for (const d of HORIZ) {
          if (!(R.nextFloat() < prob)) continue;
          const x = q[0] + d[0], z = q[2] + d[2];
          for (let y = q[1], n = 0; n < 5 && W.empty(x, y, z); y--, n++) W.set(x, y, z, 'minecraft:vine');
        }
        break;
      case 'cocoa':
        if (!(R.nextFloat() < prob)) break;
        for (const q of logs.filter((l) => l[1] - oy >= 1 && l[1] - oy <= 3)) for (const d of HORIZ) if (R.nextFloat() <= 0.25 && W.empty(q[0] + d[0], q[1], q[2] + d[2])) W.set(q[0] + d[0], q[1], q[2] + d[2], 'minecraft:cocoa');
        break;
      case 'alter_ground': {
        const s = (x, z) => { for (let y = oy + 2; y >= oy - 3; y--) { if (W.solid(x, y, z) && !/log/.test(W.get(x, y, z))) { W.set(x, y, z, pickState(dec.provider, R, W, [x, y, z])); return; } } };
        const bases = logs.filter((q) => q[1] === oy);
        for (const b of bases) for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) if (Math.abs(x) !== 2 || Math.abs(z) !== 2) s(b[0] + x, b[2] + z);
        break;
      }
      case 'attached_to_leaves': case 'pale_moss':
        for (const q of leaves) {
          if (!(R.nextFloat() < prob) || !W.empty(q[0], q[1] - 1, q[2])) continue;
          W.set(q[0], q[1] - 1, q[2], t === 'pale_moss' ? 'minecraft:pale_hanging_moss' : pickState(dec.block_provider, R, W, q));
        }
        break;
      case 'place_on_ground': {
        const tries = dec.tries ?? 128, r = dec.radius ?? 2, hh = dec.height ?? 1;
        for (let i = 0; i < tries; i++) {
          const x = ox + R.nextInt(r * 2 + 1) - r, z = oz + R.nextInt(r * 2 + 1) - r, y = oy + R.nextInt(hh * 2 + 1) - hh;
          if (W.empty(x, y, z) && W.solid(x, y - 1, z)) W.set(x, y, z, pickState(dec.block_state_provider, R, W, [x, y, z]));
        }
        break;
      }
      case 'creaking_heart':
        if (R.nextFloat() < prob && logs.length > 2) { const q = logs[1 + R.nextInt(logs.length - 2)]; W.set(q[0], q[1], q[2], 'minecraft:creaking_heart'); }
        break;
      case 'shelf_mushroom':
        for (const q of logs) for (const d of HORIZ) if (R.nextFloat() < (dec.probability ?? 0.05) && W.empty(q[0] + d[0], q[1], q[2] + d[2])) W.set(q[0] + d[0], q[1], q[2] + d[2], 'minecraft:shelf_mushroom');
        break;
      default: W.skipped.add(t);
    }
  }
  W.label = W.label || `Tree: ${short(tt)} + ${short(ft)}, height ${height}`;
  return true;
}
FT.tree = treePlace;
FT.fallen_tree = (c, p, W) => {
  const R = W.R, len = ip(c.log_length, R), d = R.horiz();
  const st = pickState(c.trunk_provider, R, W, p);
  W.set(p[0], p[1], p[2], st);
  for (let i = 2; i < len + 2; i++) W.set(p[0] + d[0] * i, p[1], p[2] + d[2] * i, st);
  for (const dec of c.log_decorators || []) for (let i = 2; i < len + 2; i++) if (R.nextFloat() < (dec.probability ?? 0)) W.set(p[0] + d[0] * i, p[1] + 1, p[2] + d[2] * i, pickState(dec.block_provider, R, W, p));
  W.label = `Fallen log, length ${len}`;
  return true;
};
FT.root_system = (c, p, W) => {
  W.approx = true;
  const R = W.R;
  placeAny(c.feature, p, W);
  const root = pickState(c.root_state_provider || 'minecraft:rooted_dirt', R, W, p);
  const depth = Math.min(c.root_column_max_height || 6, 8);
  for (let y = 1; y <= depth; y++) W.set(p[0], p[1] - y, p[2], root);
  const rr = c.root_radius || 3;
  for (let i = 0; i < (c.root_placement_attempts || 20); i++) {
    const x = p[0] + R.nextInt(rr) - R.nextInt(rr), y = p[1] - 1 - R.nextInt(depth), z = p[2] + R.nextInt(rr) - R.nextInt(rr);
    W.set(x, y, z, root);
  }
  const hr = c.hanging_root_radius || 3;
  for (let i = 0; i < (c.hanging_root_placement_attempts || 20); i++) {
    const x = p[0] + R.nextInt(hr) - R.nextInt(hr), z = p[2] + R.nextInt(hr) - R.nextInt(hr);
    const y = p[1] - depth - 1;
    if (W.get(x, y + 1, z) === root) W.set(x, y, z, pickState(c.hanging_root_state_provider || 'minecraft:hanging_roots', R, W, p));
  }
  return true;
};

/* ---------- mushrooms, fungi, plants ---------- */
function mushroomHeight(R) { let i = R.nextInt(3) + 4; if (R.nextInt(12) === 0) i *= 2; return i; }
FT.huge_red_mushroom = (c, p, W) => {
  const R = W.R, h = mushroomHeight(R), r = c.foliage_radius ?? 2;
  for (let y = 0; y < h; y++) W.set(p[0], p[1] + y, p[2], pickState(c.stem_provider, R, W, p));
  for (let y = h - 3; y <= h; y++) {
    const j = y < h ? r : r - 1;
    for (let x = -j; x <= j; x++) for (let z = -j; z <= j; z++) {
      const ex = x === -j || x === j, ez = z === -j || z === j;
      if (y >= h || ex !== ez) W.set(p[0] + x, p[1] + y, p[2] + z, pickState(c.cap_provider, R, W, p));
    }
  }
  W.label = `Huge red mushroom, height ${h}`;
  return true;
};
FT.huge_brown_mushroom = (c, p, W) => {
  const R = W.R, h = mushroomHeight(R), r = c.foliage_radius ?? 3;
  for (let y = 0; y < h; y++) W.set(p[0], p[1] + y, p[2], pickState(c.stem_provider, R, W, p));
  for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++) {
    const ex = x === -r || x === r, ez = z === -r || z === r;
    if (!ex || !ez) W.set(p[0] + x, p[1] + h, p[2] + z, pickState(c.cap_provider, R, W, p));
  }
  W.label = `Huge brown mushroom, height ${h}`;
  return true;
};
FT.huge_fungus = (c, p, W) => {
  const R = W.R;
  let h = R.between(4, 13);
  if (R.nextInt(12) === 0) h *= 2;
  const thick = !c.planted && R.nextFloat() < 0.06;
  const stem = pickState(c.stem_state, R, W, p), hat = pickState(c.hat_state, R, W, p), decor = pickState(c.decor_state, R, W, p);
  const wart = /nether_wart_block/.test(hat);
  const t = thick ? 1 : 0;
  for (let x = -t; x <= t; x++) for (let z = -t; z <= t; z++) {
    const corner = thick && Math.abs(x) === t && Math.abs(z) === t;
    for (let y = 0; y < h; y++) if (!corner || R.nextFloat() < 0.1) W.set(p[0] + x, p[1] + y, p[2] + z, stem);
  }
  const i = Math.min(R.nextInt(1 + Math.trunc(h / 3)) + 5, h), j = h - i;
  const hatBlock = (q, dc, hc, vc) => {
    if (R.nextFloat() < dc) W.set(...q, decor);
    else if (R.nextFloat() < hc) { W.set(...q, hat); if (R.nextFloat() < vc && W.empty(q[0], q[1] - 1, q[2])) W.set(q[0], q[1] - 1, q[2], 'minecraft:weeping_vines'); }
  };
  for (let k = j; k <= h; k++) {
    let l = k < h - R.nextInt(3) ? 2 : 1;
    if (i > 8 && k < j + 4) l = 3;
    if (thick) l++;
    for (let m = -l; m <= l; m++) for (let n = -l; n <= l; n++) {
      const em = m === -l || m === l, en = n === -l || n === l;
      const inner = !em && !en && k !== h, corner = em && en, low = k < j + 3;
      const q = [p[0] + m, p[1] + k, p[2] + n];
      if (!W.replaceable(...q)) continue;
      if (low) { if (!inner && R.nextFloat() < 0.15) W.set(...q, hat); }
      else if (inner) hatBlock(q, 0.1, 0.2, wart ? 0.1 : 0);
      else if (corner) hatBlock(q, 0.01, 0.7, wart ? 0.083 : 0);
      else hatBlock(q, 5e-4, 0.98, wart ? 0.07 : 0);
    }
  }
  W.label = `Huge fungus, height ${h}${thick ? ', thick stem' : ''}`;
  return true;
};
FT.bamboo = (c, p, W) => {
  const R = W.R, n = R.nextInt(12) + 5;
  if (R.nextFloat() < (c.probability ?? 0)) {
    const k = R.nextInt(4) + 1;
    for (let x = -k; x <= k; x++) for (let z = -k; z <= k; z++) if (x * x + z * z <= k * k && W.solid(p[0] + x, p[1] - 1, p[2] + z)) W.set(p[0] + x, p[1] - 1, p[2] + z, 'minecraft:podzol');
  }
  for (let i = 0; i < n; i++) W.set(p[0], p[1] + i, p[2], 'minecraft:bamboo');
  W.label = `Bamboo, height ${n}`;
  return true;
};
FT.chorus_plant = (c, p, W) => {
  const R = W.R;
  const allEmpty = (q, except) => HORIZ.every((d) => (except && d === except) || W.empty(q[0] + d[0], q[1], q[2] + d[2]));
  const grow = (pos, it) => {
    let i = R.nextInt(4) + 1;
    if (it === 0) i++;
    for (let j = 0; j < i; j++) { const q = [pos[0], pos[1] + j + 1, pos[2]]; if (!allEmpty(q)) return; W.set(...q, 'minecraft:chorus_plant'); }
    let grew = false;
    if (it < 4) {
      let k = R.nextInt(4);
      if (it === 0) k++;
      for (let l = 0; l < k; l++) {
        const d = R.horiz();
        const q = [pos[0] + d[0], pos[1] + i, pos[2] + d[2]];
        const opp = HORIZ.find((e) => e[0] === -d[0] && e[2] === -d[2]);
        if (Math.abs(q[0] - p[0]) < 8 && Math.abs(q[2] - p[2]) < 8 && W.empty(...q) && W.empty(q[0], q[1] - 1, q[2]) && allEmpty(q, opp)) {
          grew = true;
          W.set(...q, 'minecraft:chorus_plant');
          grow(q, it + 1);
        }
      }
    }
    if (!grew) W.set(pos[0], pos[1] + i + 1, pos[2], 'minecraft:chorus_flower');
  };
  W.set(p[0], p[1], p[2], 'minecraft:chorus_plant');
  grow(p, 0);
  W.label = 'Chorus plant';
  return true;
};
FT.random_neighbor_spread = (c, p, W) => {
  const R = W.R, acc = (Array.isArray(c.accepted_neighbors) ? c.accepted_neighbors : [c.accepted_neighbors]).map(normId);
  const st = pickState(c.block, R, W, p);
  W.set(p[0], p[1], p[2], st);
  for (let i = 0; i < (c.attempts || 0); i++) {
    const q = [p[0] + ip(c.xz_offset, R), p[1] + ip(c.y_offset, R), p[2] + ip(c.xz_offset, R)];
    if (!testPred(c.can_replace, W, q)) continue;
    let n = 0;
    for (const d of Object.values(DIRS6)) { const g = W.get(q[0] + d[0], q[1] + d[1], q[2] + d[2]); if (acc.includes(normId(g)) || g === st) n++; }
    if (n === 1) W.set(...q, st);
  }
  return true;
};
FT.blue_ice = (c, p, W) => {
  const R = W.R;
  W.set(p[0], p[1], p[2], 'minecraft:blue_ice');
  for (let i = 0; i < 200; i++) {
    const j = R.nextInt(5) - R.nextInt(6);
    let k = 3;
    if (j < 2) k += Math.trunc(j / 2);
    if (k < 1) continue;
    const q = [p[0] + R.nextInt(k) - R.nextInt(k), p[1] + j, p[2] + R.nextInt(k) - R.nextInt(k)];
    if (!W.empty(...q)) continue;
    if (Object.values(DIRS6).some((d) => /blue_ice/.test(W.get(q[0] + d[0], q[1] + d[1], q[2] + d[2])))) W.set(...q, 'minecraft:blue_ice');
  }
  return true;
};
FT.spike = (c, p, W) => {
  const R = W.R, st = pickState(c.state, R, W, p);
  let base = [p[0], p[1] - 1 + R.nextInt(4), p[2]]; // vanilla starts on the snow block, then lifts 0-3
  const i = R.nextInt(4) + 7, j = Math.trunc(i / 4) + R.nextInt(2);
  if (j > 1 && R.nextInt(60) === 0) base = [base[0], base[1] + 10 + R.nextInt(30), base[2]];
  for (let k = 0; k < i; k++) {
    const f = (1 - k / i) * j, l = Math.ceil(f);
    for (let m = -l; m <= l; m++) {
      const g = Math.abs(m) - 0.25;
      for (let n = -l; n <= l; n++) {
        const hh = Math.abs(n) - 0.25;
        if (((m === 0 && n === 0) || !(g * g + hh * hh > f * f)) && ((m !== -l && m !== l && n !== -l && n !== l) || !(R.nextFloat() > 0.75))) {
          W.set(base[0] + m, base[1] + k, base[2] + n, st);
          if (k !== 0 && l > 1) W.set(base[0] + m, base[1] - k, base[2] + n, st);
        }
      }
    }
  }
  const k = Math.max(0, Math.min(1, j - 1));
  for (let l = -k; l <= k; l++) for (let m = -k; m <= k; m++) {
    let y = base[1] - 1, n = Math.abs(l) === 1 && Math.abs(m) === 1 ? R.nextInt(5) : 50;
    const stop = base[1] - 14; // vanilla digs down to y=50 from about y=64
    while (y > stop) { W.set(base[0] + l, y, base[2] + m, st); y--; if (--n <= 0) { y -= R.nextInt(5) + 1; n = R.nextInt(5); } }
  }
  W.label = `Ice spike, height ${i}`;
  return true;
};
FT.iceberg = (c, p, W) => {
  W.approx = true;
  const R = W.R, st = pickState(c.state, R, W, p);
  const hgt = 6 + R.nextInt(10), rad = 3 + R.nextInt(5), depth = Math.round(hgt * 1.4);
  for (let y = -depth; y <= hgt; y++) {
    const t = y >= 0 ? 1 - y / hgt : 1 - -y / depth;
    const r = Math.max(0, rad * Math.pow(t, y >= 0 ? 1.3 : 0.8));
    for (let x = -Math.ceil(r); x <= Math.ceil(r); x++) for (let z = -Math.ceil(r); z <= Math.ceil(r); z++) {
      if (x * x + z * z <= r * r + R.nextFloat() * 2) W.set(p[0] + x, p[1] + y, p[2] + z, y >= hgt - 2 && R.nextFloat() < 0.3 ? 'minecraft:snow_block' : st);
    }
  }
  W.label = 'Iceberg (approximate shape)';
  return true;
};
FT.geode = (c, p, W) => {
  W.approx = true;
  const R = W.R, b = c.blocks || {}, L = c.layers || {};
  const filling = L.filling ?? 1.7, inner = L.inner_layer ?? 2.2, middle = L.middle_layer ?? 3.2, outer = L.outer_layer ?? 4.2;
  const pts = [];
  const nPts = ip(c.distribution_points || { type: 'uniform', min_inclusive: 3, max_inclusive: 4 }, R);
  const wall = ip(c.outer_wall_distance || 5, R);
  for (let i = 0; i < nPts; i++) pts.push([R.nextInt(wall) - Math.floor(wall / 2), R.nextInt(wall) - Math.floor(wall / 2), R.nextInt(wall) - Math.floor(wall / 2), 1 + R.nextFloat() * 0.5]);
  const scale = 1.2;
  const sq = (x) => x * x;
  const R0 = wall + 3;
  for (let x = -R0; x <= R0; x++) for (let y = -R0; y <= R0; y++) for (let z = -R0; z <= R0; z++) {
    if (z > 0) continue; // cut away the front half so the layers show
    let s = 0;
    for (const q of pts) s += 1 / Math.sqrt(sq(x - q[0]) + sq(y - q[1]) + sq(z - q[2]) + q[3]);
    const d = 1 / Math.max(1e-6, s) * scale * pts.length / 2.2;
    const q = [p[0] + x, p[1] + y, p[2] + z];
    if (d < filling) continue;
    if (d < inner) W.set(...q, R.nextFloat() < (c.use_alternate_layer0_chance ?? 0.08) ? pickState(b.alternate_inner_layer_provider, R, W, q) : pickState(b.inner_layer_provider, R, W, q));
    else if (d < middle) W.set(...q, pickState(b.middle_layer_provider, R, W, q));
    else if (d < outer) W.set(...q, pickState(b.outer_layer_provider, R, W, q));
  }
  W.label = 'Geode, cut in half (approximate shape)';
  return true;
};

/* ---------- cave decorations ---------- */
FT.speleothem = (c, p, W) => {
  W.approx = true;
  const R = W.R, up = W.solid(p[0], p[1] - 1, p[2]) || !W.solid(p[0], p[1] + 1, p[2]);
  const n = 1 + R.nextInt(4), d = up ? 1 : -1;
  W.set(p[0], p[1] - d, p[2], pickState(c.base_block, R, W, p));
  for (let i = 0; i < n; i++) W.set(p[0], p[1] + d * i, p[2], pickState(c.pointed_block, R, W, p));
  return true;
};
FT.speleothem_cluster = FT.dripstone_cluster = (c, p, W) => {
  W.approx = true;
  const R = W.R, r = 4 + R.nextInt(3), ceil = W.g.ceilY ?? 10;
  const base = pickState(c.base_block || 'minecraft:dripstone_block', R, W, p);
  const pointed = pickState(c.pointed_block || 'minecraft:pointed_dripstone', R, W, p);
  for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++) {
    const dist = Math.sqrt(x * x + z * z);
    if (dist > r) continue;
    const chance = 1 - (dist / r) * (1 - (c.chance_of_speleothem_at_max_distance_from_center ?? 0.1));
    W.set(p[0] + x, -1, p[2] + z, base);
    W.set(p[0] + x, ceil, p[2] + z, base);
    if (R.nextFloat() > chance * fp(c.density ?? 0.5, R) * 1.6) continue;
    const hgt = Math.max(0, Math.round(ip(c.height || 4, R) * (1 - dist / (r + 2)) + R.nextInt((c.height_deviation ?? 2) + 1) - 1));
    for (let i = 0; i < Math.min(hgt, ceil - 1); i++) W.set(p[0] + x, i, p[2] + z, i < hgt - 1 ? base : pointed);
    const hg2 = Math.max(0, hgt - R.nextInt(3));
    for (let i = 0; i < Math.min(hg2, ceil - hgt - 1); i++) W.set(p[0] + x, ceil - 1 - i, p[2] + z, i < hg2 - 1 ? base : pointed);
  }
  W.label = 'Dripstone cluster (approximate shape)';
  return true;
};
FT.large_dripstone = (c, p, W) => {
  W.approx = true;
  const R = W.R, r = Math.min(8, ip(c.column_radius, R)), hs = fp(c.height_scale, R) || 1;
  const ceil = W.g.ceilY ?? Math.round(r / 0.33);
  const hgt = Math.min(ceil - 1, Math.round(r * 2.2 * hs));
  for (let y = 0; y < hgt; y++) {
    const rr = r * (1 - y / hgt);
    for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++) {
      if (x * x + z * z > rr * rr) continue;
      W.set(p[0] + x, y, p[2] + z, 'minecraft:dripstone_block');
      W.set(p[0] + x, ceil - 1 - y, p[2] + z, 'minecraft:dripstone_block');
    }
  }
  W.label = 'Large dripstone (approximate shape)';
  return true;
};
FT.multiface_growth = (c, p, W) => {
  W.approx = true;
  const R = W.R, st = normId(c.block || 'minecraft:glow_lichen');
  for (let i = 0; i < 24; i++) {
    const x = p[0] + R.nextInt(9) - 4, z = p[2] + R.nextInt(9) - 4;
    if (c.can_place_on_floor !== false && W.solid(x, -1, z)) W.set(x, 0, z, st);
    if (c.can_place_on_ceiling && W.g.ceilY != null && W.solid(x, W.g.ceilY, z)) W.set(x, W.g.ceilY - 1, z, st);
  }
  W.label = `${short(st)} on nearby surfaces (approximate)`;
  return true;
};
FT.vines = (c, p, W) => {
  W.approx = true;
  for (let y = 0; y < 6; y++) W.set(p[0], p[1] + y, p[2], 'minecraft:stone');
  for (let y = 1; y < 6; y++) if (W.R.nextFloat() < 0.7) W.set(p[0] + 1, p[1] + y, p[2], 'minecraft:vine');
  W.label = 'Vines on a wall (approximate)';
  return true;
};
FT.underwater_magma = (c, p, W) => {
  W.approx = true;
  const r = c.placement_radius_around_floor ?? 1;
  for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++) if (W.R.nextFloat() < (c.placement_probability_per_valid_position ?? 0.5)) W.set(p[0] + x, -1, p[2] + z, 'minecraft:magma_block');
  return true;
};
FT.freeze_top_layer = (c, p, W) => {
  for (let x = -8; x < 8; x++) for (let z = -8; z < 8; z++) W.set(x, 0, z, 'minecraft:snow');
  W.label = 'Snow layer on every column of the chunk';
  return true;
};
FT.monster_room = (c, p, W) => {
  const R = W.R, rx = R.nextInt(2) + 2, rz = R.nextInt(2) + 2;
  for (let x = -rx - 1; x <= rx + 1; x++) for (let y = -1; y <= 4; y++) for (let z = -rz - 1; z <= rz + 1; z++) {
    const edge = x === -rx - 1 || x === rx + 1 || y === -1 || y === 4 || z === -rz - 1 || z === rz + 1;
    if (edge && !(y === 4 && R.nextFloat() < 0.6)) W.set(p[0] + x, p[1] + y, p[2] + z, y === -1 && R.nextInt(4) !== 0 ? 'minecraft:mossy_cobblestone' : 'minecraft:cobblestone');
  }
  W.set(p[0], p[1], p[2], 'minecraft:spawner');
  W.set(p[0] + rx, p[1], p[2], 'minecraft:chest');
  W.label = 'Monster room (roof partly removed)';
  return true;
};
FT.sculk_patch = (c, p, W) => {
  W.approx = true;
  const R = W.R, n = Math.min(400, (c.charge_count || 8) * (c.amount_per_charge || 16));
  for (let i = 0; i < n; i++) {
    const r = Math.sqrt(R.nextFloat()) * 6, a = R.nextFloat() * Math.PI * 2;
    W.set(p[0] + Math.round(Math.cos(a) * r), -1, p[2] + Math.round(Math.sin(a) * r), 'minecraft:sculk');
  }
  return true;
};

/* ---------- coral ---------- */
FT.coral_tree = (c, p, W) => {
  const R = W.R, place = (q) => placeAny(c.feature, q, W) || /coral/.test(W.get(...q));
  let q = p.slice();
  const i = R.nextInt(3) + 1;
  for (let j = 0; j < i; j++) { if (!place(q)) return true; q = [q[0], q[1] + 1, q[2]]; }
  const top = q.slice(), k = R.nextInt(3) + 2;
  for (const d of R.shuffle(HORIZ).slice(0, k)) {
    q = pAdd(top, d);
    const l = R.nextInt(5) + 2;
    let m = 0;
    for (let n = 0; n < l && place(q); n++) { m++; q = [q[0], q[1] + 1, q[2]]; if (n === 0 || (m >= 2 && R.nextFloat() < 0.25)) { q = pAdd(q, d); m = 0; } }
  }
  return true;
};
FT.coral_claw = (c, p, W) => {
  const R = W.R, place = (q) => placeAny(c.feature, q, W) || /coral/.test(W.get(...q));
  if (!place(p)) return false;
  const d = R.horiz();
  const cw = [-d[2], 0, d[0]], ccw = [d[2], 0, -d[0]];
  const pick = R.shuffle([d, cw, ccw]).slice(0, R.nextInt(2) + 2);
  for (const e of pick) {
    let q = pAdd(p, e);
    const j = R.nextInt(2) + 1;
    let f, k;
    if (e === d) { f = d; k = R.nextInt(3) + 2; } else { q = [q[0], q[1] + 1, q[2]]; f = R.nextBool() ? e : [0, 1, 0]; k = R.nextInt(3) + 3; }
    for (let l = 0; l < j && place(q); l++) q = pAdd(q, f);
    q = pAdd(q, f, -1); q = [q[0], q[1] + 1, q[2]];
    for (let l = 0; l < k; l++) { q = pAdd(q, d); if (!place(q)) break; if (R.nextFloat() < 0.25) q = [q[0], q[1] + 1, q[2]]; }
  }
  return true;
};
FT.coral_mushroom = (c, p, W) => {
  const R = W.R, i = R.nextInt(3) + 3, j = R.nextInt(3) + 3, k = R.nextInt(3) + 3, l = R.nextInt(3) + 1;
  for (let m = 0; m <= j; m++) for (let n = 0; n <= i; n++) for (let o = 0; o <= k; o++) {
    const shell = m === 0 || m === j || n === 0 || n === i || o === 0 || o === k;
    const edge = ((m === 0 || m === j) && (n === 0 || n === i)) || ((o === 0 || o === k) && (n === 0 || n === i)) || ((m === 0 || m === j) && (o === 0 || o === k));
    if (shell && !edge && !(R.nextFloat() < 0.1)) placeAny(c.feature, [p[0] + m, p[1] + n - l, p[2] + o], W);
  }
  return true;
};

/* ---------- basalt ---------- */
FT.single_block_pillar = (c, p, W) => {
  const R = W.R;
  let y = p[1];
  const top = W.g.ceilY != null ? W.g.ceilY : p[1] + 8 + R.nextInt(8);
  while (y < top && testPred(c.can_replace, W, [p[0], y, p[2]])) { W.set(p[0], y, p[2], pickState(c.block, R, W, p)); y++; }
  if (c.cap_feature) placeAny(c.cap_feature, [p[0], y, p[2]], W);
  return true;
};
FT.projected_random_patchy_square = (c, p, W) => {
  W.approx = true;
  const R = W.R, s = c.size ?? 3;
  for (let x = -s; x <= s; x++) for (let z = -s; z <= s; z++) {
    if (R.nextFloat() < 0.4) continue;
    let y = p[1];
    for (let k = 0; k < (c.max_projection_height ?? 3) && testPred(c.project_through, W, [p[0] + x, y, p[2] + z]) && !W.solid(p[0] + x, y - 1, p[2] + z); k++) y--;
    const st = pickState(c.block, R, W, [p[0] + x, y, p[2] + z]);
    if (st) W.set(p[0] + x, y, p[2] + z, st);
  }
  return true;
};
FT.stepped_column_cluster = FT.basalt_columns = (c, p, W) => {
  W.approx = true;
  const R = W.R, reach = c.cluster_reach ?? 5, n = Math.min(c.column_count ?? 30, 60);
  for (let i = 0; i < n; i++) {
    const x = p[0] + R.nextInt(reach * 2 + 1) - reach, z = p[2] + R.nextInt(reach * 2 + 1) - reach;
    const hh = ip(c.height || 5, R) - Math.floor(Math.hypot(x - p[0], z - p[2]) / 2);
    for (let y = 0; y < Math.max(1, hh); y++) W.set(x, y, z, pickState(c.block, R, W, p));
  }
  return true;
};

/* ---------- the End ---------- */
FT.end_island = (c, p, W) => {
  const R = W.R;
  let f = R.nextInt(3) + 4;
  for (let i = 0; f > 0.5; i--) {
    for (let j = Math.floor(-f); j <= Math.ceil(f); j++) for (let k = Math.floor(-f); k <= Math.ceil(f); k++) if (j * j + k * k <= (f + 1) * (f + 1)) W.set(p[0] + j, p[1] + i, p[2] + k, 'minecraft:end_stone');
    f -= R.nextInt(2) + 0.5;
  }
  return true;
};
FT.end_platform = (c, p, W) => { for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) W.set(p[0] + x, p[1] - 1, p[2] + z, 'minecraft:obsidian'); return true; };
FT.end_gateway = (c, p, W) => {
  for (let x = -1; x <= 1; x++) for (let y = -2; y <= 2; y++) for (let z = -1; z <= 1; z++) {
    const bx = x === 0, by = y === 0, bz = z === 0, b4 = Math.abs(y) === 2;
    let s = null;
    if (bx && by && bz) s = 'minecraft:end_gateway';
    else if (by) s = null;
    else if (b4 && bx && bz) s = 'minecraft:bedrock';
    else if ((bx || bz) && !b4) s = 'minecraft:bedrock';
    if (s) W.set(p[0] + x, p[1] + y, p[2] + z, s);
  }
  return true;
};
FT.end_podium = (c, p, W) => {
  for (let x = -4; x <= 4; x++) for (let y = -1; y <= 32; y++) for (let z = -4; z <= 4; z++) {
    const d = x * x + y * y + z * z, inner = d < 6.25;
    if (!inner && !(d < 12.25)) continue;
    const q = [p[0] + x, p[1] + y, p[2] + z];
    if (y < 0) W.set(...q, inner ? 'minecraft:bedrock' : 'minecraft:end_stone');
    else if (y === 0) W.set(...q, inner ? (c.active ? 'minecraft:end_portal' : 'minecraft:air') : 'minecraft:bedrock');
  }
  for (let i = 0; i < 4; i++) W.set(p[0], p[1] + i, p[2], 'minecraft:bedrock');
  for (const d of HORIZ) W.set(p[0] + d[0], p[1] + 2, p[2] + d[2], 'minecraft:wall_torch');
  return true;
};
FT.end_spike = (c, p, W) => {
  const R = W.R, list = c.spikes && c.spikes.length ? c.spikes : null;
  const idx = R.nextInt(10);
  const s = list ? list[R.nextInt(list.length)] : { radius: 2 + Math.trunc(idx / 3), height: 76 + idx * 3, guarded: idx === 1 || idx === 2 };
  const r = s.radius;
  for (let y = 0; y < s.height; y++) for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++) if (x * x + z * z <= r * r + 1) W.set(p[0] + x, y, p[2] + z, 'minecraft:obsidian');
  W.set(p[0], s.height, p[2], 'minecraft:bedrock');
  if (s.guarded) for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) for (let y = 0; y <= 3; y++) if (Math.abs(x) === 2 || Math.abs(z) === 2 || y === 3) W.set(p[0] + x, s.height + y, p[2] + z, 'minecraft:iron_bars');
  W.label = `End spike, radius ${r}, height ${s.height}${s.guarded ? ', caged' : ''}`;
  return true;
};
FT.void_start_platform = (c, p, W) => {
  for (let x = -16; x <= 16; x++) for (let z = -16; z <= 16; z++) W.set(p[0] + x, p[1] - 1, p[2] + z, x === 0 && z === 0 ? 'minecraft:cobblestone' : 'minecraft:stone');
  return true;
};
FT.bonus_chest = (c, p, W) => {
  W.set(p[0], p[1], p[2], 'minecraft:chest');
  for (const d of HORIZ) W.set(p[0] + d[0], p[1], p[2] + d[2], 'minecraft:torch');
  return true;
};

/* ---------- patches ---------- */
function vegetationPatch(c, p, W, waterlogged) {
  const R = W.R;
  const xr = ip(c.xz_radius, R) + 1, zr = ip(c.xz_radius, R) + 1;
  const ceiling = c.surface === 'ceiling';
  const sy = ceiling ? (W.g.ceilY ?? 1) : -1;
  const tops = [];
  for (let x = -xr; x <= xr; x++) for (let z = -zr; z <= zr; z++) {
    const ex = x === -xr || x === xr, ez = z === -zr || z === zr, edge = ex || ez, corner = ex && ez, side = edge && !corner;
    if (corner || (side && !(c.extra_edge_column_chance && R.nextFloat() <= c.extra_edge_column_chance))) continue;
    let d = ip(c.depth, R);
    if (R.nextFloat() < (c.extra_bottom_block_chance ?? 0)) d++;
    for (let k = 0; k < d; k++) W.set(p[0] + x, ceiling ? sy + k : sy - k, p[2] + z, pickState(c.ground_state, R, W, p));
    tops.push([p[0] + x, z, side]);
    if (waterlogged && !edge) W.set(p[0] + x, sy, p[2] + z, 'minecraft:water');
  }
  for (const [x, z] of tops) {
    if (!(c.vegetation_chance > 0 && R.nextFloat() < c.vegetation_chance)) continue;
    placeAny(c.vegetation_feature, [x, ceiling ? sy - 1 : 0, p[2] + z], W);
  }
  W.label = `${short(pickState(c.ground_state, R, W, p))} patch`;
  return true;
}
FT.vegetation_patch = (c, p, W) => vegetationPatch(c, p, W, false);
FT.waterlogged_vegetation_patch = (c, p, W) => vegetationPatch(c, p, W, true);

/* features that need structure templates or full chunks */
FT.template = FT.fossil = (c, p, W) => { W.skipped.add('structure templates'); return false; };

/* ---------- context & entry point ---------- */
/** A ground block the feature's own predicates ask for (matching_blocks one block below). */
function groundHint(j) {
  let found = null, visits = 0;
  const seen = new Set();
  const walk = (v, key) => {
    if (found || visits++ > 4000) return;
    if (typeof v === 'string') {
      if (!/^(feature|default|feature_true|feature_false|features|data|vegetation_feature|cap_feature)$/.test(key || '')) return;
      if (seen.has(v) || !v.includes(':')) return;
      seen.add(v);
      const pf = resolveJson('worldgen/placed_feature', v);
      if (pf) walk(pf);
      return;
    }
    if (Array.isArray(v)) { for (const x of v) walk(x, key); return; }
    if (!v || typeof v !== 'object') return;
    if (typeOf(v) === 'matching_blocks' && Array.isArray(v.offset) && v.offset[1] === -1 && v.offset[0] === 0 && v.offset[2] === 0) {
      const b = [].concat(v.blocks || []).map(normId).find((x) => !isAirName(x) && !isFluidName(x));
      if (b) { found = b; return; }
    }
    for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  walk(j, 'feature');
  return found;
}
/** Which ground the root feature sits on. */
function featureGround(j, depth = 0) {
  if (depth === 0) {
    const g = featureGroundBase(j);
    const hint = g.mode === 'floor' || g.mode === 'cave' ? groundHint(j) : null;
    return hint ? { ...g, top: hint } : g;
  }
  return featureGroundBase(j, depth);
}
function featureGroundBase(j, depth = 0) {
  const fj = typeof j === 'string' ? resolveFeatureJson(j) : j && j.feature !== undefined && !j.type ? resolveFeatureJson(j.feature) : j;
  if (!fj || depth > 6) return { mode: 'floor', top: 'minecraft:grass_block', under: 'minecraft:dirt' };
  const c = fj.config || fj;
  const t = typeOf(fj);
  const floor = (top, under = top) => ({ mode: 'floor', top, under });
  switch (t) {
    case 'random_selector': return featureGroundBase(c.default, depth + 1);
    case 'simple_random_selector': case 'overlay': case 'sequence': return featureGroundBase([].concat(c.features || [])[0], depth + 1);
    case 'weighted_random_selector': return featureGroundBase(((c.features || [])[0] || {}).data, depth + 1);
    case 'random_boolean_selector': return featureGroundBase(c.feature_true, depth + 1);
    case 'ore': case 'scattered_ore': case 'geode': case 'netherrack_replace_blobs': case 'lake': case 'spring_feature': case 'iceberg':
    case 'end_island': case 'end_gateway': case 'end_spike': case 'end_platform': case 'end_podium': case 'void_start_platform': case 'monster_room': case 'vines':
      return { mode: 'none' };
    case 'block_column':
      if (/kelp|seagrass/.test(JSON.stringify(c))) return { ...floor('minecraft:sand'), underwater: true };
      if (/twisting/.test(JSON.stringify(c))) return floor('minecraft:warped_nylium', 'minecraft:netherrack');
      return c.direction === 'down' ? { mode: 'ceiling', ceilY: 1, ceil: 'minecraft:stone' } : floor(/cactus/.test(JSON.stringify(c)) ? 'minecraft:sand' : 'minecraft:grass_block', /cactus/.test(JSON.stringify(c)) ? 'minecraft:sand' : 'minecraft:dirt');
    case 'random_neighbor_spread': return { mode: 'ceiling', ceilY: 1, ceil: 'minecraft:netherrack' };
    case 'huge_red_mushroom': case 'huge_brown_mushroom': return floor('minecraft:mycelium', 'minecraft:dirt');
    case 'huge_fungus': return floor(normId(c.valid_base_block || 'minecraft:crimson_nylium'), 'minecraft:netherrack');
    case 'spike': return floor('minecraft:snow_block');
    case 'chorus_plant': return floor('minecraft:end_stone');
    case 'delta_feature': case 'stepped_column_cluster': case 'single_block_pillar': return floor('minecraft:basalt');
    case 'speleothem_cluster': case 'dripstone_cluster': case 'large_dripstone': case 'multiface_growth':
      return { mode: 'cave', top: 'minecraft:stone', under: 'minecraft:stone', ceilY: t === 'large_dripstone' ? 22 : 10, ceil: 'minecraft:stone' };
    case 'speleothem': return { mode: 'cave', top: 'minecraft:stone', under: 'minecraft:stone', ceilY: 8, ceil: 'minecraft:stone' };
    case 'vegetation_patch': case 'waterlogged_vegetation_patch':
      return c.surface === 'ceiling' ? { mode: 'ceiling', ceilY: 1, ceil: 'minecraft:stone' } : floor('minecraft:stone');
    case 'underwater_magma': case 'sculk_patch': return floor('minecraft:stone');
    case 'coral_tree': case 'coral_claw': case 'coral_mushroom': return { ...floor('minecraft:sand'), underwater: true };
    case 'disk': return { ...floor('minecraft:dirt'), underwater: true };
    case 'simple_block': {
      const s = String(JSON.stringify(c.to_place || ''));
      if (/coral|seagrass|kelp|sea_pickle/.test(s)) return { ...floor('minecraft:sand'), underwater: true };
      if (/nether|crimson|warped|soul_fire|\bfire/.test(s)) return floor('minecraft:netherrack');
      if (/spore_blossom/.test(s)) return { mode: 'ceiling', ceilY: 1, ceil: 'minecraft:stone' };
      return floor('minecraft:grass_block', 'minecraft:dirt');
    }
    default: return floor('minecraft:grass_block', 'minecraft:dirt');
  }
}
function resolveFeatureJson(f, depth = 0, configured = false) {
  if (depth > 8) return null;
  if (typeof f === 'string') {
    const pf = configured ? undefined : resolveJson('worldgen/placed_feature', f);
    if (pf) return resolveFeatureJson(pf.feature, depth + 1, true);
    return resolveJson('worldgen/feature', f) || null;
  }
  if (f && f.feature !== undefined && !f.type) return resolveFeatureJson(f.feature, depth + 1, true);
  return f || null;
}
/** Runs a feature into a voxel volume centred on its origin column. */
function featureVoxels(json, seed, { ground = true } = {}) {
  const R = frng(seed);
  const g = featureGround(json);
  const W = new FWorld(R, g);
  const ok = placeAny(json, [0, 0, 0], W);
  const blocks = [];
  for (const [k, name] of W.m) if (!isAirName(name)) { const [x, y, z] = k.split(',').map(Number); blocks.push([x, y, z, name]); }
  if (!ok && !blocks.length) return { empty: true, skipped: [...W.skipped] };
  // context plane: floor under the feature, ceiling above it
  let r = 3, y0 = Infinity, y1 = -Infinity;
  for (const [x, y, z] of blocks) { r = Math.max(r, Math.abs(x) + 1, Math.abs(z) + 1); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  if (!blocks.length) { y0 = 0; y1 = 0; }
  r = Math.min(r, 40);
  if (ground && g.mode !== 'none') {
    const layers = [];
    if (g.mode === 'floor' || g.mode === 'cave') layers.push(-1);
    if (g.mode === 'ceiling' || g.mode === 'cave') layers.push(g.ceilY);
    for (const ly of layers) for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++) {
      if (W.m.has(x + ',' + ly + ',' + z)) continue;
      blocks.push([x, ly, z, W.groundAt(x, ly, z)]);
      y0 = Math.min(y0, ly); y1 = Math.max(y1, ly);
    }
  }
  if (g.underwater) {
    for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++) for (let y = 0; y <= Math.max(y1 + 1, 3); y++) if (!W.m.has(x + ',' + y + ',' + z)) blocks.push([x, y, z, 'minecraft:water']);
    y1 = Math.max(y1 + 1, 3);
  }
  // symmetric in x and z so the origin column sits in the middle of the view
  let ext = 0;
  for (const [x, , z] of blocks) ext = Math.max(ext, Math.abs(x), Math.abs(z));
  const sx = ext * 2 + 1, sz = sx, sy = y1 - y0 + 1;
  if (sx * sy * sz > 6e6) return { empty: true, skipped: ['too large to preview'] };
  const pal = ['minecraft:air'];
  const pi = new Map([['minecraft:air', 0]]);
  const data = new Uint16Array(sx * sy * sz);
  for (const [x, y, z, name] of blocks) {
    let i = pi.get(name);
    if (i === undefined) { i = pal.length; pal.push(name); pi.set(name, i); }
    data[((y - y0) * sz + (z + ext)) * sx + (x + ext)] = i;
  }
  return { data, palette: pal, dims: { sx, sy, sz, y0 }, label: W.label, approx: W.approx, skipped: [...W.skipped], count: blocks.length };
}
