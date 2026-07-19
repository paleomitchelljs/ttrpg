// Treasure rolls. Called at generation time with the seeded RNG so loot is
// part of the deterministic world.

import { roll } from '../engine/dice.js';
import { LOOT_TABLE } from '../../data/treasure.js';
import { randInt } from '../engine/rng.js';
import { lootScale } from '../engine/rules.js';

// Chance a loot pile is a spell tome instead of gold. Deliberately very low:
// finding one should feel like an event.
const TOME_CHANCE = 0.06;

export function rollLoot(rng, depth = 1) {
  if (rng() < TOME_CHANCE) {
    return { label: 'a dusty spell tome', icon: '📖', tome: true, gold: 0 };
  }
  const d6 = 1 + randInt(rng, 6);
  const entry = LOOT_TABLE.find((e) => d6 >= e.min && d6 <= e.max);
  const gold = Math.round(roll(entry.dice, rng).total * lootScale(depth));
  return { label: entry.label, icon: entry.icon, gold };
}
