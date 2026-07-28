// Treasure rolls. Called at generation time with the seeded RNG so loot is
// part of the deterministic world.

import { roll } from '../engine/dice.js';
import { LOOT_TABLE } from '../../data/treasure.js';
import { CONSUMABLES } from '../../data/consumables.js';
import { randInt } from '../engine/rng.js';
import { lootScale } from '../engine/rules.js';

// Rare special finds, checked in order before ordinary gold. All deliberately
// low: each should feel like an event. What a den or cache actually contains
// is decided at pickup time (whatever you don't own yet).
const TOME_CHANCE = 0.06; // dragon learns a spell
const POTION_CHANCE = 0.1; // a one-shot consumable for the pouch
// Magic items never appear in loot piles: they come from bosses and quests.
// Familiars are no longer found — they're chosen as a level-up feat.

export function rollLoot(rng, depth = 1) {
  if (rng() < TOME_CHANCE) {
    return { label: 'a dusty spell tome', tome: true, gold: 0 };
  }
  if (rng() < POTION_CHANCE) {
    const c = CONSUMABLES[randInt(rng, CONSUMABLES.length)];
    return { label: `a flask, ${c.name}`, consumable: c.id, gold: 0 };
  }
  const d6 = 1 + randInt(rng, 6);
  const entry = LOOT_TABLE.find((e) => d6 >= e.min && d6 <= e.max);
  const gold = Math.round(roll(entry.dice, rng).total * lootScale(depth));
  return { label: entry.label, icon: entry.icon, gold };
}
