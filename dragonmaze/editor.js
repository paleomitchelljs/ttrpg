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

// The five placement lists per subregion. 'decor' is free (w/h/rot, half-tile
// snap); the four marker kinds are 1×1 cells snapped to the grid.
const KINDS = ['decor', 'monsters', 'loot', 'boss', 'miniboss'];
const MARKER_KINDS = ['monsters', 'loot', 'boss', 'miniboss'];
const MARKERS = [
  { kind: 'monsters', label: '👹 Monster' },
  { kind: 'loot', label: '💰 Treasure' },
  { kind: 'boss', label: '💀 Boss' },
  { kind: 'miniboss', label: '👺 Mini' },
];

function subPlace() {
  const P = place[sub.id] ?? (place[sub.id] = {});
  for (const k of KINDS) P[k] ??= [];
  return P;
}
function selObj() { return sel ? subPlace()[sel.kind]?.[sel.i] ?? null : null; }

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
  const same = brush && b && brush.kind === b.kind && brush.key === b.key;
  brush = same ? null : b;
  sel = null;
  fillMarkerbar(); fillPalette(); render();
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
$('zoneSel').onchange = (e) => { zone = ZONES[+e.target.value]; sub = zone.subregions[0]; sel = null; fillRegions(); render(); };
$('regionSel').onchange = (e) => { sub = zone.subregions[+e.target.value]; sel = null; render(); };
function fillZones() { $('zoneSel').innerHTML = ZONES.map((z, i) => `<option value="${i}">${z.name ?? z.id}</option>`).join(''); }
function fillRegions() { $('regionSel').innerHTML = zone.subregions.map((s, i) => `<option value="${i}">${s.name ?? s.id}</option>`).join(''); }

// ---------------------------------------------------------------- map: stage
const stage = $('stage');
function render() {
  const rows = sub.map, H = rows.length, W = rows[0].length;
  const edges = sub.edges ?? {};
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
  return kind === 'boss' ? '💀' : '👺';
}
function markerCap(kind, m) {
  if (kind === 'monsters') return m.id ? (monsterById(m.id)?.name ?? m.id) : 'roll';
  if (kind === 'loot') return m.item ? (itemById(m.item)?.name ?? m.item) : 'roll';
  if (kind === 'boss') return sub.boss ? 'boss' : '⚠ none';
  return sub.miniboss ? 'mini' : '⚠ none';
}
function markerEl(kind, m, i) {
  const el = document.createElement('div');
  el.className = `marker ${kind}` + (sel && sel.kind === kind && sel.i === i ? ' sel' : '');
  el.style.left = m.x * TS + 'px'; el.style.top = m.y * TS + 'px';
  el.style.width = TS + 'px'; el.style.height = TS + 'px';
  el.style.zIndex = 1000 + m.y;
  el.innerHTML = `<span class="ico">${markerIcon(kind, m)}</span><span class="cap">${markerCap(kind, m)}</span>`;
  el.dataset.kind = kind; el.dataset.i = i;
  return el;
}
function placeBrush(x, y) {
  const P = subPlace();
  if (brush.kind === 'decor') { P.decor.push({ key: brush.key, x, y, w: deco.w, h: deco.h, rot: deco.rot }); sel = { kind: 'decor', i: P.decor.length - 1 }; }
  else { P[brush.kind].push({ x, y }); sel = { kind: brush.kind, i: P[brush.kind].length - 1 }; }
}
stage.addEventListener('pointerdown', (e) => {
  const rect = stage.getBoundingClientRect();
  const cx = (e.clientX - rect.left) / TS, cy = (e.clientY - rect.top) / TS;
  const hit = e.target.closest('.obj, .marker');
  if (hit) sel = { kind: hit.dataset.kind, i: +hit.dataset.i };
  else if (brush) placeBrush(Math.floor(cx), Math.floor(cy));
  else { sel = null; render(); return; }
  render();
  const o = selObj(); if (!o) return;
  drag = { ox: cx - o.x, oy: cy - o.y, el: stage.querySelector('.obj.sel, .marker.sel') };
  stage.setPointerCapture(e.pointerId);
});
stage.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const rect = stage.getBoundingClientRect();
  const o = selObj(); if (!o) return;
  const snap = sel.kind === 'decor' ? 2 : 1; // half-tile for decor, whole cells for markers
  o.x = Math.round(((e.clientX - rect.left) / TS - drag.ox) * snap) / snap;
  o.y = Math.round(((e.clientY - rect.top) / TS - drag.oy) * snap) / snap;
  drag.el.style.left = o.x * TS + 'px'; drag.el.style.top = o.y * TS + 'px';
});
stage.addEventListener('pointerup', () => { if (drag) { drag = null; render(); } });

// map: inspector
function inspector() {
  const box = $('inspector');
  const o = selObj();
  if (!o) {
    box.innerHTML = `<h3>Nothing selected</h3><div class="hint">Pick a decor tile or a <b>Monster / Treasure / Boss / Mini</b> brush on the left, then click the map to place it. Click a placement to select; drag to move.<br><br>New decor keeps the last size &amp; rotation you set — size one, place many.<br><br><kbd>R</kbd> rotate decor · <kbd>Del</kbd> delete · arrows nudge · <kbd>[</kbd> <kbd>]</kbd> scale decor</div>`;
    return;
  }
  if (sel.kind === 'decor') {
    box.innerHTML = `
      <h3>${o.key}</h3>
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
}
function xyRows(o) {
  return `<div class="row"><label>X</label><input type="number" step="1" value="${o.x}" data-a="x"></div>
      <div class="row"><label>Y</label><input type="number" step="1" value="${o.y}" data-a="y"></div>`;
}
function act(a) {
  const o = selObj(); if (!o) return;
  if (a === 'del') { if (!confirm('Delete this placement?')) return; subPlace()[sel.kind].splice(sel.i, 1); sel = null; }
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
  try { const j = await fetch('/save-placements', { method: 'POST', body: JSON.stringify(out) }).then((r) => r.json()); setStatus(j.ok ? `Saved ${j.regions} region(s) ✓` : 'Save failed'); }
  catch { setStatus('Save failed — is the dev server running?'); }
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
fillZones(); fillRegions(); fillMarkerbar();
await loadTiles();
render();
