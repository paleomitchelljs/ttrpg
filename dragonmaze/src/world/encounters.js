// Roll an encounter's composition from the monster pool available at this
// depth. Uses the seeded world-gen RNG passed in by the maze generator.

import { MONSTERS } from '../../data/monsters.js';
import { randInt } from '../engine/rng.js';

export function rollEncounter(depth, rng) {
  const pool = MONSTERS.filter((m) => (m.minDepth ?? 1) <= depth);
  const totalWeight = pool.reduce((sum, m) => sum + (m.weight ?? 1), 0);
  let pick = rng() * totalWeight;
  let chosen = pool[pool.length - 1];
  for (const m of pool) {
    pick -= m.weight ?? 1;
    if (pick < 0) {
      chosen = m;
      break;
    }
  }
  const count = 1 + randInt(rng, chosen.packMax ?? 1);
  return Array(count).fill(chosen.id);
}
