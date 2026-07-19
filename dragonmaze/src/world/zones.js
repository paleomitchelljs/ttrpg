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
  const tiles = rows.map((r) => [...r].map((ch) => (ch === '#' ? 0 : 1)));

  let start = null;
  let exit = null;
  const encounters = [];
  const loot = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ch = rows[y][x];
      if (ch === 'S') start = { x, y };
      if (ch === 'E') exit = { x, y };
      if (ch === 'M') {
        encounters.push({
          id: `enc-${encounters.length}`,
          x,
          y,
          monsterIds: rollZoneEncounter(sub, rng, partySize),
        });
      }
      if (ch === 'B') {
        encounters.push({
          id: `boss-${x}-${y}`,
          x,
          y,
          monsterIds: [...sub.boss.monsterIds],
          bossName: sub.boss.name,
        });
      }
      if (ch === 'L') {
        loot.push({ id: `loot-${loot.length}`, x, y, ...rollLoot(rng, sub.difficulty) });
      }
    }
  }
  if (!start || !exit) throw new Error(`Zone map ${zoneId}/${sub.id} needs S and E`);

  return {
    seed: seedString,
    depth: sub.difficulty,
    width,
    height,
    tiles,
    start,
    exit,
    encounters,
    loot,
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
