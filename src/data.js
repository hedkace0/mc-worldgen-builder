/* ================= vanilla data & registry metadata ================= */
const VANILLA = JSON.parse($('#vanilla-data').textContent);
const MC_VERSION = VANILLA.version;
const PACK_FORMAT = 121;

/* Registries the workbench knows. `dir` is the folder under data/<namespace>/. */
const REGISTRIES = [
  { key: 'dimension', dir: 'dimension', label: 'Dimensions', color: '--c-out' },
  { key: 'dimension_type', dir: 'dimension_type', label: 'Dimension types', color: '--c-out' },
  { key: 'worldgen/world_preset', dir: 'worldgen/world_preset', label: 'World presets', color: '--c-out' },
  { key: 'worldgen/flat_level_generator_preset', dir: 'worldgen/flat_level_generator_preset', label: 'Flat presets', color: '--c-out' },
  { key: 'worldgen/noise_settings', dir: 'worldgen/noise_settings', label: 'Noise settings', color: '--c-shape' },
  { key: 'worldgen/density_function', dir: 'worldgen/density_function', label: 'Density functions', color: '--c-math' },
  { key: 'worldgen/noise', dir: 'worldgen/noise', label: 'Noises', color: '--c-noise' },
  { key: 'worldgen/multi_noise_biome_source_parameter_list', dir: 'worldgen/multi_noise_biome_source_parameter_list', label: 'Biome parameter lists', color: '--c-input' },
  { key: 'worldgen/biome', dir: 'worldgen/biome', label: 'Biomes', color: '--c-input' },
  { key: 'tags/worldgen/biome', dir: 'tags/worldgen/biome', label: 'Biome tags', color: '--c-input', tag: true },
  { key: 'worldgen/material_rule', dir: 'worldgen/material_rule', label: 'Material rules', color: '--c-shape' },
  { key: 'worldgen/material_condition', dir: 'worldgen/material_condition', label: 'Material conditions', color: '--c-shape' },
  { key: 'worldgen/carver', dir: 'worldgen/carver', label: 'Carvers', color: '--c-util' },
  { key: 'worldgen/feature', dir: 'worldgen/feature', label: 'Features', color: '--c-select' },
  { key: 'worldgen/placed_feature', dir: 'worldgen/placed_feature', label: 'Placed features', color: '--c-select' },
  { key: 'worldgen/block_state_provider', dir: 'worldgen/block_state_provider', label: 'Block state providers', color: '--c-select' },
  { key: 'worldgen/structure', dir: 'worldgen/structure', label: 'Structures', color: '--c-noise' },
  { key: 'worldgen/structure_set', dir: 'worldgen/structure_set', label: 'Structure sets', color: '--c-noise' },
  { key: 'worldgen/template_pool', dir: 'worldgen/template_pool', label: 'Template pools', color: '--c-noise' },
  { key: 'worldgen/processor_list', dir: 'worldgen/processor_list', label: 'Processor lists', color: '--c-noise' },
];
const REG = Object.fromEntries(REGISTRIES.map((r) => [r.key, r]));
const regLabel1 = (key) => (REG[key] ? REG[key].label.replace(/ies$/, 'y').replace(/s$/, '') : key);

function vanillaIds(reg) {
  return Object.keys((VANILLA.reg[reg]) || {}).concat((VANILLA.ids[reg]) || []).sort();
}
function vanillaHas(reg, id) {
  return !!((VANILLA.reg[reg] && VANILLA.reg[reg][id] !== undefined) || (VANILLA.ids[reg] && VANILLA.ids[reg].includes(id)));
}
const vanillaFetchCache = new Map();
/** Vanilla JSON for an id. Template pools are not bundled and are fetched from mcmeta on demand. */
async function vanillaJsonAsync(reg, id) {
  const v = VANILLA.reg[reg] && VANILLA.reg[reg][id];
  if (v !== undefined) return v;
  if (!(VANILLA.ids[reg] || []).includes(id)) return undefined;
  const key = reg + '|' + id;
  if (!vanillaFetchCache.has(key)) {
    const url = `https://raw.githubusercontent.com/misode/mcmeta/${MC_VERSION}-data-json/data/minecraft/${REG[reg].dir}/${id.split(':')[1]}.json`;
    vanillaFetchCache.set(key, fetch(url).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }));
  }
  return vanillaFetchCache.get(key);
}

