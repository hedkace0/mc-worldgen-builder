# Worldgen Workbench

A browser-based editor for Minecraft worldgen data packs, with a live preview for each kind of file. Projects hold many files that reference each other by id, the same way a data pack does. A noise settings file can point at your own density function, a dimension at your noise settings, and a structure set at your structures. Every preview resolves those references, using your project's files first and vanilla 26.3 data otherwise.

It is inspired by [misode's generators](https://misode.github.io/) and [jacobsjo's df-editor](https://df-editor.jacobsjo.eu/).

**Try it online:** https://hedkace0.github.io/mc-worldgen-builder/

The whole app is one self-contained file, `index.html`. It needs no server or install step. You can also download it and open it locally.

## Previews

| File type | Preview |
| --- | --- |
| Density function | Node graph editor (or raw JSON). Side and top slices, a 3D chunk view, and a per-node preview |
| Noise | Top and side noise maps |
| Noise settings | Terrain slice and 3D chunks with aquifers, surface rules and the dimension's biomes |
| Material rule | The same terrain views with this rule as the surface rule, plus an outline of the rule tree |
| Dimension | Biome map (with temperature, humidity and the other climate layers), terrain slice, 3D chunk and a summary. Flat generators show their layer stack |
| World preset | The dimension views above, for any dimension in the preset |
| Biome parameter list | Biome map, and a climate plot of which biome wins across two climate axes |
| Structure set | Placement map with spacing grid and biome checks (random spread and concentric rings) |
| Placed feature | Simulated placements over 1 to 16×16 chunks, top and side views |
| Feature | 3D preview on a ground or ceiling plane for nearly every vanilla feature type, including nested patches and selectors, plus a summary |
| Biome, dimension type, structure, template pool, tags, carver, processor list, … | Info cards: colours, spawns, features by step, vertical range, biome lists, weights |

Every card lists the file's references and which project files use it. Click any of them to open that file.

## Projects and storage

- **Browser storage (default).** Projects are kept in IndexedDB, and edits save automatically.
- **Folder on disk.** *Open folder* connects a data pack folder through the File System Access API (Chrome and Edge). Edits are written straight to the files in that folder, and changes made on disk by other programs are picked up when you return to the tab. The browser asks for permission again in later sessions; until you reconnect, edits are kept in browser storage and written to the folder afterwards.
- **Zip.** Import a data pack `.zip` as a new project, or export a project as a `.zip`.

Use *Vanilla* to open any vanilla worldgen file read-only, then *Copy to project* to make an editable copy. Keeping the `minecraft:` id overrides the vanilla file.

## Editing

- **JSON editor:** syntax highlighting and error markers. Inside a string, typing (or <kbd>Ctrl</kbd>+<kbd>Space</kbd>) suggests ids from the project and vanilla data. <kbd>Ctrl</kbd>/<kbd>Cmd</kbd>-click an id to open that file. <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd> formats the file.
- **Node editor:**
  - Right-click or press <kbd>Space</kbd> to add a node, and drag a wire onto empty space to add and connect one.
  - Reference nodes can be expanded into their definition, or opened.
  - Box select, duplicate, undo and redo, and Tidy are available.
- <kbd>Ctrl</kbd>+<kbd>P</kbd> jumps to a file, and <kbd>Ctrl</kbd>+<kbd>S</kbd> saves immediately.

## Building

The page is generated from the sources in `src/` and the bundled data in `vendor/`:

```bash
python3 build.py
```

This writes `index.html`. `python3 build.py --fragment` writes `build/fragment.html`, which is the same page without `<!doctype>` and `<head>`, for hosts that add their own.

To refresh the vanilla data from [misode/mcmeta](https://github.com/misode/mcmeta), run:

```bash
python3 tools/vanilla.py 26.3
```

| Path | Contents |
| --- | --- |
| `src/shell.html` | Markup and styles |
| `src/util.js`, `src/data.js` | Helpers, registry list, biome and block colours, new-file templates |
| `src/project.js` | IndexedDB storage, folder access, zip reading and writing, reference resolution |
| `src/graph.js` | Density function node editor |
| `src/code.js` | JSON editor |
| `src/preview.js` | Worker client, 2D map view, 3D voxel view |
| `src/renderers.js`, `src/cards.js` | Preview per file type, info cards |
| `src/features.js` | Configured feature placement in a small virtual world |
| `src/workbench.js`, `src/main.js` | Projects, explorer, tabs, dialogs, startup |
| `src/worker.js` | Evaluation engine that runs in a Web Worker |
| `vendor/deepslate-0.27.2.umd.js` | deepslate library (MIT) |
| `vendor/vanilla-26.3.json` | Vanilla worldgen data |

The 3D views load [three.js](https://threejs.org/) r128 from cdnjs when first opened. Vanilla template pools are not bundled; they are fetched from mcmeta on GitHub when you open one.

## Limits

- Feature placement assumes flat ground at the surface Y you choose. Modifiers that depend on blocks are not simulated: block predicates, surface water depth and environment scans always pass.
- Feature previews port the vanilla algorithms for trees (all trunk and foliage placers except 26.3's poplar), ores, huge mushrooms and fungi, ice spikes, End features, chorus plants, bamboo, piles, disks, lakes and coral. Geodes, icebergs, dripstone, basalt columns, sculk and poplar trees are approximate shapes and are labelled as such. Features built from structure templates (fossils, the desert well) are not rendered, nor are carvers or jigsaw structure layouts.
- deepslate 0.27.2 does not implement every 26.3 surface rule. The `hole` and `steep` conditions count as false, and the `bandlands` and `ore_vein` rules place nothing, so badlands terracotta bands and ore veins are missing from terrain previews.

## Credits

- [deepslate](https://github.com/misode/deepslate) by Misode, MIT licence (see `vendor/deepslate-LICENSE`). It provides noise, density functions, terrain, aquifers, surface rules, biome sources and structure placement.
- Vanilla worldgen data from [misode/mcmeta](https://github.com/misode/mcmeta), extracted from Minecraft 26.3. Minecraft is a trademark of Mojang Studios; this project is not affiliated with Mojang or Microsoft.
