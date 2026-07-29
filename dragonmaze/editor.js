// Tile editor: place everything that sits on a map — decor, monsters, loot, and
// bosses — per subregion (Map mode), and slice new decor tiles off the art
// sheets with tags (Slice mode). Talks to serve.mjs, which writes
// data/placements.js, assets/tiles/*.png, and data/tile-tags.json.
import { ZONES } from './data/zones.js';
import { PLACEMENTS } from './data/placements.js';
import { MONSTERS, monsterById } from './data/monsters.js';
import { ITEMS, itemById } from './data/items.js';
import { AUTOTILE, autotileKeyAt, allAutotileKeys } from './src/render/autotile.js';

// Geometry tiles (the theme autotile sets) are NOT decor — they're drawn from
// the painted #/./~ map, so they never belong in the decor palette.
const GEOM_KEYS = allAutotileKeys();
const tileRole = (k) => tagMeta[k]?.role ?? (GEOM_KEYS.has(k) ? 'wall' : 'decor');
const isDecorTile = (k) => tileRole(k) === 'decor';

const $ = (id) => document.getElementById(id);
const tileSrc = (k) => `./assets/tiles/${k}.png`;

let TS = 40;
let zone = ZONES[0];
let sub = zone.subregions[0];
let brush = null;        // { kind, key? } — a decor tile, or a bare marker kind
let sel = null;          // { kind, i } — the selected placement
let drag = null;
let mode = 'map';
let tileList = [];       // all decor tile keys
let tagMeta = {};        // { key: { tags, sheet, box } }
let activeTag = 'all';
const place = JSON.parse(JSON.stringify(PLACEMENTS));

// Multi-select + base-tile painting (the editor overhaul).
let cellSel = new Set();      // "x,y" cells shift-selected, to decorate identically
let marquee = null;          // an in-progress shift-drag rectangle
let paint = null;            // the char being drag-painted with a Tile brush
const dirtyMaps = new Set(); // sub ids whose ASCII geometry changed → saved to zones.js

// The five placement lists per subregion. 'decor' is free (w/h/rot, half-tile
// snap); the four marker kinds are 1×1 cells snapped to the grid.
const KINDS = ['decor', 'monsters', 'loot', 'boss', 'miniboss', 'portals'];
const MARKER_KINDS = ['monsters', 'loot', 'boss', 'miniboss', 'portals'];
const MARKERS = [
  { kind: 'monsters', label: '👹 Monster' },
  { kind: 'loot', label: '💰 Treasure' },
  { kind: 'boss', label: '💀 Boss' },
  { kind: 'miniboss', label: '👺 Mini' },
  { kind: 'portals', label: '🕳️ Portal' },
];
// Base-map cells you can paint — the ASCII geometry in zones.js ('.' floor,
// '#' wall, 'S' start, 'E' surface exit). Door digits are appended per region
// from sub.doors. Painting mutates sub.map and persists to zones.js on Save.
const TILE_BRUSHES = [
  { ch: '.', label: 'Floor' },
  { ch: '#', label: 'Wall' },
  { ch: '%', label: 'Invisible wall' }, // draws as floor, blocks movement (collision under decor)
  { ch: 'S', label: 'Start' },
  { ch: 'E', label: 'Exit' },
];

function subPlace() {
  const P = place[sub.id] ?? (place[sub.id] = {});
  for (const k of KINDS) P[k] ??= [];
  return P;
}
function selObj() { return sel ? subPlace()[sel.kind]?.[sel.i] ?? null : null; }
function subById(id) {
  for (const z of ZONES) for (const s of z.subregions) if (s.id === id) return s;
  return null;
}

// Paint one base-map cell. sub.map rows are immutable strings, so we splice a
// fresh row and flag the region dirty. Start is unique — painting a new 'S'
// clears the old one so zones.js keeps exactly one.
function paintCell(x, y, ch) {
  const row = sub.map[y];
  if (row === undefined || x < 0 || x >= row.length) return;
  if (ch === 'S') {
    for (let yy = 0; yy < sub.map.length; yy++) {
      const sx = sub.map[yy].indexOf('S');
      if (sx >= 0) { sub.map[yy] = sub.map[yy].slice(0, sx) + '.' + sub.map[yy].slice(sx + 1); dirtyMaps.add(sub.id); }
    }
  }
  if (sub.map[y][x] === ch) return;
  sub.map[y] = sub.map[y].slice(0, x) + ch + sub.map[y].slice(x + 1);
  dirtyMaps.add(sub.id);
}

// Stamp a brush into every cell of a selection at once — the decorate-identically
// path (shift-select a run of grass, click the grass swatch, done).
function stampIntoCells(cells, b) {
  const P = subPlace();
  for (const c of cells) {
    const [x, y] = c.split(',').map(Number);
    if (b.kind === 'decor') P.decor.push({ key: b.key, x, y, w: deco.w, h: deco.h, rot: deco.rot });
    else if (b.kind === 'tile') paintCell(x, y, b.ch);
    else P[b.kind].push({ x, y });
  }
}

const setStatus = (t) => { $('status').textContent = t; if (t) setTimeout(() => ($('status').textContent === t) && ($('status').textContent = ''), 4000); };

// Sticky decor placement: a freshly dropped tile inherits the last size and
// rotation you set, so laying a run of same-sized tiles (walls!) needs no
// re-adjusting each time. Starts at one grid cell.
let deco = { w: 1, h: 1, rot: 0 };
const syncDeco = (o) => { deco = { w: o.w, h: o.h, rot: o.rot ?? 0 }; };

// ---------------------------------------------------------------- data load
async function loadTiles() {
  tileList = await fetch('/tiles').then((r) => r.json()).catch(() => Object.keys(tagMeta));
  tagMeta = await fetch('./data/tile-tags.json').then((r) => r.json()).catch(() => ({}));
  fillPalette();
}

// Reclassify a tile: 'decor' (placed on top) vs 'wall'/'floor' (geometry painted
// into the map and drawn by the autotiler). Persists to tile-tags.json and
// updates the palette — a tile reclassed as wall/floor leaves the decor list.
async function setTileRole(key, role) {
  const j = await fetch('/set-tile-role', { method: 'POST', body: JSON.stringify({ key, role }) })
    .then((r) => r.json()).catch(() => ({}));
  if (!j.ok) { setStatus('Reclassify failed'); return; }
  tagMeta[key] = tagMeta[key] ?? { tags: [] };
  if (role === 'decor') delete tagMeta[key].role;
  else tagMeta[key].role = role;
  fillPalette();
  setStatus(`"${key}" → ${role}`);
}

