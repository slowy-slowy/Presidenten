#!/usr/bin/env python3
"""Bouwt de Claude-artifact-versie van de Pokédex.

In een artifact zijn externe afbeeldingen en netwerkverzoeken geblokkeerd. Dit script bundelt daarom
alle plaatjes in sprite-sheets, maakt een momentopname van de live-gegevens en zet HTML, CSS en JS
in één bestand.

Gebruik: python3 scripts/build-artifact.py <uitvoermap> [<cachemap voor downloads>]
Vereist: Pillow met WebP-ondersteuning.
"""
import json, os, re, sys, urllib.request, datetime
from concurrent.futures import ThreadPoolExecutor
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'pokemon')
OUT = sys.argv[1]
CACHE = sys.argv[2] if len(sys.argv) > 2 else os.path.join(OUT, '.cache')
HOME = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/home/'
LIVE = 'https://raw.githubusercontent.com/bigfoott/ScrapedDuck/data/'
# tegelgrootte, kolommen en tegels per sheet; moet overeenkomen met POKEDEX_ART in de pagina
SHEETS = {'t': (96, 32, 320), 'ts': (96, 32, 320), 'm': (384, 5, 25), 'ms': (384, 5, 25), 'v': (160, 16, 256)}

data = json.load(open(os.path.join(ROOT, 'data.json'), encoding='utf-8'))
pokemon, base = data['pokemon'], data['imgBase']


def fetch(job):
    path, url = job
    if os.path.exists(path) or not url:
        return
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            body = r.read()
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'wb') as f:
            f.write(body)
    except Exception:
        pass  # ontbrekende afbeelding: er wordt hieronder een andere bron gebruikt


c = lambda *p: os.path.join(CACHE, *p)
jobs, variants = [], []
for i, p in enumerate(pokemon):
    jobs += [(c('h', f'{i}.png'), f"{HOME}{p['n']}.png"), (c('hs', f'{i}.png'), f"{HOME}shiny/{p['n']}.png"),
             (c('g', f'{i}.png'), p.get('img') and base + p['img']), (c('gs', f'{i}.png'), p.get('simg') and base + p['simg'])]
    for v in p.get('variants', []):
        jobs.append((c('v', f'{len(variants)}.png'), base + v['img']))
        variants.append(v)
with ThreadPoolExecutor(24) as ex:
    list(ex.map(fetch, jobs))


def first(*paths):
    return next((p for p in paths if os.path.exists(p)), None)


def sheets(kind, sources, quality):
    size, cols, per = SHEETS[kind]
    rows = per // cols
    for k in range(0, len(sources), per):
        sheet = Image.new('RGBA', (cols * size, rows * size), (0, 0, 0, 0))
        for j, src in enumerate(sources[k:k + per]):
            if not src:
                continue
            im = Image.open(src).convert('RGBA')
            im.thumbnail((size, size), Image.LANCZOS)
            sheet.paste(im, ((j % cols) * size + (size - im.width) // 2, (j // cols) * size + (size - im.height) // 2))
        sheet.save(os.path.join(OUT, f'{kind}{k // per}.webp'), 'WEBP', quality=quality, method=4)


os.makedirs(OUT, exist_ok=True)
n = range(len(pokemon))
normal = [first(c('h', f'{i}.png'), c('g', f'{i}.png')) for i in n]
shiny = [first(c('hs', f'{i}.png'), c('gs', f'{i}.png')) or normal[i] for i in n]
sheets('t', normal, 80); sheets('ts', shiny, 80)
sheets('m', normal, 82); sheets('ms', shiny, 82)
sheets('v', [first(c('v', f'{k}.png')) for k in range(len(variants))], 80)
print('zonder afbeelding:', [pokemon[i]['name'] for i in n if not normal[i]])

# Momentopname van de live-gegevens, teruggebracht tot wat de pagina gebruikt.
def live(name):
    with urllib.request.urlopen(f'{LIVE}{name}.min.json', timeout=30) as r:
        return json.load(r)
pick = lambda o, keys: {k: o[k] for k in keys if o.get(k) not in (None, False, '')}
snapshot = {
    'updated': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
    'raids': [pick(r, ['name', 'tier', 'canBeShiny', 'image', 'combatPower']) for r in live('raids')],
    'eggs': [pick(e, ['name', 'eggType', 'canBeShiny', 'image', 'isAdventureSync', 'isGiftExchange', 'isRegional']) for e in live('eggs')],
    'research': [{'text': t['text'], 'rewards': [pick(r, ['name', 'image', 'canBeShiny']) for r in t.get('rewards', [])]} for t in live('research')],
}
for r in snapshot['raids']:
    if 'combatPower' in r: r['combatPower'] = {'normal': r['combatPower'].get('normal')}
json.dump(snapshot, open(os.path.join(OUT, 'live.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
for f in ('data.json', 'regions.json'):
    open(os.path.join(OUT, f), 'wb').write(open(os.path.join(ROOT, f), 'rb').read())

# Eén HTML-bestand volgens de artifact-regels: geen eigen <html>/<head>/<body>, alles inline.
read = lambda f: open(os.path.join(ROOT, f), encoding='utf-8').read()
body = re.search(r'<body>(.*)</body>', read('index.html'), re.S).group(1).replace('<script src="app.js"></script>', '')
art = {k: {'cols': v[1], 'per': v[2]} for k, v in SHEETS.items()}
extra = '''
/* Artifact: de schil reserveert zelf al ruimte voor de statusbalk. */
html, body { min-height: 100%; }
body::before { content: ""; position: fixed; inset: 0 0 auto; height: env(safe-area-inset-top, 0px); z-index: 10; background: var(--red-top); }
.dex { min-height: 100%; }
.dex-top { top: env(safe-area-inset-top, 0px); padding-top: 8px; }
'''
page = f'''<title>Pokédex GO</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Chakra+Petch:ital,wght@0,600;0,700;1,700&display=swap">
<style>
{read('style.css')}{extra}</style>
{body.strip()}
<script>window.POKEDEX_ART = {json.dumps(art)};</script>
<script>
{read('app.js')}
</script>
'''
open(os.path.join(OUT, 'index.html'), 'w', encoding='utf-8').write(page)
print('klaar:', OUT, f"{sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT) if os.path.isfile(os.path.join(OUT, f))) / 1e6:.1f} MB")
