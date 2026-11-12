'use strict';
// Pokémon GO Dashboard: opzoeken + afvinkboek. Voortgang staat in localStorage van deze browser.

const STORE = 'pogo-afvinkboek-v1';
const LIVE = 'https://raw.githubusercontent.com/bigfoott/ScrapedDuck/data/';
const SPRITE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/';

const CATS = [
  { id: 'normal', label: 'Gevangen' },
  { id: 'shiny', label: 'Shiny', shinyImg: true, applies: p => p.shiny },
  { id: 'hundo', label: 'Hundo (100%)' },
  { id: 'xxl', label: 'XXL' },
  { id: 'xxs', label: 'XXS' },
  { id: 'lucky', label: 'Lucky' },
  { id: 'shadow', label: 'Shadow', applies: p => p.shadow },
  { id: 'purified', label: 'Purified', applies: p => p.shadow },
  { id: 'mega', label: 'Mega', applies: p => p.mega },
  { id: 'dmax', label: 'Dynamax' },
  { id: 'gmax', label: 'Gigantamax', applies: p => p.gmax },
  { id: 'bgloc', label: 'Locatie-achtergrond' },
  { id: 'bgspecial', label: 'Speciale achtergrond' },
  { id: 'costume', label: 'Kostuums', variant: 'costume' },
  { id: 'form', label: 'Vormen', variant: 'form' },
];
const TYPES = { normal: 'Normaal', fire: 'Vuur', water: 'Water', grass: 'Gras', electric: 'Elektrisch', ice: 'IJs',
  fighting: 'Vecht', poison: 'Gif', ground: 'Grond', flying: 'Vlieg', psychic: 'Psychisch', bug: 'Insect',
  rock: 'Steen', ghost: 'Geest', dragon: 'Draak', dark: 'Duister', steel: 'Staal', fairy: 'Fee' };
const SHINY_VIA = { wild: 'in het wild', raid: 'raids', egg: 'eieren', research: 'research', evolution: 'evolutie', photobomb: 'snapshot-photobomb' };
const CLS = { legendary: 'Legendarisch', mythical: 'Mythisch', ultrabeast: 'Ultra Beast' };

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

let DATA = null;
let byN = new Map();
let live = null; // { raids, eggs, research } of false als ophalen mislukte
let cat = CATS[0];
let current = null; // Pokémon in het opzoek-tabblad
let state = {};
try { state = JSON.parse(localStorage.getItem(STORE)) || {}; } catch { state = {}; }

function save() {
  try { localStorage.setItem(STORE, JSON.stringify(state)); } catch { /* opslag niet beschikbaar */ }
}
const has = key => !!state[key];
function set(key, on) {
  if (on) state[key] = 1; else delete state[key];
  save();
}

function imgUrl(p, shiny, v) {
  const src = v || p;
  const file = shiny ? src.simg || src.img : src.img;
  return file ? DATA.imgBase + file : SPRITE + (shiny ? 'shiny/' : '') + p.n + '.png';
}
function imgTag(p, shiny, v) {
  return `<img loading="lazy" alt="" src="${esc(imgUrl(p, shiny, v))}" data-fallback="${SPRITE}${shiny ? 'shiny/' : ''}${p.n}.png">`;
}
// Ontbrekende iconen vallen terug op de PokeAPI-sprite.
document.addEventListener('error', e => {
  const t = e.target;
  if (t.tagName === 'IMG' && t.dataset.fallback) { const f = t.dataset.fallback; delete t.dataset.fallback; t.src = f; }
}, true);

/* ---------- Opzoeken ---------- */

