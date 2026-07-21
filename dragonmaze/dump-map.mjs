// Machine-readable map dump: resolves zones.js (geometry + identity tables) and
// placements.js (what sits where) into one view per subregion — a flat object
// list (type · id/identity · cell) plus an ASCII re-projection of the grid with
// placements stamped back on. No rendering, no images.
//
//   node dump-map.mjs                 # every subregion, as text
//   node dump-map.mjs lost-temple     # only subs whose zone/sub id contains this
//   node dump-map.mjs --json          # structured JSON (all, or filtered)
//   npm run map -- courtyard-nw       # via package.json
//
// renderText()/manifests() are also imported by serve.mjs, which regenerates
// data/maps.txt + data/maps.json every time the editor saves — so whatever you
// build by hand stays readable without running anything.
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ZONES } from './data/zones.js';
import { PLACEMENTS } from './data/placements.js';
import { monsterById } from './data/monsters.js';
import { itemById } from './data/items.js';

const root = dirname(fileURLToPath(import.meta.url));
const tags = JSON.parse(readFileSync(join(root, 'data', 'tile-tags.json'), 'utf8'));

// one subregion → a fully-resolved plain object
function manifest(zone, sub, i, placements) {
  const rows = sub.map, H = rows.length, W = rows[0].length;
  const P = placements[sub.id] ?? {};
  let start = null;
  const doors = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const ch = rows[y][x];
    if (ch === 'S') start = { x, y };
    else if (ch === 'E') doors.push({ ch: 'E', x, y, to: 'surface' });
    else if (ch >= '1' && ch <= '9') doors.push({ ch, x, y, to: sub.doors?.[ch] ?? null });
  }
  const objects = [];
  for (const d of P.decor ?? [])
    objects.push({ type: 'decor', id: d.key, tags: tags[d.key]?.tags ?? [], x: d.x, y: d.y, w: d.w, h: d.h, rot: d.rot ?? 0 });
  for (const m of P.monsters ?? [])
    objects.push({ type: 'monster', x: m.x, y: m.y, ...(m.id ? { id: m.id, name: monsterById(m.id)?.name ?? null } : { roll: true }) });
  for (const l of P.loot ?? [])
    objects.push({ type: 'loot', x: l.x, y: l.y, ...(l.item ? { id: l.item, name: itemById(l.item)?.name ?? null } : { roll: true }) });
  for (const b of P.boss ?? [])
    objects.push({ type: 'boss', x: b.x, y: b.y, name: sub.boss?.name ?? null, pack: sub.boss?.monsterIds ?? [], drops: sub.boss?.drops ?? [] });
  for (const b of P.miniboss ?? [])
    objects.push({ type: 'miniboss', x: b.x, y: b.y, name: sub.miniboss?.name ?? null, pack: sub.miniboss?.monsterIds ?? [] });
  return {
    zone: zone.id, sub: sub.id, name: sub.name, index: i,
    size: { w: W, h: H }, theme: sub.theme ?? null, difficulty: sub.difficulty,
    start, doors, edges: sub.edges ?? null, portals: sub.portals ?? [],
    table: (sub.table ?? []).map((t) => ({ id: t.id, weight: t.weight, packMax: t.packMax ?? 1 })),
    boss: sub.boss ?? null, miniboss: sub.miniboss ?? null,
    objects,
  };
}

const MARK = { monster: 'M', loot: 'L', boss: 'B', miniboss: 'b', decor: 'd' };

// geometry ASCII with placements stamped back onto their cells
function grid(sub, m) {
  const rows = sub.map.map((r) => [...r]);
  for (const o of m.objects) if (rows[o.y] && rows[o.y][o.x] !== undefined) rows[o.y][o.x] = MARK[o.type];
  return rows.map((r) => '     ' + r.join('')).join('\n');
}

function ident(o) {
  if (o.type === 'decor') return `${o.id} (${o.tags.join('/') || 'untagged'}) ${o.w}x${o.h} rot${o.rot}`;
  if (o.type === 'monster') return o.roll ? 'roll (region table)' : `${o.id} — ${o.name ?? '??'}`;
  if (o.type === 'loot') return o.roll ? 'roll (gold/tome/den)' : `${o.id} — ${o.name ?? '??'}`;
  if (o.type === 'boss') return `${o.name ?? '(none defined)'} [${o.pack.join(', ')}]${o.drops.length ? ' drops ' + o.drops.join(', ') : ''}`;
  return `${o.name ?? '(none defined)'} [${o.pack.join(', ')}]`;
}

function text(m, sub) {
  const L = [];
  L.push(`== ${m.zone} / ${m.sub}  [${m.name}]`);
  L.push(`   ${m.size.w}x${m.size.h}  theme ${m.theme}  difficulty ${m.difficulty}`);
  const ways = [
    m.start ? `start ${m.start.x},${m.start.y}` : null,
    ...m.doors.map((d) => (d.to === 'surface' ? `exit(surface) ${d.x},${d.y}` : `door ${d.ch}->${d.to} ${d.x},${d.y}`)),
    m.edges ? 'edges ' + Object.entries(m.edges).map(([k, v]) => `${k}:${v}`).join(' ') : null,
    ...(m.portals ?? []).map((p) => `portal->${p.to} ${p.x},${p.y}`),
  ].filter(Boolean);
  L.push('   ' + ways.join(' | '));
  if (m.table.length) L.push('   table: ' + m.table.map((t) => `${t.id}(w${t.weight},≤${t.packMax})`).join('  '));
  L.push('   objects (type · identity · @cell):');
  for (const o of m.objects) L.push(`     ${o.type.padEnd(9)}${ident(o).padEnd(46)} @${o.x},${o.y}`);
  L.push('   grid (M monster · L loot · B boss · b mini · d decor anchor):');
  L.push(grid(sub, m));
  return L.join('\n');
}

// select subs matching an optional zone/sub id substring
function pick(filter) {
  const out = [];
  for (const zone of ZONES)
    for (let i = 0; i < zone.subregions.length; i++) {
      const sub = zone.subregions[i];
      if (filter && !`${zone.id}/${sub.id}`.includes(filter) && !zone.id.includes(filter) && !sub.id.includes(filter)) continue;
      out.push([zone, sub, i]);
    }
  return out;
}

export function manifests(placements = PLACEMENTS, filter = null) {
  return pick(filter).map(([z, s, i]) => manifest(z, s, i, placements));
}
export function renderText(placements = PLACEMENTS, filter = null) {
  return pick(filter).map(([z, s, i]) => text(manifest(z, s, i, placements), s)).join('\n\n');
}

// CLI only when run directly (not when serve.mjs imports us)
let isMain = false;
try { isMain = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { isMain = false; }
if (isMain) {
  const args = process.argv.slice(2);
  const filter = args.find((a) => !a.startsWith('--')) ?? null;
  console.log(args.includes('--json') ? JSON.stringify(manifests(PLACEMENTS, filter), null, 2) : renderText(PLACEMENTS, filter));
}
