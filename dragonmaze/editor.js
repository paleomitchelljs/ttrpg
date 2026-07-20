// Tile editor for hand-placing scenery per subregion. Loads the game's data
// modules, edits a scenery map, and POSTs it to serve.mjs (writes data/scenery.js).
import { ZONES } from './data/zones.js';
import { TILES } from './src/assets-manifest.js';
import { SCENERY } from './data/scenery.js';

const $ = (id) => document.getElementById(id);
const stage = $('stage');
let TS = 40;              // tile size in px
let zone = ZONES[0];
let sub = zone.subregions[0];
let brush = null;        // palette key armed for placing
let sel = -1;            // index of selected placed tile
let drag = null;
const scenery = JSON.parse(JSON.stringify(SCENERY));

// tiles for the current subregion; seed from the zones.js props the first time
function tiles() {
  if (!scenery[sub.id]) scenery[sub.id] = (sub.props ?? []).map((p) => ({ rot: 0, ...p }));
  return scenery[sub.id];
}

// ---------------------------------------------------------------- dropdowns
function fillZones() {
  $('zoneSel').innerHTML = ZONES.map((z, i) => `<option value="${i}">${z.name ?? z.id}</option>`).join('');
}
function fillRegions() {
  $('regionSel').innerHTML = zone.subregions.map((s, i) => `<option value="${i}">${s.name ?? s.id}</option>`).join('');
}
$('zoneSel').onchange = (e) => { zone = ZONES[+e.target.value]; sub = zone.subregions[0]; sel = -1; fillRegions(); render(); };
$('regionSel').onchange = (e) => { sub = zone.subregions[+e.target.value]; sel = -1; render(); };

// ---------------------------------------------------------------- palette
function fillPalette() {
  const keys = Object.keys(TILES).sort();
  $('palette').innerHTML = keys
    .map((k) => `<div class="swatch" data-k="${k}"><img src="${TILES[k]}"><span>${k}</span></div>`)
    .join('');
  $('palette').querySelectorAll('.swatch').forEach((el) => {
    el.onclick = () => { brush = brush === el.dataset.k ? null : el.dataset.k; sel = -1; syncPalette(); render(); };
  });
}
function syncPalette() {
  $('palette').querySelectorAll('.swatch').forEach((el) => el.classList.toggle('on', el.dataset.k === brush));
}

// ---------------------------------------------------------------- stage
function render() {
  const rows = sub.map, H = rows.length, W = rows[0].length;
  const edges = sub.edges ?? {};
  stage.style.width = W * TS + 'px';
  stage.style.height = H * TS + 'px';
  let html = '';
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const ch = rows[y][x];
      let cls = 'cell ';
      if (ch === '#') cls += 'wall';
      else if ('E123456789'.includes(ch)) cls += 'door';
      else cls += 'floor';
      if ('SMBLb'.includes(ch)) cls += ' mark';
      if (ch !== '#' && ((x === W - 1 && edges.e) || (x === 0 && edges.w) || (y === H - 1 && edges.s) || (y === 0 && edges.n))) cls += ' edge';
      html += `<div class="${cls}" style="left:${x * TS}px;top:${y * TS}px;width:${TS}px;height:${TS}px"></div>`;
    }
  }
  stage.innerHTML = html;
  tiles().forEach((t, i) => stage.appendChild(objEl(t, i)));
  inspector();
}
function objEl(t, i) {
  const el = document.createElement('div');
  el.className = 'obj' + (i === sel ? ' sel' : '');
  el.style.left = t.x * TS + 'px';
  el.style.top = t.y * TS + 'px';
  el.style.width = t.w * TS + 'px';
  el.style.height = t.h * TS + 'px';
  el.style.zIndex = Math.round((t.y + t.h) * 10);
  el.innerHTML = `<img src="${TILES[t.key]}" style="transform:rotate(${t.rot || 0}deg)">`;
  el.dataset.i = i;
  return el;
}

