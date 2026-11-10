"""Downloads vanilla worldgen data from misode/mcmeta and writes vendor/vanilla-<version>.json.

    python3 tools/vanilla.py [version]      (default 26.3)

The bundle holds every worldgen registry the workbench previews, keyed by registry path and then by
id. Template pools are large, so only their ids are bundled; the app fetches a pool when it is opened.
The built-in multi-noise presets (overworld, nether) are expanded so biome maps can be drawn; the
overworld table (~7600 entries) is packed into bytes that index per-parameter value tables.
"""
import base64, json, pathlib, sys, urllib.request

version = sys.argv[1] if len(sys.argv) > 1 else '26.3'
root = pathlib.Path(__file__).resolve().parent.parent
BASE = f'https://raw.githubusercontent.com/misode/mcmeta/{version}-summary/data/'

FULL = [
    'dimension', 'dimension_type',
    'worldgen/biome', 'worldgen/block_state_provider', 'worldgen/carver', 'worldgen/density_function',
    'worldgen/feature', 'worldgen/flat_level_generator_preset', 'worldgen/material_condition',
    'worldgen/material_rule', 'worldgen/multi_noise_biome_source_parameter_list', 'worldgen/noise',
    'worldgen/noise_settings', 'worldgen/placed_feature', 'worldgen/processor_list', 'worldgen/structure',
    'worldgen/structure_set', 'worldgen/world_preset',
]
IDS_ONLY = ['worldgen/template_pool']
TAGS = {'tags/worldgen/biome': 'tag/worldgen/biome'}


def get(path):
    with urllib.request.urlopen(BASE + path + '/data.min.json') as r:
        return json.loads(r.read())


def ns(d):
    return {('minecraft:' + k): v for k, v in sorted(d.items())}


out = {'version': version, 'reg': {}, 'ids': {}, 'presets': {}}
for reg in FULL:
    out['reg'][reg] = ns(get(reg))
    print(reg, len(out['reg'][reg]))
for reg in IDS_ONLY:
    out['ids'][reg] = sorted('minecraft:' + k for k in get(reg))
for reg, src in TAGS.items():
    out['reg'][reg] = ns(get(src))

# The summary expands multi-noise presets inside dimensions. Keep the data-pack form in the dimension
# files and move the expanded lists into `presets`.
dims = out['reg']['dimension']
for dim_id, preset in [('minecraft:overworld', 'minecraft:overworld'), ('minecraft:the_nether', 'minecraft:nether')]:
    src = dims[dim_id]['generator']['biome_source']
    entries = src['biomes']
    dims[dim_id]['generator']['biome_source'] = {'type': 'minecraft:multi_noise', 'preset': preset}
    if preset == 'minecraft:nether':
        out['presets'][preset] = {'biomes': entries}
        continue
    keys = ['temperature', 'humidity', 'continentalness', 'erosion', 'depth', 'weirdness']
    biomes = sorted({e['biome'] for e in entries})
    values = []
    for k in keys:
        vs = set()
        for e in entries:
            v = e['parameters'][k]
            vs.update(v if isinstance(v, list) else [v, v])
        values.append(sorted(vs))
    offsets = sorted({e['parameters']['offset'] for e in entries})
    buf = bytearray()
    for e in entries:
        p = e['parameters']
        buf.append(biomes.index(e['biome']))
        for i, k in enumerate(keys):
            v = p[k] if isinstance(p[k], list) else [p[k], p[k]]
            buf.append(values[i].index(v[0]))
            buf.append(values[i].index(v[1]))
        buf.append(offsets.index(p['offset']))
    out['presets'][preset] = {
        'packed': True, 'keys': keys, 'biomes': biomes, 'values': values, 'offsets': offsets,
        'count': len(entries), 'data': base64.b64encode(bytes(buf)).decode(),
    }
    print(preset, len(entries), 'entries,', len(buf), 'bytes')

dest = root / 'vendor' / f'vanilla-{version}.json'
dest.write_text(json.dumps(out, separators=(',', ':')))
print(dest.relative_to(root), f'{dest.stat().st_size / 1024:.0f} KB')
