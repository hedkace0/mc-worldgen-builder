/* Evaluation engine. Concatenated after the deepslate UMD bundle, so `deepslate` is a global.
   Runs inside a Worker; falls back to the main thread through self.__dfEngine.
   Vanilla registry entries are registered as builtins; the open project's files are registered on top
   and replaced wholesale whenever the project changes (Registry.clear() restores the builtins). */
(function () {
  const D = self.deepslate;
  const R = D.WorldgenRegistries;
  const ID = (s) => D.Identifier.parse(s);
  let VAN = null;
  let PROJ = {};
  let projVersion = -1;
  const cache = new Map();

  const PARSERS = {
    'worldgen/noise': [R.NOISE, (j) => D.NormalNoise.fromJson(j)],
    'worldgen/density_function': [R.DENSITY_FUNCTION, (j) => D.DensityFunction.fromJson(j)],
    'worldgen/noise_settings': [R.NOISE_SETTINGS, (j) => D.NoiseGeneratorSettings.fromJson(j)],
    'worldgen/material_rule': [R.MATERIAL_RULE, (j) => D.MaterialRule.fromJson(j)],
    'worldgen/material_condition': [R.MATERIAL_CONDITION, (j) => D.MaterialCondition.fromJson(j)],
    'worldgen/structure': [D.WorldgenStructure.REGISTRY, (j) => D.WorldgenStructure.fromJson(j)],
    'worldgen/structure_set': [D.StructureSet.REGISTRY, (j) => D.StructureSet.fromJson(j)],
  };
  function registerAll(src, builtin) {
    for (const [key, [registry, parse]] of Object.entries(PARSERS)) {
      for (const [id, json] of Object.entries(src[key] || {})) registry.register(ID(id), () => parse(json), builtin);
    }
    for (const id of Object.keys(src['worldgen/biome'] || {})) R.BIOME.register(ID(id), {}, builtin);
    const tags = R.BIOME.getTagRegistry();
    for (const [id, json] of Object.entries(src['tags/worldgen/biome'] || {})) {
      tags.register(ID(id), () => D.HolderSet.fromJson(R.BIOME, json, ID(id)), builtin);
    }
  }
  function setProject(version, data) {
    if (version === projVersion) return;
    for (const [registry] of Object.values(PARSERS)) registry.clear();
    R.BIOME.clear();
    registerAll(data || {}, false);
    PROJ = data || {};
    projVersion = version;
    cache.clear();
  }
  const lookup = (reg, id) => {
    const p = PROJ[reg] && PROJ[reg][id];
    if (p !== undefined) return p;
    return VAN.reg[reg] && VAN.reg[reg][id];
  };

  /* ---------- multi-noise presets ---------- */
  const presetEntries = new Map();
  function builtinPreset(name) {
    if (presetEntries.has(name)) return presetEntries.get(name);
    const p = VAN.presets[name];
    if (!p) throw new Error('Unknown multi-noise preset ' + name);
    let entries = p.biomes;
    if (p.packed) {
      const bin = atob(p.data);
      const n = p.count, stride = 14;
      entries = new Array(n);
      for (let i = 0; i < n; i++) {
        const o = i * stride;
        const params = {};
        p.keys.forEach((k, j) => {
          const vals = p.values[j];
          const a = vals[bin.charCodeAt(o + 1 + j * 2)], b = vals[bin.charCodeAt(o + 2 + j * 2)];
          params[k] = a === b ? a : [a, b];
        });
        params.offset = p.offsets[bin.charCodeAt(o + 13)];
        entries[i] = { biome: p.biomes[bin.charCodeAt(o)], parameters: params };
      }
    }
    presetEntries.set(name, entries);
    return entries;
  }
  /** Parameter-list id -> biome entries. A list file names a built-in preset (or, unofficially, holds `biomes`). */
  function paramListEntries(listId) {
    const json = lookup('worldgen/multi_noise_biome_source_parameter_list', listId);
    if (json && Array.isArray(json.biomes)) return json.biomes;
    if (json && json.preset) return builtinPreset(json.preset);
    return builtinPreset(listId);
  }
  function biomeSource(json) {
    if (!json) return null;
    const key = 'bs|' + JSON.stringify(json);
    if (cache.has(key)) return cache.get(key);
    const t = String(json.type || '').replace(/^minecraft:/, '');
    let src;
    if (t === 'multi_noise') {
      const entries = Array.isArray(json.biomes) ? json.biomes : paramListEntries(json.preset);
      src = D.MultiNoiseBiomeSource.fromJson({ biomes: entries });
    } else src = D.BiomeSource.fromJson(json);
    cache.set(key, src);
    return src;
  }
  function multiNoiseParams(entries) {
    const key = 'mn|' + entries.length + '|' + JSON.stringify(entries[0]);
    if (cache.has(key)) return cache.get(key);
    const src = D.MultiNoiseBiomeSource.fromJson({ biomes: entries });
    cache.set(key, src);
    return src;
  }

  /* ---------- generator contexts ---------- */
  function worldContext(settingsJson, sourceJson, seed) {
    const key = 'ctx|' + seed + '|' + JSON.stringify(settingsJson) + '|' + JSON.stringify(sourceJson || null);
    if (cache.has(key)) return cache.get(key);
    const settings = D.NoiseGeneratorSettings.fromJson(settingsJson);
    const rs = new D.RandomState(settings, BigInt(seed));
    const bs = biomeSource(sourceJson);
    const gen = new D.NoiseChunkGenerator(bs || new D.FixedBiomeSource(ID('minecraft:plains')), settings);
    const ctx = { settings, rs, bs, gen, wctx: { minY: settings.noise.minY, height: settings.noise.height, seaLevel: settings.seaLevel } };
    for (const k of cache.keys()) if (k.startsWith('ctx|')) { cache.delete(k); break; }
    cache.set(key, ctx);
    return ctx;
  }
  let dfState = null, dfStateKey = '';
  function dfRandomState(seed) {
    const key = projVersion + '|' + seed;
    if (dfStateKey !== key) { dfState = new D.RandomState(D.NoiseGeneratorSettings.create({}), BigInt(seed)); dfStateKey = key; }
    return dfState;
  }

  /* ---------- palettes ---------- */
  function palette() {
    const names = [], map = new Map();
    return {
      names,
      of(state) {
        const s = state.getName().toString();
        let i = map.get(s);
        if (i === undefined) { i = names.length; names.push(s); map.set(s, i); }
        return i;
      },
      ofName(s) {
        let i = map.get(s);
        if (i === undefined) { i = names.length; names.push(s); map.set(s, i); }
        return i;
      },
    };
  }

  /* ---------- terrain ---------- */
  function biomeGetterFor(ctx, m) {
    if (m.fixedBiome || !ctx.bs) {
      const id = ID(m.fixedBiome || 'minecraft:plains');
      return () => id;
    }
    const memo = new Map();
    return (pos) => {
      const qx = pos[0] >> 2, qy = pos[1] >> 2, qz = pos[2] >> 2;
      const k = qx * 73856093 ^ qy * 19349663 ^ qz * 83492791;
      let b = memo.get(k);
      if (!b) {
        b = ctx.bs.getBiome(qx, qy, qz, ctx.rs.sampler);
        if (memo.size > 50000) memo.clear();
        memo.set(k, b);
      }
      return b;
    };
  }
  /** Fills one chunk's columns at local z in `zs` and applies the material rule to them (deepslate's own
      buildSurface only handles the first z row). */
  function buildChunk(ctx, cx, cz, zs, getBiome, surface) {
    const { settings, rs, gen } = ctx;
    const minY = settings.noise.minY, H = settings.noise.height;
    const chunk = new D.Chunk(minY, H, D.ChunkPos.create(cx, cz));
    const z0 = Math.min(...zs), z1 = Math.max(...zs);
    const volume = new D.DensityVolume(16, H, z1 - z0 + 1, cx * 16, minY, cz * 16 + z0);
    const noiseChunk = new D.NoiseChunk(rs, settings, gen.globalFluidPicker, volume);
    const dens = rs.router.finalDensity.computeVolume(volume);
    for (const lz of zs) {
      const vz = lz - z0;
      const bz = cz * 16 + lz;
      for (let x = 0; x < 16; x++) {
        const bx = cx * 16 + x;
        for (let y = H - 1; y >= 0; y--) {
          const by = minY + y;
          const state = noiseChunk.aquifer.computeSubstance(bx, by, bz, dens[volume.indexUnchecked(x, y, vz)]) ?? settings.defaultBlock;
          if (!state.equals(D.BlockState.AIR)) chunk.getOrCreateSection(chunk.getSectionIndex(by)).setBlockState(x, by & 15, lz, state);
        }
      }
    }
    if (surface) {
      const system = rs.surfaceSystem;
      const context = new D.MaterialRuleContext(system, rs, chunk, noiseChunk, ctx.wctx, getBiome);
      const rule = settings.materialRule.compile(context);
      const AIR = D.BlockState.AIR;
      for (const lz of zs) {
        const bz = cz * 16 + lz;
        for (let x = 0; x < 16; x++) {
          const bx = cx * 16 + x;
          context.updateXZ(bx, bz);
          let stoneAbove = 0, waterHeight = Number.MIN_SAFE_INTEGER, nextCeil = Number.MAX_SAFE_INTEGER;
          for (let y = chunk.maxY; y >= chunk.minY; y--) {
            const pos = [bx, y, bz];
            const old = chunk.getBlockState(pos);
            if (old.equals(AIR)) { stoneAbove = 0; waterHeight = Number.MIN_SAFE_INTEGER; continue; }
            if (old.isFluid()) { if (waterHeight === Number.MIN_SAFE_INTEGER) waterHeight = y + 1; continue; }
            if (nextCeil >= y) {
              nextCeil = Number.MIN_SAFE_INTEGER;
              for (let ly = y - 1; ly >= chunk.minY; ly--) {
                const ns = chunk.getBlockState([bx, ly, bz]);
                if (ns.equals(AIR) || ns.isFluid()) { nextCeil = ly + 1; break; }
              }
            }
            stoneAbove++;
            context.updateY(stoneAbove, y - nextCeil + 1, waterHeight, y);
            const st = rule(bx, y, bz);
            if (st) chunk.setBlockState(pos, st);
          }
        }
      }
    }
    return chunk;
  }
  function terrainSlice(m, post) {
    const ctx = worldContext(m.settings, m.source, m.seed);
    const { settings, rs, gen } = ctx;
    const minY = settings.noise.minY, H = settings.noise.height;
    const p = m.params;
    const { w, h, step, x0, a0, fixed: z } = p;
    const out = new Uint16Array(w * h).fill(65535);
    const pal = palette();
    const t0 = performance.now();
    let last = t0;
    const getBiome = biomeGetterFor(ctx, m);
    const send = (done) => {
      const data = done ? out : out.slice();
      post({ id: m.id, [done ? 'done' : 'partial']: true, data, palette: pal.names.slice(), ms: performance.now() - t0, note: step > 1 ? 'Zoom in to one block per pixel to see surface blocks.' : '' }, [data.buffer]);
    };
    if (step === 1) {
      const cz = Math.floor(z / 16), lz = ((z % 16) + 16) % 16;
      const cxa = Math.floor(x0 / 16), cxb = Math.floor((x0 + w - 1) / 16);
      for (let cx = cxa; cx <= cxb; cx++) {
        const chunk = buildChunk(ctx, cx, cz, [lz], getBiome, true);
        for (let x = 0; x < 16; x++) {
          const i = cx * 16 + x - x0;
          if (i < 0 || i >= w) continue;
          for (let j = 0; j < h; j++) {
            const y = a0 + j;
            if (y < minY || y >= minY + H) continue;
            out[j * w + i] = pal.of(chunk.getBlockState([cx * 16 + x, y, z]));
          }
        }
        const now = performance.now();
        if (now - last > 150) { last = now; send(false); }
      }
      send(true);
      return;
    }
    // zoomed out: sample every `step` blocks, no surface rules
    const cols = 8;
    for (let i0 = 0; i0 < w; i0 += cols) {
      const nx = Math.min(cols, w - i0);
      const ys = Math.max(1, Math.min(h, Math.floor((minY + H - a0 - 1) / step) + 1));
      const yStart = Math.max(0, Math.ceil((minY - a0) / step));
      const volume = new D.DensityVolume(nx, ys - yStart, 1, x0 + i0 * step, a0 + yStart * step, z, step, step, 1);
      const noiseChunk = new D.NoiseChunk(rs, settings, gen.globalFluidPicker, volume);
      const dens = rs.router.finalDensity.computeVolume(volume);
      for (let ix = 0; ix < nx; ix++) {
        for (let jy = 0; jy < ys - yStart; jy++) {
          const by = a0 + (jy + yStart) * step, bx = x0 + (i0 + ix) * step;
          const st = noiseChunk.aquifer.computeSubstance(bx, by, z, dens[volume.indexUnchecked(ix, jy, 0)]) ?? settings.defaultBlock;
          out[(jy + yStart) * w + i0 + ix] = pal.of(st);
        }
      }
      const now = performance.now();
      if (now - last > 150) { last = now; send(false); }
    }
    send(true);
  }
  function terrain3d(m, post) {
    const ctx = worldContext(m.settings, m.source, m.seed);
    const { settings } = ctx;
    const minY = settings.noise.minY, H = settings.noise.height;
    const n = m.params.n, cx0 = m.params.cx - Math.floor((n - 1) / 2), cz0 = m.params.cz - Math.floor((n - 1) / 2);
    const sx = 16 * n, sz = 16 * n, sy = H;
    const out = new Uint16Array(sx * sy * sz);
    const pal = palette();
    pal.ofName('minecraft:air');
    const getBiome = biomeGetterFor(ctx, m);
    const all = [...Array(16).keys()];
    const t0 = performance.now();
    let done = 0;
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
      const cx = cx0 + a, cz = cz0 + b;
      const chunk = buildChunk(ctx, cx, cz, all, getBiome, true);
      for (let y = 0; y < sy; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
        const st = chunk.getBlockState([cx * 16 + x, minY + y, cz * 16 + z]);
        out[(y * sz + b * 16 + z) * sx + a * 16 + x] = st.equals(D.BlockState.AIR) ? 0 : pal.of(st);
      }
      post({ id: m.id, progress: ++done / (n * n) });
    }
    post({ id: m.id, done: true, data: out, palette: pal.names, dims: { sx, sy, sz, y0: minY, x0: cx0 * 16, z0: cz0 * 16 }, seaLevel: settings.seaLevel, ms: performance.now() - t0 }, [out.buffer]);
  }

  /* ---------- biome maps ---------- */
  const CLIMATE = ['temperature', 'humidity', 'continentalness', 'erosion', 'depth', 'weirdness'];
  function biomeMap(m, post) {
    const ctx = worldContext(m.settings, m.source, m.seed);
    const { rs, bs } = ctx;
    const { w, h, step, x0, a0: z0, fixed: y } = m.params;
    const out = new Uint16Array(w * h).fill(65535);
    const clim = new Float32Array(w * h * 6);
    const pal = palette();
    const mn = bs instanceof D.MultiNoiseBiomeSource ? bs.parameters : null;
    const t0 = performance.now();
    let last = t0;
    const qy = y >> 2;
    for (let j = 0; j < h; j++) {
      const qz = Math.floor((z0 + j * step) / 4);
      for (let i = 0; i < w; i++) {
        const qx = Math.floor((x0 + i * step) / 4);
        const t = rs.sampler.sample(qx, qy, qz);
        const o = (j * w + i) * 6;
        clim[o] = t.temperature; clim[o + 1] = t.humidity; clim[o + 2] = t.continentalness;
        clim[o + 3] = t.erosion; clim[o + 4] = t.depth; clim[o + 5] = t.weirdness;
        const b = mn ? mn.find(t) : bs ? bs.getBiome(qx, qy, qz, rs.sampler) : null;
        out[j * w + i] = b ? pal.ofName(b.toString()) : 65535;
      }
      const now = performance.now();
      if (now - last > 150 && j < h - 1) {
        last = now;
        const data = out.slice();
        post({ id: m.id, partial: true, data, palette: pal.names.slice() }, [data.buffer]);
      }
    }
    post({ id: m.id, done: true, data: out, climate: clim, palette: pal.names, ms: performance.now() - t0 }, [out.buffer, clim.buffer]);
  }
  function climatePlot(m, post) {
    const entries = m.biomes ? m.biomes : paramListEntries(m.list);
    const src = multiNoiseParams(entries);
    const { w, h, xAxis, yAxis, fixed, range } = m.params;
    const out = new Uint16Array(w * h);
    const pal = palette();
    const v = CLIMATE.map((k) => fixed[k] || 0);
    const xi = CLIMATE.indexOf(xAxis), yi = CLIMATE.indexOf(yAxis);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        v[xi] = range[0] + ((i + 0.5) / w) * (range[1] - range[0]);
        v[yi] = range[1] - ((j + 0.5) / h) * (range[1] - range[0]);
        const b = src.parameters.find(D.Climate.target(v[0], v[1], v[2], v[3], v[4], v[5]));
        out[j * w + i] = pal.ofName(b.toString());
      }
    }
    post({ id: m.id, done: true, data: out, palette: pal.names }, [out.buffer]);
  }

  /* ---------- structure placement ---------- */
  function biomeSet(value, seen = new Set()) {
    const out = new Set();
    const add = (v) => {
      if (typeof v !== 'string') { if (v && v.id) add(v.id); return; }
      if (v.startsWith('#')) {
        const id = v.slice(1);
        if (seen.has(id)) return;
        seen.add(id);
        const tag = lookup('tags/worldgen/biome', id);
        for (const x of (tag && tag.values) || []) add(x);
      } else out.add(v.includes(':') ? v : 'minecraft:' + v);
    };
    if (Array.isArray(value)) value.forEach(add); else if (value) add(value);
    return out;
  }
  function structures(m, post) {
    const t0 = performance.now();
    const set = m.set;
    const ctx = m.settings ? worldContext(m.settings, m.source, m.seed) : null;
    const seed = BigInt(m.seed);
    const placement = D.StructurePlacement.fromJson(set.placement);
    if (placement instanceof D.StructurePlacement.ConcentricRingsStructurePlacement) {
      if (!ctx || !ctx.bs) throw new Error('Concentric rings need a dimension with a biome source to place against.');
      placement.prepare(ctx.bs, ctx.rs.sampler, seed);
    }
    const { cx0, cz0, cx1, cz1, y } = m.params;
    const chunks = placement.getPotentialStructureChunks(seed, cx0, cz0, cx1, cz1).filter(([cx, cz]) => placement.isStructureChunk(seed, cx, cz));
    const entries = (set.structures || []).map((e) => {
      const st = typeof e.structure === 'string' ? lookup('worldgen/structure', e.structure.includes(':') ? e.structure : 'minecraft:' + e.structure) : e.structure;
      if (!st) throw new Error(`Missing key in worldgen/structure: ${e.structure}`);
      return { id: typeof e.structure === 'string' ? e.structure : '(inline)', weight: e.weight || 1, biomes: biomeSet(st.biomes) };
    });
    const total = entries.reduce((s, e) => s + e.weight, 0) || 1;
    const out = [];
    for (const [cx, cz] of chunks.slice(0, 4000)) {
      const bx = cx * 16 + 8, bz = cz * 16 + 8;
      let biome = null;
      if (ctx && ctx.bs && m.check) biome = ctx.bs.getBiome(bx >> 2, (y == null ? 64 : y) >> 2, bz >> 2, ctx.rs.sampler).toString();
      // weighted pick, then fall back to the others (like vanilla's retry when a biome doesn't fit)
      let r = ((Math.imul(cx, 341873128) ^ Math.imul(cz, 132897987)) >>> 0) / 4294967296 * total;
      let first = entries[0];
      for (const e of entries) { if ((r -= e.weight) < 0) { first = e; break; } }
      let pick = first;
      if (biome) {
        pick = first && first.biomes.has(biome) ? first : entries.find((e) => e.biomes.has(biome)) || null;
      }
      out.push({ cx, cz, x: bx, z: bz, id: pick ? pick.id : first ? first.id : '?', ok: !!pick || !biome, biome });
    }
    // biome backdrop
    let bg = null;
    if (ctx && ctx.bs && m.bg) {
      const { w, h, step, x0, z0 } = m.bg;
      const data = new Uint16Array(w * h);
      const pal = palette();
      const qy = (y == null ? 64 : y) >> 2;
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        data[j * w + i] = pal.ofName(ctx.bs.getBiome(Math.floor((x0 + i * step) / 4), qy, Math.floor((z0 + j * step) / 4), ctx.rs.sampler).toString());
      }
      bg = { ...m.bg, data, palette: pal.names };
    }
    post({ id: m.id, done: true, list: out, bg, kind: placement.constructor.name, spacing: placement.spacing, separation: placement.separation, ms: performance.now() - t0 });
  }

  /* ---------- feature placement ---------- */
  function intProvider(p, rnd) {
    if (typeof p === 'number') return Math.floor(p);
    if (!p || typeof p !== 'object') return 0;
    const t = String(p.type || '').replace(/^minecraft:/, '');
    const between = (a, b) => (b < a ? a : a + rnd.nextInt(b - a + 1));
    switch (t) {
      case 'constant': return p.value | 0;
      case 'uniform': return between(p.min_inclusive, p.max_inclusive);
      case 'biased_to_bottom': return p.min_inclusive + rnd.nextInt(rnd.nextInt(p.max_inclusive - p.min_inclusive + 1) + 1);
      case 'clamped': return Math.min(p.max_inclusive, Math.max(p.min_inclusive, intProvider(p.source, rnd)));
      case 'clamped_normal': {
        const g = Math.sqrt(-2 * Math.log(1 - rnd.nextDouble())) * Math.cos(2 * Math.PI * rnd.nextDouble());
        return Math.round(Math.min(p.max_inclusive, Math.max(p.min_inclusive, p.mean + g * p.deviation)));
      }
      case 'trapezoid': {
        const lo = p.min, hi = p.max, plateau = p.plateau || 0;
        const range = hi - lo, half = (range - plateau) >> 1;
        return lo + between(0, range - half) + between(0, half);
      }
      case 'weighted_list': {
        const dist = p.distribution || [];
        let r = rnd.nextInt(dist.reduce((s, d) => s + d.weight, 0) || 1);
        for (const d of dist) { if ((r -= d.weight) < 0) return intProvider(d.data, rnd); }
        return 0;
      }
      default: return 0;
    }
  }
  let infoNoise = null;
  function biomeInfoNoise(x, z, factor = 200) {
    try {
      if (!infoNoise) infoNoise = new D.PerlinSimplexNoise(new D.LegacyRandom(2345n), [0]);
      return infoNoise.sample(x / factor, z / factor, false);
    } catch { return 0; }
  }
  function placement(m, post) {
    const t0 = performance.now();
    const { n, surfaceY, minY, height, seaLevel } = m.params;
    const wctx = { minY, height, seaLevel };
    const mods = m.placed.placement || [];
    const skipped = new Set();
    const pts = [];
    const c0 = -Math.floor(n / 2);
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
      const cx = c0 + a, cz = c0 + b;
      const rnd = D.XoroshiroRandom.create(BigInt(m.seed) ^ BigInt(cx * 341873128712 + cz * 132897987541));
      let list = [[cx * 16, minY, cz * 16]];
      for (const mod of mods) {
        const t = String(mod.type || '').replace(/^minecraft:/, '');
        const next = [];
        for (const p of list) {
          switch (t) {
            case 'count': case 'count_on_every_layer': { const k = intProvider(mod.count, rnd); for (let i = 0; i < k; i++) next.push(p.slice()); if (t !== 'count') skipped.add(t); break; }
            case 'rarity_filter': if (rnd.nextFloat() < 1 / Math.max(1, mod.chance || 1)) next.push(p); break;
            case 'in_square': next.push([p[0] + rnd.nextInt(16), p[1], p[2] + rnd.nextInt(16)]); break;
            case 'height_range': next.push([p[0], D.HeightProvider.fromJson(mod.height)(rnd, wctx), p[2]]); break;
            case 'heightmap': next.push([p[0], surfaceY, p[2]]); break;
            case 'random_offset': next.push([p[0] + intProvider(mod.xz_spread, rnd), p[1] + intProvider(mod.y_spread, rnd), p[2] + intProvider(mod.xz_spread, rnd)]); break;
            case 'offset': next.push([p[0] + intProvider(mod.x, rnd), p[1] + intProvider(mod.y, rnd), p[2] + intProvider(mod.z, rnd)]); break;
            case 'fixed_placement': for (const q of mod.positions || []) next.push([q[0], q[1], q[2]]); break;
            case 'noise_based_count': {
              const v = biomeInfoNoise(p[0], p[2], mod.noise_factor || 1);
              const k = Math.ceil((v + (mod.noise_offset || 0)) * (mod.noise_to_count_ratio || 0));
              for (let i = 0; i < Math.max(0, k); i++) next.push(p.slice());
              break;
            }
            case 'noise_threshold_count': {
              const v = biomeInfoNoise(p[0], p[2]);
              const k = v < (mod.noise_level || 0) ? mod.below_noise : mod.above_noise;
              for (let i = 0; i < k; i++) next.push(p.slice());
              break;
            }
            default: skipped.add(t); next.push(p);
          }
        }
        list = next;
        if (list.length > 20000) break;
      }
      for (const p of list) pts.push(p[0], p[1], p[2]);
    }
    const arr = new Int32Array(pts);
    post({ id: m.id, done: true, data: arr, skipped: [...skipped], ms: performance.now() - t0 }, [arr.buffer]);
  }

  /* ---------- density functions ---------- */
  function densityFn(json, seed) {
    return D.DensityFunction.fromJson(json).mapAll(dfRandomState(seed).createVisitor(false));
  }
  function runDf(m, post) {
    const fn = densityFn(m.json, m.seed);
    const p = m.params;
    const t0 = performance.now();
    let lastPost = t0;
    let min = Infinity, max = -Infinity;
    if (m.mode === '3d') {
      const { x0, z0, y0, sx, sy, sz } = p;
      const out = new Float32Array(sx * sy * sz);
      for (let y = 0; y < sy; y++) {
        for (let z = 0; z < sz; z++) {
          for (let x = 0; x < sx; x++) {
            const v = fn.compute({ x: x0 + x, y: y0 + y, z: z0 + z });
            out[(y * sz + z) * sx + x] = v;
            if (v < min) min = v;
            if (v > max) max = v;
          }
        }
        const now = performance.now();
        if (now - lastPost > 120) { lastPost = now; post({ id: m.id, progress: (y + 1) / sy }); }
      }
      post({ id: m.id, done: true, data: out, min, max, ms: performance.now() - t0 }, [out.buffer]);
      return;
    }
    const { w, h, step, x0, a0, fixed } = p;
    const out = new Float32Array(w * h).fill(NaN);
    for (let j = 0; j < h; j++) {
      const a = a0 + j * step;
      for (let i = 0; i < w; i++) {
        const x = x0 + i * step;
        const v = m.mode === 'side' ? fn.compute({ x, y: a, z: fixed }) : fn.compute({ x, y: fixed, z: a });
        out[j * w + i] = v;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      const now = performance.now();
      if (now - lastPost > 120 && j < h - 1) {
        lastPost = now;
        const part = out.slice();
        post({ id: m.id, partial: true, data: part, min, max }, [part.buffer]);
      }
    }
    post({ id: m.id, done: true, data: out, min, max, ms: performance.now() - t0 }, [out.buffer]);
  }

  const TASKS = { df: runDf, terrain: terrainSlice, terrain3d, biomes: biomeMap, climate: climatePlot, structures, placement };
  function handle(m, post) {
    if (m.type === 'init') {
      try {
        VAN = m.vanilla;
        registerAll(VAN.reg, true);
        post({ ready: true });
      } catch (err) {
        post({ ready: false, error: String((err && err.message) || err) });
      }
      return;
    }
    try {
      setProject(m.projVersion, m.project);
      const task = TASKS[m.task];
      if (!task) throw new Error('Unknown task ' + m.task);
      task(m, post);
    } catch (err) {
      post({ id: m.id, error: String((err && err.message) || err) });
    }
  }

  if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
    self.onmessage = (e) => handle(e.data, (msg, transfer) => self.postMessage(msg, transfer || []));
  } else {
    self.__dfEngine = { handle };
  }
})();