// ---------------------------------------------------------------- palette
function allTags() {
  const s = new Set();
  for (const k of Object.keys(tagMeta)) (tagMeta[k].tags || []).forEach((t) => s.add(t));
  return [...s].sort();
}
function fillMarkerbar() {
  $('markerbar').innerHTML = MARKERS
    .map((m) => `<button data-k="${m.kind}" class="${brush?.kind === m.kind ? 'on' : ''}">${m.label}</button>`)
    .join('');
  $('markerbar').querySelectorAll('button').forEach((b) => (b.onclick = () => setBrush({ kind: b.dataset.k })));
}
function fillTilebar() {
  const doors = Object.keys(sub.doors ?? {}).map((d) => ({ ch: d, label: `Door ${d}→${sub.doors[d]}` }));
  const items = [...TILE_BRUSHES, ...doors];
  $('tilebar').innerHTML = items
    .map((t) => `<button data-ch="${t.ch}" class="${brush?.kind === 'tile' && brush.ch === t.ch ? 'on' : ''}">${t.label}</button>`)
    .join('');
  $('tilebar').querySelectorAll('button').forEach((b) => (b.onclick = () => setBrush({ kind: 'tile', ch: b.dataset.ch })));
}
function fillPalette() {
  $('tagfilter').innerHTML = ['all', ...allTags(), 'untagged', 'hidden']
    .map((t) => `<button data-t="${t}" class="${t === activeTag ? 'on' : ''}">${t}</button>`)
    .join('');
  $('tagfilter').querySelectorAll('button').forEach((b) => (b.onclick = () => { activeTag = b.dataset.t; fillPalette(); }));
  // The 'hidden' filter reviews archived (stale) tiles so they can be restored;
  // otherwise show placeable decor, filtered by tag.
  const showHidden = activeTag === 'hidden';
  const keys = tileList.filter((k) => {
    if (showHidden) return tileRole(k) === 'hidden';
    if (!isDecorTile(k)) return false; // geometry is painted, hidden is archived
    if (activeTag === 'all') return true;
    const tg = tagMeta[k]?.tags || [];
    return activeTag === 'untagged' ? tg.length === 0 : tg.includes(activeTag);
  });
  const on = (k) => brush?.kind === 'decor' && brush.key === k;
  const hideBtn = (k) => `<button class="swatch-hide" data-hk="${k}" title="${showHidden ? 'restore to the palette' : 'hide this stale tile from the palette'}">${showHidden ? '↩' : '✕'}</button>`;
  $('swatches').innerHTML = keys
    .map((k) => `<div class="swatch ${on(k) ? 'on' : ''}" data-k="${k}"><img src="${tileSrc(k)}"><span>${k}</span><em>${(tagMeta[k]?.tags || []).join(', ')}</em>${hideBtn(k)}</div>`)
    .join('');
  $('swatches').querySelectorAll('.swatch').forEach((el) => {
    el.onclick = (e) => {
      if (e.target.classList.contains('swatch-hide')) {
        e.stopPropagation();
        setTileRole(e.target.dataset.hk, showHidden ? 'decor' : 'hidden');
        return;
      }
      setBrush({ kind: 'decor', key: el.dataset.k });
    };
  });
}
function setBrush(b) {
  // With a live multi-selection, picking any brush stamps it into every selected
  // cell at once, then clears the selection (decorate-identically).
  if (b && cellSel.size) {
    stampIntoCells(cellSel, b);
    cellSel.clear();
    sel = null;
    fillMarkerbar(); fillTilebar(); fillPalette(); render();
    return;
  }
  const same = brush && b && brush.kind === b.kind && brush.key === b.key && brush.ch === b.ch;
  brush = same ? null : b;
  sel = null;
  fillMarkerbar(); fillTilebar(); fillPalette(); render();
}

// ---------------------------------------------------------------- mode switch
function setMode(m) {
  mode = m;
  const isMap = m === 'map', isSheet = m === 'sheet', isEntity = m === 'enemies' || m === 'items';
  for (const [id, name] of [['mMap', 'map'], ['mSheet', 'sheet'], ['mEnemies', 'enemies'], ['mItems', 'items']])
    $(id).classList.toggle('on', m === name);
  document.querySelector('.maponly').style.display = isMap ? '' : 'none';
  document.querySelector('.sheetonly').style.display = isSheet ? '' : 'none';
  $('palette').style.display = isMap ? '' : 'none';
  $('stagewrap').style.display = isMap ? 'block' : 'none';
  $('sheetview').classList.toggle('on', isSheet);
  $('inspector').style.display = isMap ? 'block' : 'none';
  $('sliceform').style.display = isSheet ? 'block' : 'none';
  $('entityview').classList.toggle('on', isEntity);
  if (isSheet) initSheet();
  if (isEntity) renderEntities();
}
$('mMap').onclick = () => setMode('map');
$('mSheet').onclick = () => setMode('sheet');
$('mEnemies').onclick = () => setMode('enemies');
$('mItems').onclick = () => setMode('items');

// ---------------------------------------------------------------- map: dropdowns
$('zoneSel').onchange = (e) => { zone = ZONES[+e.target.value]; sub = zone.subregions[0]; sel = null; cellSel.clear(); fillRegions(); fillTilebar(); render(); };
$('regionSel').onchange = (e) => { sub = zone.subregions[+e.target.value]; sel = null; cellSel.clear(); fillTilebar(); render(); };
function fillZones() { $('zoneSel').innerHTML = ZONES.map((z, i) => `<option value="${i}">${z.name ?? z.id}</option>`).join(''); }
function fillRegions() { $('regionSel').innerHTML = zone.subregions.map((s, i) => `<option value="${i}">${s.name ?? s.id}</option>`).join(''); }

