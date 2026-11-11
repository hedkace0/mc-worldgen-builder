/* ================= info cards ================= */
function showCard(...sections) {
  cardHost.innerHTML = '';
  const wrap = h('div', { class: 'card' });
  if (TARGET) {
    const head = h('div', { class: 'card-head' },
      h('span', { class: 'reg-dot', style: { background: `var(${(REG[TARGET.reg] || {}).color || '--c-util'})` } }),
      h('div', {}, h('div', { class: 'card-title' }, TARGET.id || fileTitle(TARGET.path)), h('div', { class: 'card-sub' }, (REG[TARGET.reg] ? regLabel1(TARGET.reg) : 'File') + (TARGET.readOnly ? ' · vanilla, read-only' : ''))));
    wrap.append(head);
  }
  for (const s of sections.flat()) if (s) wrap.append(s);
  if (TARGET && TARGET.json !== undefined) {
    const refs = refsSection(TARGET.json, TARGET.reg);
    if (refs) wrap.append(refs);
    const used = usedBySection(TARGET.id, TARGET.reg);
    if (used) wrap.append(used);
  }
  cardHost.append(wrap);
  cardHost.scrollTop = 0;
  setStatus('');
}
const sec = (title, ...kids) => h('section', { class: 'card-sec' }, title ? h('h3', {}, title) : null, ...kids);
function kv(rows) {
  const t = h('div', { class: 'kv' });
  for (const [k, v] of rows) {
    if (v === undefined) continue;
    t.append(h('span', { class: 'k' }, k), h('span', { class: 'v' }, v instanceof Node ? v : fmtVal(v)));
  }
  return t;
}
function fmtVal(v) {
  if (v === null) return 'null';
  if (typeof v === 'number') return fmt(v, 6);
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'string') return v;
  const s = JSON.stringify(v);
  return s.length > 140 ? s.slice(0, 137) + '…' : s;
}
function refChip(reg, id, label) {
  const isTag = String(id).startsWith('#');
  const r = isTag ? resolveRef('tags/worldgen/biome', id.slice(1)) : resolveRef(reg, id);
  const cls = 'chip ' + (!r ? 'missing' : r.src === 'project' ? 'proj' : 'van');
  const b = h('button', { class: cls, type: 'button', title: `${isTag ? 'Biome tag' : regLabel1(reg)}: ${id}${!r ? ' (not found)' : r.src === 'project' ? ' (in project)' : ' (vanilla)'}` },
    h('i', { style: { background: `var(${(REG[isTag ? 'tags/worldgen/biome' : reg] || {}).color || '--c-util'})` } }), label || short(id));
  b.addEventListener('click', () => (isTag ? openRef('tags/worldgen/biome', id.slice(1)) : openRef(reg, id)));
  return b;
}
function biomeChip(id) {
  const b = refChip('worldgen/biome', id);
  b.querySelector('i').style.background = rgbCss(biomeColor(normId(id)));
  return b;
}
const chips = (list) => h('div', { class: 'chips' }, list);
function swatch(label, color) {
  const c = hexRgb(color);
  if (!c) return null;
  return h('div', { class: 'swatch' }, h('i', { style: { background: rgbCss(c) } }), h('span', {}, label), h('code', {}, typeof color === 'number' ? '#' + color.toString(16).padStart(6, '0') : String(color)));
}

