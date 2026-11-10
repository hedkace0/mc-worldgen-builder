/* Evaluation engine. Concatenated after the deepslate UMD bundle, so `deepslate` is a global.
   Runs inside a Worker; falls back to the main thread through self.__dfEngine. */
(function () {
  const D = self.deepslate;
  let randomState = null;
  let randomSeed = null;
  let noisesVersion = -1;
  const customNoiseIds = [];

  function registerVanilla(v) {
    const R = D.WorldgenRegistries;
    for (const [k, val] of Object.entries(v.noise)) {
      R.NOISE.register(D.Identifier.parse(k), D.NormalNoise.fromJson(val), true);
    }
    for (const [k, val] of Object.entries(v.density_function)) {
      R.DENSITY_FUNCTION.register(D.Identifier.parse(k), D.DensityFunction.fromJson(val), true);
    }
  }

  function setCustomNoises(noises, version) {
    if (version === noisesVersion) return;
    const R = D.WorldgenRegistries;
    for (const id of customNoiseIds.splice(0)) R.NOISE.delete(id);
    for (const [k, val] of Object.entries(noises || {})) {
      const id = D.Identifier.parse(k);
      if (R.NOISE.has(id)) R.NOISE.delete(id);
      R.NOISE.register(id, D.NormalNoise.fromJson(val));
      customNoiseIds.push(id);
    }
    noisesVersion = version;
    randomState = null; // noise instances are cached per RandomState
  }

  function build(json, seed) {
    if (!randomState || randomSeed !== seed) {
      randomState = new D.RandomState(D.NoiseGeneratorSettings.create({}), BigInt(seed));
      randomSeed = seed;
    }
    return D.DensityFunction.fromJson(json).mapAll(randomState.createVisitor(false));
  }

  function run(m, post) {
    setCustomNoises(m.noises, m.noisesVersion);
    const fn = build(m.json, m.seed);
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
        if (now - lastPost > 120) {
          lastPost = now;
          post({ id: m.id, progress: (y + 1) / sy });
        }
      }
      post({ id: m.id, done: true, data: out, min, max, ms: performance.now() - t0 }, [out.buffer]);
      return;
    }
    // 2D: side (x across, y up, fixed z) or top (x across, z down, fixed y)
    const { w, h, step, x0, a0, fixed } = p;
    const out = new Float32Array(w * h);
    let rowStart = 0;
    for (let j = 0; j < h; j++) {
      const a = a0 + j * step;
      for (let i = 0; i < w; i++) {
        const x = x0 + i * step;
        const v = m.mode === 'side'
          ? fn.compute({ x, y: a, z: fixed })
          : fn.compute({ x, y: fixed, z: a });
        out[j * w + i] = v;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      const now = performance.now();
      if (now - lastPost > 90 && j < h - 1) {
        lastPost = now;
        const part = out.slice(rowStart * w, (j + 1) * w);
        post({ id: m.id, partial: true, row: rowStart, rows: j + 1 - rowStart, data: part, min, max }, [part.buffer]);
        rowStart = j + 1;
      }
    }
    post({ id: m.id, done: true, data: out, min, max, ms: performance.now() - t0 }, [out.buffer]);
  }

  function handle(m, post) {
    if (m.type === 'init') {
      try {
        registerVanilla(m.vanilla);
        post({ ready: true });
      } catch (err) {
        post({ ready: false, error: String((err && err.message) || err) });
      }
      return;
    }
    try {
      run(m, post);
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