// ---------------------------------------------------------------- map: stage
const stage = $('stage');
// Build the game's autotiler view of the painted geometry so the editor shows
// the exact walls/floors/water the crawler draws — '#' wall, '~' water, else
// floor. Returns null for themes with no autotiler (they keep CSS base tiles).
function autotileView() {
  const cfg = AUTOTILE[sub.theme];
  if (!cfg) return null;
  const rows = sub.map;
  return {
    cfg,
    d: {
      width: rows[0].length,
      height: rows.length,
      tiles: rows.map((r) => [...r].map((ch) => (ch === '#' ? 0 : 1))),
      water: rows.map((r) => [...r].map((ch) => ch === '~')),
    },
  };
}
function render() {
  const rows = sub.map, H = rows.length, W = rows[0].length;
  const edges = sub.edges ?? {};
  const at = autotileView();
  // Autotiled cells carry their own tile background, so suppress the CSS theme
  // base (which would otherwise paint the flat one-wall/one-floor look).
  stage.dataset.theme = at ? '' : (sub.theme ?? '');
  stage.style.width = W * TS + 'px';
  stage.style.height = H * TS + 'px';
  let html = '';
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const ch = rows[y][x];
    let cls = 'cell ';
    if (ch === '#') cls += 'wall';
    else if ('E123456789'.includes(ch)) cls += 'door';
    else if (ch === '~') cls += 'water';
    else cls += 'floor';
    if (ch === '%') cls += ' inviswall'; // draws as floor + an editor-only hatch
    if (ch === 'S') cls += ' mark';
    if (ch !== '#' && ((x === W - 1 && edges.e) || (x === 0 && edges.w) || (y === H - 1 && edges.s) || (y === 0 && edges.n))) cls += ' edge';
    if (cellSel.has(`${x},${y}`)) cls += ' selcell';
    let style = `left:${x * TS}px;top:${y * TS}px;width:${TS}px;height:${TS}px`;
    if (at) style += `;background:url('${tileSrc(autotileKeyAt(at.cfg, at.d, x, y))}') 0 0/100% 100%`;
    // A badge keeps start/exit/doors legible over the autotiled art.
    const badge = ch === 'S' ? 'S' : ch === 'E' ? 'E' : '0123456789'.includes(ch) ? ch : '';
    html += `<div class="${cls}" style="${style}">${badge ? `<span class="cbadge">${badge}</span>` : ''}</div>`;
  }
  stage.innerHTML = html;
  const P = subPlace();
  P.decor.forEach((t, i) => stage.appendChild(objEl(t, i)));
  for (const kind of MARKER_KINDS) P[kind].forEach((m, i) => stage.appendChild(markerEl(kind, m, i)));
  inspector();
}
function objEl(t, i) {
  const el = document.createElement('div');
  el.className = 'obj' + (sel && sel.kind === 'decor' && sel.i === i ? ' sel' : '');
  el.style.left = t.x * TS + 'px'; el.style.top = t.y * TS + 'px';
  el.style.width = t.w * TS + 'px'; el.style.height = t.h * TS + 'px';
  el.style.zIndex = Math.round((t.y + t.h) * 10);
  el.innerHTML = `<img src="${tileSrc(t.key)}" style="transform:rotate(${t.rot || 0}deg)">`;
  el.dataset.kind = 'decor'; el.dataset.i = i;
  return el;
}
function markerIcon(kind, m) {
  if (kind === 'monsters') return (m.id && monsterById(m.id)?.emoji) || '👹';
  if (kind === 'loot') return m.item ? '💎' : '💰';
  if (kind === 'portals') return '🕳️';
  return kind === 'boss' ? '💀' : '👺';
}
function markerCap(kind, m) {
  if (kind === 'monsters') return m.id ? (monsterById(m.id)?.name ?? m.id) : 'roll';
  if (kind === 'loot') return m.item ? (itemById(m.item)?.name ?? m.item) : 'roll';
  if (kind === 'portals') return m.to ? (subById(m.to)?.name ?? m.to) : '⚠ set dest';
  if (kind === 'boss') return sub.boss ? 'boss' : '⚠ none';
  return sub.miniboss ? 'mini' : '⚠ none';
}
function markerEl(kind, m, i) {
  const el = document.createElement('div');
  el.className = `marker ${kind}` + (sel && sel.kind === kind && sel.i === i ? ' sel' : '');
  el.style.left = m.x * TS + 'px'; el.style.top = m.y * TS + 'px';
  el.style.width = TS + 'px'; el.style.height = TS + 'px';
  el.style.zIndex = 1000 + m.y;
  // Treasure shows the loose gold-coins art (matching the in-game tile), which
  // reverts to bare grass once collected; other markers keep an emoji glyph.
  const ico = kind === 'loot'
    ? `<img class="ico-img" src="${tileSrc('courtyard-gold-pile')}" alt="treasure">`
    : `<span class="ico">${markerIcon(kind, m)}</span>`;
  el.innerHTML = `${ico}<span class="cap">${markerCap(kind, m)}</span>`;
  el.dataset.kind = kind; el.dataset.i = i;
  return el;
}
function placeBrush(x, y) {
  const P = subPlace();
  if (brush.kind === 'decor') { P.decor.push({ key: brush.key, x, y, w: deco.w, h: deco.h, rot: deco.rot }); sel = { kind: 'decor', i: P.decor.length - 1 }; }
  else if (brush.kind === 'tile') { paintCell(x, y, brush.ch); sel = null; }
  else { P[brush.kind].push({ x, y }); sel = { kind: brush.kind, i: P[brush.kind].length - 1 }; }
}
const cellAt = (e) => {
  const rect = stage.getBoundingClientRect();
  return { cx: (e.clientX - rect.left) / TS, cy: (e.clientY - rect.top) / TS };
};
// Recompute the shift-selection from the pre-drag snapshot plus the current
// rectangle, so dragging out and back doesn't leave stale cells behind.
function applyMarquee(x1, y1) {
  cellSel = new Set(marquee.base);
  const xa = Math.min(marquee.x0, x1), xb = Math.max(marquee.x0, x1);
  const ya = Math.min(marquee.y0, y1), yb = Math.max(marquee.y0, y1);
  for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
    const k = `${x},${y}`;
    if (marquee.add) cellSel.add(k); else cellSel.delete(k);
  }
}
const capture = (id) => { try { stage.setPointerCapture(id); } catch {} };
stage.addEventListener('pointerdown', (e) => {
  const { cx, cy } = cellAt(e);
  const gx = Math.floor(cx), gy = Math.floor(cy);
  if (e.shiftKey) { // build/trim a multi-cell selection; drag out a rectangle
    marquee = { x0: gx, y0: gy, add: !cellSel.has(`${gx},${gy}`), base: new Set(cellSel) };
    applyMarquee(gx, gy);
    render();
    capture(e.pointerId);
    return;
  }
  // With a placement brush active, a click PLACES/paints — it must not be
  // swallowed by decor sitting under the cursor. That interception was the bug
  // that made monsters, treasure, and entrances un-placeable over a decorated
  // map (every click hit a decor tile and just selected it).
  if (brush) {
    placeBrush(gx, gy);
    if (brush.kind === 'tile') { paint = brush.ch; render(); capture(e.pointerId); return; }
    render();
    const o = selObj(); if (!o) return;
    drag = { ox: cx - o.x, oy: cy - o.y, el: stage.querySelector('.obj.sel, .marker.sel') };
    capture(e.pointerId);
    return;
  }
  // No brush: click selects an existing placement to move/edit, or clears.
  const hit = e.target.closest('.obj, .marker');
  if (hit) sel = { kind: hit.dataset.kind, i: +hit.dataset.i };
  else { sel = null; if (cellSel.size) cellSel.clear(); render(); return; }
  render();
  const o = selObj(); if (!o) return;
  drag = { ox: cx - o.x, oy: cy - o.y, el: stage.querySelector('.obj.sel, .marker.sel') };
  capture(e.pointerId);
});
stage.addEventListener('pointermove', (e) => {
  const { cx, cy } = cellAt(e);
  if (marquee) { applyMarquee(Math.floor(cx), Math.floor(cy)); render(); return; }
  if (paint != null) { paintCell(Math.floor(cx), Math.floor(cy), paint); render(); return; }
  if (!drag) return;
  const o = selObj(); if (!o) return;
  const snap = sel.kind === 'decor' ? 2 : 1; // half-tile for decor, whole cells for markers
  o.x = Math.round((cx - drag.ox) * snap) / snap;
  o.y = Math.round((cy - drag.oy) * snap) / snap;
  drag.el.style.left = o.x * TS + 'px'; drag.el.style.top = o.y * TS + 'px';
});
stage.addEventListener('pointerup', () => {
  if (marquee) { marquee = null; render(); }
  if (paint != null) { paint = null; render(); }
  if (drag) { drag = null; render(); }
});

