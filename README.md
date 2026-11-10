# Density Function Workbench

A browser-based node editor for Minecraft worldgen **density functions** with a live preview. You build the function by wiring nodes together, and the result renders as a 3D chunk pillar or a side or top slice as you edit. It is inspired by [misode's density function generator](https://misode.github.io/worldgen/density-function/) and [jacobsjo's df-editor](https://df-editor.jacobsjo.eu/).

The whole app is one self-contained file, `index.html`. Open it in a browser; it needs no server or install step.

## Features

- **Node editor**
  - Every 26.x density function type is available: math, noise, spline, interval select, gradient, distance to point, find top surface, caching and blending markers, and more.
  - An input you leave unconnected takes a typed number instead.
  - Right-click or press <kbd>Space</kbd> to add a node. Dragging a wire onto empty space adds a node and connects it.
  - Box select, duplicate, undo/redo and auto-layout (Tidy) are built in.
- **Live preview**, computed in a Web Worker:
  - **3D chunk:** a pillar of 1×1 up to 4×4 chunks showing the blocks where density > 0. It has terrain colouring (grass, dirt, sand, stone, deepslate, water) and ambient occlusion.
  - **Side / Top:** 2D slices you can pan and zoom, with several colour maps and a per-block value readout.
  - **Per-node preview:** the eye icon on a node previews just that node's output.
- **Accurate maths:** evaluation uses [deepslate](https://github.com/misode/deepslate), the same library misode's site uses. Noise, splines and interpolation should therefore match vanilla.
- **Vanilla data:** all Minecraft 26.3 noises and density functions are bundled. Any vanilla function loads as a preset, and **Expand** on a reference node replaces it with its full definition.
- **Import / export:** copy the output as data-pack JSON, or paste JSON in. Pre-26.x types (`y_clamped_gradient`, `flat_cache`, `cache_2d`, `shifted_noise`, `argument1`/`argument2`, …) are converted on import.
- **Custom noises:** define your own noise parameters and use them in Noise nodes.

Your graph and view settings are saved in your browser's local storage.

## Building

The page is generated from the sources in `src/` and the bundled data in `vendor/`:

```bash
python3 build.py
```

This writes `index.html`. `python3 build.py --fragment` writes `build/fragment.html` instead: the same page without `<!doctype>`/`<head>`, for hosts that add their own.

| Path | Contents |
| --- | --- |
| `src/shell.html` | Markup and styles |
| `src/graph.js` | Node types, graph model, editor interaction, JSON import/export |
| `src/preview.js` | Worker management, 2D slice renderer, 3D voxel mesher |
| `src/main.js` | Presets, toolbar, dialogs, startup |
| `src/worker.js` | Evaluation engine that runs in the worker |
| `vendor/deepslate-0.27.2.umd.js` | deepslate library (MIT) |
| `vendor/vanilla-26.3.json` | Vanilla noise, density function and noise settings data |

The 3D view loads [three.js](https://threejs.org/) r128 from cdnjs when it first opens.

## Credits

- [deepslate](https://github.com/misode/deepslate) by Misode, MIT licence (see `vendor/deepslate-LICENSE`).
- Vanilla worldgen data from [misode/mcmeta](https://github.com/misode/mcmeta), extracted from Minecraft 26.3. Minecraft is a trademark of Mojang Studios; this project is not affiliated with Mojang or Microsoft.
