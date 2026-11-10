/* ================= storage =================
   Projects live in IndexedDB (one record per project, one per file). A project can also be linked to a
   folder on disk through the File System Access API; then every save is written straight to that
   folder and IndexedDB keeps a cached copy so the project still opens before access is re-granted. */
const DB = {
  db: null, ok: true, mem: null,
  open() {
    if (this.db || !this.ok) return Promise.resolve(this.db);
    return new Promise((res) => {
      let req;
      try { req = indexedDB.open('worldgen-workbench', 1); } catch { this.fallback(); res(null); return; }
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('projects', { keyPath: 'id' });
        const f = db.createObjectStore('files', { keyPath: 'key' });
        f.createIndex('pid', 'pid');
      };
      req.onsuccess = () => { this.db = req.result; res(this.db); };
      req.onerror = () => { this.fallback(); res(null); };
      req.onblocked = () => { this.fallback(); res(null); };
    });
  },
  fallback() {
    this.ok = false;
    try { this.mem = JSON.parse(store.get('wgw:mem') || 'null'); } catch { this.mem = null; }
    if (!this.mem) this.mem = { projects: {}, files: {} };
  },
  saveMem() { store.set('wgw:mem', JSON.stringify(this.mem)); },
  req(storeName, mode, fn) {
    return new Promise((res, rej) => {
      const tx = this.db.transaction(storeName, mode);
      const out = fn(tx.objectStore(storeName));
      tx.oncomplete = () => res(out && 'result' in out ? out.result : undefined);
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error);
    });
  },
  async projects() {
    await this.open();
    if (!this.db) return Object.values(this.mem.projects);
    return this.req('projects', 'readonly', (s) => s.getAll());
  },
  async putProject(p) {
    await this.open();
    if (!this.db) { const { handle, ...rest } = p; this.mem.projects[p.id] = rest; this.saveMem(); return; }
    return this.req('projects', 'readwrite', (s) => s.put(p));
  },
  async deleteProject(id) {
    await this.open();
    if (!this.db) {
      delete this.mem.projects[id];
      for (const k of Object.keys(this.mem.files)) if (k.startsWith(id + '\u0000')) delete this.mem.files[k];
      this.saveMem();
      return;
    }
    const files = await this.files(id);
    await this.req('files', 'readwrite', (s) => { for (const f of files) s.delete(id + '\u0000' + f.path); });
    return this.req('projects', 'readwrite', (s) => s.delete(id));
  },
  async files(pid) {
    await this.open();
    if (!this.db) {
      return Object.entries(this.mem.files).filter(([k]) => k.startsWith(pid + '\u0000')).map(([k, text]) => ({ path: k.split('\u0000')[1], text }));
    }
    return this.req('files', 'readonly', (s) => s.index('pid').getAll(pid));
  },
  async putFiles(pid, entries) {
    await this.open();
    if (!this.db) { for (const [path, text] of entries) this.mem.files[pid + '\u0000' + path] = text; this.saveMem(); return; }
    return this.req('files', 'readwrite', (s) => { for (const [path, text] of entries) s.put({ key: pid + '\u0000' + path, pid, path, text }); });
  },
  async deleteFiles(pid, paths) {
    await this.open();
    if (!this.db) { for (const p of paths) delete this.mem.files[pid + '\u0000' + p]; this.saveMem(); return; }
    return this.req('files', 'readwrite', (s) => { for (const p of paths) s.delete(pid + '\u0000' + p); });
  },
};

/* ================= paths ================= */
const REG_BY_DIR = [...REGISTRIES].sort((a, b) => b.dir.length - a.dir.length);
/** data/<ns>/<registry dir>/<name>.json -> { reg, id } */
function parsePath(path) {
  const m = /^data\/([a-z0-9_.-]+)\/(.+)\.json$/.exec(path);
  if (!m) return null;
  for (const r of REG_BY_DIR) {
    if (m[2].startsWith(r.dir + '/')) {
      const name = m[2].slice(r.dir.length + 1);
      if (!/^[a-z0-9_./-]+$/.test(name)) return null;
      return { reg: r.key, id: m[1] + ':' + name, ns: m[1], name };
    }
  }
  return null;
}
const pathFor = (reg, id) => { const [ns, name] = normId(id).split(':'); return `data/${ns}/${REG[reg].dir}/${name}.json`; };
const isVanillaPath = (p) => p.startsWith('vanilla:');
const vanillaPath = (reg, id) => `vanilla:${reg}:${id}`;
function parseVanillaPath(p) { const m = /^vanilla:(.+?):(.+:.+)$/.exec(p); return m ? { reg: m[1], id: m[2] } : null; }
function fileTitle(path) {
  const v = parseVanillaPath(path);
  if (v) return short(v.id);
  const info = parsePath(path);
  return info ? (info.ns === 'minecraft' ? info.name : info.id) : path.split('/').pop();
}