// map: inspector
function inspector() {
  const box = $('inspector');
  const o = selObj();
  if (!o) {
    if (cellSel.size) {
      box.innerHTML = `<h3>${cellSel.size} tile(s) selected</h3><div class="hint">Now click a <b>Paint base tile</b>, an <b>Add to map</b> marker, or a <b>Decor</b> swatch — it fills every selected tile identically.<br><br><kbd>Shift</kbd>-click toggles a tile · shift-drag selects a rectangle · <kbd>Esc</kbd> clears.</div>`;
      return;
    }
    box.innerHTML = regionPanelHtml();
    return;
  }
  if (sel.kind === 'decor') {
    box.innerHTML = `
      <h3>${o.key}</h3>
      <div class="row"><label>Tile</label><select id="tileSwap">
        ${tileList.map((k) => `<option value="${k}" ${k === o.key ? 'selected' : ''}>${k}</option>`).join('')}
      </select></div>
      <div class="row"><label>Class</label><select id="tileRole">
        <option value="decor">decor (on top)</option>
        <option value="wall">wall tile (geometry)</option>
        <option value="floor">floor tile (geometry)</option>
        <option value="hidden">hidden (stale — off palette)</option>
      </select></div>
      <div class="row"><label>Rotate</label><button data-a="rot">⟳ ${o.rot || 0}°</button></div>
      <div class="row"><label>Width</label><button data-a="w-">−</button><span class="val">${o.w}</span><button data-a="w+">+</button></div>
      <div class="row"><label>Height</label><button data-a="h-">−</button><span class="val">${o.h}</span><button data-a="h+">+</button></div>
      <div class="row"><label>X</label><input type="number" step="0.5" value="${o.x}" data-a="x"></div>
      <div class="row"><label>Y</label><input type="number" step="0.5" value="${o.y}" data-a="y"></div>
      <button class="bigbtn del" data-a="del">Delete decor</button>`;
  } else if (sel.kind === 'monsters') {
    box.innerHTML = `
      <h3>👹 Monster</h3>
      ${xyRows(o)}
      <div class="row"><label>Who</label><select id="pin">
        <option value="">↻ random (region table)</option>
        ${MONSTERS.map((m) => `<option value="${m.id}" ${o.id === m.id ? 'selected' : ''}>${m.emoji ?? ''} ${m.name}</option>`).join('')}
      </select></div>
      <div class="hint">Random rolls a fresh pack from this region each visit. Pin one to fix it.</div>
      <button class="bigbtn del" data-a="del">Delete monster</button>`;
  } else if (sel.kind === 'loot') {
    box.innerHTML = `
      <h3>💰 Treasure</h3>
      ${xyRows(o)}
      <div class="row"><label>Holds</label><select id="pin">
        <option value="">↻ random (gold / tome / den)</option>
        ${ITEMS.map((it) => `<option value="${it.id}" ${o.item === it.id ? 'selected' : ''}>${it.name}</option>`).join('')}
      </select></div>
      <div class="hint">Random rolls gold or a rare find. Pin a magic item to make this a fixed reward.</div>
      <button class="bigbtn del" data-a="del">Delete treasure</button>`;
  } else if (sel.kind === 'portals') {
    box.innerHTML = `
      <h3>🕳️ Portal</h3>
      ${xyRows(o)}
      <div class="row"><label>To</label><select id="pdest">
        <option value="">⚠ set destination</option>
        ${zone.subregions.map((s) => `<option value="${s.id}" ${o.to === s.id ? 'selected' : ''}>${s.name ?? s.id}</option>`).join('')}
      </select></div>
      <div class="row"><label>Title</label><input id="ptitle" placeholder="The Sunken Well"></div>
      <div class="row"><label>Prompt</label><input id="plabel" placeholder="Climb down into the well?"></div>
      <div class="hint">Walking onto this tile asks the player before travelling to the chosen region — put it under the well/stairs art so the two move together.</div>
      <button class="bigbtn del" data-a="del">Delete portal</button>`;
    box.querySelector('#ptitle').value = o.title ?? '';
    box.querySelector('#plabel').value = o.label ?? '';
  } else {
    const def = sel.kind === 'boss' ? sub.boss : sub.miniboss;
    box.innerHTML = `
      <h3>${sel.kind === 'boss' ? '💀 Boss' : '👺 Miniboss'}</h3>
      ${xyRows(o)}
      <div class="row"><label>Pack</label><span class="hint" style="margin:0">${def?.name ?? '⚠ none defined'}</span></div>
      <div class="hint">${def ? `Spawns this region's fixed ${sel.kind} pack (its name + drops live in zones.js).` : `This region defines no ${sel.kind}, so the marker spawns nothing at runtime.`}</div>
      <button class="bigbtn del" data-a="del">Delete ${sel.kind === 'boss' ? 'boss' : 'miniboss'}</button>`;
  }
  box.querySelectorAll('[data-a]').forEach((el) => {
    const a = el.dataset.a;
    if (el.tagName === 'INPUT') el.onchange = () => { o[a] = parseFloat(el.value) || 0; render(); };
    else el.onclick = () => act(a);
  });
  const pin = box.querySelector('#pin');
  if (pin) pin.onchange = () => { if (sel.kind === 'monsters') o.id = pin.value || undefined; else o.item = pin.value || undefined; render(); };
  const swap = box.querySelector('#tileSwap');
  if (swap) swap.onchange = () => { o.key = swap.value; render(); };
  const roleSel = box.querySelector('#tileRole');
  if (roleSel) { roleSel.value = tileRole(o.key); roleSel.onchange = () => setTileRole(o.key, roleSel.value); }
  const dest = box.querySelector('#pdest');
  if (dest) dest.onchange = () => { o.to = dest.value || undefined; render(); };
  const ptitle = box.querySelector('#ptitle');
  if (ptitle) ptitle.oninput = () => { o.title = ptitle.value.trim() || undefined; };
  const plabel = box.querySelector('#plabel');
  if (plabel) plabel.oninput = () => { o.label = plabel.value.trim() || undefined; };
}
function xyRows(o) {
  return `<div class="row"><label>X</label><input type="number" step="1" value="${o.x}" data-a="x"></div>
      <div class="row"><label>Y</label><input type="number" step="1" value="${o.y}" data-a="y"></div>`;
}
function act(a) {
  const o = selObj(); if (!o) return;
  if (a === 'del') { subPlace()[sel.kind].splice(sel.i, 1); sel = null; }
  else if (sel.kind === 'decor') {
    if (a === 'rot') o.rot = ((o.rot || 0) + 90) % 360;
    else if (a === 'w-') o.w = Math.max(0.5, o.w - 0.5);
    else if (a === 'w+') o.w += 0.5;
    else if (a === 'h-') o.h = Math.max(0.5, o.h - 0.5);
    else if (a === 'h+') o.h += 0.5;
    syncDeco(o); // remember this size/rotation for the next decor placed
  }
  render();
}
document.addEventListener('keydown', (e) => {
  if (mode !== 'map' || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (e.key === 'Escape') { cellSel.clear(); sel = null; brush = null; fillMarkerbar(); fillTilebar(); fillPalette(); render(); return; }
  const o = selObj(); if (!o) return;
  const step = sel.kind === 'decor' ? 0.5 : 1;
  if (e.key === 'ArrowLeft') o.x -= step;
  else if (e.key === 'ArrowRight') o.x += step;
  else if (e.key === 'ArrowUp') o.y -= step;
  else if (e.key === 'ArrowDown') o.y += step;
  else if ((e.key === 'r' || e.key === 'R') && sel.kind === 'decor') act('rot');
  else if (e.key === 'Delete' || e.key === 'Backspace') act('del');
  else if (e.key === '[' && sel.kind === 'decor') { o.w = Math.max(0.5, o.w - 0.5); o.h = Math.max(0.5, o.h - 0.5); syncDeco(o); }
  else if (e.key === ']' && sel.kind === 'decor') { o.w += 0.5; o.h += 0.5; syncDeco(o); }
  else return;
  e.preventDefault(); render();
});
$('scaleDown').onclick = () => { TS = Math.max(16, TS - 6); render(); };
$('scaleUp').onclick = () => { TS = Math.min(80, TS + 6); render(); };
$('saveBtn').onclick = async () => {
  const out = {};
  for (const [id, P] of Object.entries(place)) {
    const kept = {};
    for (const k of KINDS) if (P[k]?.length) kept[k] = P[k];
    if (Object.keys(kept).length) out[id] = kept;
  }
  try {
    const j = await fetch('/save-placements', { method: 'POST', body: JSON.stringify(out) }).then((r) => r.json());
    if (!j.ok) { setStatus('Save failed'); return; }
    let msg = `Saved ${j.regions} region(s)`;
    let last = j;
    // Painted geometry goes back to zones.js in the same Save.
    if (dirtyMaps.size) {
      const maps = {};
      for (const id of dirtyMaps) { const s = subById(id); if (s) maps[id] = s.map; }
      const jm = await fetch('/save-map', { method: 'POST', body: JSON.stringify(maps) }).then((r) => r.json());
      if (!jm.ok) { setStatus('Map save failed: ' + (jm.error || 'see server log')); return; }
      dirtyMaps.clear(); msg += ` + ${jm.regions} map(s)`; last = jm;
    }
    // The server rebuilds dragon.html on save, so edits are live in-game at once.
    msg += last.built ? ' + rebuilt ✓' : last.buildError ? ` ✓ (rebuild failed: ${last.buildError})` : ' ✓';
    setStatus(msg);
  } catch { setStatus('Save failed — is the dev server running?'); }
};

// ---------------------------------------------------------------- sheet slicer
let sheetScale = 1;
let selBox = null;      // { x, y, w, h } in sheet px
let boxes = [];
async function initSheet() {
  if ($('sheetSel').children.length === 0) {
    const sheets = await fetch('/sheets').then((r) => r.json()).catch(() => []);
    $('sheetSel').innerHTML = sheets.map((s) => `<option>${s}</option>`).join('');
  }
  sliceForm();
}
$('detectBtn').onclick = async () => {
  const sheet = $('sheetSel').value;
  const img = $('sheetimg');
  img.src = `./art/${sheet}`;
  await img.decode().catch(() => {});
  const wrap = $('sheetwrap');
  const maxW = $('sheetview').clientWidth - 40;
  sheetScale = Math.min(1, maxW / img.naturalWidth);
  img.style.width = img.naturalWidth * sheetScale + 'px';
  setStatus('Detecting…');
  const j = await fetch('/detect', { method: 'POST', body: JSON.stringify({ sheet }) }).then((r) => r.json()).catch(() => ({}));
  boxes = j.boxes || [];
  wrap.querySelectorAll('.box').forEach((b) => b.remove());
  boxes.forEach((b) => {
    const el = document.createElement('div');
    el.className = 'box';
    el.style.left = b.x * sheetScale + 'px'; el.style.top = b.y * sheetScale + 'px';
    el.style.width = b.w * sheetScale + 'px'; el.style.height = b.h * sheetScale + 'px';
    el.onclick = () => selectBox(b, el);
    wrap.appendChild(el);
  });
  setStatus(`${boxes.length} objects — click one, or drag your own box`);
};
function selectBox(b, el) {
  selBox = { ...b };
  $('sheetwrap').querySelectorAll('.box').forEach((e) => e.classList.remove('sel'));
  if (el) el.classList.add('sel');
  sliceForm();
}
// drag a custom box on the sheet
let draw = null;
$('sheetwrap').addEventListener('pointerdown', (e) => {
  if (e.target.classList.contains('box')) return;
  const r = $('sheetimg').getBoundingClientRect();
  draw = { sx: (e.clientX - r.left) / sheetScale, sy: (e.clientY - r.top) / sheetScale, el: null };
});
$('sheetwrap').addEventListener('pointermove', (e) => {
  if (!draw) return;
  const r = $('sheetimg').getBoundingClientRect();
  const cx = (e.clientX - r.left) / sheetScale, cy = (e.clientY - r.top) / sheetScale;
  const x = Math.min(draw.sx, cx), y = Math.min(draw.sy, cy), w = Math.abs(cx - draw.sx), h = Math.abs(cy - draw.sy);
  if (!draw.el) { draw.el = document.createElement('div'); draw.el.className = 'box sel'; $('sheetwrap').appendChild(draw.el); }
  Object.assign(draw.el.style, { left: x * sheetScale + 'px', top: y * sheetScale + 'px', width: w * sheetScale + 'px', height: h * sheetScale + 'px' });
  selBox = { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
});
$('sheetwrap').addEventListener('pointerup', () => { if (draw && selBox) sliceForm(); draw = null; });

function sliceForm() {
  const box = $('sliceform');
  if (!selBox) { box.innerHTML = `<h3>Slice a tile</h3><div class="hint">Pick a sheet up top and hit <b>Detect objects</b>. Click a detected box (or drag your own), name it, tag it, and Slice — it drops into your palette.</div>`; return; }
  box.innerHTML = `
    <h3>New tile</h3>
    <div class="row"><label>Box</label><span class="hint" style="margin:0">${selBox.x},${selBox.y} · ${selBox.w}×${selBox.h}</span></div>
    <div class="row"><label>Name</label><input id="tName" placeholder="e.g. altar" autocomplete="off"></div>
    <div class="row"><label>Tags</label><input id="tTags" placeholder="statue, boss" autocomplete="off"></div>
    <button class="bigbtn go" id="sliceGo">Slice tile</button>
    <div class="hint">Suggested tags: ${allTags().map((t) => `<kbd class="sug">${t}</kbd>`).join(' ') || '—'}</div>`;
  box.querySelectorAll('.sug').forEach((k) => (k.onclick = () => { const i = $('tTags'); i.value = (i.value ? i.value + ', ' : '') + k.textContent; }));
  $('sliceGo').onclick = doSlice;
}
async function doSlice() {
  const name = $('tName').value.trim();
  const tags = $('tTags').value.split(',').map((s) => s.trim()).filter(Boolean);
  if (!name || !selBox) { setStatus('Name and a box are required'); return; }
  const slug = name.replace(/[^a-z0-9-]/gi, '').toLowerCase();
  if (tileList.includes(slug) && !confirm(`A tile named "${slug}" already exists — overwrite it?`)) return;
  setStatus('Slicing…');
  const j = await fetch('/slice', { method: 'POST', body: JSON.stringify({ sheet: $('sheetSel').value, name, box: [selBox.x, selBox.y, selBox.w, selBox.h], tags }) }).then((r) => r.json()).catch(() => ({}));
  if (j.ok) { await loadTiles(); setStatus(`Sliced "${j.name}" ✓ — in the palette`); selBox = null; $('sheetwrap').querySelectorAll('.box.sel').forEach((e) => e.remove()); sliceForm(); }
  else setStatus('Slice failed: ' + (j.error || 'see server log'));
}

// ---------------------------------------------------------------- enemies / items editor
// Edit the definitions behind the monster/loot brushes. Saves POST to serve.mjs,
// which surgically rewrites data/monsters.js or data/items.js and rebuilds. We
// also patch the in-memory MONSTERS/ITEMS so the map-mode pin dropdowns update
// without a reload.
let entitySel = null;   // id being edited, or '__new__'
let entityDraft = null; // working copy shown in the form

const numOrU = (v) => (v === '' || v == null ? undefined : Number(v));
const strOrU = (v) => { v = (v ?? '').trim(); return v || undefined; };
const listOrU = (v) => { const a = (v ?? '').split(',').map((s) => s.trim()).filter(Boolean); return a.length ? a : undefined; };
const slug = (s) => String(s ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const esc = (s) => String(s ?? '').replace(/"/g, '&quot;');
const entHint = (t) => { const el = $('entHint'); if (el) el.textContent = t; };

// A labeled input or select. opts: {type, step, options:[val|[val,label]], readonly}.
function fld(label, id, value, opts = {}) {
  const v = value ?? '';
  if (opts.options) {
    const os = opts.options.map((o) => { const [ov, ol] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(ov)}" ${String(ov) === String(v) ? 'selected' : ''}>${ol}</option>`; }).join('');
    return `<label class="field">${label}<select id="${id}">${os}</select></label>`;
  }
  return `<label class="field">${label}<input id="${id}" type="${opts.type || 'text'}"${opts.step ? ` step="${opts.step}"` : ''}${opts.readonly ? ' readonly' : ''} value="${esc(v)}"></label>`;
}