/* ---------- biome colours (for maps) ---------- */
const BIOME_COLORS = {
  ocean: '#1f3fa8', deep_ocean: '#162f80', warm_ocean: '#2a8fbd', lukewarm_ocean: '#2a6fbd', deep_lukewarm_ocean: '#21589a',
  cold_ocean: '#2a4f9a', deep_cold_ocean: '#203d7a', frozen_ocean: '#6f8fd0', deep_frozen_ocean: '#5873b0',
  river: '#3a63dd', frozen_river: '#9fb6ee', beach: '#e3d79a', snowy_beach: '#e8e6cf', stony_shore: '#8d8f8a',
  plains: '#8db360', sunflower_plains: '#a8c25a', snowy_plains: '#e4ecf2', ice_spikes: '#b4dcec',
  desert: '#e8c97a', swamp: '#4c6e45', mangrove_swamp: '#3d6b4f', forest: '#3f7a2c', flower_forest: '#5e9b3a',
  birch_forest: '#5c9a4c', old_growth_birch_forest: '#4f8a42', dark_forest: '#2c4f1e', pale_garden: '#9aa39a',
  taiga: '#3c6f5a', old_growth_pine_taiga: '#4f6b4c', old_growth_spruce_taiga: '#40624a', snowy_taiga: '#7ea39a',
  savanna: '#bdb25f', savanna_plateau: '#a79d55', windswept_savanna: '#c5b96c', windswept_hills: '#7c8a74',
  windswept_gravelly_hills: '#8a8f87', windswept_forest: '#567a59', jungle: '#2f8f1a', sparse_jungle: '#55a032',
  bamboo_jungle: '#6fa62a', badlands: '#c96a33', eroded_badlands: '#d9773c', wooded_badlands: '#a8683a',
  meadow: '#7fc17a', cherry_grove: '#eaa6c4', grove: '#a9c9b6', snowy_slopes: '#d7e4ec', frozen_peaks: '#c3d8ec',
  jagged_peaks: '#e8eef4', stony_peaks: '#9a9a96', mushroom_fields: '#a77fa6', dripstone_caves: '#86684e',
  lush_caves: '#6fa64a', deep_dark: '#1d2b33', sulfur_caves: '#c9b93f', dappled_forest: '#6a9a3e',
  nether_wastes: '#8a2b24', soul_sand_valley: '#5a4636', crimson_forest: '#b02a2a', warped_forest: '#2a8a80',
  basalt_deltas: '#5a5560', the_end: '#c8c27e', end_highlands: '#b7b26c', end_midlands: '#a9a463',
  small_end_islands: '#8d8955', end_barrens: '#7a774c', the_void: '#101010',
};
const biomeRgbCache = new Map();
function biomeColor(id) {
  let c = biomeRgbCache.get(id);
  if (!c) {
    const name = String(id).replace(/^minecraft:/, '');
    c = (String(id).startsWith('minecraft:') || !String(id).includes(':')) && BIOME_COLORS[name] ? hexRgb(BIOME_COLORS[name]) : hashColor(String(id));
    biomeRgbCache.set(id, c);
  }
  return c;
}

