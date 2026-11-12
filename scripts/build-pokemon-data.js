#!/usr/bin/env node
// Bouwt public/pokemon/data.json uit openbare Pokémon GO-databronnen.
// Gebruik: node scripts/build-pokemon-data.js
// Optioneel: POGO_CACHE=<map> om reeds gedownloade JSON-bestanden te gebruiken.
const fs = require('fs');
const path = require('path');

const POKEDEX = 'https://pokemon-go-api.github.io/pokemon-go-api/api/pokedex.json';
const POGOAPI = 'https://pogoapi.net/api/v1/';
const IMG_BASE = 'https://raw.githubusercontent.com/pokemon-go-api/assets/main/Pokemon/';
const CACHE = process.env.POGO_CACHE;

async function load(url) {
  const file = CACHE && path.join(CACHE, path.basename(url));
  if (file && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

const pretty = s => s.replace(/_NOEVOLVE$/i, '').toLowerCase().split('_')
  .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
const img = url => (url && url.startsWith(IMG_BASE) ? url.slice(IMG_BASE.length) : url || '');
const type = t => (t ? t.type.replace('POKEMON_TYPE_', '').toLowerCase() : null);
const CLASS = { POKEMON_CLASS_LEGENDARY: 'legendary', POKEMON_CLASS_MYTHIC: 'mythical', POKEMON_CLASS_ULTRA_BEAST: 'ultrabeast' };

(async () => {
  const [dex, released, shiny, shadow, raidEx, nests, babies, ditto, megas, researchEx] = await Promise.all([
    load(POKEDEX),
    ...['released_pokemon', 'shiny_pokemon', 'shadow_pokemon', 'raid_exclusive_pokemon', 'nesting_pokemon',
      'baby_pokemon', 'possible_ditto_pokemon', 'mega_pokemon', 'research_task_exclusive_pokemon']
      .map(f => load(`${POGOAPI}${f}.json`)),
  ]);

  const idSet = list => new Set(list.map(x => x.id));
  const babySet = idSet(babies);
  const researchSet = idSet(researchEx);
  const megaById = {};
  for (const m of megas) (megaById[m.pokemon_id] ||= []).push(m.mega_name);

  const evoFrom = {};
  for (const p of dex) for (const e of p.evolutions || []) {
    if (!evoFrom[e.id]) evoFrom[e.id] = { from: p.names.English, candies: e.candies, item: e.item ? pretty(e.item.id || String(e.item)) : null };
  }

  const pokemon = dex.sort((a, b) => a.dexNr - b.dexNr).map(p => {
    const seen = new Set();
    const variants = [];
    for (const a of p.assetForms || []) {
      if (!a.form && !a.costume) continue;
      if (/^(MEGA|PRIMAL|GIGANTAMAX)/.test(a.form || '')) continue; // eigen categorieën in het afvinkboek
      const id = `${a.form || ''}|${a.costume || ''}`;
      if (seen.has(id)) continue;
      seen.add(id);
      variants.push({
        id,
        kind: a.costume ? 'costume' : 'form',
        label: [a.form && pretty(a.form), a.costume && pretty(a.costume)].filter(Boolean).join(' · '),
        img: img(a.image),
        simg: img(a.shinyImage),
      });
    }
    const s = shiny[p.dexNr];
    const names = [...new Set(Object.values(p.names))].filter(n => n !== p.names.English);
    const o = {
      n: p.dexNr,
      id: p.id,
      name: p.names.English,
      alt: names,
      gen: p.generation,
      types: [type(p.primaryType), type(p.secondaryType)].filter(Boolean),
      img: img(p.assets && p.assets.image),
      simg: img(p.assets && p.assets.shinyImage),
      released: !!released[p.dexNr],
    };
    if (!o.img) { // geen basis-icoon: neem de eerste vorm (bv. Unown), anders valt de pagina terug op PokeAPI
      const f = variants.find(v => v.kind === 'form' && v.img);
      if (f) { o.img = f.img; o.simg = f.simg; }
    }
    if (CLASS[p.pokemonClass]) o.cls = CLASS[p.pokemonClass];
    if (s) o.shiny = ['wild', 'raid', 'egg', 'research', 'evolution', 'photobomb'].filter(k => s['found_' + k]);
    if (shadow[p.dexNr]) o.shadow = true;
    if (raidEx[p.dexNr]) o.raid = raidEx[p.dexNr].raid_level;
    if (nests[p.dexNr]) o.nest = true;
    if (babySet.has(p.dexNr)) o.baby = true;
    if (ditto[p.dexNr]) o.ditto = true;
    if (researchSet.has(p.dexNr)) o.research = true;
    const megaNames = megaById[p.dexNr] || (p.hasMegaEvolution ? Object.values(p.megaEvolutions || {}).map(m => m.names.English) : null);
    if (megaNames && megaNames.length) o.mega = megaNames;
    if (p.hasGigantamaxEvolution) o.gmax = true;
    if (evoFrom[p.id]) o.evo = evoFrom[p.id];
    if (variants.length) o.variants = variants;
    return o;
  });

  const out = { built: new Date().toISOString().slice(0, 10), imgBase: IMG_BASE, pokemon };
  const file = path.join(__dirname, '..', 'public', 'pokemon', 'data.json');
  fs.writeFileSync(file, JSON.stringify(out));
  const count = k => pokemon.filter(p => p[k]).length;
  console.log(`${pokemon.length} Pokémon → ${file} (${(fs.statSync(file).size / 1024).toFixed(0)} kB)`);
  console.log(`released ${count('released')}, shiny ${count('shiny')}, shadow ${count('shadow')}, mega ${count('mega')}, gmax ${count('gmax')}, varianten ${count('variants')}`);
})().catch(e => { console.error(e); process.exit(1); });