function blankMonster() {
  return { id: '', name: '', kind: 'monster', ac: 12, hpMax: 6, abilities: { str: 0, dex: 0, con: 0, int: -2, wis: 0, cha: -2 },
    attacks: [{ name: 'strike', toHit: 2, damage: '1d6', range: 'melee' }], emoji: '👾', faction: 'wild', parley: 'never',
    minDepth: 1, packMax: 2, weight: 1, morale: 2 };
}
function blankItem() { return { id: '', name: '', slot: 'weapon', zone: '', mods: {}, blurb: '' }; }

function renderEntities() { renderEntityList(); renderEntityForm(); }

function renderEntityList() {
  const isEnemy = mode === 'enemies';
  const list = isEnemy ? MONSTERS : ITEMS;
  const q = ($('entSearch')?.value || '').toLowerCase();
  const rows = list.filter((e) => !q || e.name.toLowerCase().includes(q) || e.id.includes(q));
  $('entityList').innerHTML =
    `<div class="elhead"><b>${isEnemy ? 'Enemies' : 'Items'} (${list.length})</b><button id="entNew">+ New</button></div>` +
    `<div class="elhead"><input id="entSearch" placeholder="search…" value="${esc($('entSearch')?.value || '')}" autocomplete="off"></div>` +
    rows.map((e) => `<div class="erow ${entitySel === e.id ? 'on' : ''}" data-id="${e.id}">${isEnemy ? (e.emoji ?? '👹') : '💎'} ${e.name}</div>`).join('');
  $('entNew').onclick = () => { entitySel = '__new__'; entityDraft = isEnemy ? blankMonster() : blankItem(); renderEntities(); };
  $('entSearch').oninput = () => renderEntityList();
  $('entityList').querySelectorAll('.erow').forEach((el) => (el.onclick = () => {
    entitySel = el.dataset.id; entityDraft = structuredClone((isEnemy ? MONSTERS : ITEMS).find((x) => x.id === el.dataset.id)); renderEntityForm(); renderEntityList();
  }));
}

