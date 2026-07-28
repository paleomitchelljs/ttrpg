// Roll an encounter's composition from the monster pool available at this
// depth. Uses the seeded world-gen RNG passed in by the maze generator.

import { MONSTERS } from '../../data/monsters.js';
import { randInt } from '../engine/rng.js';

export function rollEncounter(depth, rng, partySize = 1) {
  const pool = MONSTERS.filter(
    (m) => (m.minDepth ?? 1) <= depth && depth <= (m.maxDepth ?? Infinity)
  );
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
  // Shadowdark "number appearing": packMax is the hard ceiling for this monster,
  // so swarms (packMax 4-5) fill out while brutes/bosses (packMax 1) stay solo.
  const packMax = chosen.packMax ?? 1;
  let count = 1 + randInt(rng, packMax);
  if (partySize > 1) count += randInt(rng, Math.ceil(partySize / 2)); // bigger party, fuller pack
  return Array(Math.min(count, packMax, 6)).fill(chosen.id);
}
