/* ================= examples ================= */
const N = (noise, xz = 1, y = 1) => ({ type: 'minecraft:noise', noise, xz_scale: xz, y_scale: y });
const EXAMPLES = [
  {
    name: 'Hills with caves', dim: 'overworld',
    json: {
      type: 'minecraft:min',
      left: {
        type: 'minecraft:add',
        left: { type: 'minecraft:gradient', axis: 'y', from_coordinate: 20, from_value: 1, to_coordinate: 150, to_value: -1 },
        right: { type: 'minecraft:mul', left: N('minecraft:cave_cheese', 1.5, 0.6), right: 1.3 },
      },
      right: {
        type: 'minecraft:add',
        left: { type: 'minecraft:abs', input: N('minecraft:spaghetti_3d_1', 1, 1) },
        right: -0.07,
      },
    },
  },
  {
    name: 'Floating islands', dim: 'overworld',
    json: {
      type: 'minecraft:add',
      left: { type: 'minecraft:mul', left: N('minecraft:cave_cheese', 2.5, 1.2), right: 1.6 },
      right: {
        type: 'minecraft:sub',
        left: -0.3,
        right: { type: 'minecraft:mul', left: { type: 'minecraft:abs', input: { type: 'minecraft:gradient', axis: 'y', from_coordinate: 80, from_value: -1, to_coordinate: 200, to_value: 1 } }, right: 1.4 },
      },
    },
  },
  {
    name: 'Terraced plateaus', dim: 'overworld',
    json: {
      type: 'minecraft:mul',
      left: {
        type: 'minecraft:sub',
        left: {
          type: 'minecraft:add',
          left: 70,
          right: { type: 'minecraft:floor', input: { type: 'minecraft:mul', left: N('minecraft:ridge', 1.5, 0), right: 70 }, multiple: 9 },
        },
        right: 'minecraft:y',
      },
      right: 0.08,
    },
  },
  {
    name: 'Planetoid', dim: 'overworld',
    json: {
      type: 'minecraft:add',
      left: {
        type: 'minecraft:sub',
        left: 1,
        right: { type: 'minecraft:div', left: { type: 'minecraft:distance_to_point', point: [8, 64, 8], metric: 'euclidean' }, right: 48 },
      },
      right: { type: 'minecraft:mul', left: N('minecraft:cave_cheese', 3, 3), right: 0.35 },
    },
  },
  {
    name: 'Shaped by spline', dim: 'overworld',
    json: {
      type: 'minecraft:add',
      left: { type: 'minecraft:gradient', axis: 'y', from_coordinate: 0, from_value: 1.5, to_coordinate: 200, to_value: -1.5 },
      right: {
        type: 'minecraft:spline',
        spline: {
          coordinate: N('minecraft:continentalness', 2, 0),
          points: [
            { location: -0.6, value: -0.8, derivative: 0 },
            { location: -0.1, value: -0.1, derivative: 1.2 },
            { location: 0.15, value: 0.35, derivative: 0 },
            { location: 0.5, value: 1.1, derivative: 0.6 },
          ],
        },
      },
    },
  },
];

function openPresets() {
  const btn = $('#btn-presets').getBoundingClientRect();
  openPicker({
    x: btn.left, y: btn.bottom + 6, placeholder: 'Search presets…',
    groups: [
      { name: 'Examples', color: 'var(--accent)', items: EXAMPLES.map((e, i) => ({ label: e.name, value: { ex: i } })) },
      {
        name: 'Vanilla density functions (26.3)', color: 'var(--c-input)',
        items: VANILLA_DFS.map((id) => ({ label: short(id), value: { id } })),
      },
    ],
    onPick: (v) => {
      if (v.ex != null) {
        const e = EXAMPLES[v.ex];
        setDim(e.dim);
        loadDensityFunction(e.json);
        toast(`Loaded “${e.name}”`);
      } else {
        const d = v.id.includes('end/') ? 'end' : v.id.includes('nether/') ? 'nether' : 'overworld';
        setDim(d);
        loadDensityFunction(VANILLA.density_function[v.id]);
        toast(`Loaded ${short(v.id)}. Use Expand on references to open them up.`);
      }
    },
  });
}