function renderEntityForm() {
  const isEnemy = mode === 'enemies';
  if (!entityDraft) { $('entityForm').innerHTML = `<div class="hint">Pick ${isEnemy ? 'an enemy' : 'an item'} on the left to edit its name and stats, or <b>+ New</b> to create one. Saving writes to data/${isEnemy ? 'monsters' : 'items'}.js and rebuilds the game.</div>`; return; }
  const isNew = entitySel === '__new__';
  $('entityForm').innerHTML = isEnemy ? monsterFormHtml(entityDraft, isNew) : itemFormHtml(entityDraft, isNew);
  bindEntityForm(isNew);
}

function attackRow(a, i) {
  return `<div class="arow" data-i="${i}">
    ${fld('attack', `a_name_${i}`, a.name)}
    ${fld('to hit', `a_hit_${i}`, a.toHit, { type: 'number' })}
    ${fld('damage', `a_dmg_${i}`, a.damage)}
    ${fld('range', `a_rng_${i}`, a.range || 'melee', { options: ['melee', 'ranged'] })}
    <button class="arowdel" data-i="${i}" title="remove attack">✕</button></div>`;
}

function monsterFormHtml(m, isNew) {
  const ab = m.abilities || {};
  const atk = m.attacks?.length ? m.attacks : [{ name: 'strike', toHit: 0, damage: '1d6', range: 'melee' }];
  return `<h3 style="margin-top:0">${isNew ? 'New enemy' : m.name}</h3>
    <div class="fgrid">
      ${fld('id', 'm_id', m.id, { readonly: !isNew })}
      ${fld('name', 'm_name', m.name)}
      ${fld('emoji', 'm_emoji', m.emoji)}
      ${fld('AC', 'm_ac', m.ac, { type: 'number' })}
      ${fld('HP max', 'm_hp', m.hpMax, { type: 'number' })}
      ${fld('faction', 'm_faction', m.faction)}
      ${fld('parley', 'm_parley', m.parley, { options: ['willing', 'wary', 'never'] })}
      ${fld('min depth', 'm_min', m.minDepth, { type: 'number' })}
      ${fld('max depth', 'm_max', m.maxDepth, { type: 'number' })}
      ${fld('pack max', 'm_pack', m.packMax, { type: 'number' })}
      ${fld('weight', 'm_weight', m.weight, { type: 'number' })}
      ${fld('gold', 'm_gold', m.goldValue, { type: 'number' })}
      ${fld('morale (blank=fearless)', 'm_morale', m.morale, { type: 'number' })}
    </div>
    <div class="fsection"><b>Abilities</b><div class="fgrid">
      ${['str', 'dex', 'con', 'int', 'wis', 'cha'].map((k) => fld(k.toUpperCase(), `m_ab_${k}`, ab[k] ?? 0, { type: 'number' })).join('')}
    </div></div>
    <div class="fsection"><b>Attacks</b><div id="m_attacks">${atk.map(attackRow).join('')}</div>
      <button class="minibtn" id="m_addatk">+ attack</button></div>
    <div class="fsection"><b>Traits</b><div class="fgrid">
      ${fld('special', 'm_ability', m.ability, { options: [['', '— none —'], 'regenerate', 'relentless', 'lifedrain'] })}
      ${fld('resist (csv)', 'm_resist', (m.resist || []).join(', '))}
      ${fld('vulnerable (csv)', 'm_vuln', (m.vulnerable || []).join(', '))}
      ${fld('sprite', 'm_sprite', m.sprite)}
      ${fld('anim idle', 'm_idle', m.anim?.idle)}
      ${fld('anim attack', 'm_atk', m.anim?.attack)}
    </div>
      <label class="chk"><input type="checkbox" id="m_facesLeft" ${m.facesLeft ? 'checked' : ''}> art already faces left</label>
      <label class="chk"><input type="checkbox" id="m_patrol" ${m.patrol ? 'checked' : ''}> patrols / gives chase</label>
    </div>
    <div class="fsection"><label class="chk"><input type="checkbox" id="m_caster" ${m.castStat ? 'checked' : ''}> <b>spellcaster</b></label>
      <div id="m_castbox" class="fgrid" style="${m.castStat ? '' : 'display:none'}">
        ${fld('cast stat', 'm_caststat', m.castStat || 'wis', { options: ['str', 'dex', 'con', 'int', 'wis', 'cha'] })}
        ${fld('spell name', 'm_castname', m.cast?.name)}
        ${fld('tier', 'm_casttier', m.cast?.tier, { type: 'number' })}
        ${fld('kind', 'm_castkind', m.cast?.kind, { options: ['bolt', 'heal', 'drain', 'daze'] })}
        ${fld('dice', 'm_castdice', m.cast?.dice)}
        ${fld('chance', 'm_castchance', m.cast?.chance, { type: 'number', step: '0.05' })}
      </div></div>
    <button class="bigbtn go" id="entSave">Save enemy</button>
    <div class="hint" id="entHint"></div>`;
}