function search(q) {
  q = norm(q.trim().replace(/^#/, ''));
  if (!q) return [];
  if (/^\d+$/.test(q)) {
    const exact = byN.get(+q);
    const rest = DATA.pokemon.filter(p => p !== exact && String(p.n).startsWith(q));
    return (exact ? [exact] : []).concat(rest);
  }
  const starts = [], contains = [];
  for (const p of DATA.pokemon) {
    const names = p.search;
    if (names.includes(q)) starts.unshift(p); // exacte naam bovenaan
    else if (names.some(n => n.startsWith(q))) starts.push(p);
    else if (names.some(n => n.includes(q))) contains.push(p);
  }
  return starts.concat(contains);
}

function liveMatches(p) {
  if (!live) return null;
  const re = new RegExp('(?<![\\w-])' + p.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w-])', 'i');
  const out = [];
  for (const r of live.raids) if (re.test(r.name)) out.push(`Raid: ${r.name} (${r.tier})${r.canBeShiny ? ' — shiny mogelijk' : ''}`);
  for (const e of live.eggs) if (re.test(e.name)) out.push(`Ei: ${e.name} uit ${e.eggType}-eieren${e.isAdventureSync ? ' (Adventure Sync)' : ''}${e.canBeShiny ? ' — shiny mogelijk' : ''}`);
  for (const t of live.research) for (const r of t.rewards || []) {
    if (re.test(r.name)) out.push(`Research: ${r.name} — “${t.text.replace(/<[^>]*>/g, '')}”${r.canBeShiny ? ' — shiny mogelijk' : ''}`);
  }
  return out;
}

function availability(p) {
  const a = [];
  if (!p.released) a.push('Nog niet uitgebracht in Pokémon GO (volgens de momentopname).');
  if (p.cls) a.push(`${CLS[p.cls]}: meestal alleen via raids, speciale research of evenementen.`);
  if (p.nest) a.push('Komt voor in nesten, dus te vangen in het wild.');
  if (p.baby) a.push('Baby-Pokémon: alleen uit eieren.');
  if (p.raid) a.push(`Raid-exclusief (niveau ${p.raid}).`);
  if (p.research) a.push('Alleen via research-taken.');
  if (p.evo) a.push(`Evolueert uit ${p.evo.from}${p.evo.candies ? ` (${p.evo.candies} candy${p.evo.item ? ' + ' + p.evo.item : ''})` : ''}.`);
  if (p.ditto) a.push('Kan een vermomde Ditto zijn.');
  if (p.shadow) a.push('Als Shadow te redden van Team GO Rocket (daarna te zuiveren).');
  if (p.mega) a.push(`Mega-evolutie: ${p.mega.join(', ')} (Mega Energy uit mega-raids).`);
  if (p.gmax) a.push('Gigantamax-vorm via Max Battles.');
  if (p.cd) a.push(`Community Day gehad op: ${p.cd.join(', ')}.`);
  if (p.released && a.length === 0) a.push('Uitgebracht; geen bijzondere bron bekend in de data — doorgaans in het wild of via evenementen.');
  return a;
}

function checkbox(key, label, extra) {
  return `<label class="${extra || ''}"><input type="checkbox" data-key="${esc(key)}"${has(key) ? ' checked' : ''}> ${esc(label)}</label>`;
}

function detailHTML(p) {
  const types = p.types.map(t => `<span class="badge">${TYPES[t] || t}</span>`).join('');
  const shiny = p.shiny
    ? `<span class="badge">Shiny: ${p.shiny.map(k => SHINY_VIA[k]).join(', ') || 'beschikbaar'}</span>`
    : '<span class="badge no">Shiny niet beschikbaar</span>';
  const lm = liveMatches(p);
  const liveHTML = lm === null
    ? `<p class="muted">${live === false ? 'Live-gegevens zijn nu niet bereikbaar.' : 'Live-gegevens laden…'}</p>`
    : lm.length ? `<ul>${lm.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`
      : '<p class="muted">Staat nu niet in de lijst van raids, eieren of research-taken.</p>';
  const checks = CATS.filter(c => !c.variant)
    .map(c => checkbox(`${p.n}:${c.id}`, c.label, c.applies && !c.applies(p) ? 'na' : '')).join('');
  const groups = ['costume', 'form'].map(kind => {
    const vs = (p.variants || []).filter(v => v.kind === kind);
    if (!vs.length) return '';
    return `<h3>${kind === 'costume' ? 'Kostuums' : 'Vormen'} (${vs.length})</h3><div class="variants">${vs.map(v => `
      <div class="variant">${imgTag(p, false, v)}<div>${esc(v.label)}</div>
        <div class="row">${checkbox(`${p.n}:v:${v.id}`, 'Heb ik')}${checkbox(`${p.n}:vs:${v.id}`, 'Shiny')}</div>
      </div>`).join('')}</div>`;
  }).join('');
  return `<article class="detail" data-n="${p.n}">
    <div class="head">${imgTag(p, false)}${imgTag(p, true)}
      <div><h2>#${String(p.n).padStart(4, '0')} ${esc(p.name)}</h2>
        <div>${types}<span class="badge">Generatie ${p.gen}</span>${shiny}</div>
        ${p.alt.length ? `<div class="muted">Ook bekend als: ${esc(p.alt.join(', '))}</div>` : ''}</div>
    </div>
    <h3>Hoe te krijgen</h3><ul>${availability(p).map(x => `<li>${esc(x)}</li>`).join('')}</ul>
    <h3>Nu actief (live via LeekDuck)</h3>${liveHTML}
    <h3>Afvinken</h3><div class="checks">${checks}</div>
    <p class="muted">Vaag weergegeven vakjes bestaan volgens de data (nog) niet voor deze Pokémon, maar je kunt ze wel aanvinken.</p>
    ${groups}
  </article>`;
}

function showResult(p) {
  current = p;
  $('#result').innerHTML = detailHTML(p);
}

function onQuery() {
  const hits = search($('#q').value).slice(0, 12);
  $('#suggest').innerHTML = hits.map(p => `<button data-pick="${p.n}">#${p.n} ${esc(p.name)}</button>`).join('');
  if (hits.length) showResult(hits[0]); // beste treffer meteen tonen
  else if ($('#q').value.trim() && !hits.length) { current = null; $('#result').innerHTML = '<p class="muted">Geen Pokémon gevonden.</p>'; }
}

/* ---------- Afvinkboek ---------- */

function variantsOf(p, kind) { return (p.variants || []).filter(v => v.kind === kind); }
function progressOf(p) { // [afgevinkt, totaal] voor de huidige categorie
  if (!cat.variant) return [has(`${p.n}:${cat.id}`) ? 1 : 0, 1];
  const vs = variantsOf(p, cat.variant);
  return [vs.filter(v => has(`${p.n}:v:${v.id}`)).length, vs.length];
}
function inCategory(p) {
  if (cat.variant) return variantsOf(p, cat.variant).length > 0;
  if ($('#showall').checked) return true;
  return p.released && (!cat.applies || !!cat.applies(p));
}

function renderGrid() {
  const f = norm($('#filter').value.trim().replace(/^#/, ''));
  const gen = $('#gen').value;
  const onlyMissing = $('#missing').checked;
  let done = 0, total = 0;
  const html = [];
  for (const p of DATA.pokemon) {
    if (!inCategory(p)) continue;
    const [d, t] = progressOf(p);
    if (gen && String(p.gen) !== gen) continue;
    done += d; total += t;
    if (onlyMissing && d === t) continue;
    if (f && !(String(p.n) === f || p.search.some(n => n.includes(f)))) continue;
    const cls = d === t ? 'done' : d ? 'part' : '';
    html.push(`<div class="tile ${cls}" data-n="${p.n}">
      <button class="main" title="${cat.variant ? 'Open om af te vinken' : 'Klik om af te vinken'}">${imgTag(p, cat.shinyImg)}
        <span class="num">#${p.n}</span><span>${esc(p.name)}</span>${cat.variant ? `<span class="num">${d}/${t}</span>` : ''}</button>
      <button class="info" title="Details" aria-label="Details van ${esc(p.name)}">i</button></div>`);
  }
  $('#grid').innerHTML = html.join('') || '<p class="muted">Niets te tonen met deze filters.</p>';
  $('#bar').style.width = total ? (100 * done / total) + '%' : '0';
  $('#progresstext').textContent = `${cat.label}: ${done} / ${total}${total ? ` (${Math.round(100 * done / total)}%)` : ''}`;
  $('#cathint').textContent = cat.variant ? 'Klik op een Pokémon om de afzonderlijke ' + cat.label.toLowerCase() + ' af te vinken.'
    : cat.applies && !$('#showall').checked ? 'Alleen Pokémon waarvoor deze categorie volgens de data bestaat. Mis je er één? Zet "Toon alles" aan.'
      : ['dmax', 'bgloc', 'bgspecial'].includes(cat.id) ? 'Hiervoor is geen betrouwbare lijst per Pokémon beschikbaar; alle uitgebrachte Pokémon worden getoond.' : '';
}

function openDialog(p) {
  $('#dlgbody').innerHTML = detailHTML(p);
  $('#dlg').showModal();
}

/* ---------- Events ---------- */

function selectTab(name) {
  for (const b of document.querySelectorAll('.tabs button')) b.setAttribute('aria-selected', b.dataset.tab === name);
  $('#tab-zoek').hidden = name !== 'zoek';
  $('#tab-boek').hidden = name !== 'boek';
  if (name === 'boek') renderGrid();
}

function wire() {
  document.querySelector('.tabs').addEventListener('click', e => { if (e.target.dataset.tab) selectTab(e.target.dataset.tab); });
  $('#q').addEventListener('input', onQuery);
  $('#q').addEventListener('keydown', e => {
    if (e.key === 'Enter') { const first = search($('#q').value)[0]; if (first) showResult(first); }
  });
  $('#suggest').addEventListener('click', e => { if (e.target.dataset.pick) showResult(byN.get(+e.target.dataset.pick)); });

  $('#cats').innerHTML = CATS.map(c => `<button data-cat="${c.id}" aria-pressed="${c === cat}">${c.label}</button>`).join('');
  $('#cats').addEventListener('click', e => {
    const c = CATS.find(x => x.id === e.target.dataset.cat);
    if (!c) return;
    cat = c;
    for (const b of $('#cats').children) b.setAttribute('aria-pressed', b.dataset.cat === c.id);
    renderGrid();
  });
  for (const id of ['#filter', '#gen', '#missing', '#showall']) $(id).addEventListener('input', renderGrid);

  $('#grid').addEventListener('click', e => {
    const tile = e.target.closest('.tile');
    if (!tile) return;
    const p = byN.get(+tile.dataset.n);
    if (e.target.closest('.info') || cat.variant) return openDialog(p);
    const key = `${p.n}:${cat.id}`;
    set(key, !has(key));
    renderGrid();
  });

  // Vinkjes in detailkaarten (opzoek-tabblad en dialoog).
  document.addEventListener('change', e => {
    if (e.target.dataset.key) set(e.target.dataset.key, e.target.checked);
  });
  $('#dlg').addEventListener('click', e => { if (e.target.closest('[data-close]') || e.target === $('#dlg')) $('#dlg').close(); });
  $('#dlg').addEventListener('close', () => { renderGrid(); if (current) showResult(current); });

  $('#export').addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(state)], { type: 'application/json' }));
    a.download = 'pokemon-go-afvinkboek.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $('#import').addEventListener('click', () => $('#importfile').click());
  $('#importfile').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('verkeerd formaat');
      const n = Object.keys(data).length;
      if (!confirm(`Je huidige afvinkboek vervangen door dit bestand (${n} vinkjes)?`)) return;
      state = {};
      for (const k of Object.keys(data)) if (data[k]) state[k] = 1;
      save();
      renderGrid();
      if (current) showResult(current);
    } catch (err) {
      alert('Importeren mislukt: ' + err.message);
    }
  });
}

