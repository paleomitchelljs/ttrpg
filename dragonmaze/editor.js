// Tile editor: place hand-authored scenery per subregion (Map mode) and slice
// new tiles off the art sheets with tags (Slice mode). Talks to serve.mjs,
// which writes data/scenery.js, assets/tiles/*.png, and data/tile-tags.json.
import { ZONES } from './data/zones.js';
import { SCENERY } from './data/scenery.js';

const $ = (id) => document.getElementById(id);
const tileSrc = (k) => `./assets/tiles/${k}.png`;

let TS = 40;
let zone = ZONES[0];
let sub = zone.subregions[0];
let brush = null;
let sel = -1;
let drag = null;
let mode = 'map';
let tileList = [];       // all tile keys
let tagMeta = {};        // { key: { tags, sheet, box } }
let activeTag = 'all';
const scenery = JSON.parse(JSON.stringify(SCENERY));

function tiles() {
  if (!scenery[sub.id]) scenery[sub.id] = (sub.props ?? []).map((p) => ({ rot: 0, ...p }));
  return scenery[sub.id];
}
const setStatus = (t) => { $('status').textContent = t; if (t) setTimeout(() => ($('status').textContent === t) && ($('status').textContent = ''), 4000); };

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
  $('swatches').innerHTML = keys
    .map((k) => `<div class="swatch ${k === brush ? 'on' : ''}" data-k="${k}"><img src="${tileSrc(k)}"><span>${k}</span><em>${(tagMeta[k]?.tags || []).join(', ')}</em></div>`)
    .join('');
  $('swatches').querySelectorAll('.swatch').forEach((el) => {
    el.onclick = () => { brush = brush === el.dataset.k ? null : el.dataset.k; sel = -1; fillPalette(); render(); };
  });
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
$('zoneSel').onchange = (e) => { zone = ZONES[+e.target.value]; sub = zone.subregions[0]; sel = -1; fillRegions(); render(); };
$('regionSel').onchange = (e) => { sub = zone.subregions[+e.target.value]; sel = -1; render(); };
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
    if ('SMBLb'.includes(ch)) cls += ' mark';
    if (ch !== '#' && ((x === W - 1 && edges.e) || (x === 0 && edges.w) || (y === H - 1 && edges.s) || (y === 0 && edges.n))) cls += ' edge';
    html += `<div class="${cls}" style="left:${x * TS}px;top:${y * TS}px;width:${TS}px;height:${TS}px"></div>`;
  }
  stage.innerHTML = html;
  tiles().forEach((t, i) => stage.appendChild(objEl(t, i)));
  inspector();
}
function objEl(t, i) {
  const el = document.createElement('div');
  el.className = 'obj' + (i === sel ? ' sel' : '');
  el.style.left = t.x * TS + 'px'; el.style.top = t.y * TS + 'px';
  el.style.width = t.w * TS + 'px'; el.style.height = t.h * TS + 'px';
  el.style.zIndex = Math.round((t.y + t.h) * 10);
  el.innerHTML = `<img src="${tileSrc(t.key)}" style="transform:rotate(${t.rot || 0}deg)">`;
  el.dataset.i = i;
  return el;
}
stage.addEventListener('pointerdown', (e) => {
  const rect = stage.getBoundingClientRect();
  const cx = (e.clientX - rect.left) / TS, cy = (e.clientY - rect.top) / TS;
  const obj = e.target.closest('.obj');
  if (obj) sel = +obj.dataset.i;
  else if (brush) { tiles().push({ key: brush, x: Math.floor(cx), y: Math.floor(cy), w: 2, h: 2, rot: 0 }); sel = tiles().length - 1; }
  else { sel = -1; render(); return; }
  render();
  const t = tiles()[sel];
  drag = { ox: cx - t.x, oy: cy - t.y, el: stage.querySelector('.obj.sel') };
  stage.setPointerCapture(e.pointerId);
});
stage.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const rect = stage.getBoundingClientRect();
  const t = tiles()[sel];
  t.x = Math.round(((e.clientX - rect.left) / TS - drag.ox) * 2) / 2;
  t.y = Math.round(((e.clientY - rect.top) / TS - drag.oy) * 2) / 2;
  drag.el.style.left = t.x * TS + 'px'; drag.el.style.top = t.y * TS + 'px';
});
stage.addEventListener('pointerup', () => { if (drag) { drag = null; render(); } });