function itemFormHtml(it, isNew) {
  const mods = it.mods || {};
  const zones = [...new Set(ITEMS.map((i) => i.zone).filter(Boolean))].sort();
  return `<h3 style="margin-top:0">${isNew ? 'New item' : it.name}</h3>
    <div class="fgrid">
      ${fld('id', 'i_id', it.id, { readonly: !isNew })}
      ${fld('name', 'i_name', it.name)}
      ${fld('slot', 'i_slot', it.slot, { options: ['weapon', 'armor', 'trinket'] })}
      ${fld('zone', 'i_zone', it.zone, { options: [['', '—'], ...zones] })}
      ${fld('bane', 'i_bane', it.bane, { options: [['', '— none —'], 'undead'] })}
    </div>
    <div class="fsection"><b>Stat mods (blank = none)</b><div class="fgrid">
      ${fld('to hit', 'i_toHit', mods.toHit, { type: 'number' })}
      ${fld('damage', 'i_damage', mods.damage, { type: 'number' })}
      ${fld('AC', 'i_ac', mods.ac, { type: 'number' })}
      ${fld('HP max', 'i_hp', mods.hpMax, { type: 'number' })}
      ${fld('init', 'i_init', mods.init, { type: 'number' })}
    </div></div>
    <label class="field" style="margin-top:12px">blurb<input id="i_blurb" value="${esc(it.blurb)}" autocomplete="off"></label>
    <button class="bigbtn go" id="entSave" style="margin-top:12px">Save item</button>
    <div class="hint" id="entHint"></div>`;
}

function bindEntityForm(isNew) {
  $('entSave').onclick = saveEntity;
  if (mode !== 'enemies') return;
  $('m_caster').onchange = (e) => ($('m_castbox').style.display = e.target.checked ? '' : 'none');
  $('m_addatk').onclick = () => { entityDraft = readMonsterForm(isNew); entityDraft.attacks.push({ name: 'strike', toHit: 0, damage: '1d6', range: 'melee' }); renderEntityForm(); };
  $('entityForm').querySelectorAll('.arowdel').forEach((b) => (b.onclick = () => { entityDraft = readMonsterForm(isNew); entityDraft.attacks.splice(+b.dataset.i, 1); if (!entityDraft.attacks.length) entityDraft.attacks.push({ name: 'strike', toHit: 0, damage: '1d6', range: 'melee' }); renderEntityForm(); }));
}

function readMonsterForm(isNew) {
  const V = (id) => $(id)?.value;
  const abilities = {};
  ['str', 'dex', 'con', 'int', 'wis', 'cha'].forEach((k) => (abilities[k] = Number(V(`m_ab_${k}`)) || 0));
  const attacks = [...$('m_attacks').querySelectorAll('.arow')].map((row) => {
    const i = row.dataset.i;
    return { name: strOrU(V(`a_name_${i}`)) || 'attack', toHit: Number(V(`a_hit_${i}`)) || 0, damage: strOrU(V(`a_dmg_${i}`)) || '1d4', range: V(`a_rng_${i}`) || 'melee' };
  });
  const m = {
    id: isNew ? (slug(V('m_id')) || slug(V('m_name'))) : entityDraft.id,
    name: strOrU(V('m_name')) || 'Unnamed', kind: 'monster',
    ac: Number(V('m_ac')) || 10, hpMax: Number(V('m_hp')) || 1, abilities, attacks,
    emoji: strOrU(V('m_emoji')), faction: strOrU(V('m_faction')), parley: V('m_parley'),
    goldValue: numOrU(V('m_gold')), minDepth: numOrU(V('m_min')), maxDepth: numOrU(V('m_max')),
    packMax: numOrU(V('m_pack')), weight: numOrU(V('m_weight')),
    morale: V('m_morale') === '' ? null : Number(V('m_morale')),
    ability: strOrU(V('m_ability')), resist: listOrU(V('m_resist')), vulnerable: listOrU(V('m_vuln')),
    sprite: strOrU(V('m_sprite')),
    anim: (strOrU(V('m_idle')) || strOrU(V('m_atk'))) ? { idle: strOrU(V('m_idle')), attack: strOrU(V('m_atk')) } : undefined,
    facesLeft: $('m_facesLeft').checked || undefined, patrol: $('m_patrol').checked || undefined,
  };
  if ($('m_caster').checked) {
    m.castStat = V('m_caststat');
    m.cast = { name: strOrU(V('m_castname')) || 'Spell', tier: Number(V('m_casttier')) || 1, kind: V('m_castkind') || 'bolt', dice: strOrU(V('m_castdice')) || '1d6', chance: Number(V('m_castchance')) || 0.4 };
  }
  return m;
}

function readItemForm(isNew) {
  const V = (id) => $(id)?.value;
  const mods = {};
  for (const [k, f] of [['toHit', 'i_toHit'], ['damage', 'i_damage'], ['ac', 'i_ac'], ['hpMax', 'i_hp'], ['init', 'i_init']]) {
    const n = numOrU(V(f)); if (n !== undefined) mods[k] = n;
  }
  return {
    id: isNew ? (slug(V('i_id')) || slug(V('i_name'))) : entityDraft.id,
    name: strOrU(V('i_name')) || 'Unnamed', slot: V('i_slot'), zone: strOrU(V('i_zone')),
    mods, bane: strOrU(V('i_bane')), blurb: strOrU(V('i_blurb')),
  };
}

async function saveEntity() {
  const isEnemy = mode === 'enemies';
  const isNew = entitySel === '__new__';
  const obj = isEnemy ? readMonsterForm(isNew) : readItemForm(isNew);
  const arr = isEnemy ? MONSTERS : ITEMS;
  if (!obj.id) { entHint('An id (or name) is required.'); return; }
  if (isNew && arr.some((e) => e.id === obj.id)) { entHint(`id "${obj.id}" already exists — pick another.`); return; }
  setStatus('Saving…'); entHint('');
  const j = await fetch(isEnemy ? '/save-monster' : '/save-item', { method: 'POST', body: JSON.stringify(obj) }).then((r) => r.json()).catch(() => ({}));
  if (!j.ok) { entHint('Save failed: ' + (j.error || 'see server log')); setStatus('Save failed'); return; }
  const i = arr.findIndex((e) => e.id === obj.id);
  if (i >= 0) arr[i] = obj; else arr.push(obj);
  entitySel = obj.id; entityDraft = structuredClone(obj);
  setStatus(`Saved ${obj.id} ✓${j.built === false ? ' (rebuild failed — see log)' : ''}`);
  renderEntities();
}

// ---------------------------------------------------------------- region editor
// When no placement is selected, the inspector shows the current region's config:
// its random-encounter table, and its boss/miniboss packs — each saved to
// zones.js independently (POST /save-zone-table | /save-zone-boss). A transient
// `regionDraft` holds edits (add/remove rows) until Save; it's re-seeded from the
// live sub whenever the region changes.
const INSPECTOR_HELP =
  '<b>Paint base tile</b> — click/drag to lay floor, wall, start, exit or a door (saved to zones.js). ' +
  '<b>Invisible wall</b> draws as floor but blocks movement — put it under a statue or rubble.<br><br>' +
  '<b>Add to map</b> or a <b>Decor</b> swatch — click the map to place; click a placement to select, drag to move.<br><br>' +
  '<kbd>Shift</kbd>-click (or drag) selects many tiles, then a brush fills them alike.<br>' +
  '<kbd>R</kbd> rotate · <kbd>Del</kbd> delete · arrows nudge · <kbd>[</kbd> <kbd>]</kbd> scale · <kbd>Esc</kbd> deselect';

