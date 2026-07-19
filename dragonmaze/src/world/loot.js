// Treasure rolls. Called at generation time with the seeded RNG so loot is
// part of the deterministic world.

import { roll } from '../engine/dice.js';
import { LOOT_TABLE } from '../../data/treasure.js';
import { randInt } from '../engine/rng.js';
import { lootScale } from '../engine/rules.js';

// Rare special finds, checked in order before ordinary gold. All deliberately
// low: each should feel like an event. What a den or cache actually contains
// is decided at pickup time (whatever you don't own yet).
const TOME_CHANCE = 0.06; // dragon learns a spell
const DEN_CHANCE = 0.04; // a familiar is earned
const CACHE_CHANCE = 0.08; // an equippable item

export function rollLoot(rng, depth = 1) {
  if (rng() < TOME_CHANCE) {
    return { label: 'a dusty spell tome', tome: true, gold: 0 };
  }
  if (rng() < DEN_CHANCE) {
    return { label: 'a rustling den', den: true, gold: 0 };
  }
  if (rng() < CACHE_CHANCE) {
    return { label: 'a gleaming cache', cache: true, gold: 0 };
  }
  const d6 = 1 + randInt(rng, 6);
  const entry = LOOT_TABLE.find((e) => d6 >= e.min && d6 <= e.max);
  const gold = Math.round(roll(entry.dice, rng).total * lootScale(depth));
  return { label: entry.label, icon: entry.icon, gold };
}
