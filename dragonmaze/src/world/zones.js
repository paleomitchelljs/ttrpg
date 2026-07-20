// Hand-authored zone loader. Parses a subregion's ASCII map into the same
// dungeon shape generateDungeon() produces, so everything downstream (map
// render, movement, combat, banking) works unchanged. Encounter composition
// and loot values still roll on the seeded world RNG, so revisits differ,
// but the geography is fixed — these are real places.

import { makeSeededRNG, randInt } from '../engine/rng.js';
import { rollLoot } from './loot.js';
import { zoneById } from '../../data/zones.js';

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
  const floorAt = (x, y) => x >= 0 && x < width && y >= 0 && y < height && tiles[y][x] === 1;

  let start = null;
  const encounters = [];
  const loot = [];
  const doorCells = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ch = rows[y][x];
      if (ch === 'S') start = { x, y };
      if (isDoorCh(ch)) doorCells.push({ x, y, ch });
      if (ch === 'M') {
        encounters.push({ id: `enc-${encounters.length}`, x, y, monsterIds: rollZoneEncounter(sub, rng, partySize) });
      }
      if (ch === 'B') {
        encounters.push({
          id: `boss-${x}-${y}`, x, y,
          monsterIds: [...sub.boss.monsterIds],
          bossName: sub.boss.name,
          bossDrops: [...(sub.boss.drops ?? [])],
        });
      }
      if (ch === 'b' && sub.miniboss) {
        encounters.push({
          id: `miniboss-${x}-${y}`, x, y,
          monsterIds: [...sub.miniboss.monsterIds],
          bossName: sub.miniboss.name,
          bossDrops: [...(sub.miniboss.drops ?? [])],
        });
      }
      if (ch === 'L') {
        loot.push({ id: `loot-${loot.length}`, x, y, ...rollLoot(rng, sub.difficulty) });
      }
    }
  }
  if (!start) throw new Error(`Zone map ${zoneId}/${sub.id} needs S`);

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
    start,
    exit: doors.find((d) => d.to === 'surface') ?? null,
    encounters,
    loot,
    doors,
    edges: sub.edges ?? null, // { n|s|e|w: neighbouring subId } — walk off an edge
    props: (sub.props ?? []).map((p) => ({ ...p })), // decorative overlays
    subId: sub.id,
    theme: sub.theme ?? null,
    zone: {
      id: zone.id,
      name: zone.name,
      sub: sub.name,
      subIndex: zone.subregions.indexOf(sub),
      subCount: zone.subregions.length,
    },
  };
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
  let count = 1 + randInt(rng, chosen.packMax ?? 1);
  if (partySize > 1) count += randInt(rng, partySize);
  return Array(Math.min(count, 4)).fill(chosen.id);
}
