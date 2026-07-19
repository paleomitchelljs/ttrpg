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
  let count = 1 + randInt(rng, chosen.packMax ?? 1);
  // Bigger parties draw bigger packs (extra rolls only when partySize > 1
  // keeps solo seeds bit-identical to older versions).
  if (partySize > 1) count += randInt(rng, partySize);
  return Array(Math.min(count, 4)).fill(chosen.id);
}
