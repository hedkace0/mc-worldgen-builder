/* ================= density function examples ================= */
const N = (noise, xz = 1, y = 1) => ({ type: 'minecraft:noise', noise, xz_scale: xz, y_scale: y });
const EXAMPLES = [
  {
    name: 'Hills with caves',
    json: {
      type: 'minecraft:min',
      left: {
        type: 'minecraft:add',
        left: { type: 'minecraft:gradient', axis: 'y', from_coordinate: 20, from_value: 1, to_coordinate: 150, to_value: -1 },
        right: { type: 'minecraft:mul', left: N('minecraft:cave_cheese', 1.5, 0.6), right: 1.3 },
      },
      right: { type: 'minecraft:add', left: { type: 'minecraft:abs', input: N('minecraft:spaghetti_3d_1', 1, 1) }, right: -0.07 },
    },
  },
  {
    name: 'Floating islands',
    json: {
      type: 'minecraft:add',
      left: { type: 'minecraft:mul', left: N('minecraft:cave_cheese', 2.5, 1.2), right: 1.6 },
      right: { type: 'minecraft:sub', left: -0.3, right: { type: 'minecraft:mul', left: { type: 'minecraft:abs', input: { type: 'minecraft:gradient', axis: 'y', from_coordinate: 80, from_value: -1, to_coordinate: 200, to_value: 1 } }, right: 1.4 } },
    },
  },
  {
    name: 'Terraced plateaus',
    json: {
      type: 'minecraft:mul',
      left: { type: 'minecraft:sub', left: { type: 'minecraft:add', left: 70, right: { type: 'minecraft:floor', input: { type: 'minecraft:mul', left: N('minecraft:ridge', 1.5, 0), right: 70 }, multiple: 9 } }, right: 'minecraft:y' },
      right: 0.08,
    },
  },
  {
    name: 'Planetoid',
    json: {
      type: 'minecraft:add',
      left: { type: 'minecraft:sub', left: 1, right: { type: 'minecraft:div', left: { type: 'minecraft:distance_to_point', point: [8, 64, 8], metric: 'euclidean' }, right: 48 } },
      right: { type: 'minecraft:mul', left: N('minecraft:cave_cheese', 3, 3), right: 0.35 },
    },
  },
  {
    name: 'Shaped by spline',
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
function openExamples(anchor) {
  const r = anchor.getBoundingClientRect();
  openPicker({
    x: r.left, y: r.bottom + 6, placeholder: 'Load an example into this file…',
    groups: [{ name: 'Examples', color: 'var(--accent)', items: EXAMPLES.map((e, i) => ({ label: e.name, value: i })) }],
    onPick: (i) => {
      loadDensityFunction(EXAMPLES[i].json);
      toast(`Loaded “${EXAMPLES[i].name}”. Undo to go back.`);
    },
  });
}

/* ================= chrome ================= */
$('#btn-project').addEventListener('click', () => { if (openMenuEl) closeMenus(); else projectMenu(); });
$('#btn-new').addEventListener('click', () => newFileDialog(regOfPath(WB.active || '') && REG[regOfPath(WB.active)] ? regOfPath(WB.active) : 'worldgen/density_function'));
$('#btn-vanilla').addEventListener('click', (e) => { if (openMenuEl) closeMenus(); else browseVanilla(e.currentTarget); });
$('#btn-reconnect').addEventListener('click', reconnectFolder);
$('#btn-files').addEventListener('click', () => document.body.classList.toggle('show-files'));
$('#btn-fit').addEventListener('click', fitView);
$('#file-filter').addEventListener('input', (e) => { WB.filter = e.target.value; renderExplorer(); });
$('#w-new').addEventListener('click', () => newFileDialog('worldgen/density_function'));
$('#w-vanilla').addEventListener('click', (e) => browseVanilla(e.currentTarget));
$('#w-folder').addEventListener('click', openFolderProject);
$('#w-zip').addEventListener('click', importZip);
$('#btn-reseed').addEventListener('click', () => {
  const hi = Math.floor(Math.random() * 2 ** 31) * (Math.random() < 0.5 ? -1 : 1);
  const lo = Math.floor(Math.random() * 2 ** 32);
  $('#seed').value = BigInt.asIntN(64, (BigInt(hi) << 32n) + BigInt(lo)).toString();
  store.set('wgw:seed', $('#seed').value);
  scheduleEval(0);
});
$('#seed').value = store.get('wgw:seed') || '0';
$('#seed').addEventListener('input', () => { store.set('wgw:seed', $('#seed').value); scheduleEval(250); });
stage.addEventListener('pointermove', (ev) => {
  const R = PV.renderer, M = R && R.modes().find((m) => m.id === PV.mode);
  if (!M || M.kind !== 'canvas' || !R.canvasHover) return;
  const r = stage.getBoundingClientRect();
  const t = R.canvasHover(ev.clientX - r.left, ev.clientY - r.top);
  readout.hidden = !t;
  readout.textContent = t;
});
document.addEventListener('keydown', (ev) => {
  const mod = ev.ctrlKey || ev.metaKey;
  if (mod && ev.key.toLowerCase() === 's') { ev.preventDefault(); flushAllSaves().then(() => toast(PJ.cur && PJ.cur.kind === 'folder' && PJ.cur.perm === 'granted' ? 'Saved to folder' : 'Saved')); }
  if (mod && ev.key.toLowerCase() === 'p' && !ev.shiftKey) { ev.preventDefault(); quickOpen(); }
});
function quickOpen() {
  const r = $('#tabs').getBoundingClientRect();
  const items = [...PJ.cur.files.keys()].map((p) => ({ label: fileTitle(p), sub: REG[regOfPath(p)] ? regLabel1(regOfPath(p)) : '', value: p, keys: p }));
  openPicker({ x: r.left + 20, y: r.top + 4, placeholder: 'Go to file…', cls: 'menu wide', groups: [{ name: PJ.cur.name, items }], onPick: openFile });
}

/* ---------- split resize ---------- */
(() => {
  const split = $('#split');
  const saved = store.get('wgw:split');
  if (saved) document.documentElement.style.setProperty('--preview-w', saved);
  split.addEventListener('pointerdown', (ev) => {
    split.setPointerCapture(ev.pointerId);
    split.classList.add('drag');
    const move = (e) => {
      const w = Math.min(innerWidth - 420, Math.max(300, innerWidth - e.clientX));
      document.documentElement.style.setProperty('--preview-w', w + 'px');
    };
    const up = () => {
      split.classList.remove('drag');
      split.removeEventListener('pointermove', move);
      store.set('wgw:split', getComputedStyle(document.documentElement).getPropertyValue('--preview-w').trim());
      redrawWires();
    };
    split.addEventListener('pointermove', move);
    split.addEventListener('pointerup', up, { once: true });
  });
})();
new ResizeObserver(() => onPreviewResize()).observe(stage);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { onPreviewResize(); render3d(); for (const n of G.nodes.values()) if (n._plot) drawSplinePlot(n); });

/* ================= startup ================= */
async function migrateLegacy() {
  // the single-graph version kept its graph and custom noises in localStorage
  const old = store.get('dfw:graph');
  if (!old) return null;
  try {
    const s = JSON.parse(old);
    deserialize(old);
    const json = exportNode('out');
    const files = new Map([['pack.mcmeta', packMcmeta('Migrated from Density Function Workbench')]]);
    files.set('data/mypack/worldgen/density_function/main.json', JSON.stringify(json, null, 2) + '\n');
    for (const [id, v] of Object.entries(s.noises || {})) {
      if (/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(id)) files.set(pathFor('worldgen/noise', id), JSON.stringify(v, null, 2) + '\n');
    }
    G.nodes.clear(); G.edges = [];
    store.del('dfw:graph');
    return await newProject('My worldgen pack', files);
  } catch { return null; }
}
(async () => {
  Engine.spawn();
  showEditor('welcome');
  let list = await listProjects();
  let rec = null;
  if (!list.length) rec = await migrateLegacy();
  if (!rec && !list.length) rec = await newProject('My worldgen pack', starterFiles());
  if (!rec) {
    const want = store.get('wgw:project');
    rec = list.find((p) => p.id === want) || list[0];
  }
  await openProject(rec, { quiet: true });
  if (!DB.ok) toast('Browser storage is unavailable here; projects are kept in local storage only.', 4000);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => redrawWires());
})();
