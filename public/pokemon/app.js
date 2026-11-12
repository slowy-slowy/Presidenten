'use strict';
// Pokédex GO: opzoeken, live-beschikbaarheid en afvinkboek. Voortgang staat in localStorage van deze browser.

const STORE = 'pogo-afvinkboek-v1';
const LIVE = 'https://raw.githubusercontent.com/bigfoott/ScrapedDuck/data/';
const SPRITE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/';
const HOME3D = SPRITE + 'other/home/'; // 3D-renders uit Pokémon HOME
// Als Claude-artifact zijn externe afbeeldingen en verzoeken geblokkeerd: dan komen de plaatjes uit
// meegebundelde sprite-sheets en gaan vinkjes en live-gegevens via de opslag van het artifact.
const ART = window.POKEDEX_ART || null;

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
const TYPE_COLOR = { normal: '#9a9a6b', fire: '#ee8130', water: '#5a8bea', grass: '#5fae3b', electric: '#e0b400', ice: '#5fbfbb',
  fighting: '#c22e28', poison: '#a33ea1', ground: '#c9a04a', flying: '#8f79e6', psychic: '#f0457a', bug: '#93a516',
  rock: '#a8922f', ghost: '#735797', dragon: '#6f35fc', dark: '#705746', steel: '#8989a8', fairy: '#d06ca6' };
const WEATHER = [
  ['☀️ Zonnig', ['grass', 'ground', 'fire']], ['🌧️ Regen', ['water', 'electric', 'bug']],
  ['⛅ Half bewolkt', ['normal', 'rock']], ['☁️ Bewolkt', ['fairy', 'fighting', 'poison']],
  ['💨 Wind', ['dragon', 'flying', 'psychic']], ['❄️ Sneeuw', ['ice', 'steel']], ['🌫️ Mist', ['dark', 'ghost']],
];
const SHINY_VIA = { wild: 'in het wild', raid: 'raids', egg: 'eieren', research: 'research', evolution: 'evolutie', photobomb: 'snapshot' };
const CLS = { legendary: 'Legendarisch', mythical: 'Mythisch', ultrabeast: 'Ultra Beast' };

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const num = n => '#' + String(n).padStart(4, '0');

let DATA = null;
let REG = {};          // regionale info per Pokédex-nummer
let byN = new Map();
let live = null;       // { raids, eggs, research } of false als ophalen mislukte
let liveByN = new Map();
let liveTab = 'raids';
let cat = CATS[0];
let visible = [];      // nummers in de huidige lijst (voor vorige/volgende)
let sheet = null;      // { p, shiny, variant } van het geopende detailscherm
let gridDirty = false;
let state = {};
try { state = JSON.parse(localStorage.getItem(STORE)) || {}; } catch { state = {}; }

function save() {
  try { localStorage.setItem(STORE, JSON.stringify(state)); } catch { /* opslag niet beschikbaar */ }
  if (cloud) { cloudDirty = true; clearTimeout(cloudTimer); cloudTimer = setTimeout(pushCloud, 1200); }
}
const has = key => !!state[key];
function set(key, on) {
  if (on) state[key] = 1; else delete state[key];
  touched.set(key, on);
  save();
}

/* ---------- Opslag bij het artifact (alleen in de artifact-versie) ---------- */

let cloud = null;            // document met de vinkjes van deze gebruiker
let cloudTimer = 0, cloudBusy = false, cloudDirty = false;
const touched = new Map();   // wat er is aan- of uitgevinkt voordat de opslag geladen was

