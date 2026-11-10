"""Bundles src/ and vendor/ into one self-contained page.

    python3 build.py              -> index.html (standalone document, e.g. for GitHub Pages)
    python3 build.py --fragment   -> build/fragment.html (body-only page for hosts that add their own <head>)
"""
import json, pathlib, sys

root = pathlib.Path(__file__).parent
src, ven = root / 'src', root / 'vendor'
fragment_only = '--fragment' in sys.argv

shell = (src / 'shell.html').read_text()
vanilla = json.dumps(json.loads((ven / 'vanilla-26.3.json').read_text()), separators=(',', ':')).replace('</', '<\\/')
ds = (ven / 'deepslate-0.27.2.umd.js').read_text()
engine = (src / 'worker.js').read_text()
MODULES = ['util.js', 'data.js', 'project.js', 'graph.js', 'preview.js', 'renderers.js', 'cards.js', 'code.js', 'workbench.js', 'main.js']
app = '\n'.join((src / f).read_text() for f in MODULES)
for name, text in [('deepslate', ds), ('worker.js', engine), ('app', app)]:
    assert '</script' not in text.lower(), f'{name} contains </script'

body = (shell
  + f'\n<script type="application/json" id="vanilla-data">{vanilla}</script>'
  + '\n<!-- deepslate 0.27.2 by Misode, MIT licence: https://github.com/misode/deepslate -->'
  + f'\n<script type="text/plain" id="ds-src">{ds}</script>'
  + f'\n<script type="text/plain" id="engine-src">{engine}</script>'
  + "\n<script>\n(() => {\n'use strict';\n" + app + '\n})();\n</script>\n')

if fragment_only:
    out_path = root / 'build' / 'fragment.html'
    out_path.parent.mkdir(exist_ok=True)
    out = body
else:
    out_path = root / 'index.html'
    head, sep, rest = body.partition('<div id="app">')
    assert sep, 'shell.html must contain <div id="app">'
    head = head.replace('<meta name="claude:viewport-fit-sides" content="cover">\n', '')
    out = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
           '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
           '<meta name="description" content="Minecraft worldgen data pack editor with live previews: density function node graphs, terrain, biome maps, structure and feature placement.">\n'
           '<style>body{margin:0}[hidden]{display:none!important}</style>\n'
           + head + '</head>\n<body>\n' + sep + rest + '</body>\n</html>\n')
out_path.write_text(out)
print(f'{out_path.relative_to(root)}: {len(out) / 1024:.0f} KB')
