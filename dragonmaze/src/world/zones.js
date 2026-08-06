// Hand-authored zone loader. Parses a subregion's ASCII map into the same
// dungeon shape generateDungeon() produces, so everything downstream (map
// render, movement, combat, banking) works unchanged. The ASCII map holds only
// geometry (walls, floor, start, doors); where monsters, loot, bosses, and
// decor sit is authored in data/placements.js. Encounter composition and loot
// values still roll on the seeded world RNG unless a placement pins an identity,
// so revisits differ — but the geography is fixed. These are real places.

import { makeSeededRNG, randInt } from '../engine/rng.js';
import { rollLoot } from './loot.js';
import { zoneById } from '../../data/zones.js';
import { PLACEMENTS } from '../../data/placements.js';
import { itemById } from '../../data/items.js';
import { monsterById } from '../../data/monsters.js';

export function buildZoneDungeon(zoneId, subIndex, seedString, partySize = 1) {
  const zone = zoneById(zoneId);
  if (!zone) throw new Error(`Unknown zone: ${zoneId}`);
  const sub = zone.subregions[Math.min(subIndex, zone.subregions.length - 1)];
  const rng = makeSeededRNG(`zone:${zoneId}:${sub.id}:${seedString}`);

  const rows = sub.map;
  const height = rows.length;
  const width = rows[0].length;
  // Doors ('1'-'9') and the surface exit ('E') sit ON border walls — they are
  // NOT walkable floor; you walk *into* them from the adjacent floor tile.
  const isDoorCh = (ch) => ch === 'E' || (ch >= '1' && ch <= '9');
  const tiles = rows.map((r) => [...r].map((ch) => (ch === '#' || isDoorCh(ch) ? 0 : 1)));
  // '~' is walkable (a shallow sewer stream) but drawn as water, not stone floor.
  const water = rows.map((r) => [...r].map((ch) => ch === '~'));
  // '%' is an INVISIBLE wall: it draws as ordinary floor (so it doesn't disturb
  // the autotiled walls) but blocks movement — for laying collision under decor
  // like statues or rubble. Rendered floor, treated as wall.
  const blocked = new Set();
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (rows[y][x] === '%') blocked.add(`${x},${y}`);
  }
  const floorAt = (x, y) => x >= 0 && x < width && y >= 0 && y < height && tiles[y][x] === 1 && !blocked.has(`${x},${y}`);

  // Geometry pass: the map yields only the start and the border-wall doors.
  let start = null;
  const doorCells = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ch = rows[y][x];
      if (ch === 'S') start = { x, y };
      else if (isDoorCh(ch)) doorCells.push({ x, y, ch });
    }
  }
  if (!start) throw new Error(`Zone map ${zoneId}/${sub.id} needs S`);

  // Placed monsters, bosses, and loot (from data/placements.js). A monster/loot
  // with no pinned id/item rolls on the seeded RNG; a pin fixes its identity.
  // Fixed iteration order (monsters, boss, miniboss, then loot) keeps the build
  // deterministic for a given seed.
  const place = PLACEMENTS[sub.id] ?? {};
  const encounters = [];
  (place.monsters ?? []).forEach((m, i) => {
    encounters.push({
      id: `enc-${i}`, x: m.x, y: m.y,
      monsterIds: m.id ? [m.id] : rollZoneEncounter(sub, rng, partySize),
    });
  });
  (place.boss ?? []).forEach((b) => {
    if (!sub.boss) return;
    encounters.push({
      id: `boss-${b.x}-${b.y}`, x: b.x, y: b.y,
      monsterIds: [...sub.boss.monsterIds],
      bossName: sub.boss.name,
      bossDrops: [...(sub.boss.drops ?? [])],
      bossKey: `${zoneId}:${sub.id}:boss`, // stable across rebuilds — for no-respawn
    });
  });
  (place.miniboss ?? []).forEach((b) => {
    if (!sub.miniboss) return;
    encounters.push({
      id: `miniboss-${b.x}-${b.y}`, x: b.x, y: b.y,
      monsterIds: [...sub.miniboss.monsterIds],
      bossName: sub.miniboss.name,
      bossDrops: [...(sub.miniboss.drops ?? [])],
      bossKey: `${zoneId}:${sub.id}:miniboss`,
    });
  });
  const loot = (place.loot ?? []).map((l, i) => ({
    id: `loot-${i}`, x: l.x, y: l.y,
    ...(l.item ? pinnedLoot(l.item) : rollLoot(rng, sub.difficulty)),
  }));

  // Golems (and any monster flagged `patrol`) pace their post and give chase;
  // `home` anchors the beat. See tickEnemies() in gameState.
  for (const e of encounters) {
    if (e.monsterIds.some((id) => monsterById(id)?.patrol)) {
      e.patrol = true;
      e.home = { x: e.x, y: e.y };
    }
  }

  // Each door's `entry` is its one interior-floor neighbour; `dir` points from
  // the entry into the door (the way you walk to travel). `to` names the
  // destination subregion (or 'surface' to bank).
  const doors = doorCells.map(({ x, y, ch }) => {
    let entry = null;
    let dir = { dx: 0, dy: 0 };
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      if (floorAt(x + dx, y + dy)) {
        entry = { x: x + dx, y: y + dy };
        dir = { dx: -dx, dy: -dy };
        break;
      }
    }
    if (!entry) throw new Error(`Door ${ch} in ${zoneId}/${sub.id} has no interior neighbour`);
    return { x, y, ch, entry, dir, to: ch === 'E' ? 'surface' : sub.doors?.[ch] ?? 'surface' };
  });

  return {
    seed: seedString,
    depth: sub.difficulty,
    width,
    height,
    tiles,
    water,
    blocked, // "x,y" cells that render as floor but block movement (invisible walls)
    start,
    exit: doors.find((d) => d.to === 'surface') ?? null,
    encounters,
    loot,
    doors,
    edges: sub.edges ?? null, // { n|s|e|w: neighbouring subId } — walk off an edge
    props: (place.decor ?? []).map((p) => ({ ...p })), // hand-placed decor from data/placements.js
    // Walk-into tiles that prompt to travel (e.g. the well). Editor-placed portals
    // live in placements.js (kept in sync with their decor); any authored the old
    // way in zones.js still work as a fallback.
    portals: (place.portals ?? sub.portals ?? []).map((p) => ({ ...p })),
    subId: sub.id,
    theme: sub.theme ?? null,
    // Hand-pinned base tiles from the editor, "x,y" -> tile key. Overrides the
    // autotiler for those cells only (see autotileKeyAt).
    baseTiles: place.baseTiles ?? null,
    // Override the autotiler's outer-vs-internal wall inference for this map:
    // 'inner' or 'outer' forces every wall into that set. A labyrinth whose
    // walls all connect back to the border would otherwise read as one huge
    // outer shell (see outerWalls in render/autotile.js).
    wallStyle: sub.wallStyle ?? null,
    zone: {
      id: zone.id,
      name: zone.name,
      sub: sub.name,
      subIndex: zone.subregions.indexOf(sub),
      subCount: zone.subregions.length,
    },
  };
}

// A loot pile pinned to a specific magic item (authored in the editor). Ordinary
// piles roll gold/tomes/dens; a pin is a deliberate hand-placed reward.
function pinnedLoot(itemId) {
  const it = itemById(itemId);
  return { label: it ? `a cache holding ${it.name}` : 'a cache', item: itemId, gold: 0 };
}

function rollZoneEncounter(sub, rng, partySize) {
  const totalWeight = sub.table.reduce((sum, t) => sum + t.weight, 0);
  let pick = rng() * totalWeight;
  let chosen = sub.table[sub.table.length - 1];
  for (const t of sub.table) {
    pick -= t.weight;
    if (pick < 0) {
      chosen = t;
      break;
    }
  }
  // The monster's own packMax (data/monsters.js) is the authoritative "number
  // appearing" ceiling — zone weights choose *which* monster, its number-appearing
  // decides how many. (A zone table's legacy packMax is now just a fallback.)
  const packMax = monsterById(chosen.id)?.packMax ?? chosen.packMax ?? 1;
  let count = 1 + randInt(rng, packMax);
  if (partySize > 1) count += randInt(rng, Math.ceil(partySize / 2));
  return Array(Math.min(count, packMax, 6)).fill(chosen.id);
}