function setSync(cls, text) {
  const el = $('#syncstate');
  el.className = 'syncline ' + cls;
  el.querySelector('span').textContent = text;
}
async function pushCloud() { // één schrijfactie tegelijk
  if (cloudBusy || !cloud) return;
  cloudBusy = true;
  while (cloudDirty) {
    cloudDirty = false;
    try {
      await cloud.set({ keys: Object.keys(state), at: Date.now() });
      setSync('ok', 'Opgeslagen bij je account');
    } catch {
      setSync('err', 'Opslaan lukt nu niet — je vinkjes staan wel op dit toestel');
      break;
    }
  }
  cloudBusy = false;
}
async function initCloud() {
  const use = window.claude && window.claude.use ? n => window.claude.use(n).catch(() => null) : () => null;
  const [db, user] = await Promise.all([use('db'), use('user')]);
  if (!db) return setSync('', 'Niet aangemeld — vinkjes blijven alleen op dit toestel');
  db.doc('live/current').get().then(snap => { // nieuwere live-gegevens dan de meegebundelde
    const d = snap.exists && snap.data();
    if (d && d.json && (!liveAt || d.updated > liveAt)) setLive(JSON.parse(d.json));
  }).catch(() => {});
  const id = user && await user.id();
  if (!id) return setSync('', 'Niet aangemeld — vinkjes blijven alleen op dit toestel');
  try {
    const ref = db.doc(`data/users/${id}/ticks`);
    const snap = await ref.get();
    if (snap.exists) { // de opslag is leidend; wat je net al aantikte blijft staan
      const next = {};
      for (const k of snap.data().keys || []) next[k] = 1;
      for (const [k, on] of touched) { if (on) next[k] = 1; else delete next[k]; }
      state = next;
    }
    cloud = ref;
    setSync('ok', 'Opgeslagen bij je account');
    if (!snap.exists ? Object.keys(state).length : touched.size) save(); else { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch { /* geen opslag */ } }
    renderGrid();
    renderStats();
    if (sheet) renderSheet(true);
  } catch {
    setSync('err', 'Opslag niet bereikbaar — vinkjes blijven op dit toestel');
  }
}

/* ---------- Afbeeldingen ---------- */

function iconUrl(p, shiny, v) {
  const src = v || p;
  const file = shiny ? src.simg || src.img : src.img;
  return file ? DATA.imgBase + file : SPRITE + (shiny ? 'shiny/' : '') + p.n + '.png';
}
// Probeert de bronnen in data-fb één voor één als een afbeelding ontbreekt.
function img(urls, cls) {
  const [first, ...rest] = urls.filter((u, i, a) => u && a.indexOf(u) === i);
  return `<img class="${cls || ''}" loading="lazy" decoding="async" alt="" draggable="false" src="${esc(first)}"${rest.length ? ` data-fb="${esc(rest.join('|'))}"` : ''}>`;
}
function spr(kind, i, cls) { // tegel i uit een meegebundelde sprite-sheet
  const s = ART[kind], j = i % s.per, rows = s.per / s.cols;
  return `<span class="spr ${cls || ''}" style="background-image:url(${kind}${Math.floor(i / s.per)}.webp);background-size:${s.cols * 100}% ${rows * 100}%;` +
    `background-position:${(j % s.cols) / (s.cols - 1) * 100}% ${Math.floor(j / s.cols) / (rows - 1) * 100}%"></span>`;
}
const iconTag = (p, shiny, v) => ART ? (v ? spr('v', v.k) : spr(shiny ? 'ts' : 't', p.i))
  : img([iconUrl(p, shiny, v), `${SPRITE}${shiny ? 'shiny/' : ''}${p.n}.png`]);
function modelTag(p, shiny, v) {
  if (ART) return v ? spr('v', v.k, 'model') : spr(shiny ? 'ms' : 'm', p.i, 'model');
  const s = shiny ? 'shiny/' : '';
  return img(v ? [iconUrl(p, shiny, v), `${HOME3D}${s}${p.n}.png`]
    : [`${HOME3D}${s}${p.n}.png`, iconUrl(p, shiny), `${SPRITE}other/official-artwork/${s}${p.n}.png`, `${SPRITE}${s}${p.n}.png`], 'model');
}
document.addEventListener('error', e => {
  const t = e.target;
  if (t.tagName !== 'IMG' || !t.dataset.fb) return;
  const [next, ...rest] = t.dataset.fb.split('|');
  if (rest.length) t.dataset.fb = rest.join('|'); else delete t.dataset.fb;
  t.src = next;
}, true);

/* ---------- Gegevens per Pokémon ---------- */

const region = p => REG[p.n] || null;
const isRegional = p => !!region(p);

