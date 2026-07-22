// Tile editor: place everything that sits on a map — decor, monsters, loot, and
// bosses — per subregion (Map mode), and slice new decor tiles off the art
// sheets with tags (Slice mode). Talks to serve.mjs, which writes
// data/placements.js, assets/tiles/*.png, and data/tile-tags.json.
import { ZONES } from './data/zones.js';
import { PLACEMENTS } from './data/placements.js';
import { MONSTERS, monsterById } from './data/monsters.js';
import { ITEMS, itemById } from './data/items.js';

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
  $('tagfilter').innerHTML = ['all', ...allTags(), 'untagged']
    .map((t) => `<button data-t="${t}" class="${t === activeTag ? 'on' : ''}">${t}</button>`)
    .join('');
  $('tagfilter').querySelectorAll('button').forEach((b) => (b.onclick = () => { activeTag = b.dataset.t; fillPalette(); }));
  const keys = tileList.filter((k) => {
    if (activeTag === 'all') return true;
    const tg = tagMeta[k]?.tags || [];
    return activeTag === 'untagged' ? tg.length === 0 : tg.includes(activeTag);
  });
  const on = (k) => brush?.kind === 'decor' && brush.key === k;
  $('swatches').innerHTML = keys
    .map((k) => `<div class="swatch ${on(k) ? 'on' : ''}" data-k="${k}"><img src="${tileSrc(k)}"><span>${k}</span><em>${(tagMeta[k]?.tags || []).join(', ')}</em></div>`)
    .join('');
  $('swatches').querySelectorAll('.swatch').forEach((el) => {
    el.onclick = () => setBrush({ kind: 'decor', key: el.dataset.k });
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
  $('mMap').classList.toggle('on', m === 'map');
  $('mSheet').classList.toggle('on', m === 'sheet');
  document.querySelector('.maponly').style.display = m === 'map' ? '' : 'none';
  document.querySelector('.sheetonly').style.display = m === 'sheet' ? '' : 'none';
  $('stagewrap').style.display = m === 'map' ? 'block' : 'none';
  $('sheetview').classList.toggle('on', m === 'sheet');
  $('inspector').style.display = m === 'map' ? 'block' : 'none';
  $('sliceform').style.display = m === 'sheet' ? 'block' : 'none';
  if (m === 'sheet') initSheet();
}
$('mMap').onclick = () => setMode('map');
$('mSheet').onclick = () => setMode('sheet');

// ---------------------------------------------------------------- map: dropdowns
$('zoneSel').onchange = (e) => { zone = ZONES[+e.target.value]; sub = zone.subregions[0]; sel = null; cellSel.clear(); fillRegions(); fillTilebar(); render(); };
$('regionSel').onchange = (e) => { sub = zone.subregions[+e.target.value]; sel = null; cellSel.clear(); fillTilebar(); render(); };
function fillZones() { $('zoneSel').innerHTML = ZONES.map((z, i) => `<option value="${i}">${z.name ?? z.id}</option>`).join(''); }
function fillRegions() { $('regionSel').innerHTML = zone.subregions.map((s, i) => `<option value="${i}">${s.name ?? s.id}</option>`).join(''); }

// ---------------------------------------------------------------- map: stage
const stage = $('stage');
function render() {
  const rows = sub.map, H = rows.length, W = rows[0].length;
  const edges = sub.edges ?? {};
  stage.dataset.theme = sub.theme ?? ''; // faithful base floors/walls per theme
  stage.style.width = W * TS + 'px';
  stage.style.height = H * TS + 'px';
  let html = '';
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const ch = rows[y][x];
    let cls = 'cell ';
    if (ch === '#') cls += 'wall';
    else if ('E123456789'.includes(ch)) cls += 'door';
    else cls += 'floor';
    if (ch === 'S') cls += ' mark';
    if (ch !== '#' && ((x === W - 1 && edges.e) || (x === 0 && edges.w) || (y === H - 1 && edges.s) || (y === 0 && edges.n))) cls += ' edge';
    if (cellSel.has(`${x},${y}`)) cls += ' selcell';
    html += `<div class="${cls}" style="left:${x * TS}px;top:${y * TS}px;width:${TS}px;height:${TS}px"></div>`;
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
  const hit = e.target.closest('.obj, .marker');
  if (hit) sel = { kind: hit.dataset.kind, i: +hit.dataset.i };
  else if (brush) {
    placeBrush(gx, gy);
    if (brush.kind === 'tile') { paint = brush.ch; render(); capture(e.pointerId); return; }
  } else { sel = null; if (cellSel.size) cellSel.clear(); render(); return; }
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
    box.innerHTML = `<h3>Nothing selected</h3><div class="hint"><b>Paint base tile</b> — click/drag to lay floor, wall, start, exit or a door (saved to zones.js).<br><br><b>Add to map</b> or a <b>Decor</b> swatch — click the map to place; click a placement to select, drag to move.<br><br><kbd>Shift</kbd>-click (or shift-drag) selects many tiles, then pick a brush to fill them identically.<br><br><kbd>R</kbd> rotate decor · <kbd>Del</kbd> delete (no confirm) · arrows nudge · <kbd>[</kbd> <kbd>]</kbd> scale decor · <kbd>Esc</kbd> deselect</div>`;
    return;
  }
  if (sel.kind === 'decor') {
    box.innerHTML = `
      <h3>${o.key}</h3>
      <div class="row"><label>Tile</label><select id="tileSwap">
        ${tileList.map((k) => `<option value="${k}" ${k === o.key ? 'selected' : ''}>${k}</option>`).join('')}
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
    // Painted geometry goes back to zones.js in the same Save.
    if (dirtyMaps.size) {
      const maps = {};
      for (const id of dirtyMaps) { const s = subById(id); if (s) maps[id] = s.map; }
      const jm = await fetch('/save-map', { method: 'POST', body: JSON.stringify(maps) }).then((r) => r.json());
      if (jm.ok) { dirtyMaps.clear(); msg += ` + ${jm.regions} map(s)`; }
      else { setStatus('Map save failed: ' + (jm.error || 'see server log')); return; }
    }
    setStatus(msg + ' ✓');
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

// ---------------------------------------------------------------- boot
fillZones(); fillRegions(); fillMarkerbar(); fillTilebar();
await loadTiles();
render();
