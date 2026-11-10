/* ================= workbench: projects, explorer, tabs ================= */
const WB = {
  tabs: [], active: null,
  hist: new Map(),      // DF path -> { stack, idx }
  dfView: new Map(),    // DF path -> 'graph' | 'json'
  collapsed: new Set(JSON.parse(store.get('wgw:collapsed') || '[]')),
  filter: '',
};
const DF_SELF = { path: null, id: null, loading: false };
const dfActive = () => !!(DF_SELF.path && WB.active === DF_SELF.path && viewOf(DF_SELF.path) === 'graph');
const viewOf = (path) => WB.dfView.get(path) || 'graph';
const regOfPath = (path) => { if (path === 'pack.mcmeta') return 'pack'; const v = parseVanillaPath(path); if (v) return v.reg; const i = parsePath(path); return i ? i.reg : null; };

/* ---------- save status ---------- */
function setSaveStatus(state, msg) {
  const el = $('#save-chip');
  const p = PJ.cur;
  const where = p && p.kind === 'folder' ? (p.perm === 'granted' ? 'to folder' : 'in browser, folder not connected') : 'in browser';
  el.dataset.state = state;
  el.textContent = state === 'saving' ? 'Saving…' : state === 'error' ? 'Save failed' : `Saved ${where}`;
  el.title = msg || (state === 'error' ? 'Could not save' : '');
}