function search(q) {
  q = norm(q.trim().replace(/^#/, ''));
  if (!q) return null;
  if (/^\d+$/.test(q)) {
    const exact = byN.get(+q);
    const rest = DATA.pokemon.filter(p => p !== exact && String(p.n).startsWith(q));
    return (exact ? [exact] : []).concat(rest);
  }
  const exact = [], starts = [], contains = [];
  for (const p of DATA.pokemon) {
    const names = p.search;
    if (names.includes(q)) exact.push(p);
    else if (names.some(n => n.startsWith(q))) starts.push(p);
    else if (names.some(n => n.includes(q))) contains.push(p);
  }
  return exact.concat(starts, contains);
}

function liveN(item, fallbackName) { // Pokédex-nummer bij een live-item
  const m = /pm(\d+)\./.exec(item.image || '');
  if (m) return +m[1];
  const hit = DATA.pokemon.find(p => norm(fallbackName || item.name).includes(norm(p.name)));
  return hit ? hit.n : 0;
}
function indexLive() {
  liveByN = new Map();
  const add = (n, o) => { if (n) (liveByN.get(n) || liveByN.set(n, []).get(n)).push(o); };
  for (const r of live.raids) add(liveN(r), { icon: '⚔️', title: `Raid · ${tierLabel(r.tier)}`, sub: r.name, shiny: r.canBeShiny });
  for (const e of live.eggs) add(liveN(e), { icon: '🥚', title: `Ei · ${e.eggType}${eggExtra(e)}`, sub: e.name, shiny: e.canBeShiny });
  for (const t of live.research) for (const r of t.rewards || []) {
    add(liveN(r), { icon: '📋', title: 'Research-taak', sub: `${r.name} — “${taskText(t)}”`, shiny: r.canBeShiny });
  }
}
const taskText = t => String(t.text || '').replace(/<[^>]*>/g, '');
const eggExtra = e => (e.isAdventureSync ? ' (Adventure Sync)' : e.isGiftExchange ? ' (uit cadeaus)' : '') + (e.isRegional ? ' · regionaal' : '');
function tierLabel(t) {
  const m = /^(\d)-Star/.exec(t || '');
  if (m) return '★'.repeat(+m[1]) + ` ${m[1]} ${m[1] === '1' ? 'ster' : 'sterren'}`;
  return String(t || 'Raid').replace(/ Raids?$/, '');
}

function sources(p) { // waar/hoe je deze Pokémon krijgt
  const a = [];
  if (!p.released) a.push(['⏳', 'Nog niet uitgebracht in Pokémon GO.']);
  if (p.cls) a.push(['👑', `${CLS[p.cls]}: meestal via raids, speciale research of evenementen.`]);
  if (p.nest) a.push(['🌳', 'In het wild — komt ook voor in nesten (parken).']);
  if (p.baby) a.push(['🥚', 'Baby-Pokémon: alleen uit eieren.']);
  if (p.raid) a.push(['⚔️', `Alleen via raids (niveau ${p.raid}).`]);
  if (p.research) a.push(['📋', 'Alleen via research-taken.']);
  if (p.evo) a.push(['⬆️', `Evolueert uit ${p.evo.from}${p.evo.candies ? ` (${p.evo.candies} candy${p.evo.item ? ' + ' + p.evo.item : ''})` : ''}.`]);
  if (p.ditto) a.push(['🟣', 'Kan een vermomde Ditto zijn.']);
  if (p.shadow) a.push(['🚀', 'Als Shadow te redden van Team GO Rocket.']);
  if (p.mega) a.push(['💎', `Mega-evolutie: ${p.mega.join(', ')}.`]);
  if (p.gmax) a.push(['🌀', 'Gigantamax-vorm via Max Battles.']);
  if (p.released && !a.length) a.push(['🌿', 'In het wild of via evenementen.']);
  return a;
}
const weatherOf = p => WEATHER.filter(([, ts]) => p.types.some(t => ts.includes(t))).map(([w]) => w);

/* ---------- Detailscherm ---------- */

function regionHTML(p) {
  const r = region(p);
  if (!r) return `<div class="regbox global"><b>🌐 Niet regionaal</b><span>Wereldwijd te vinden — geen vaste spawnregio.</span></div>`;
  const here = h => (h ? '<em class="here">✓ NL/BE</em>' : '<em class="nothere">✕ niet in NL/BE</em>');
  const forms = (r.forms || []).map(f => `<li><b>${esc(f.label)}</b><span>${esc(f.where)}</span>${here(f.here)}</li>`).join('');
  return `<div class="regbox ${r.partial ? 'partial' : 'regional'}">
    <b>📍 ${r.partial ? 'Regionale vormen' : 'Regionaal'}</b>
    ${r.where ? `<span class="where">${esc(r.where)}</span>${here(r.here)}` : ''}
    ${r.note ? `<span>${esc(r.note)}</span>` : ''}
    ${forms ? `<ul class="regforms">${forms}</ul>` : ''}
    <small>Tijdens evenementen of via ruilen soms ook buiten de regio te krijgen.</small></div>`;
}

function liveHTML(p) {
  if (live === null) return '<p class="muted">Live-gegevens laden…</p>';
  if (live === false) return '<p class="muted">Live-gegevens zijn nu niet bereikbaar.</p>';
  const items = liveByN.get(p.n) || [];
  if (!items.length) return '<p class="muted">Zit nu niet in raids, eieren of research-taken.</p>';
  return `<ul class="rows live">${items.map(x => `<li><i>${x.icon}</i><div><b>${esc(x.title)}${x.shiny ? ' <span class="spark" title="Shiny mogelijk">✨</span>' : ''}</b><span>${esc(x.sub)}</span></div></li>`).join('')}</ul>`;
}

function toggle(key, label, extra) {
  return `<label class="tog check ${extra || ''}"><input type="checkbox" data-key="${esc(key)}"${has(key) ? ' checked' : ''}><span>${esc(label)}</span></label>`;
}

function detailHTML() {
  const { p, shiny, variant } = sheet;
  const c1 = TYPE_COLOR[p.types[0]] || '#888', c2 = TYPE_COLOR[p.types[1] || p.types[0]] || c1;
  const types = p.types.map(t => `<span class="type" style="--t:${TYPE_COLOR[t]}">${TYPES[t] || t}</span>`).join('');
  const r = region(p);
  const facts = [
    `<span class="fact">Gen ${p.gen}</span>`,
    p.cls ? `<span class="fact gold">${CLS[p.cls]}</span>` : '',
    r ? `<span class="fact reg">📍 ${r.partial ? 'Regionale vormen' : 'Regionaal'}</span>` : '<span class="fact">🌐 Wereldwijd</span>',
    p.released ? '' : '<span class="fact no">Nog niet in GO</span>',
  ].join('');
  const shinyLine = p.shiny
    ? `✨ Shiny via ${p.shiny.map(k => SHINY_VIA[k]).join(', ') || 'evenementen'}`
    : '✨ Shiny nog niet beschikbaar';
  const weather = weatherOf(p);
  const checks = CATS.filter(c => !c.variant)
    .map(c => toggle(`${p.n}:${c.id}`, c.label, c.applies && !c.applies(p) ? 'na' : '')).join('');
  const groups = ['form', 'costume'].map(kind => {
    const vs = (p.variants || []).filter(v => v.kind === kind);
    if (!vs.length) return '';
    return `<details class="card vgroup"${vs.length <= 6 ? ' open' : ''}><summary>${kind === 'costume' ? 'Kostuums' : 'Vormen'} <span class="count">${vs.length}</span></summary>
      <div class="variants">${vs.map(v => `
      <div class="variant${variant === v ? ' on' : ''}">
        <button class="vimg" data-variant="${esc(v.id)}" aria-label="Bekijk ${esc(v.label)}">${iconTag(p, false, v)}</button>
        <div class="vname">${esc(v.label)}</div>
        <div class="vrow">${toggle(`${p.n}:v:${v.id}`, 'Heb ik')}${toggle(`${p.n}:vs:${v.id}`, '✨')}</div>
      </div>`).join('')}</div></details>`;
  }).join('');

  return `<article class="detail" style="--c1:${c1};--c2:${c2}">
    <div class="stage${shiny ? ' shiny' : ''}">
      <span class="stnum">${num(p.n)}</span>
      <button class="shinybtn" data-shiny aria-pressed="${shiny}" ${p.shiny || p.simg ? '' : 'hidden'}>✨ Shiny</button>
      <div class="fig"><div class="float">${modelTag(p, shiny, variant)}</div></div>
      <div class="shadow"></div>
      <div class="sthint">sleep om te draaien · tik voor een rondje</div>
    </div>
    <div class="dhead">
      <h2>${esc(p.name)}${variant ? ` <small>${esc(variant.label)}</small>` : ''}</h2>
      <div class="types">${types}</div>
      <div class="facts">${facts}</div>
    </div>

    <section class="card"><h3>Waar te vinden</h3>
      ${regionHTML(p)}
      <ul class="rows">${sources(p).map(([i, x]) => `<li><i>${i}</i><div><span>${esc(x)}</span></div></li>`).join('')}
        <li><i>✨</i><div><span>${esc(shinyLine.slice(2))}</span></div></li>
        ${weather.length ? `<li><i>🌦️</i><div><span>Vaker bij dit weer: ${weather.join(', ')}</span></div></li>` : ''}
      </ul></section>

    <section class="card livecard"><h3><span class="dot"></span>Nu live te krijgen</h3>${liveHTML(p)}</section>

    <section class="card"><h3>Mijn collectie</h3><div class="checks">${checks}</div>
      <p class="muted small">Vaag = bestaat (nog) niet voor deze Pokémon, maar aanvinken kan wel.</p></section>
    ${groups}
    ${p.alt.length ? `<p class="muted small alt">Ook bekend als: ${esc(p.alt.join(' · '))}</p>` : ''}
  </article>`;
}

function renderSheet(keepScroll) {
  const body = $('#sheetbody');
  const top = body.scrollTop;
  body.innerHTML = detailHTML();
  body.scrollTop = keepScroll ? top : 0;
  const i = visible.indexOf(sheet.p.n);
  const list = i >= 0 ? visible : DATA.pokemon.map(p => p.n);
  const j = list.indexOf(sheet.p.n);
  for (const [id, n] of [['#prev', list[j - 1]], ['#next', list[j + 1]]]) {
    const b = $(id);
    b.disabled = !n;
    b.dataset.n = n || '';
    b.querySelector('span').textContent = n ? byN.get(n).name : '';
  }
}

function openSheet(p) {
  const wasOpen = !!sheet;
  sheet = { p, shiny: cat.shinyImg && !!p.shiny, variant: null };
  renderSheet();
  if (wasOpen) return;
  $('#sheet').hidden = false;
  document.body.classList.add('locked');
  if (!ART) history.pushState({ sheet: true }, ''); // terug-knop sluit het detailscherm
}
function closeSheet() { // via terug-knop of sluitknop
  if (!sheet) return;
  sheet = null;
  $('#sheet').hidden = true;
  document.body.classList.remove('locked');
  if (gridDirty) { renderGrid(); renderStats(); }
}

/* ---------- Lijst ---------- */

function variantsOf(p, kind) { return (p.variants || []).filter(v => v.kind === kind); }
function progressOf(p) { // [afgevinkt, totaal] voor de huidige categorie
  if (!cat.variant) return [has(`${p.n}:${cat.id}`) ? 1 : 0, 1];
  const vs = variantsOf(p, cat.variant);
  return [vs.filter(v => has(`${p.n}:v:${v.id}`)).length, vs.length];
}
function inCategory(p, c = cat) {
  if (c.variant) return variantsOf(p, c.variant).length > 0;
  return p.released && (!c.applies || !!c.applies(p));
}

function renderGrid() {
  gridDirty = false;
  const hits = search($('#q').value);
  const gen = $('#gen').value, type = $('#type').value;
  const onlyMissing = $('#missing').checked, onlyRegional = $('#regional').checked;
  let done = 0, total = 0;
  const html = [];
  visible = [];
  for (const p of hits || DATA.pokemon) {
    const applies = inCategory(p);
    // Bij "Gevangen" en bij zoeken zie je de hele Pokédex; anders alleen wat in de categorie bestaat.
    if (!applies && !hits && cat.id !== 'normal') continue;
    if (gen && String(p.gen) !== gen) continue;
    if (type && !p.types.includes(type)) continue;
    if (onlyRegional && !isRegional(p)) continue;
    const [d, t] = applies ? progressOf(p) : [0, 0];
    done += d; total += t;
    if (onlyMissing && (!applies || d === t)) continue;
    visible.push(p.n);
    const cls = !applies ? 'na' : d === t ? 'done' : d ? 'part' : '';
    html.push(`<button class="tile ${cls}" data-n="${p.n}" style="--t:${TYPE_COLOR[p.types[0]]}">
      ${isRegional(p) ? '<i class="rg" title="Regionaal">📍</i>' : ''}${liveByN.has(p.n) ? '<i class="lv" title="Nu live"></i>' : ''}
      ${iconTag(p, cat.shinyImg && !!p.shiny)}
      <span class="num">${num(p.n)}</span><span class="nm">${esc(p.name)}</span>
      ${cat.variant && applies ? `<span class="cnt">${d}/${t}</span>` : ''}</button>`);
  }
  $('#grid').innerHTML = html.join('') || '<p class="empty">Geen Pokémon gevonden met deze filters.</p>';
  $('#bar').style.width = total ? (100 * done / total) + '%' : '0';
  $('#progresstext').textContent = `${cat.label}: ${done} / ${total}${total ? ` · ${Math.round(100 * done / total)}%` : ''}`;
  $('#cathint').textContent = cat.variant ? `Tik op een Pokémon om de afzonderlijke ${cat.label.toLowerCase()} af te vinken.`
    : cat.applies && !hits ? `Je ziet alleen Pokémon waarvoor ${cat.label} bestaat.` : '';
  $('#quick').closest('.quick').hidden = !!cat.variant;
}

function renderStats() {
  $('#stats').innerHTML = CATS.map(c => {
    let d = 0, t = 0;
    for (const p of DATA.pokemon) {
      if (!inCategory(p, c)) continue;
      if (c.variant) { const vs = variantsOf(p, c.variant); t += vs.length; d += vs.filter(v => has(`${p.n}:v:${v.id}`)).length; }
      else { t++; if (has(`${p.n}:${c.id}`)) d++; }
    }
    return `<button class="stat" data-cat="${c.id}"><span class="sl">${c.label}</span><span class="sv">${d} / ${t}</span>
      <span class="sb"><i style="width:${t ? 100 * d / t : 0}%"></i></span></button>`;
  }).join('');
}

/* ---------- Live ---------- */

function liveCard(item, sub, name) {
  const n = liveN(item, name);
  const p = byN.get(n);
  const file = /[^/]+$/.exec(item.image || '');
  const pic = ART ? (p ? iconTag(p) : '') : img([file && DATA.imgBase + file[0], p && iconUrl(p), n && `${SPRITE}${n}.png`]);
  return `<button class="lcard" ${n ? `data-n="${n}"` : 'disabled'}>${pic}
    <b>${esc(item.name)}${item.canBeShiny ? ' <span class="spark" title="Shiny mogelijk">✨</span>' : ''}</b>${sub ? `<span>${sub}</span>` : ''}</button>`;
}
function grouped(list, key) {
  const m = new Map();
  for (const x of list) (m.get(key(x)) || m.set(key(x), []).get(key(x))).push(x);
  return [...m];
}
function renderLive() {
  for (const b of document.querySelectorAll('.seg button')) b.setAttribute('aria-selected', b.dataset.live === liveTab);
  const el = $('#livebody');
  if (live === null) { el.innerHTML = '<p class="empty">Live-gegevens laden…</p>'; return; }
  if (live === false) { el.innerHTML = '<p class="empty">Live-gegevens zijn nu niet bereikbaar.</p><div class="btnrow center"><button class="btn" id="retry">Opnieuw proberen</button></div>'; return; }
  let html = '';
  if (liveTab === 'raids') {
    html = grouped(live.raids, r => r.tier).map(([tier, rs]) => `<h3 class="lgroup">${esc(tierLabel(tier))}</h3><div class="lgrid">${
      rs.map(r => liveCard(r, r.combatPower && r.combatPower.normal ? `CP ${r.combatPower.normal.min}–${r.combatPower.normal.max}` : '')).join('')}</div>`).join('');
  } else if (liveTab === 'eggs') {
    html = grouped(live.eggs, e => e.eggType + (e.isAdventureSync ? ' · Adventure Sync' : e.isGiftExchange ? ' · uit cadeaus' : ''))
      .map(([type, es]) => `<h3 class="lgroup">🥚 ${esc(type)}</h3><div class="lgrid">${
        es.map(e => liveCard(e, e.isRegional ? '📍 regionaal' : '')).join('')}</div>`).join('');
  } else {
    html = live.research.map(t => `<div class="task"><p>${esc(taskText(t))}</p><div class="lgrid">${
      (t.rewards || []).map(r => liveCard(r, '')).join('')}</div></div>`).join('');
  }
  el.innerHTML = (html || '<p class="empty">Niets gevonden.</p>') + `<p class="muted small foot">Bron: LeekDuck (via ScrapedDuck)${liveAt ? ` · bijgewerkt op ${new Date(liveAt).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long' })}` : ''}. ✨ = shiny mogelijk. Tik op een Pokémon voor details.</p>`;
}

let liveAt = ''; // moment waarop de live-gegevens zijn opgehaald (alleen bekend in de artifact-versie)
function setLive(d) {
  live = d ? { raids: d.raids || [], eggs: d.eggs || [], research: d.research || [] } : false;
  liveAt = (d && d.updated) || '';
  if (live) indexLive();
  $('#livestate').className = 'livestate ' + (live ? 'on' : 'off');
  renderLive();
  renderGrid();
  if (sheet) renderSheet(true);
}
async function loadLive() {
  live = null;
  $('#livestate').className = 'livestate';
  renderLive();
  const get = async url => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(r.status);
    return r.json();
  };
  try {
    if (ART) return setLive(await get('live.json'));
    const [raids, eggs, research] = await Promise.all(['raids', 'eggs', 'research'].map(f => get(`${LIVE}${f}.min.json`)));
    setLive({ raids, eggs, research });
  } catch {
    setLive(null);
  }
}

/* ---------- Events ---------- */

function selectView(name) {
  for (const b of document.querySelectorAll('.dex-nav button')) b.setAttribute('aria-current', b.dataset.view === name);
  for (const v of document.querySelectorAll('.view')) v.hidden = v.id !== 'view-' + name;
  if (name === 'meer') renderStats();
  window.scrollTo(0, 0);
}
function setCat(id) {
  cat = CATS.find(c => c.id === id) || CATS[0];
  $('#cat').value = cat.id;
  renderGrid();
}

function wireStage() { // 3D-kantelen van het model
  const body = $('#sheetbody');
  const tilt = (stage, x, y) => {
    const fig = stage.querySelector('.fig');
    fig.style.setProperty('--ry', (x * 32).toFixed(1) + 'deg');
    fig.style.setProperty('--rx', (-y * 16).toFixed(1) + 'deg');
  };
  body.addEventListener('pointermove', e => {
    const stage = e.target.closest('.stage');
    if (!stage) return;
    const r = stage.getBoundingClientRect();
    tilt(stage, ((e.clientX - r.left) / r.width) * 2 - 1, ((e.clientY - r.top) / r.height) * 2 - 1);
  });
  for (const ev of ['pointerleave', 'pointerup', 'pointercancel']) {
    body.addEventListener(ev, e => { const s = e.target.closest && e.target.closest('.stage'); if (s) tilt(s, 0, 0); }, true);
  }
  body.addEventListener('click', e => {
    if (e.target.closest('[data-shiny]')) { sheet.shiny = !sheet.shiny; return renderSheet(true); }
    const vb = e.target.closest('[data-variant]');
    if (vb) {
      const v = sheet.p.variants.find(x => x.id === vb.dataset.variant);
      sheet.variant = sheet.variant === v ? null : v;
      renderSheet(true);
      return $('#sheetbody').scrollTo({ top: 0, behavior: 'smooth' });
    }
    const fig = e.target.closest('.stage') && $('#sheetbody .fig');
    if (fig && !fig.classList.contains('spin')) {
      fig.classList.add('spin');
      fig.addEventListener('animationend', () => fig.classList.remove('spin'), { once: true });
    }
  });
}

function wire() {
  document.querySelector('.dex-nav').addEventListener('click', e => {
    const b = e.target.closest('[data-view]');
    if (b) selectView(b.dataset.view);
  });

  $('#cat').innerHTML = CATS.map(c => `<option value="${c.id}">${c.label}</option>`).join('');
  $('#cat').addEventListener('change', e => setCat(e.target.value));
  $('#type').insertAdjacentHTML('beforeend', Object.keys(TYPES).map(t => `<option value="${t}">${TYPES[t]}</option>`).join(''));
  for (const id of ['#q', '#gen', '#type', '#missing', '#regional']) $(id).addEventListener('input', renderGrid);
  $('#q').addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    e.target.blur();
    if (visible.length === 1) openSheet(byN.get(visible[0]));
  });

  $('#grid').addEventListener('click', e => {
    const tile = e.target.closest('.tile');
    if (!tile) return;
    const p = byN.get(+tile.dataset.n);
    if (!$('#quick').checked || cat.variant || !inCategory(p)) return openSheet(p);
    const key = `${p.n}:${cat.id}`;
    set(key, !has(key));
    if ($('#missing').checked) return renderGrid();
    tile.classList.toggle('done', has(key)); // zonder de hele lijst opnieuw op te bouwen
    const [d, t] = $('#progresstext').textContent.match(/\d+/g).map(Number);
    const nd = d + (has(key) ? 1 : -1);
    $('#bar').style.width = (100 * nd / t) + '%';
    $('#progresstext').textContent = `${cat.label}: ${nd} / ${t} · ${Math.round(100 * nd / t)}%`;
  });

  // Detailscherm
  wireStage();
  const back = () => (ART ? closeSheet() : history.back());
  $('#close').addEventListener('click', back);
  for (const id of ['#prev', '#next']) $(id).addEventListener('click', e => {
    const n = +e.currentTarget.dataset.n;
    if (n) openSheet(byN.get(n));
  });
  addEventListener('popstate', closeSheet);
  addEventListener('keydown', e => { if (e.key === 'Escape' && sheet) back(); });
  document.addEventListener('change', e => {
    if (!e.target.dataset.key) return;
    set(e.target.dataset.key, e.target.checked);
    gridDirty = true;
  });

  // Live
  document.querySelector('.seg').addEventListener('click', e => {
    if (e.target.dataset.live) { liveTab = e.target.dataset.live; renderLive(); }
  });
  $('#livebody').addEventListener('click', e => {
    if (e.target.closest('#retry')) return loadLive();
    const c = e.target.closest('.lcard');
    if (c && c.dataset.n && byN.has(+c.dataset.n)) openSheet(byN.get(+c.dataset.n));
  });
  $('#livestate').addEventListener('click', () => selectView('live'));

  // Voortgang
  $('#stats').addEventListener('click', e => {
    const b = e.target.closest('[data-cat]');
    if (b) { setCat(b.dataset.cat); selectView('dex'); }
  });
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
      renderStats();
    } catch (err) {
      alert('Importeren mislukt: ' + err.message);
    }
  });
}

