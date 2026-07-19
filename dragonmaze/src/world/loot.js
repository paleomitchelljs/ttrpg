// Treasure rolls. Called at generation time with the seeded RNG so loot is
// part of the deterministic world.

import { roll } from '../engine/dice.js';
import { LOOT_TABLE } from '../../data/treasure.js';
import { randInt } from '../engine/rng.js';

export function rollLoot(rng) {
  const d6 = 1 + randInt(rng, 6);
  const entry = LOOT_TABLE.find((e) => d6 >= e.min && d6 <= e.max);
  return { label: entry.label, icon: entry.icon, gold: roll(entry.dice, rng).total };
}