/* ---------- projects ---------- */
async function listProjects() { return (await DB.projects()).sort((a, b) => (b.opened || 0) - (a.opened || 0)); }
async function newProject(name, files, extra = {}) {
  const p = { id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, kind: 'browser', created: Date.now(), opened: Date.now(), ...extra };
  await DB.putProject(p);
  await DB.putFiles(p.id, [...files]);
  return p;
}
function starterFiles(ns = 'mypack') {
  const files = new Map();
  files.set('pack.mcmeta', packMcmeta('My worldgen pack'));
  files.set(`data/${ns}/worldgen/density_function/hills.json`, JSON.stringify(EXAMPLES[0].json, null, 2) + '\n');
  const nsj = clone(VANILLA.reg['worldgen/noise_settings']['minecraft:overworld']);
  nsj.noise_router.final_density = `${ns}:hills`;
  files.set(`data/${ns}/worldgen/noise_settings/hills.json`, JSON.stringify(nsj, null, 2) + '\n');
  files.set(`data/${ns}/dimension/hills.json`, JSON.stringify({ type: 'minecraft:overworld', generator: { type: 'minecraft:noise', settings: `${ns}:hills`, biome_source: { type: 'minecraft:multi_noise', preset: 'minecraft:overworld' } } }, null, 2) + '\n');
  return files;
}
async function openProject(rec, { quiet = false } = {}) {
  await flushAllSaves();
  const files = new Map();
  for (const f of await DB.files(rec.id)) files.set(f.path, f.text);
  PJ.cur = { ...rec, files, perm: null };
  PJ.parsed.clear();
  PJ.pendingDisk.clear();
  rec.opened = Date.now();
  DB.putProject(rec);
  store.set('wgw:project', rec.id);
  if (rec.kind === 'folder' && rec.handle) {
    try { PJ.cur.perm = await rec.handle.queryPermission({ mode: 'readwrite' }); } catch { PJ.cur.perm = 'denied'; }
    if (PJ.cur.perm === 'granted') await syncFromDisk(true);
  }
  WB.tabs = [];
  WB.active = null;
  WB.hist.clear();
  DF_SELF.path = null;
  let saved = null;
  try { saved = JSON.parse(store.get('wgw:tabs:' + rec.id) || 'null'); } catch { saved = null; }
  const tabs = ((saved && saved.tabs) || []).filter((p) => isVanillaPath(p) || files.has(p));
  WB.tabs = tabs;
  projectChanged({ project: true });
  renderProjectHeader();
  setSaveStatus('saved');
  const first = saved && tabs.includes(saved.active) ? saved.active : tabs[0] || [...files.keys()].find((p) => regOfPath(p) === 'worldgen/density_function') || [...files.keys()].find((p) => parsePath(p));
  if (first) openFile(first); else showWelcome();
  if (!quiet) toast(`Opened ${rec.name}`);
}
function saveTabs() { if (PJ.cur) store.set('wgw:tabs:' + PJ.cur.id, JSON.stringify({ tabs: WB.tabs, active: WB.active })); }
function renderProjectHeader() {
  const p = PJ.cur;
  $('#project-name').textContent = p ? p.name : 'No project';
  const st = $('#storage-line');
  st.innerHTML = '';
  if (!p) return;
  if (p.kind === 'folder') {
    st.append(h('span', { class: 'dot ' + (p.perm === 'granted' ? 'ok' : 'warn') }), `Folder · ${p.handle ? p.handle.name : p.name}`);
  } else st.append(h('span', { class: 'dot' }), 'Browser storage');
  const banner = $('#reconnect');
  banner.hidden = !(p.kind === 'folder' && p.perm !== 'granted');
}
async function reconnectFolder() {
  const p = PJ.cur;
  if (!p || !p.handle) return;
  try {
    p.perm = await p.handle.requestPermission({ mode: 'readwrite' });
  } catch (err) { toast('Could not get access: ' + err.message); return; }
  if (p.perm === 'granted') {
    // write anything edited while disconnected, then pick up changes made on disk
    for (const path of PJ.pendingDisk) {
      const t = p.files.get(path);
      try { if (t === undefined) await fsDelete(p.handle, path); else await fsWrite(p.handle, path, t); } catch { /* keep going */ }
    }
    PJ.pendingDisk.clear();
    await syncFromDisk();
    toast('Folder connected');
  }
  renderProjectHeader();
  setSaveStatus('saved');
}
/** Reads the folder and merges it in. Files with unsaved local edits are kept. */
async function syncFromDisk(initial) {
  const p = PJ.cur;
  if (!p || p.kind !== 'folder' || p.perm !== 'granted') return;
  let scan;
  try { scan = await fsScan(p.handle); } catch (err) { toast('Could not read the folder: ' + err.message); return; }
  const changed = [];
  for (const [path, text] of scan.files) {
    if (PJ.saveTimers.has(path)) continue;
    if (p.files.get(path) !== text) { p.files.set(path, text); changed.push(path); }
  }
  for (const path of [...p.files.keys()]) {
    if (!scan.files.has(path) && !PJ.saveTimers.has(path) && !PJ.pendingDisk.has(path)) { p.files.delete(path); changed.push(path); }
  }
  p.mtimes = scan.mtimes;
  if (changed.length) {
    await DB.putFiles(p.id, changed.filter((x) => p.files.has(x)).map((x) => [x, p.files.get(x)]));
    await DB.deleteFiles(p.id, changed.filter((x) => !p.files.has(x)));
    if (!initial) {
      projectChanged({ disk: true });
      if (changed.includes(WB.active)) reloadActive();
      toast(`${changed.length} file${changed.length === 1 ? '' : 's'} changed on disk`);
    }
  }
}
async function openFolderProject() {
  if (!canPickFolder()) {
    openInfo('Folder access not available', window.self !== window.top
      ? 'This page is embedded, and browsers only allow folder access on a top-level page. Open the workbench in its own tab (for example the GitHub Pages site) to connect a folder. Your projects are kept in browser storage here.'
      : 'This browser does not support connecting to folders (it needs the File System Access API, available in Chrome and Edge). Your projects are kept in browser storage instead; use Export zip to save a data pack.');
    return;
  }
  let handle;
  try { handle = await window.showDirectoryPicker({ id: 'worldgen-pack', mode: 'readwrite' }); } catch (err) {
    if (err && err.name === 'AbortError') return;
    openInfo('Could not open the folder', String(err.message || err));
    return;
  }
  for (const p of await listProjects()) {
    try { if (p.kind === 'folder' && p.handle && await p.handle.isSameEntry(handle)) { await openProject(p); if (PJ.cur.perm !== 'granted') reconnectFolder(); return; } } catch { /* not comparable */ }
  }
  const scan = await fsScan(handle);
  let files = scan.files;
  if (!files.has('pack.mcmeta') && ![...files.keys()].some((p) => p.startsWith('data/'))) {
    const ok = await confirmModal('Start a data pack here?', `“${handle.name}” has no pack.mcmeta or data folder. Create a pack.mcmeta in it and use it as a new project?`, 'Create pack');
    if (!ok) return;
    await fsWrite(handle, 'pack.mcmeta', packMcmeta(handle.name));
    files = new Map([['pack.mcmeta', packMcmeta(handle.name)]]);
  }
  const rec = await newProject(handle.name, files, { kind: 'folder', handle });
  await openProject(rec);
}
function projectMenu() {
  const btn = $('#btn-project').getBoundingClientRect();
  listProjects().then((list) => {
    openPicker({
      x: btn.left, y: btn.bottom + 6, placeholder: 'Projects and actions…', cls: 'menu wide',
      groups: [
        { name: 'Projects', color: 'var(--accent)', items: list.map((p) => ({ label: p.name, sub: (p.kind === 'folder' ? 'folder' : 'browser') + (PJ.cur && p.id === PJ.cur.id ? ' · open' : ''), value: { open: p.id } })) },
        { name: 'Project', color: 'var(--c-util)', items: [
          { label: 'New project', sub: 'in browser storage', value: { act: 'new' } },
          { label: 'Open folder…', sub: canPickFolder() ? 'edit files on disk' : 'not available here', value: { act: 'folder' } },
          { label: 'Import zip…', sub: 'a data pack .zip', value: { act: 'import' } },
          { label: 'Export zip', sub: 'download the pack', value: { act: 'export' } },
          { label: 'Rename project…', value: { act: 'rename' } },
          { label: 'Delete project…', value: { act: 'delete' } },
        ] },
      ],
      onPick: async (v) => {
        if (v.open) { const p = list.find((x) => x.id === v.open); if (p && (!PJ.cur || p.id !== PJ.cur.id)) openProject(p); return; }
        if (v.act === 'new') {
          const name = await promptModal('New project', 'Name', 'My worldgen pack');
          if (!name) return;
          const ns = name.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_|_$/g, '') || 'mypack';
          openProject(await newProject(name, starterFiles(ns)));
        }
        if (v.act === 'folder') openFolderProject();
        if (v.act === 'import') importZip();
        if (v.act === 'export') exportZip();
        if (v.act === 'rename') {
          const name = await promptModal('Rename project', 'Name', PJ.cur.name);
          if (!name) return;
          PJ.cur.name = name;
          const rec = (await listProjects()).find((x) => x.id === PJ.cur.id);
          rec.name = name;
          await DB.putProject(rec);
          renderProjectHeader();
        }
        if (v.act === 'delete') {
          const ok = await confirmModal('Delete project?', PJ.cur.kind === 'folder'
            ? `Remove “${PJ.cur.name}” from the workbench. The folder on disk and its files are not touched.`
            : `Delete “${PJ.cur.name}” and its ${PJ.cur.files.size} files from browser storage. This cannot be undone; export a zip first if you want to keep them.`, 'Delete', true);
          if (!ok) return;
          await DB.deleteProject(PJ.cur.id);
          const rest = await listProjects();
          openProject(rest[0] || await newProject('My worldgen pack', starterFiles()));
        }
      },
    });
  });
}
function importZip() {
  const inp = h('input', { type: 'file', accept: '.zip,application/zip' });
  inp.addEventListener('change', async () => {
    const f = inp.files[0];
    if (!f) return;
    try {
      const entries = await zipDecode(await f.arrayBuffer());
      const files = new Map(entries.filter(([p]) => p === 'pack.mcmeta' || parsePath(p)));
      if (!files.size) { openInfo('Nothing to import', 'The zip has no pack.mcmeta or worldgen files under data/.'); return; }
      openProject(await newProject(f.name.replace(/\.zip$/i, ''), files));
      toast(`Imported ${files.size} files`);
    } catch (err) { openInfo('Could not read the zip', String(err.message || err)); }
  });
  inp.click();
}
async function exportZip() {
  await flushAllSaves();
  const entries = [...PJ.cur.files.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  if (!PJ.cur.files.has('pack.mcmeta')) entries.unshift(['pack.mcmeta', packMcmeta(PJ.cur.name)]);
  downloadBlob(PJ.cur.name.replace(/[^\w.-]+/g, '_') + '.zip', zipEncode(entries));
}

/* ---------- explorer ---------- */
function renderExplorer() {
  const tree = $('#tree');
  tree.innerHTML = '';
  if (!PJ.cur) return;
  const q = WB.filter.trim().toLowerCase();
  if (PJ.cur.files.has('pack.mcmeta') && (!q || 'pack.mcmeta'.includes(q))) tree.append(fileItem('pack.mcmeta', 'pack.mcmeta', '--fg-dim'));
  for (const r of REGISTRIES) {
    const items = projectEntries(r.key).filter((e) => !q || e.id.includes(q));
    if (!items.length) continue;
    const collapsed = WB.collapsed.has(r.key) && !q;
    const head = h('div', { class: 'tree-group' + (collapsed ? ' collapsed' : '') },
      h('span', { class: 'chev', html: ICON.chev }), h('i', { style: { background: `var(${r.color})` } }), h('span', { class: 'g-name' }, r.label), h('span', { class: 'g-count' }, String(items.length)));
    const add = h('button', { class: 'g-add', type: 'button', title: 'New ' + regLabel1(r.key).toLowerCase(), html: ICON.plus });
    add.addEventListener('click', (e) => { e.stopPropagation(); newFileDialog(r.key); });
    head.append(add);
    head.addEventListener('click', () => {
      if (WB.collapsed.has(r.key)) WB.collapsed.delete(r.key); else WB.collapsed.add(r.key);
      store.set('wgw:collapsed', JSON.stringify([...WB.collapsed]));
      renderExplorer();
    });
    tree.append(head);
    if (collapsed) continue;
    for (const e of items) tree.append(fileItem(e.path, e.id.startsWith('minecraft:') ? e.id : e.id, `${r.color}`));
  }
  if (!tree.children.length) tree.append(h('div', { class: 'tree-empty' }, q ? 'No matching files' : 'No files yet. Use + New file, or copy something from Vanilla.'));
}
function fileItem(path, label, color) {
  const c = parsedFile(path);
  const [ns, name] = label.includes(':') ? label.split(':') : ['', label];
  const el = h('div', { class: 'tree-item' + (WB.active === path ? ' act' : '') + (c && c.error ? ' bad' : ''), title: path, tabindex: 0 },
    h('span', { class: 'ti-name' }, ns ? h('span', { class: 'ns' }, ns + ':') : null, name));
  if (c && c.error) el.append(h('span', { class: 'ti-err', title: c.error }, '!'));
  const more = h('button', { class: 'ti-more', type: 'button', title: 'More', html: ICON.dots });
  more.addEventListener('click', (e) => { e.stopPropagation(); fileMenu(path, more); });
  el.append(more);
  el.addEventListener('click', () => openFile(path));
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter') openFile(path); });
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); fileMenu(path, el, e.clientX, e.clientY); });
  return el;
}
function fileMenu(path, anchor, x, y) {
  const r = anchor.getBoundingClientRect();
  const info = parsePath(path);
  openPicker({
    x: x ?? r.right - 10, y: y ?? r.bottom + 2, placeholder: fileTitle(path), cls: 'menu small',
    groups: [{ name: fileTitle(path), items: [
      { label: 'Open', value: 'open' },
      ...(info ? [{ label: 'Rename / move…', value: 'rename' }, { label: 'Duplicate…', value: 'dup' }] : []),
      { label: 'Copy JSON', value: 'copy' },
      { label: 'Delete…', value: 'del' },
    ] }],
    onPick: async (v) => {
      if (v === 'open') openFile(path);
      if (v === 'copy') copyText(PJ.cur.files.get(path), 'Copied ' + fileTitle(path));
      if (v === 'rename' || v === 'dup') {
        const id = await promptModal(v === 'dup' ? 'Duplicate' : 'Rename', 'New id (namespace:path)', info.id, (s) => (/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(s) ? (PJ.cur.files.has(pathFor(info.reg, s)) ? 'That file already exists' : null) : 'Use namespace:path with lowercase letters, digits, _ - . /'));
        if (!id) return;
        const to = pathFor(info.reg, id);
        if (v === 'dup') { await createFile(to, PJ.cur.files.get(path)); openFile(to); return; }
        await renameFile(path, to);
        const i = WB.tabs.indexOf(path);
        if (i >= 0) WB.tabs[i] = to;
        if (WB.hist.has(path)) { WB.hist.set(to, WB.hist.get(path)); WB.hist.delete(path); }
        if (DF_SELF.path === path) { DF_SELF.path = to; DF_SELF.id = id; }
        if (WB.active === path) { WB.active = to; activate(to); }
        renderTabs();
        toast(`Renamed to ${id}. References to the old id are not updated.`, 3200);
      }
      if (v === 'del') {
        const ok = await confirmModal('Delete file?', `Delete ${path}${PJ.cur.kind === 'folder' && PJ.cur.perm === 'granted' ? ' from the folder on disk' : ''}? This cannot be undone.`, 'Delete', true);
        if (!ok) return;
        closeTab(path);
        await deleteFile(path);
      }
    },
  });
}