/* ================= the open project ================= */
const PJ = {
  cur: null,          // { id, name, kind: 'browser' | 'folder', handle, perm, files: Map<path, text> }
  version: 0,
  parsed: new Map(),  // path -> { text, json, error }
  saveTimers: new Map(),
  pendingDisk: new Set(),
  listeners: new Set(),
  status: '',
};
function onProjectChange(fn) { PJ.listeners.add(fn); }
function projectChanged(detail) {
  PJ.version++;
  for (const fn of PJ.listeners) fn(detail || {});
}
function parsedFile(path) {
  const text = PJ.cur && PJ.cur.files.get(path);
  if (text === undefined) return null;
  let c = PJ.parsed.get(path);
  if (!c || c.text !== text) {
    c = { text, json: undefined, error: null };
    try { c.json = JSON.parse(text); } catch (err) { c.error = err.message; }
    PJ.parsed.set(path, c);
  }
  return c;
}
function projectEntries(reg) {
  const out = [];
  if (!PJ.cur) return out;
  for (const path of PJ.cur.files.keys()) {
    const info = parsePath(path);
    if (info && info.reg === reg) out.push({ id: info.id, path });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}
/** Resolves an id: the project's file wins over vanilla. */
function resolveRef(reg, id) {
  id = normId(id);
  if (PJ.cur) {
    const path = pathFor(reg, id);
    const c = parsedFile(path);
    if (c) return { src: 'project', path, json: c.json, error: c.error };
  }
  const v = VANILLA.reg[reg] && VANILLA.reg[reg][id];
  if (v !== undefined) return { src: 'vanilla', json: v };
  if (vanillaHas(reg, id)) return { src: 'vanilla', json: undefined, lazy: true };
  return null;
}
const resolveJson = (reg, id) => { const r = resolveRef(reg, id); return r ? r.json : undefined; };
function allIds(reg) {
  const p = projectEntries(reg).map((e) => e.id);
  const set = new Set(p);
  return p.concat(vanillaIds(reg).filter((id) => !set.has(id)));
}
/** Every registry entry the worker needs to evaluate previews, with the project's files overriding vanilla. */
const ENGINE_REGS = ['worldgen/noise', 'worldgen/density_function', 'worldgen/noise_settings', 'worldgen/material_rule', 'worldgen/material_condition', 'tags/worldgen/biome', 'worldgen/biome', 'worldgen/structure', 'worldgen/structure_set', 'worldgen/multi_noise_biome_source_parameter_list'];
function engineProjectData() {
  const out = {};
  if (!PJ.cur) return out;
  for (const path of PJ.cur.files.keys()) {
    const info = parsePath(path);
    if (!info || !ENGINE_REGS.includes(info.reg)) continue;
    const c = parsedFile(path);
    if (c.error) continue;
    (out[info.reg] = out[info.reg] || {})[info.id] = info.reg === 'worldgen/biome' ? {} : c.json;
  }
  return out;
}

/* ---------- writing ---------- */
function setFileText(path, text, { quiet = false } = {}) {
  if (!PJ.cur || isVanillaPath(path)) return;
  if (PJ.cur.files.get(path) === text) return;
  PJ.cur.files.set(path, text);
  queueSave(path);
  if (!quiet) projectChanged({ path, edit: true });
}
function queueSave(path) {
  clearTimeout(PJ.saveTimers.get(path));
  setSaveStatus('saving');
  PJ.saveTimers.set(path, setTimeout(() => { PJ.saveTimers.delete(path); flushSave(path); }, 450));
}
async function flushSave(path) {
  const p = PJ.cur;
  if (!p) return;
  const text = p.files.get(path);
  try {
    if (text === undefined) await DB.deleteFiles(p.id, [path]);
    else await DB.putFiles(p.id, [[path, text]]);
    if (p.kind === 'folder') {
      if (p.perm === 'granted') {
        if (text === undefined) await fsDelete(p.handle, path);
        else await fsWrite(p.handle, path, text);
        p.mtimes && p.mtimes.set(path, Date.now());
      } else PJ.pendingDisk.add(path);
    }
    if (!PJ.saveTimers.size) setSaveStatus('saved');
  } catch (err) {
    setSaveStatus('error', err.message || String(err));
  }
}
async function flushAllSaves() {
  const paths = [...PJ.saveTimers.keys()];
  for (const p of paths) { clearTimeout(PJ.saveTimers.get(p)); PJ.saveTimers.delete(p); }
  for (const p of paths) await flushSave(p);
}
async function createFile(path, text) {
  PJ.cur.files.set(path, text);
  await flushSave(path);
  projectChanged({ path, created: true });
}
async function deleteFile(path) {
  PJ.cur.files.delete(path);
  PJ.parsed.delete(path);
  await flushSave(path);
  projectChanged({ path, deleted: true });
}
async function renameFile(from, to) {
  const text = PJ.cur.files.get(from);
  PJ.cur.files.set(to, text);
  PJ.cur.files.delete(from);
  PJ.parsed.delete(from);
  await flushSave(to);
  await flushSave(from);
  projectChanged({ path: to, renamed: from });
}

/* ---------- folder access (File System Access API) ---------- */
const canPickFolder = () => typeof window.showDirectoryPicker === 'function';
async function fsDir(root, parts, create) {
  let d = root;
  for (const part of parts) d = await d.getDirectoryHandle(part, { create });
  return d;
}
async function fsWrite(root, path, text) {
  const parts = path.split('/');
  const dir = await fsDir(root, parts.slice(0, -1), true);
  const fh = await dir.getFileHandle(parts[parts.length - 1], { create: true });
  const w = await fh.createWritable();
  await w.write(text);
  await w.close();
}
async function fsDelete(root, path) {
  const parts = path.split('/');
  try {
    const dir = await fsDir(root, parts.slice(0, -1), false);
    await dir.removeEntry(parts[parts.length - 1]);
  } catch (err) { if (err && err.name !== 'NotFoundError') throw err; }
}
/** Reads pack.mcmeta and every worldgen file the workbench understands. Other files are left alone. */
async function fsScan(root) {
  const files = new Map(), mtimes = new Map();
  const readFile = async (fh, path) => {
    const f = await fh.getFile();
    if (f.size > 4e6) return;
    files.set(path, await f.text());
    mtimes.set(path, f.lastModified);
  };
  try { await readFile(await root.getFileHandle('pack.mcmeta'), 'pack.mcmeta'); } catch { /* no pack.mcmeta */ }
  let data;
  try { data = await root.getDirectoryHandle('data'); } catch { return { files, mtimes }; }
  const walk = async (dir, prefix, depth) => {
    if (depth > 12) return;
    for await (const [name, handle] of dir.entries()) {
      const path = prefix + '/' + name;
      if (handle.kind === 'directory') {
        // only descend into folders that can contain a known registry
        const rel = path.split('/').slice(2).join('/');
        if (depth >= 1 && !REGISTRIES.some((r) => (r.dir + '/').startsWith(rel + '/') || rel.startsWith(r.dir + '/'))) continue;
        await walk(handle, path, depth + 1);
      } else if (name.endsWith('.json') && parsePath(path)) await readFile(handle, path);
    }
  };
  await walk(data, 'data', 0);
  return { files, mtimes };
}

/* ---------- zip (store + deflate read, store write) ---------- */
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(bytes) { let c = 0xffffffff; for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function zipEncode(entries) {
  const enc = new TextEncoder();
  const chunks = [], central = [];
  let offset = 0;
  for (const [path, text] of entries) {
    const name = enc.encode(path), data = enc.encode(text), crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true);
    chunks.push(lh.buffer, name, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true);
    ch.setUint32(42, offset, true);
    central.push(ch.buffer, name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((s, b) => s + b.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...chunks, ...central, end.buffer], { type: 'application/zip' });
}
async function zipDecode(buf) {
  const dv = new DataView(buf);
  let e = buf.byteLength - 22;
  while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('Not a zip file');
  const count = dv.getUint16(e + 10, true);
  let p = dv.getUint32(e + 16, true);
  const dec = new TextDecoder();
  const out = [];
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(buf, p + 46, nlen));
    p += 46 + nlen + xlen + clen;
    if (name.endsWith('/')) continue;
    const ds = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const raw = new Uint8Array(buf, ds, csize);
    let bytes;
    if (method === 0) bytes = raw;
    else if (method === 8) {
      if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot unpack compressed zips');
      bytes = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    } else continue;
    out.push([name, dec.decode(bytes)]);
  }
  // a zip of a folder: strip the single top-level directory
  const top = out.length && out.every(([n]) => n.includes('/')) ? out[0][0].split('/')[0] : null;
  if (top && out.every(([n]) => n.startsWith(top + '/')) && out.some(([n]) => n === top + '/pack.mcmeta' || n.startsWith(top + '/data/'))) {
    return out.map(([n, t]) => [n.slice(top.length + 1), t]);
  }
  return out;
}