/* ---------- references ---------- */
const KEY_REGS = {
  noise: ['worldgen/noise'], settings: ['worldgen/noise_settings'], feature: ['worldgen/placed_feature', 'worldgen/feature'],
  features: ['worldgen/placed_feature'], carvers: ['worldgen/carver'], biome: ['worldgen/biome'], biomes: ['worldgen/biome'],
  structure: ['worldgen/structure'], structures: ['worldgen/structure'], start_pool: ['worldgen/template_pool'], fallback: ['worldgen/template_pool'],
  processors: ['worldgen/processor_list'], preset: ['worldgen/multi_noise_biome_source_parameter_list'], material_rule: ['worldgen/material_rule'],
  then_run: ['worldgen/material_rule'], sequence: ['worldgen/material_rule'], if_true: ['worldgen/material_condition'], invert: ['worldgen/material_condition'],
  structure_overrides: ['worldgen/structure_set'], other_set: ['worldgen/structure_set'], biome_is: ['worldgen/biome'], values: ['worldgen/biome'],
};
const DF_KEYS = new Set(['argument', 'argument1', 'argument2', 'input', 'left', 'right', 'coordinate', 'final_density', 'temperature', 'vegetation', 'continents', 'erosion', 'depth', 'ridges', 'chunk_surface_level', 'surface_level', 'barrier', 'exclusion', 'lava', 'fluid_level_floodedness', 'fluid_level_spread', 'function', 'density', 'upper_bound', 'shift_x', 'shift_y', 'shift_z', 'alpha', 'first', 'second', 'when_in_range', 'when_out_of_range', 'base', 'exponent', 'multiple', 'functions', 'value']);
function findRefs(json, reg, self = TARGET) {
  const found = new Map();
  const walk = (v, key, depth) => {
    if (typeof v === 'string') {
      if (!v.includes(':') && !v.startsWith('#')) return;
      if (!ID_RE.test(v)) return;
      let regs = KEY_REGS[key];
      if (key === 'type') {
        if (reg === 'dimension' && depth === 1) regs = ['dimension_type'];
        else return;
      }
      if (!regs && DF_KEYS.has(key)) regs = ['worldgen/density_function'];
      if (reg === 'worldgen/density_function' && !regs) regs = ['worldgen/density_function'];
      if (v.startsWith('#')) regs = ['tags/worldgen/biome'];
      const k = v + '|' + (regs || []).join(',');
      if (!found.has(k)) found.set(k, { id: v, regs });
      return;
    }
    if (Array.isArray(v)) { for (const x of v) walk(x, key, depth); return; }
    if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k, depth + 1);
  };
  walk(json, '', 0);
  const out = [];
  const seen = new Set();
  for (const { id, regs } of found.values()) {
    const isTag = id.startsWith('#');
    const cands = isTag ? ['tags/worldgen/biome'] : regs || REGISTRIES.map((r) => r.key);
    let hit = null;
    for (const r of cands) if ((isTag ? resolveRef(r, id.slice(1)) : resolveRef(r, id))) { hit = r; break; }
    if (!hit && !regs) continue; // a block or other non-registry id
    const r = hit || cands[0];
    const key = r + '|' + id;
    if (seen.has(key) || (self && r === self.reg && normId(id) === self.id)) continue;
    seen.add(key);
    out.push({ reg: r, id: isTag ? id : normId(id) });
  }
  return out;
}
function refsSection(json, reg) {
  const refs = findRefs(json, reg);
  if (!refs.length) return null;
  const groups = new Map();
  for (const r of refs) { if (!groups.has(r.reg)) groups.set(r.reg, []); groups.get(r.reg).push(r.id); }
  return sec('References', ...[...groups.entries()].map(([r, ids]) => h('div', { class: 'ref-group' }, h('span', { class: 'ref-label' }, REG[r] ? REG[r].label : r), chips(ids.slice(0, 80).map((id) => refChip(r, id))))));
}
const refCache = new Map(); // path -> { text, refs }
function usedBySection(id, reg) {
  if (!id || !PJ.cur) return null;
  const tagId = reg === 'tags/worldgen/biome' ? '#' + id : null;
  const hits = [];
  for (const [path, text] of PJ.cur.files) {
    if (path === TARGET.path || !text.includes(short(id))) continue;
    let c = refCache.get(path);
    if (!c || c.text !== text) {
      const pf = parsedFile(path);
      const info = parsePath(path);
      c = { text, refs: pf && !pf.error && info ? findRefs(pf.json, info.reg, info) : [] };
      refCache.set(path, c);
    }
    if (c.refs.some((r) => (tagId ? r.id === tagId : r.reg === reg && r.id === id))) hits.push(path);
  }
  if (!hits.length) return null;
  return sec('Used by in this project', chips(hits.map((p) => {
    const info = parsePath(p);
    const b = h('button', { class: 'chip proj', type: 'button', title: p }, h('i', { style: { background: `var(${(info && REG[info.reg] || {}).color || '--c-util'})` } }), fileTitle(p));
    b.addEventListener('click', () => openFile(p));
    return b;
  })));
}