/* ---------- new files ---------- */
async function newFileDialog(reg, preset) {
  const ns = defaultNamespace();
  const regSel = h('select', {}, REGISTRIES.map((r) => h('option', { value: r.key, selected: r.key === (reg || 'worldgen/density_function') }, regLabel1(r.key))));
  const idIn = h('input', { type: 'text', value: preset && preset.id ? preset.id : ns + ':', spellcheck: false });
  const fromSel = h('select', {});
  const fillFrom = () => {
    fromSel.innerHTML = '';
    if (preset && preset.json !== undefined && regSel.value === reg) fromSel.append(h('option', { value: '=' }, 'Copy of the open file'));
    fromSel.append(h('option', { value: '' }, 'Template'));
    for (const id of vanillaIds(regSel.value)) if (VANILLA.reg[regSel.value] && VANILLA.reg[regSel.value][id] !== undefined) fromSel.append(h('option', { value: id }, 'Copy of ' + id));
    if (preset && preset.from) fromSel.value = preset.from;
  };
  fillFrom();
  regSel.addEventListener('change', fillFrom);
  const msg = h('span', { class: 'msg' });
  const ok = h('button', { class: 'btn primary', type: 'button' }, 'Create');
  const cancel = h('button', { class: 'btn', type: 'button' }, 'Cancel');
  const body = h('div', { class: 'form' },
    h('label', {}, h('span', {}, 'Type'), regSel), h('label', {}, h('span', {}, 'Id'), idIn), h('label', {}, h('span', {}, 'Start from'), fromSel),
    h('p', { class: 'muted' }, 'Saved as data/<namespace>/<type folder>/<path>.json. Other files refer to it by its id.'));
  const back = modalShell('New file', body, [msg, cancel, ok]);
  setTimeout(() => { idIn.focus(); idIn.setSelectionRange(idIn.value.length, idIn.value.length); }, 0);
  return new Promise((res) => {
    cancel.addEventListener('click', () => { back.remove(); res(null); });
    const go = async () => {
      const id = idIn.value.trim();
      if (!/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(id)) { msg.textContent = 'Use namespace:path with lowercase letters, digits, _ - . /'; return; }
      const r = regSel.value;
      const path = pathFor(r, id);
      if (PJ.cur.files.has(path)) { msg.textContent = 'That file already exists.'; return; }
      let json = fromSel.value === '=' ? preset.json : fromSel.value ? clone(VANILLA.reg[r][fromSel.value]) : TEMPLATES[r] ? TEMPLATES[r]() : {};
      if (json === undefined) json = {};
      back.remove();
      if (!PJ.cur.files.has('pack.mcmeta')) await createFile('pack.mcmeta', packMcmeta(PJ.cur.name));
      await createFile(path, JSON.stringify(json, null, 2) + '\n');
      openFile(path);
      res(path);
    };
    ok.addEventListener('click', go);
    idIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  });
}
function defaultNamespace() {
  const counts = new Map();
  for (const p of PJ.cur ? PJ.cur.files.keys() : []) { const i = parsePath(p); if (i && i.ns !== 'minecraft') counts.set(i.ns, (counts.get(i.ns) || 0) + 1); }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map((x) => x[0])[0] || 'mypack';
}
function browseVanilla(anchor) {
  const r = (anchor || $('#btn-vanilla')).getBoundingClientRect();
  openPicker({
    x: r.left, y: r.bottom + 6, placeholder: `Search vanilla ${MC_VERSION} worldgen…`, cls: 'menu wide',
    groups: REGISTRIES.filter((g) => vanillaIds(g.key).length).map((g) => ({ name: g.label, color: `var(${g.color})`, items: vanillaIds(g.key).map((id) => ({ label: short(id), value: { reg: g.key, id }, keys: g.label })) })),
    onPick: (v) => openFile(vanillaPath(v.reg, v.id)),
  });
}
async function openRef(reg, id) {
  id = normId(id);
  const path = pathFor(reg, id);
  if (PJ.cur && PJ.cur.files.has(path)) { openFile(path); return; }
  if (vanillaHas(reg, id)) { openFile(vanillaPath(reg, id)); return; }
  const ok = await confirmModal(`Create ${id}?`, `There is no ${regLabel1(reg).toLowerCase()} called ${id} in the project or in vanilla. Create it?`, 'Create');
  if (ok) newFileDialog(reg, { id });
}