stage.addEventListener('pointerdown', (e) => {
  const rect = stage.getBoundingClientRect();
  const cx = (e.clientX - rect.left) / TS, cy = (e.clientY - rect.top) / TS;
  const obj = e.target.closest('.obj');
  if (obj) {
    sel = +obj.dataset.i;
  } else if (brush) {
    tiles().push({ key: brush, x: Math.floor(cx), y: Math.floor(cy), w: 2, h: 2, rot: 0 });
    sel = tiles().length - 1;
  } else {
    sel = -1; syncPalette(); render(); return;
  }
  syncPalette(); render();
  const t = tiles()[sel];
  drag = { ox: cx - t.x, oy: cy - t.y, el: stage.querySelector('.obj.sel') };
  stage.setPointerCapture(e.pointerId);
});
stage.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const rect = stage.getBoundingClientRect();
  const cx = (e.clientX - rect.left) / TS, cy = (e.clientY - rect.top) / TS;
  const t = tiles()[sel];
  t.x = Math.round((cx - drag.ox) * 2) / 2; // snap to half-tiles
  t.y = Math.round((cy - drag.oy) * 2) / 2;
  drag.el.style.left = t.x * TS + 'px';
  drag.el.style.top = t.y * TS + 'px';
});
stage.addEventListener('pointerup', () => { if (drag) { drag = null; render(); } });

// ---------------------------------------------------------------- inspector
function inspector() {
  const box = $('inspector');
  const t = tiles()[sel];
  if (!t) {
    box.innerHTML = `<h3>No tile selected</h3><div class="hint">Pick a tile on the left, then click the map to place it. Click a placed tile to select; drag to move.<br><br><kbd>R</kbd> rotate · <kbd>Del</kbd> delete · arrows nudge · <kbd>[</kbd> <kbd>]</kbd> scale</div>`;
    return;
  }
  box.innerHTML = `
    <h3>${t.key}</h3>
    <div class="row"><label>Rotate</label><button data-a="rot">⟳ ${t.rot || 0}°</button></div>
    <div class="row"><label>Width</label><button data-a="w-">−</button><span class="val">${t.w}</span><button data-a="w+">+</button></div>
    <div class="row"><label>Height</label><button data-a="h-">−</button><span class="val">${t.h}</span><button data-a="h+">+</button></div>
    <div class="row"><label>X</label><input type="number" step="0.5" value="${t.x}" data-a="x"></div>
    <div class="row"><label>Y</label><input type="number" step="0.5" value="${t.y}" data-a="y"></div>
    <button class="del" data-a="del">Delete tile</button>`;
  box.querySelectorAll('[data-a]').forEach((el) => {
    const a = el.dataset.a;
    if (el.tagName === 'INPUT') el.onchange = () => { t[a] = parseFloat(el.value) || 0; render(); };
    else el.onclick = () => act(a);
  });
}
function act(a) {
  const t = tiles()[sel];
  if (!t) return;
  if (a === 'rot') t.rot = ((t.rot || 0) + 90) % 360;
  else if (a === 'w-') t.w = Math.max(0.5, t.w - 0.5);
  else if (a === 'w+') t.w += 0.5;
  else if (a === 'h-') t.h = Math.max(0.5, t.h - 0.5);
  else if (a === 'h+') t.h += 0.5;
  else if (a === 'del') { tiles().splice(sel, 1); sel = -1; }
  render();
}

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  const t = tiles()[sel];
  if (!t) return;
  const map = { r: 'rot', R: 'rot', Delete: 'del', Backspace: 'del', '[': 'shrink', ']': 'grow' };
  if (e.key === 'ArrowLeft') t.x -= 0.5;
  else if (e.key === 'ArrowRight') t.x += 0.5;
  else if (e.key === 'ArrowUp') t.y -= 0.5;
  else if (e.key === 'ArrowDown') t.y += 0.5;
  else if (map[e.key] === 'shrink') { t.w = Math.max(0.5, t.w - 0.5); t.h = Math.max(0.5, t.h - 0.5); }
  else if (map[e.key] === 'grow') { t.w += 0.5; t.h += 0.5; }
  else if (map[e.key]) { act(map[e.key]); return; }
  else return;
  e.preventDefault();
  render();
});

$('scaleDown').onclick = () => { TS = Math.max(16, TS - 6); render(); };
$('scaleUp').onclick = () => { TS = Math.min(80, TS + 6); render(); };

$('saveBtn').onclick = async () => {
  const out = {};
  for (const [k, v] of Object.entries(scenery)) if (v && v.length) out[k] = v;
  try {
    const res = await fetch('/save-scenery', { method: 'POST', body: JSON.stringify(out) });
    const j = await res.json();
    $('status').textContent = j.ok ? `Saved ${j.regions} region(s) ✓` : 'Save failed';
  } catch {
    $('status').textContent = 'Save failed — is the dev server (serve.mjs) running?';
  }
  setTimeout(() => ($('status').textContent = ''), 4000);
};

fillZones();
fillRegions();
fillPalette();
render();