async function loadLive() {
  try {
    const [raids, eggs, research] = await Promise.all(['raids', 'eggs', 'research'].map(async f => {
      const r = await fetch(`${LIVE}${f}.min.json`);
      if (!r.ok) throw new Error(r.status);
      return r.json();
    }));
    live = { raids, eggs, research };
  } catch {
    live = false;
  }
  if (current) showResult(current);
}

(async () => {
  try {
    const r = await fetch('data.json');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    DATA = await r.json();
  } catch (err) {
    $('#result').innerHTML = `<p>Pokémon-data kon niet geladen worden (${esc(err.message)}).</p>`;
    return;
  }
  for (const p of DATA.pokemon) {
    p.search = [p.name, ...p.alt].map(norm);
    byN.set(p.n, p);
  }
  const gens = [...new Set(DATA.pokemon.map(p => p.gen))].sort((a, b) => a - b);
  $('#gen').insertAdjacentHTML('beforeend', gens.map(g => `<option value="${g}">Generatie ${g}</option>`).join(''));
  $('#foot').innerHTML = `Momentopname van de data: ${esc(DATA.built)} (bronnen: pokemon-go-api, PoGoAPI.net; live: LeekDuck via ScrapedDuck). ` +
    'Je vinkjes worden alleen in deze browser bewaard — gebruik Exporteren voor een back-up.';
  wire();
  loadLive();
})();