let regionDraft = null, regionDraftSub = null;
function regionDraftInit() {
  if (regionDraftSub === sub.id && regionDraft) return;
  regionDraft = {
    table: structuredClone(sub.table ?? []),
    boss: sub.boss ? structuredClone(sub.boss) : null,
    miniboss: sub.miniboss ? structuredClone(sub.miniboss) : null,
  };
  regionDraftSub = sub.id;
}
// Pull the current inputs back into regionDraft before any add/remove/save so
// in-progress edits survive a re-render.
function syncRegionDraft() {
  const pr = $('poolRows');
  if (pr) regionDraft.table = [...pr.querySelectorAll('.prow')].map((r) => ({
    id: r.querySelector('.pmon').value, weight: Number(r.querySelector('.pw').value) || 1, packMax: Number(r.querySelector('.pmax').value) || 1,
  }));
  if (regionDraft.miniboss && $('mbName')) {
    regionDraft.miniboss.name = $('mbName').value.trim();
    regionDraft.miniboss.monsterIds = [...$('mbMons').querySelectorAll('select')].map((s) => s.value);
  }
  if (regionDraft.boss && $('bName')) {
    regionDraft.boss.name = $('bName').value.trim();
    regionDraft.boss.monsterIds = [...$('bMons').querySelectorAll('select')].map((s) => s.value);
    regionDraft.boss.drops = [...$('bDrops').querySelectorAll('select')].map((s) => s.value);
  }
}
const optList = (arr, sel) => arr.map((e) => `<option value="${e.id}" ${e.id === sel ? 'selected' : ''}>${e.name}</option>`).join('');
function poolRow(t) {
  return `<div class="prow"><select class="pmon">${optList(MONSTERS, t.id)}</select>` +
    `<input class="pw" type="number" title="weight" value="${t.weight ?? 1}">` +
    `<input class="pmax" type="number" title="pack max" value="${t.packMax ?? 1}">` +
    `<button class="rrowdel" data-ra="pool-del">✕</button></div>`;
}
const idRow = (arr, id, delRa) => `<div class="idrow"><select>${optList(arr, id)}</select><button class="rrowdel" data-ra="${delRa}">✕</button></div>`;
function packEditor(kind, pack) {
  const cap = kind === 'boss' ? 'Boss' : 'Miniboss';
  if (!pack) return `<div class="rsection"><b>${cap}</b> <span class="hint" style="display:inline;margin:0">none defined</span> <button class="minibtn" data-ra="def-${kind}">+ define</button></div>`;
  const nameId = kind === 'boss' ? 'bName' : 'mbName', monsId = kind === 'boss' ? 'bMons' : 'mbMons';
  const drops = kind === 'boss'
    ? `<div class="sublabel">drops</div><div id="bDrops">${(pack.drops ?? []).map((id) => idRow(ITEMS, id, 'b-drop-del')).join('')}</div><button class="minibtn" data-ra="b-drop-add">+ drop</button>`
    : '';
  return `<div class="rsection"><b>${cap} pack</b>
    <label class="field">name<input id="${nameId}" value="${esc(pack.name)}" autocomplete="off"></label>
    <div class="sublabel">monsters</div><div id="${monsId}">${(pack.monsterIds ?? []).map((id) => idRow(MONSTERS, id, kind === 'boss' ? 'b-mon-del' : 'mb-del')).join('')}</div>
    <button class="minibtn" data-ra="${kind === 'boss' ? 'b-mon-add' : 'mb-add'}">+ monster</button>
    ${drops}
    <button class="bigbtn go" data-ra="${kind === 'boss' ? 'b-save' : 'mb-save'}">Save ${kind}</button></div>`;
}
function regionPanelHtml() {
  regionDraftInit();
  const d = regionDraft;
  return `<h3 style="margin-top:0">Region: ${sub.name ?? sub.id}</h3>
    <div class="hint" style="margin-top:0">difficulty ${sub.difficulty ?? '—'} · theme ${sub.theme ?? 'none'} · <code>${sub.id}</code></div>
    <div class="rsection"><b>Random pool</b> <span class="hint" style="display:inline;margin:0">monster · weight · pack</span>
      <div id="poolRows">${d.table.map(poolRow).join('') || '<div class="hint" style="margin:0">empty — walks roll nothing here</div>'}</div>
      <button class="minibtn" data-ra="pool-add">+ monster</button>
      <button class="bigbtn go" data-ra="pool-save">Save pool</button></div>
    ${packEditor('miniboss', d.miniboss)}
    ${packEditor('boss', d.boss)}
    <details class="rsection"><summary>Placement help</summary><div class="hint">${INSPECTOR_HELP}</div></details>`;
}
// One delegated handler for every region-editor button (the inspector re-renders
// its innerHTML, but the #inspector element persists, so this binds once).
async function onRegionAction(ev) {
  const b = ev.target.closest('[data-ra]');
  if (!b || mode !== 'map' || selObj()) return; // region view only (nothing selected)
  regionDraftInit();
  syncRegionDraft();
  const a = b.dataset.ra;
  const rowIndex = () => { const row = b.closest('.prow, .idrow'); return [...row.parentElement.children].indexOf(row); };
  const d = regionDraft;
  if (a === 'pool-save') return saveZoneField('table', d.table);
  if (a === 'mb-save') return saveZoneField('miniboss', d.miniboss);
  if (a === 'b-save') return saveZoneField('boss', d.boss);
  if (a === 'pool-add') d.table.push({ id: MONSTERS[0].id, weight: 1, packMax: 1 });
  else if (a === 'pool-del') d.table.splice(rowIndex(), 1);
  else if (a === 'def-miniboss') d.miniboss = { name: 'New pack', monsterIds: [MONSTERS[0].id] };
  else if (a === 'mb-add') d.miniboss.monsterIds.push(MONSTERS[0].id);
  else if (a === 'mb-del') d.miniboss.monsterIds.splice(rowIndex(), 1);
  else if (a === 'def-boss') d.boss = { name: 'New pack', monsterIds: [MONSTERS[0].id], drops: [] };
  else if (a === 'b-mon-add') d.boss.monsterIds.push(MONSTERS[0].id);
  else if (a === 'b-mon-del') d.boss.monsterIds.splice(rowIndex(), 1);
  else if (a === 'b-drop-add') (d.boss.drops ??= []).push(ITEMS[0].id);
  else if (a === 'b-drop-del') d.boss.drops.splice(rowIndex(), 1);
  inspector();
}
async function saveZoneField(field, value) {
  const url = field === 'table' ? '/save-zone-table' : '/save-zone-boss';
  setStatus('Saving…');
  const j = await fetch(url, { method: 'POST', body: JSON.stringify({ subId: sub.id, field, value }) }).then((r) => r.json()).catch(() => ({}));
  if (!j.ok) { setStatus(`Save failed: ${j.error || 'see server log'}`); return; }
  sub[field] = value; // reflect in memory so the panel and pins stay in step
  setStatus(`Saved ${sub.id} ${field} ✓${j.built === false ? ' (rebuild failed — see log)' : ''}`);
  inspector();
}
$('inspector').addEventListener('click', onRegionAction);

// ---------------------------------------------------------------- boot
fillZones(); fillRegions(); fillMarkerbar(); fillTilebar();
await loadTiles();
render();