/* ---------- individual cards ---------- */
const STEPS = ['raw_generation', 'lakes', 'local_modifications', 'underground_structures', 'surface_structures', 'strongholds', 'underground_ores', 'underground_decoration', 'fluid_springs', 'vegetal_decoration', 'top_layer_modification'];
function cardBiome() {
  const j = TARGET.json || {};
  const fx = j.effects || {};
  const at = j.attributes || {};
  const colors = [];
  for (const [k, v] of Object.entries(at)) if (/color/.test(k) && typeof v !== 'object') colors.push(swatch(k.replace(/^minecraft:visual\//, '').replace(/_/g, ' '), v));
  for (const [k, v] of Object.entries(fx)) if (/color$/.test(k)) colors.push(swatch(k.replace(/_/g, ' '), v));
  const spawns = (at['minecraft:gameplay/natural_mob_spawns'] && at['minecraft:gameplay/natural_mob_spawns'].argument && at['minecraft:gameplay/natural_mob_spawns'].argument.spawns_by_category) || j.spawners || {};
  const spawnRows = Object.entries(spawns).filter(([, l]) => l && l.length).map(([cat, l]) => [cat, l.map((s) => `${short(s.type)} ×${typeof s.count === 'object' ? `${s.count.min_inclusive}–${s.count.max_inclusive}` : s.count ?? `${s.minCount}–${s.maxCount}`} (${s.weight})`).join(', ')]);
  const feats = (j.features || []).map((l, i) => (l && l.length ? h('div', { class: 'ref-group' }, h('span', { class: 'ref-label' }, STEPS[i] || 'step ' + i), chips(l.map((f) => (typeof f === 'string' ? refChip('worldgen/placed_feature', f) : h('span', { class: 'chip' }, 'inline'))))) : null)).filter(Boolean);
  const inOverworld = (VANILLA.presets['minecraft:overworld'].biomes || []).includes(TARGET.id);
  showCard(
    h('div', { class: 'biome-hero', style: { '--sky': rgbCss(hexRgb(at['minecraft:visual/sky_color'] || '#78a7ff') || [120, 167, 255]), '--water': rgbCss(hexRgb(fx.water_color || '#3f76e4') || [63, 118, 228]), '--grass': rgbCss(hexRgb(fx.grass_color || '#79c05a') || [121, 192, 90]), '--map': rgbCss(biomeColor(TARGET.id)) } }, h('span', {}, short(TARGET.id))),
    sec('Climate', kv([['temperature', j.temperature], ['downfall', j.downfall], ['precipitation', j.has_precipitation], ['temperature modifier', j.temperature_modifier], ['grass modifier', fx.grass_color_modifier], ['in vanilla overworld', TARGET.reg === 'worldgen/biome' && TARGET.id.startsWith('minecraft:') ? inOverworld : undefined]])),
    colors.filter(Boolean).length ? sec('Colours', h('div', { class: 'swatches' }, colors)) : null,
    spawnRows.length ? sec('Mob spawns', kv(spawnRows)) : null,
    (j.carvers && (Array.isArray(j.carvers) ? j.carvers.length : true)) ? sec('Carvers', chips((Array.isArray(j.carvers) ? j.carvers : [j.carvers]).map((c) => typeof c === 'string' && c.startsWith('#') ? h('span', { class: 'chip' }, c) : refChip('worldgen/carver', c)))) : null,
    feats.length ? sec('Features by step', ...feats) : null,
  );
}
function cardDimType() {
  const j = TARGET.json || {};
  const minY = j.min_y ?? 0, height = j.height ?? 256, logical = j.logical_height ?? height;
  const bar = h('div', { class: 'vbar' });
  const H = 220;
  const total = Math.max(height, 16);
  bar.append(
    h('div', { class: 'vbar-col', style: { height: H + 'px' } },
      h('div', { class: 'vbar-fill', style: { height: '100%' } }),
      h('div', { class: 'vbar-logical', style: { height: (logical / total) * 100 + '%' } }),
      h('span', { class: 'vbar-top' }, `y ${minY + height}`), h('span', { class: 'vbar-bot' }, `y ${minY}`)),
    h('div', { class: 'vbar-legend' }, h('div', {}, h('i', { class: 'l1' }), `build height ${height}`), h('div', {}, h('i', { class: 'l2' }), `logical height ${logical}`)),
  );
  const at = j.attributes || {};
  const colors = Object.entries(at).filter(([k, v]) => /color/.test(k) && typeof v !== 'object').map(([k, v]) => swatch(k.replace(/^minecraft:visual\//, '').replace(/_/g, ' '), v));
  const flags = Object.entries(j).filter(([k, v]) => typeof v !== 'object' && !['min_y', 'height', 'logical_height'].includes(k));
  showCard(
    sec('Vertical range', bar),
    sec('Settings', kv(flags)),
    colors.filter(Boolean).length ? sec('Colours', h('div', { class: 'swatches' }, colors)) : null,
    Object.keys(at).length ? sec('Attributes', kv(Object.entries(at).filter(([k, v]) => !/color/.test(k) || typeof v === 'object').map(([k, v]) => [k.replace(/^minecraft:/, ''), v]))) : null,
  );
}
function cardDimension(dim) {
  const gen = dim.generator || {};
  const bs = gen.biome_source || {};
  const rows = [['generator', short(gen.type || '?')]];
  const extra = [];
  if (typeof dim.type === 'string') extra.push(h('div', { class: 'ref-group' }, h('span', { class: 'ref-label' }, 'Dimension type'), chips([refChip('dimension_type', dim.type)])));
  if (typeof gen.settings === 'string') extra.push(h('div', { class: 'ref-group' }, h('span', { class: 'ref-label' }, 'Noise settings'), chips([refChip('worldgen/noise_settings', gen.settings)])));
  if (bs.type) {
    rows.push(['biome source', short(bs.type)]);
    if (bs.preset) extra.push(h('div', { class: 'ref-group' }, h('span', { class: 'ref-label' }, 'Parameter list'), chips([refChip('worldgen/multi_noise_biome_source_parameter_list', bs.preset)])));
    if (Array.isArray(bs.biomes)) {
      const ids = [...new Set(bs.biomes.map((b) => (typeof b === 'string' ? b : b.biome)))];
      rows.push(['biomes', ids.length]);
      extra.push(chips(ids.slice(0, 60).map(biomeChip)));
    }
    if (typeof bs.biome === 'string') extra.push(chips([biomeChip(bs.biome)]));
  }
  showCard(sec('Generator', kv(rows), ...extra));
}
function cardFlat(settings, dim, preset) {
  settings = settings || {};
  const layers = settings.layers || [];
  let minY = 0;
  try { if (dim && typeof dim.type === 'string') minY = (resolveJson('dimension_type', dim.type) || {}).min_y ?? 0; } catch { /* ignore */ }
  if (!dim && preset) minY = -64;
  const total = layers.reduce((s, l) => s + (l.height || 0), 0);
  const col = h('div', { class: 'layers' });
  let y = minY;
  const rows = layers.map((l) => { const r = { block: l.block, height: l.height || 0, y0: y }; y += r.height; return r; });
  for (const l of rows.reverse()) {
    const c = blockColor(l.block) || [200, 200, 200];
    col.append(h('div', { class: 'layer', style: { '--c': rgbCss(c), flexGrow: String(Math.max(1, Math.log2(l.height + 1))) } },
      h('span', { class: 'layer-name' }, short(l.block)), h('span', { class: 'layer-h' }, `${l.height} · y ${l.y0}${l.height > 1 ? `…${l.y0 + l.height - 1}` : ''}`)));
  }
  showCard(
    preset && preset.display ? sec('Icon', chips([h('span', { class: 'chip' }, h('i', { style: { background: rgbCss(blockColor(preset.display) || [128, 128, 128]) } }), short(preset.display))])) : null,
    sec(`Layers · ${total} block${total === 1 ? '' : 's'} thick`, layers.length ? col : h('p', { class: 'muted' }, 'No layers: the world is empty.')),
    sec('Settings', kv([['biome', settings.biome ? biomeChip(settings.biome) : undefined], ['features', settings.features], ['lakes', settings.lakes]]),
      settings.structure_overrides ? h('div', { class: 'ref-group' }, h('span', { class: 'ref-label' }, 'Structure sets'), chips((Array.isArray(settings.structure_overrides) ? settings.structure_overrides : [settings.structure_overrides]).map((s) => s.startsWith('#') ? h('span', { class: 'chip' }, s) : refChip('worldgen/structure_set', s)))) : null),
  );
}
function expandBiomes(value, seen = new Set()) {
  const out = new Set();
  const add = (v) => {
    if (typeof v !== 'string') { if (v && v.id) add(v.id); return; }
    if (v.startsWith('#')) {
      const id = v.slice(1);
      if (seen.has(id)) return;
      seen.add(id);
      const t = resolveJson('tags/worldgen/biome', id);
      for (const x of (t && t.values) || []) add(x);
    } else out.add(normId(v));
  };
  if (Array.isArray(value)) value.forEach(add); else if (value) add(value);
  return [...out];
}
function cardStructure() {
  const j = TARGET.json || {};
  const biomes = expandBiomes(j.biomes);
  const sets = [];
  for (const id of allIds('worldgen/structure_set')) {
    const s = resolveJson('worldgen/structure_set', id);
    if (s && (s.structures || []).some((e) => normId(e.structure) === TARGET.id)) sets.push(id);
  }
  showCard(
    sec('Structure', kv([['type', short(j.type || '?')], ['step', j.step], ['terrain adaptation', j.terrain_adaptation], ['size', j.size], ['max distance', j.max_distance_from_center], ['start height', j.start_height], ['heightmap', j.project_start_to_heightmap]])),
    j.start_pool ? sec('Start pool', chips([refChip('worldgen/template_pool', j.start_pool)])) : null,
    sec(`Biomes · ${biomes.length}`, typeof j.biomes === 'string' && j.biomes.startsWith('#') ? chips([refChip('tags/worldgen/biome', j.biomes)]) : null, chips(biomes.slice(0, 80).map(biomeChip))),
    sets.length ? sec('Placed by structure sets', chips(sets.map((s) => refChip('worldgen/structure_set', s)))) : null,
  );
}
function cardStructureSet() {
  const j = TARGET.json || {};
  const p = j.placement || {};
  const total = (j.structures || []).reduce((s, e) => s + (e.weight || 1), 0) || 1;
  showCard(
    sec('Placement', kv(Object.entries(p).map(([k, v]) => [k.replace(/_/g, ' '), k === 'preferred_biomes' && typeof v === 'string' ? refChip('tags/worldgen/biome', v) : v]))),
    sec('Structures', ...(j.structures || []).map((e) => h('div', { class: 'weight-row' },
      typeof e.structure === 'string' ? refChip('worldgen/structure', e.structure) : h('span', { class: 'chip' }, 'inline'),
      h('div', { class: 'wbar' }, h('i', { style: { width: ((e.weight || 1) / total) * 100 + '%' } })), h('code', {}, String(e.weight || 1))))),
  );
}
function cardPool() {
  const j = TARGET.json || {};
  const els = j.elements || [];
  const total = els.reduce((s, e) => s + (e.weight || 1), 0) || 1;
  showCard(
    j.fallback ? sec('Fallback', chips([refChip('worldgen/template_pool', j.fallback)])) : null,
    sec(`Elements · ${els.length}`, ...els.map((e) => {
      const el = e.element || {};
      const proc = typeof el.processors === 'string' ? refChip('worldgen/processor_list', el.processors) : null;
      return h('div', { class: 'weight-row' }, h('span', { class: 'el-name', title: short(el.element_type || '') }, short(el.location || el.feature || short(el.element_type || '?'))), proc,
        h('div', { class: 'wbar' }, h('i', { style: { width: ((e.weight || 1) / total) * 100 + '%' } })), h('code', {}, String(e.weight || 1)));
    })),
  );
}
function ruleTree(v, kind, depth = 0) {
  if (depth > 40) return h('span', {}, '…');
  if (typeof v === 'string') return refChip(kind === 'cond' ? 'worldgen/material_condition' : 'worldgen/material_rule', v);
  if (!v || typeof v !== 'object') return h('code', {}, String(v));
  const t = typeOf(v);
  if (kind !== 'cond') {
    if (t === 'sequence') return h('div', { class: 'rt' }, h('div', { class: 'rt-k' }, 'first match of'), h('ol', {}, (v.sequence || []).map((x) => h('li', {}, ruleTree(x, 'rule', depth + 1)))));
    if (t === 'condition') return h('div', { class: 'rt' }, h('div', { class: 'rt-if' }, h('span', { class: 'rt-k' }, 'if '), ruleTree(v.if_true, 'cond', depth + 1)), h('div', { class: 'rt-then' }, ruleTree(v.then_run, 'rule', depth + 1)));
    if (t === 'block') {
      const name = typeof v.result_state === 'string' ? v.result_state : (v.result_state && (v.result_state.Name || v.result_state.id)) || '?';
      return h('span', { class: 'chip' }, h('i', { style: { background: rgbCss(blockColor(name) || [255, 255, 255]) } }), short(name));
    }
    return h('span', { class: 'rt-k' }, `${t} `, h('code', {}, fmtVal(Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'type')))));
  }
  if (t === 'not') return h('span', {}, h('span', { class: 'rt-k' }, 'not '), ruleTree(v.invert, 'cond', depth + 1));
  if (t === 'biome') return h('span', {}, h('span', { class: 'rt-k' }, 'biome is '), chips((Array.isArray(v.biome_is) ? v.biome_is : [v.biome_is]).map((b) => (String(b).startsWith('#') ? refChip('tags/worldgen/biome', b) : biomeChip(b)))));
  const rest = Object.entries(v).filter(([k]) => k !== 'type').map(([k, x]) => `${k} ${fmtVal(x)}`).join(', ');
  return h('span', {}, h('b', {}, t.replace(/_/g, ' ')), rest ? h('span', { class: 'rt-k' }, ' (' + rest + ')') : null);
}
function cardRule() {
  showCard(sec(TARGET.reg === 'worldgen/material_condition' ? 'Condition' : 'Rule', h('div', { class: 'rule-tree' }, ruleTree(TARGET.json, TARGET.reg === 'worldgen/material_condition' ? 'cond' : 'rule'))));
}
function cardTag() {
  const j = TARGET.json || {};
  const vals = j.values || [];
  const all = expandBiomes(vals.map((v) => (typeof v === 'string' ? v : v.id)));
  showCard(
    sec('Values', chips(vals.map((v) => { const id = typeof v === 'string' ? v : v.id; return id.startsWith('#') ? refChip('tags/worldgen/biome', id) : biomeChip(id); }))),
    sec(`All biomes · ${all.length}`, chips(all.map(biomeChip))),
  );
}
function cardPlaced() {
  const j = TARGET.json || {};
  const f = j.feature;
  const fj = typeof f === 'string' ? resolveJson('worldgen/feature', f) : f;
  showCard(
    sec('Feature', typeof f === 'string' ? chips([refChip('worldgen/feature', f)]) : null, kv([['type', fj ? short(fj.type || '?') : '(unknown)']])),
    sec('Placement modifiers', h('ol', { class: 'mods' }, (j.placement || []).map((m) => h('li', {}, h('b', {}, short(m.type || '?')), ' ', h('code', {}, fmtVal(Object.fromEntries(Object.entries(m).filter(([k]) => k !== 'type')))))))),
  );
}
function cardFeature() {
  const j = TARGET.json || {};
  const cfg = j.config || j;
  showCard(sec('Feature', kv([['type', short(j.type || '?')], ...Object.entries(cfg).filter(([k]) => k !== 'type').map(([k, v]) => [k.replace(/_/g, ' '), v])])));
}
function cardPack() {
  const p = (TARGET.json && TARGET.json.pack) || {};
  showCard(sec('Pack', kv([['description', typeof p.description === 'string' ? p.description : JSON.stringify(p.description)], ['pack format', p.pack_format], ['min format', p.min_format], ['max format', p.max_format]])),
    sec('Files', kv(REGISTRIES.map((r) => [r.label, projectEntries(r.key).length]).filter(([, n]) => n))));
}
function cardGeneric() {
  const j = TARGET.json;
  const rows = j && typeof j === 'object' && !Array.isArray(j) ? Object.entries(j).map(([k, v]) => [k.replace(/_/g, ' '), v]) : [['value', j]];
  showCard(sec('Contents', kv(rows)));
}