/* ---------- tabs & editors ---------- */
function openFile(path) {
  if (!WB.tabs.includes(path)) WB.tabs.push(path);
  activate(path);
}
function closeTab(path) {
  const i = WB.tabs.indexOf(path);
  if (i < 0) return;
  if (DF_SELF.path === path) stashGraph();
  WB.tabs.splice(i, 1);
  if (WB.active === path) {
    const next = WB.tabs[i] || WB.tabs[i - 1];
    if (next) activate(next); else { WB.active = null; showWelcome(); }
  }
  renderTabs();
  saveTabs();
}
function renderTabs() {
  const bar = $('#tabs');
  bar.innerHTML = '';
  const titles = new Map();
  for (const p of WB.tabs) titles.set(fileTitle(p), (titles.get(fileTitle(p)) || 0) + 1);
  for (const p of WB.tabs) {
    const reg = regOfPath(p);
    const dup = titles.get(fileTitle(p)) > 1 && REG[reg];
    const c = isVanillaPath(p) ? null : parsedFile(p);
    const t = h('div', { class: 'tab' + (p === WB.active ? ' act' : '') + (isVanillaPath(p) ? ' van' : '') + (c && c.error ? ' bad' : ''), title: isVanillaPath(p) ? 'Vanilla (read-only): ' + parseVanillaPath(p).id : p },
      h('i', { style: { background: `var(${(REG[reg] || {}).color || '--fg-dim'})` } }), h('span', {}, fileTitle(p), dup ? h('small', { class: 'tab-reg' }, ' ' + regLabel1(reg).toLowerCase()) : null));
    const x = h('button', { class: 'tab-x', type: 'button', title: 'Close', html: ICON.x });
    x.addEventListener('click', (e) => { e.stopPropagation(); closeTab(p); });
    t.append(x);
    t.addEventListener('click', () => activate(p));
    t.addEventListener('auxclick', (e) => { if (e.button === 1) closeTab(p); });
    bar.append(t);
  }
  const act = bar.querySelector('.act');
  if (act) act.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
function stashGraph() {
  if (!DF_SELF.path) return;
  WB.hist.set(DF_SELF.path, { stack: history.stack.slice(), idx: history.idx, previewId });
}
function fileJson(path) {
  const v = parseVanillaPath(path);
  if (v) {
    const j = VANILLA.reg[v.reg] && VANILLA.reg[v.reg][v.id];
    return { json: j, error: null, text: j === undefined ? null : JSON.stringify(j, null, 2) + '\n' };
  }
  const c = parsedFile(path);
  return c ? { json: c.json, error: c.error, text: c.text } : { json: undefined, error: 'missing', text: '' };
}
async function activate(path) {
  if (DF_SELF.path && DF_SELF.path !== path) stashGraph();
  WB.active = path;
  renderTabs();
  renderExplorer();
  saveTabs();
  const reg = regOfPath(path);
  const ro = isVanillaPath(path);
  let { json, error, text } = fileJson(path);
  const v = parseVanillaPath(path);
  if (ro && json === undefined && v) {
    // template pools are fetched on demand
    showEditor('code');
    codeOpen(`Loading ${v.id} from misode/mcmeta…`, { message: true });
    setPreviewTarget(null);
    try { json = await vanillaJsonAsync(v.reg, v.id); } catch (err) { codeOpen(`Could not load ${v.id} (${err.message || err}).\n\nTemplate pools are not bundled with the workbench; they are fetched from GitHub when opened,\nwhich this page is not allowed to do here. Open the workbench in its own tab to browse them.`, { message: true }); return; }
    if (WB.active !== path) return;
    VANILLA.reg[v.reg] = VANILLA.reg[v.reg] || {};
    VANILLA.reg[v.reg][v.id] = json;
    text = JSON.stringify(json, null, 2) + '\n';
    error = null;
  }
  const id = v ? v.id : (parsePath(path) || {}).id;
  buildFileTools(path, reg, ro);
  if (reg === 'worldgen/density_function' && viewOf(path) === 'graph' && !error) {
    showEditor('graph');
    dfLoad(path, id, json);
    setPreviewTarget({ path, reg, id, json, error, readOnly: ro, dfJson: previewJsonSafe() });
  } else {
    if (DF_SELF.path === path) DF_SELF.path = null;
    showEditor('code');
    codeOpen(text, { readOnly: ro, onChange: ro ? null : (t) => setFileText(path, t) });
    setPreviewTarget({ path, reg, id, json, error, readOnly: ro });
  }
  if (innerWidth < 860) document.body.classList.remove('show-files');
}
/** Re-reads the active file after it changed outside the editor (disk sync). */
function reloadActive() {
  const path = WB.active;
  if (!path) return;
  if (DF_SELF.path === path) { WB.hist.delete(path); DF_SELF.path = null; }
  activate(path);
}
function showEditor(kind) {
  $('#editor').hidden = kind !== 'graph';
  $('#code').hidden = kind !== 'code';
  $('#welcome').hidden = kind !== 'welcome';
  if (kind === 'graph') requestAnimationFrame(() => redrawWires());
}
function showWelcome() {
  showEditor('welcome');
  buildFileTools(null);
  setPreviewTarget(null);
  renderTabs();
  renderExplorer();
}
function buildFileTools(path, reg, ro) {
  const t = $('#file-tools');
  t.innerHTML = '';
  if (!path) return;
  const btn = (label, title, fn, cls = 'btn') => { const b = h('button', { class: cls, type: 'button', title }, label); b.addEventListener('click', fn); t.append(b); return b; };
  if (reg === 'worldgen/density_function') {
    const g = h('div', { class: 'group' });
    for (const [k, l] of [['graph', 'Graph'], ['json', 'JSON']]) {
      const b = h('button', { class: 'btn' + (viewOf(path) === k ? ' on' : ''), type: 'button' }, l);
      b.addEventListener('click', () => {
        if (viewOf(path) === k) return;
        if (k === 'graph') { const c = fileJson(path); if (c.error) { toast('Fix the JSON error first'); return; } }
        if (k === 'json') stashGraph();
        WB.dfView.set(path, k);
        if (k === 'graph') WB.hist.delete(path);
        if (DF_SELF.path === path && k === 'json') DF_SELF.path = null;
        activate(path);
      });
      g.append(b);
    }
    t.append(g);
    if (viewOf(path) === 'graph' && !ro) {
      btn(h('span', { html: ICON.plus }), 'Add node (Space)', () => { const r = editor.getBoundingClientRect(); openAddMenu(r.left + r.width / 2 - 130, r.top + 60); }, 'btn icon');
      const ug = h('div', { class: 'group' });
      const u = h('button', { class: 'btn icon', id: 'btn-undo', type: 'button', title: 'Undo (Ctrl+Z)', html: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M5 3 2 6l3 3"/><path d="M2 6h7a4 4 0 0 1 0 8H6"/></svg>' });
      const rd = h('button', { class: 'btn icon', id: 'btn-redo', type: 'button', title: 'Redo (Ctrl+Shift+Z)', html: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m11 3 3 3-3 3"/><path d="M14 6H7a4 4 0 0 0 0 8h3"/></svg>' });
      u.addEventListener('click', undo); rd.addEventListener('click', redo);
      ug.append(u, rd);
      t.append(ug);
      btn('Tidy', 'Lay the graph out as a tree', () => {
        tidy();
        for (const n of G.nodes.values()) { const el = nodeEls.get(n.id); el.style.left = n.x + 'px'; el.style.top = n.y + 'px'; }
        redrawWires(); fitView(); commit();
      });
      btn('Examples', 'Replace this function with an example', (e) => openExamples(e.currentTarget));
    }
  }
  if (reg !== 'worldgen/density_function' || viewOf(path) === 'json') {
    if (!ro) btn('Format', 'Pretty-print (Ctrl+Shift+F)', codeFormat);
  }
  if (ro) {
    const b = btn('Copy to project', 'Make an editable copy in this project', () => {
      const v = parseVanillaPath(path);
      newFileDialog(v.reg, { id: v.id, json: fileJson(path).json });
    }, 'btn primary');
    b.prepend(h('span', { html: ICON.plus }));
  }
  btn('Copy JSON', 'Copy this file’s JSON', () => copyText(currentText(path), 'Copied JSON'));
  if (!(reg === 'worldgen/density_function' && viewOf(path) === 'graph' && !ro)) { const u = $('#btn-undo'); if (u) u.remove(); }
  updateHistoryButtons();
}
function currentText(path) {
  if (dfActive() && DF_SELF.path === path) { try { return JSON.stringify(exportNode('out'), null, 2) + '\n'; } catch { /* fall through */ } }
  return fileJson(path).text || '';
}
function copyText(s, msg) {
  const fallback = () => openModal({ title: 'JSON', text: s, note: 'Copying was blocked here. Select the text below and copy it.', readOnly: true });
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(s).then(() => toast(msg), fallback);
  else fallback();
}

/* ---------- density function graph per file ---------- */
function dfLoad(path, id, json) {
  if (DF_SELF.path === path && G.nodes.size) { renderAll(); requestAnimationFrame(() => { redrawWires(); }); return; }
  DF_SELF.path = path;
  DF_SELF.id = id;
  DF_SELF.loading = true;
  const saved = WB.hist.get(path);
  const layoutKey = 'wgw:layout:' + (PJ.cur ? PJ.cur.id : '') + ':' + path;
  history.stack = []; history.idx = -1;
  previewId = null;
  selection.clear();
  let restored = false;
  const want = JSON.stringify(json);
  const tryRestore = (s) => {
    try {
      deserialize(s);
      if (JSON.stringify(exportNode('out')) !== want) return false;
      renderAll();
      return true;
    } catch { return false; }
  };
  if (saved && saved.stack.length && tryRestore(saved.stack[saved.idx])) {
    history.stack = saved.stack.slice(); history.idx = saved.idx; previewId = saved.previewId && G.nodes.has(saved.previewId) ? saved.previewId : null;
    renderAll();
    restored = true;
  } else {
    const lay = store.get(layoutKey);
    if (lay && tryRestore(lay)) { restored = true; commit(); }
  }
  if (!restored) loadDensityFunction(json === undefined ? 0 : json, { fit: false });
  DF_SELF.loading = false;
  updateCount();
  updateHistoryButtons();
  requestAnimationFrame(() => { redrawWires(); fitView(); });
}
function graphCommitted(s) {
  if (!DF_SELF.path || !PJ.cur || isVanillaPath(DF_SELF.path)) return;
  store.set('wgw:layout:' + PJ.cur.id + ':' + DF_SELF.path, s);
}
let gcTimer = 0;
function graphChanged(typing) {
  updateCount();
  if (previewId && !G.nodes.has(previewId)) previewId = null;
  if (!DF_SELF.path || WB.active !== DF_SELF.path) return;
  if (TARGET && TARGET.path === DF_SELF.path) TARGET.dfJson = previewJsonSafe();
  scheduleEval(typing ? 220 : 40);
  if (DF_SELF.loading || isVanillaPath(DF_SELF.path)) return;
  clearTimeout(gcTimer);
  const path = DF_SELF.path;
  gcTimer = setTimeout(() => {
    if (DF_SELF.path !== path) return;
    let json;
    try { json = exportNode('out'); } catch { return; }
    const cur = parsedFile(path);
    if (cur && !cur.error && JSON.stringify(cur.json) === JSON.stringify(json)) return;
    setFileText(path, JSON.stringify(json, null, 2) + '\n');
  }, typing ? 300 : 60);
}
function previewJsonSafe() {
  try { return exportNode(previewId && G.nodes.has(previewId) ? previewId : 'out'); } catch { return undefined; }
}
function setPreview(id) {
  const old = previewId;
  previewId = id;
  for (const nid of [old, id]) if (nid && G.nodes.has(nid)) renderNode(G.nodes.get(nid));
  redrawWires();
  if (TARGET) TARGET.dfJson = previewJsonSafe();
  renderStatus();
  scheduleEval(0);
}
function dfStatusExtra() {
  if (!(previewId && G.nodes.has(previewId)) || !dfActive()) return null;
  const t = h('span', { class: 'target' }, 'Previewing ', h('b', {}, titleOf(previewId)));
  const b = h('button', { type: 'button' }, 'show whole function');
  b.addEventListener('click', () => setPreview(null));
  t.append(b);
  return t;
}

/* ---------- keeping views in sync with project changes ---------- */
let pcTimer = 0;
onProjectChange((d) => {
  clearTimeout(pcTimer);
  pcTimer = setTimeout(() => {
    renderExplorer();
    renderTabs();
    if (d.project) return;
    // refresh the preview of the active file: its own text, or anything it references, may have changed
    if (WB.active && TARGET && !isVanillaPath(WB.active) && !(DF_SELF.path === WB.active && dfActive())) {
      const c = parsedFile(WB.active);
      if (c) { TARGET.json = c.json; TARGET.error = c.error; }
    }
    if (TARGET) {
      if (PV.renderer && PV.renderer.modes().find((m) => m.id === PV.mode && m.kind === 'card')) runPreview();
      else if (d.path !== WB.active || !dfActive()) setPreviewTarget(TARGET);
    }
  }, 60);
});
window.addEventListener('focus', () => { if (PJ.cur && PJ.cur.kind === 'folder' && PJ.cur.perm === 'granted') syncFromDisk(); });
window.addEventListener('beforeunload', () => { flushAllSaves(); });

/* ---------- modals ---------- */
function modalShell(title, body, actions) {
  const modal = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, h('h2', {}, title), body, h('div', { class: 'actions' }, actions));
  const back = h('div', { class: 'modal-back' }, modal);
  back.addEventListener('pointerdown', (e) => { if (e.target === back) back.remove(); });
  back.addEventListener('keydown', (e) => { if (e.key === 'Escape') back.remove(); });
  document.body.append(back);
  return back;
}
function openModal({ title, note, text = '', readOnly = false }) {
  const ta = h('textarea', { spellcheck: false, readOnly });
  ta.value = text;
  const close = h('button', { class: 'btn', type: 'button' }, 'Close');
  const back = modalShell(title, h('div', {}, note ? h('p', {}, note) : null, ta), [close]);
  close.addEventListener('click', () => back.remove());
  ta.focus();
  if (readOnly) ta.select();
}
function openInfo(title, text) {
  const ok = h('button', { class: 'btn primary', type: 'button' }, 'OK');
  const back = modalShell(title, h('p', {}, text), [ok]);
  ok.addEventListener('click', () => back.remove());
  ok.focus();
}
function confirmModal(title, text, label, danger) {
  return new Promise((res) => {
    const ok = h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), type: 'button' }, label);
    const cancel = h('button', { class: 'btn', type: 'button' }, 'Cancel');
    const back = modalShell(title, h('p', {}, text), [cancel, ok]);
    const done = (v) => { back.remove(); res(v); };
    ok.addEventListener('click', () => done(true));
    cancel.addEventListener('click', () => done(false));
    new MutationObserver((_, o) => { if (!back.isConnected) { o.disconnect(); res(false); } }).observe(document.body, { childList: true });
    ok.focus();
  });
}
function promptModal(title, label, value, validate) {
  return new Promise((res) => {
    const inp = h('input', { type: 'text', value: value || '', spellcheck: false });
    const msg = h('span', { class: 'msg' });
    const ok = h('button', { class: 'btn primary', type: 'button' }, 'OK');
    const cancel = h('button', { class: 'btn', type: 'button' }, 'Cancel');
    const back = modalShell(title, h('div', { class: 'form' }, h('label', {}, h('span', {}, label), inp)), [msg, cancel, ok]);
    let settled = false;
    const done = (v) => { if (settled) return; settled = true; back.remove(); res(v); };
    const go = () => { const v = inp.value.trim(); if (!v) return; const e = validate && validate(v); if (e) { msg.textContent = e; return; } done(v); };
    ok.addEventListener('click', go);
    cancel.addEventListener('click', () => done(null));
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    new MutationObserver((_, o) => { if (!back.isConnected) { o.disconnect(); if (!settled) { settled = true; res(null); } } }).observe(document.body, { childList: true });
    setTimeout(() => { inp.focus(); inp.select(); }, 0);
  });
}