/* ================= world / controls ================= */
function setDim(d) {
  $('#dim').value = d;
  applyDim();
}
function applyDim() {
  const d = $('#dim').value;
  if (DIMS[d]) {
    $('#min-y').value = DIMS[d][0];
    $('#height').value = DIMS[d][1];
    $('#sea').value = DIMS[d][2];
  }
  for (const el of $$('[data-custom]')) el.hidden = d !== 'custom';
  P.side.s = null;
  P.prev = P.cur = null;
  saveControls();
  scheduleEval(0);
}
function setMode(m) {
  P.mode = m;
  for (const b of $$('#mode-group .btn')) b.classList.toggle('on', b.dataset.mode === m);
  for (const el of $$('#pv-controls [data-for]')) el.hidden = !el.dataset.for.split(' ').includes(m);
  const is3d = m === '3d';
  cv.hidden = is3d; ov.hidden = is3d; glHost.hidden = !is3d;
  P.hover = null;
  updateReadout();
  drawLegend(P.prev);
  saveControls();
  if (!is3d) { ensureSideDefaults(); draw2d(); }
  scheduleEval(0);
  if (is3d) render3d();
}
const CONTROL_IDS = ['seed', 'slice-z', 'slice-y', 'chunk-x', 'chunk-z', 'chunk-size', 'dim', 'min-y', 'height', 'colormap', 'range-mode', 'vox-colors', 'sea', 'show-water'];
function saveControls() {
  const o = { mode: P.mode };
  for (const id of CONTROL_IDS) { const el = $('#' + id); o[id] = el.type === 'checkbox' ? el.checked : el.value; }
  store.set('dfw:controls', JSON.stringify(o));
}
function loadControls() {
  try {
    const o = JSON.parse(store.get('dfw:controls') || 'null');
    if (!o) return null;
    for (const id of CONTROL_IDS) {
      const el = $('#' + id);
      if (o[id] === undefined || !el) continue;
      if (el.type === 'checkbox') el.checked = !!o[id]; else el.value = o[id];
    }
    return o;
  } catch { return null; }
}
for (const id of CONTROL_IDS) {
  const el = $('#' + id);
  el.addEventListener(el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input', () => {
    if (id === 'dim') { applyDim(); return; }
    saveControls();
    if (id === 'colormap' || id === 'range-mode') { rerender2dColors(); return; }
    if (id === 'vox-colors' || id === 'show-water' || id === 'sea') {
      if (P.mode === '3d' && V3.data) { buildMesh(V3.data.data, V3.data.p); }
      else rerender2dColors();
      return;
    }
    if (id === 'min-y' || id === 'height') P.side.s = null;
    scheduleEval(id === 'seed' ? 250 : 120);
  });
}
for (const b of $$('#mode-group .btn')) b.addEventListener('click', () => setMode(b.dataset.mode));
$('#btn-reset-cam').addEventListener('click', resetCamera);
$('#btn-reseed').addEventListener('click', () => {
  const hi = Math.floor(Math.random() * 2 ** 31) * (Math.random() < 0.5 ? -1 : 1);
  const lo = Math.floor(Math.random() * 2 ** 32);
  $('#seed').value = BigInt.asIntN(64, (BigInt(hi) << 32n) + BigInt(lo)).toString();
  saveControls();
  scheduleEval(0);
});

/* ================= JSON pane, copy, import ================= */
function highlightJson(s) {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
    .replace(/("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g, (m, str, colon, numb) => {
      if (str) return colon ? `<span class="k">${str}</span>${colon}` : `<span class="s">${str}</span>`;
      return `<span class="n">${numb}</span>`;
    });
}
function outputText() {
  try { return JSON.stringify(exportNode('out'), null, 2); } catch (err) { return '// ' + err.message; }
}
function updateJsonPane() {
  const pane = $('#json-pane');
  if (!pane.open) return;
  const s = outputText();
  $('#json-out').innerHTML = highlightJson(s);
  $('#json-size').textContent = `${s.split('\n').length} lines`;
}
$('#json-pane').addEventListener('toggle', updateJsonPane);
$('#btn-copy').addEventListener('click', () => {
  const s = outputText();
  const fallback = () => openModal({ title: 'Output JSON', text: s, note: 'Copying was blocked here. Select the text below and copy it.', readOnly: true });
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(s).then(() => toast('Copied density function JSON'), fallback);
  } else fallback();
});

let gcTimer = 0;
function graphChanged(typing) {
  updateCount();
  clearTimeout(gcTimer);
  gcTimer = setTimeout(() => { updateJsonPane(); renderStatus(); }, typing ? 150 : 20);
  scheduleEval(typing ? 220 : 40);
  if (previewId && !G.nodes.has(previewId)) previewId = null;
}