/* ---------- block colours (for terrain slices and voxels) ---------- */
const BLOCK_COLORS = {
  air: null, cave_air: null, void_air: null,
  stone: '#7f8288', deepslate: '#4d4f57', granite: '#9a6b58', diorite: '#bcbcbc', andesite: '#888a88', tuff: '#6c6d66',
  calcite: '#dfe0dc', dirt: '#79593d', coarse_dirt: '#77553b', rooted_dirt: '#8f6a4c', grass_block: '#6aa84f',
  podzol: '#5f4524', mycelium: '#77686f', mud: '#3c3a3d', clay: '#a0a6b3', gravel: '#857f7c', sand: '#dbcf9e',
  sandstone: '#d8cb94', red_sand: '#be6a2f', red_sandstone: '#b5612a', terracotta: '#985e43', white_terracotta: '#d1b2a1',
  orange_terracotta: '#a2531f', yellow_terracotta: '#ba8523', brown_terracotta: '#4d3324', red_terracotta: '#8f3d2e',
  light_gray_terracotta: '#876a61', snow_block: '#f0f8f8', snow: '#f0f8f8', powder_snow: '#f4fafc', ice: '#8eb5f5',
  packed_ice: '#8db4ee', blue_ice: '#74a8f8', water: '#3d6fc4', lava: '#e0661a', bedrock: '#3a3a3a', obsidian: '#1b1426',
  netherrack: '#6e3433', soul_sand: '#51402f', soul_soil: '#4b3a2c', basalt: '#4a4a50', blackstone: '#2c2629',
  crimson_nylium: '#882020', warped_nylium: '#2b7265', nether_wart_block: '#7a1414', warped_wart_block: '#167a72',
  magma_block: '#8e3d16', glowstone: '#c79a54', end_stone: '#dcdea0', cobblestone: '#7a7a7a', mossy_cobblestone: '#6b7a5a',
  moss_block: '#5a7a2c', copper_ore: '#8a7a6a', iron_ore: '#8a8078', raw_copper_block: '#9a6a4a', raw_iron_block: '#a68b6c',
  deepslate_iron_ore: '#5e5a58', coal_ore: '#6a6a6a', diamond_ore: '#7aa8a8', redstone: '#a01010', sulfur: '#c9b93f',
  cinnabar: '#a83a32', oak_log: '#6b5332', oak_leaves: '#4a7a2a', spruce_log: '#3a2a1a', spruce_leaves: '#3a5a3a',
  birch_log: '#d8d4c8', birch_leaves: '#6a8a4a', jungle_log: '#5a4a2a', jungle_leaves: '#3a8a1a', acacia_log: '#6a6058',
  acacia_leaves: '#5a7a2a', dark_oak_log: '#3a2a1a', dark_oak_leaves: '#2a5a1a', cherry_log: '#3a2a2a', cherry_leaves: '#e8a8c8',
  mangrove_log: '#5a3a2a', mangrove_leaves: '#4a7a2a', pale_oak_log: '#8a8478', pale_oak_leaves: '#9aa39a',
  azalea_leaves: '#5a8a2a', flowering_azalea_leaves: '#7a8a5a', crimson_stem: '#7a2a3a', warped_stem: '#2a6a6a',
  short_grass: '#6aa84f', tall_grass: '#6aa84f', fern: '#5a8a3a', dandelion: '#e8d83a', poppy: '#c82a2a',
  emerald_ore: '#5a9a6a', gold_ore: '#a89a5a', lapis_ore: '#4a5aa8', amethyst_block: '#8a5ac8', budding_amethyst: '#7a4ab8',
  smooth_basalt: '#4a4a52', prismarine: '#5aa89a', dripstone_block: '#86684e', pointed_dripstone: '#86684e',
};
const blockRgbCache = new Map();
function blockColor(name) {
  const id = String(name).replace(/^minecraft:/, '').replace(/\[.*$/, '');
  if (blockRgbCache.has(id)) return blockRgbCache.get(id);
  let c;
  if (id in BLOCK_COLORS) c = BLOCK_COLORS[id] ? hexRgb(BLOCK_COLORS[id]) : null;
  else if (/deepslate/.test(id)) c = hexRgb('#55575f');
  else if (/_ore$/.test(id)) c = hexRgb('#8a8580');
  else if (/leaves/.test(id)) c = hexRgb('#4a7a2a');
  else if (/(_log|_wood|_stem)$/.test(id)) c = hexRgb('#6b5332');
  else if (/terracotta/.test(id)) c = hexRgb('#985e43');
  else c = hashColor(id);
  blockRgbCache.set(id, c);
  return c;
}

/* ---------- templates for new files ---------- */
const V = (reg, id) => clone(VANILLA.reg[reg] && VANILLA.reg[reg][id]);
const TEMPLATES = {
  'dimension': () => ({ type: 'minecraft:overworld', generator: { type: 'minecraft:noise', settings: 'minecraft:overworld', biome_source: { type: 'minecraft:multi_noise', preset: 'minecraft:overworld' } } }),
  'dimension_type': () => V('dimension_type', 'minecraft:overworld'),
  'worldgen/world_preset': () => V('worldgen/world_preset', 'minecraft:normal'),
  'worldgen/flat_level_generator_preset': () => V('worldgen/flat_level_generator_preset', 'minecraft:classic_flat'),
  'worldgen/noise_settings': () => V('worldgen/noise_settings', 'minecraft:overworld'),
  'worldgen/density_function': () => ({ type: 'minecraft:add', left: { type: 'minecraft:gradient', axis: 'y', from_coordinate: 0, from_value: 1, to_coordinate: 128, to_value: -1 }, right: { type: 'minecraft:noise', noise: 'minecraft:cave_cheese', xz_scale: 1, y_scale: 0.5 } }),
  'worldgen/noise': () => V('worldgen/noise', 'minecraft:cave_cheese'),
  'worldgen/multi_noise_biome_source_parameter_list': () => ({ preset: 'minecraft:overworld' }),
  'worldgen/biome': () => V('worldgen/biome', 'minecraft:plains'),
  'tags/worldgen/biome': () => ({ values: ['minecraft:plains'] }),
  'worldgen/material_rule': () => V('worldgen/material_rule', 'minecraft:overworld/biome_surface/default'),
  'worldgen/material_condition': () => V('worldgen/material_condition', 'minecraft:on_floor'),
  'worldgen/carver': () => V('worldgen/carver', 'minecraft:cave'),
  'worldgen/feature': () => V('worldgen/feature', 'minecraft:ore_iron'),
  'worldgen/placed_feature': () => V('worldgen/placed_feature', 'minecraft:ore_iron_upper'),
  'worldgen/block_state_provider': () => ({ type: 'minecraft:simple', state: 'minecraft:stone' }),
  'worldgen/structure': () => V('worldgen/structure', 'minecraft:desert_pyramid'),
  'worldgen/structure_set': () => V('worldgen/structure_set', 'minecraft:villages'),
  'worldgen/template_pool': () => ({ fallback: 'minecraft:empty', elements: [{ weight: 1, element: { element_type: 'minecraft:single_pool_element', location: 'minecraft:village/plains/houses/plains_small_house_1', processors: 'minecraft:empty', projection: 'rigid' } }] }),
  'worldgen/processor_list': () => V('worldgen/processor_list', 'minecraft:mossify_10_percent'),
};
const packMcmeta = (desc) => JSON.stringify({ pack: { description: desc || 'Made with Worldgen Workbench', min_format: PACK_FORMAT, max_format: PACK_FORMAT } }, null, 2) + '\n';