(async () => {
  try {
    const [d, r] = await Promise.all(['data.json', 'regions.json'].map(async f => {
      const res = await fetch(f);
      if (!res.ok) throw new Error(`${f}: HTTP ${res.status}`);
      return res.json();
    }));
    DATA = d;
    REG = r;
  } catch (err) {
    $('#grid').innerHTML = `<p class="empty">Pokémon-data kon niet geladen worden (${esc(err.message)}).</p>`;
    return;
  }
  let k = 0;
  DATA.pokemon.forEach((p, i) => {
    p.i = i; // plek in de sprite-sheets
    for (const v of p.variants || []) v.k = k++;
    p.search = [p.name, ...p.alt].map(norm);
    byN.set(p.n, p);
  });
  const gens = [...new Set(DATA.pokemon.map(p => p.gen))].sort((a, b) => a - b);
  $('#gen').insertAdjacentHTML('beforeend', gens.map(g => `<option value="${g}">Gen ${g}</option>`).join(''));
  $('#foot').textContent = `Data van ${DATA.built} · bronnen: pokemon-go-api, PoGoAPI.net, LeekDuck (ScrapedDuck), PokeAPI-sprites. ` +
    'Regionale gegevens zijn met de hand bijgehouden. Niet verbonden aan Niantic of The Pokémon Company.';
  wire();
  renderGrid();
  loadLive();
  if (ART) {
    $('#synccard').hidden = false;
    $('#localcards').hidden = true;
    initCloud();
  } else if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