function openModal({ title, note, text = '', readOnly = false, action, actionLabel, placeholder }) {
  const ta = h('textarea', { spellcheck: false, readOnly, placeholder: placeholder || '' });
  ta.value = text;
  const msg = h('span', { class: 'msg' });
  const close = () => back.remove();
  const cancel = h('button', { class: 'btn', type: 'button' }, readOnly ? 'Close' : 'Cancel');
  cancel.addEventListener('click', close);
  const actions = h('div', { class: 'actions' }, msg, cancel);
  if (action) {
    const ok = h('button', { class: 'btn primary', type: 'button' }, actionLabel);
    ok.addEventListener('click', () => {
      const err = action(ta.value);
      if (err) msg.textContent = err; else close();
    });
    actions.append(ok);
  }
  const modal = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, h('h2', {}, title), note ? h('p', {}, note) : null, ta, actions);
  const back = h('div', { class: 'modal-back' }, modal);
  back.addEventListener('pointerdown', (e) => { if (e.target === back) close(); });
  back.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  document.body.append(back);
  ta.focus();
  if (readOnly) ta.select();
  return ta;
}
$('#btn-import').addEventListener('click', () => {
  openModal({
    title: 'Import density function',
    note: 'Paste a density function JSON file (or a reference such as minecraft:overworld/continents). Pre-26.x types like y_clamped_gradient, flat_cache and shifted_noise are converted.',
    placeholder: '{\n  "type": "minecraft:add",\n  "left": …,\n  "right": …\n}',
    actionLabel: 'Import',
    action: (text) => {
      const t = text.trim();
      if (!t) return 'Paste some JSON first.';
      let json;
      try { json = JSON.parse(t); } catch (err) {
        if (/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(t)) json = t;
        else return 'That is not valid JSON: ' + err.message;
      }
      loadDensityFunction(json);
      toast('Imported');
      return null;
    },
  });
});
$('#btn-noises').addEventListener('click', () => {
  const sample = Object.keys(G.noises).length ? G.noises : { 'custom:my_noise': { ...VANILLA.noise['minecraft:cave_cheese'] } };
  openModal({
    title: 'Custom noises',
    note: 'Noise parameters in the 26.x format, keyed by id. They appear in every Noise node’s list. Start from a copy of a vanilla noise and change base_octave (lower = larger features) or the amplitude modifiers.',
    text: JSON.stringify(sample, null, 2),
    actionLabel: 'Save noises',
    action: (text) => {
      let obj;
      try { obj = JSON.parse(text || '{}'); } catch (err) { return 'That is not valid JSON: ' + err.message; }
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return 'Expected an object like {"custom:id": {…}}.';
      for (const [k, v] of Object.entries(obj)) {
        if (!/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(k)) return `“${k}” is not a valid id (use namespace:path).`;
        if (!v || typeof v !== 'object') return `${k} must be an object.`;
      }
      G.noises = obj;
      renderAll();
      graphChanged();
      commit();
      toast(`${Object.keys(obj).length} custom noise${Object.keys(obj).length === 1 ? '' : 's'} saved`);
      return null;
    },
  });
});

/* ================= toolbar ================= */
$('#btn-presets').addEventListener('click', () => { if (openMenuEl) closeMenus(); else openPresets(); });
$('#btn-add').addEventListener('click', () => {
  if (openMenuEl) { closeMenus(); return; }
  const r = editor.getBoundingClientRect();
  openAddMenu(r.left + r.width / 2 - 130, r.top + 60);
});
$('#btn-undo').addEventListener('click', undo);
$('#btn-redo').addEventListener('click', redo);
$('#btn-fit').addEventListener('click', fitView);
$('#btn-layout').addEventListener('click', () => {
  tidy();
  for (const n of G.nodes.values()) { const el = nodeEls.get(n.id); el.style.left = n.x + 'px'; el.style.top = n.y + 'px'; }
  redrawWires();
  fitView();
  commit();
});

/* ================= split resize ================= */
(() => {
  const split = $('#split');
  const saved = store.get('dfw:split');
  if (saved) document.documentElement.style.setProperty('--preview-w', saved);
  split.addEventListener('pointerdown', (ev) => {
    split.setPointerCapture(ev.pointerId);
    split.classList.add('drag');
    const move = (e) => {
      const w = Math.min(innerWidth - 320, Math.max(300, innerWidth - e.clientX));
      document.documentElement.style.setProperty('--preview-w', w + 'px');
      onResize();
    };
    const up = () => {
      split.classList.remove('drag');
      split.removeEventListener('pointermove', move);
      store.set('dfw:split', getComputedStyle(document.documentElement).getPropertyValue('--preview-w').trim());
      redrawWires();
    };
    split.addEventListener('pointermove', move);
    split.addEventListener('pointerup', up, { once: true });
  });
})();
let resizeTimer = 0;
function onResize() {
  if (P.mode === '3d') resize3d();
  else { draw2d(); clearTimeout(resizeTimer); resizeTimer = setTimeout(() => scheduleEval(0), 150); }
}
new ResizeObserver(onResize).observe(stage);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (P.mode === '3d') render3d(); else draw2d(); for (const n of G.nodes.values()) if (n._plot) drawSplinePlot(n); });

/* ================= startup ================= */
Engine.spawn();
const savedControls = loadControls();
for (const el of $$('[data-custom]')) el.hidden = $('#dim').value !== 'custom';
applyView();
let restored = false;
const savedGraph = store.get('dfw:graph');
if (savedGraph) {
  try {
    deserialize(savedGraph);
    renderAll();
    restored = true;
    requestAnimationFrame(() => { redrawWires(); fitView(); });
    commit();
  } catch { restored = false; }
}
if (!restored) loadDensityFunction(EXAMPLES[0].json);
setMode((savedControls && savedControls.mode) || '3d');
renderStatus();
updateHistoryButtons();
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => redrawWires());
