// Treasure rolls. Called at generation time with the seeded RNG so loot is
// part of the deterministic world.

import { roll } from '../engine/dice.js';
import { LOOT_TABLE } from '../../data/treasure.js';
import { randInt } from '../engine/rng.js';
import { lootScale } from '../engine/rules.js';

export function rollLoot(rng, depth = 1) {
  const d6 = 1 + randInt(rng, 6);
  const entry = LOOT_TABLE.find((e) => d6 >= e.min && d6 <= e.max);
  const gold = Math.round(roll(entry.dice, rng).total * lootScale(depth));
  return { label: entry.label, icon: entry.icon, gold };
}