// map: inspector
function inspector() {
  const box = $('inspector');
  const t = tiles()[sel];
  if (!t) { box.innerHTML = `<h3>No tile selected</h3><div class="hint">Pick a tile on the left, then click the map to place it. Click a placed tile to select; drag to move.<br><br><kbd>R</kbd> rotate · <kbd>Del</kbd> delete · arrows nudge · <kbd>[</kbd> <kbd>]</kbd> scale</div>`; return; }
  box.innerHTML = `
    <h3>${t.key}</h3>
    <div class="row"><label>Rotate</label><button data-a="rot">⟳ ${t.rot || 0}°</button></div>
    <div class="row"><label>Width</label><button data-a="w-">−</button><span class="val">${t.w}</span><button data-a="w+">+</button></div>
    <div class="row"><label>Height</label><button data-a="h-">−</button><span class="val">${t.h}</span><button data-a="h+">+</button></div>
    <div class="row"><label>X</label><input type="number" step="0.5" value="${t.x}" data-a="x"></div>
    <div class="row"><label>Y</label><input type="number" step="0.5" value="${t.y}" data-a="y"></div>
    <button class="bigbtn del" data-a="del">Delete tile</button>`;
  box.querySelectorAll('[data-a]').forEach((el) => {
    const a = el.dataset.a;
    if (el.tagName === 'INPUT') el.onchange = () => { t[a] = parseFloat(el.value) || 0; render(); };
    else el.onclick = () => act(a);
  });
}
function act(a) {
  const t = tiles()[sel]; if (!t) return;
  if (a === 'rot') t.rot = ((t.rot || 0) + 90) % 360;
  else if (a === 'w-') t.w = Math.max(0.5, t.w - 0.5);
  else if (a === 'w+') t.w += 0.5;
  else if (a === 'h-') t.h = Math.max(0.5, t.h - 0.5);
  else if (a === 'h+') t.h += 0.5;
  else if (a === 'del') { tiles().splice(sel, 1); sel = -1; }
  render();
}
document.addEventListener('keydown', (e) => {
  if (mode !== 'map' || e.target.tagName === 'INPUT') return;
  const t = tiles()[sel]; if (!t) return;
  if (e.key === 'ArrowLeft') t.x -= 0.5;
  else if (e.key === 'ArrowRight') t.x += 0.5;
  else if (e.key === 'ArrowUp') t.y -= 0.5;
  else if (e.key === 'ArrowDown') t.y += 0.5;
  else if (e.key === 'r' || e.key === 'R') act('rot');
  else if (e.key === 'Delete' || e.key === 'Backspace') act('del');
  else if (e.key === '[') { t.w = Math.max(0.5, t.w - 0.5); t.h = Math.max(0.5, t.h - 0.5); }
  else if (e.key === ']') { t.w += 0.5; t.h += 0.5; }
  else return;
  e.preventDefault(); render();
});
$('scaleDown').onclick = () => { TS = Math.max(16, TS - 6); render(); };
$('scaleUp').onclick = () => { TS = Math.min(80, TS + 6); render(); };
$('saveBtn').onclick = async () => {
  const out = {};
  for (const [k, v] of Object.entries(scenery)) if (v && v.length) out[k] = v;
  try { const j = await fetch('/save-scenery', { method: 'POST', body: JSON.stringify(out) }).then((r) => r.json()); setStatus(j.ok ? `Saved ${j.regions} region(s) ✓` : 'Save failed'); }
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
  setStatus('Slicing…');
  const j = await fetch('/slice', { method: 'POST', body: JSON.stringify({ sheet: $('sheetSel').value, name, box: [selBox.x, selBox.y, selBox.w, selBox.h], tags }) }).then((r) => r.json()).catch(() => ({}));
  if (j.ok) { await loadTiles(); setStatus(`Sliced "${j.name}" ✓ — in the palette`); selBox = null; $('sheetwrap').querySelectorAll('.box.sel').forEach((e) => e.remove()); sliceForm(); }
  else setStatus('Slice failed: ' + (j.error || 'see server log'));
}

// ---------------------------------------------------------------- boot
fillZones(); fillRegions();
await loadTiles();
render();
