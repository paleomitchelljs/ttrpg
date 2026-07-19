// Every tunable constant and rule function lives here. Nothing elsewhere
// hard-codes a game number. Combat resolution follows rules-light d20
// convention: d20 + bonus vs AC, natural 20 auto-hits and doubles damage,
// natural 1 auto-misses.

import { roll, d20 } from './dice.js';

// ---------------------------------------------------------------- map tuning
export const MAP = {
  cellsWide: 7,
  cellsHigh: 5,
  braidChance: 0.45, // chance each dead end is opened into a loop
  encounterMin: 3,
  encounterMax: 5,
  minEncounterDistance: 2, // cells from start
  lootMax: 4,
};

// ---------------------------------------------------------------- hoard/runs
/** Guaranteed gold for reaching the exit of a depth-N labyrinth. */
export function endOfRunBonus(depth) {
  return 50 + depth * 25;
}

/** Hoard-pile visual tiers (gold thresholds for the canvas centerpiece). */
export const HOARD_PILE_TIERS = [0, 150, 600, 1500];

// ---------------------------------------------------------------- combat
/** Roll one attack. Returns everything a view needs to narrate it. */
export function resolveAttack(attacker, attack, target, rng = Math.random) {
  const die = d20({ rng });
  const natural = die.total;
  const total = natural + attack.toHit;
  const crit = natural === 20;
  const fumble = natural === 1;
  const hit = !fumble && (crit || total >= target.ac);
  let damage = 0;
  let damageRolls = [];
  if (hit) {
    const dmg = roll(attack.damage, rng);
    damage = crit ? dmg.total * 2 : dmg.total;
    if (damage < 1) damage = 1;
    damageRolls = dmg.rolls;
  }
  return { natural, toHit: attack.toHit, total, targetAc: target.ac, crit, fumble, hit, damage, damageRolls, attackName: attack.name };
}

/** Initiative: d20 + DEX modifier, once per combat, high goes first. */
export function rollInitiative(combatant, rng = Math.random) {
  return d20({ rng }).total + (combatant.abilities?.dex ?? 0);
}
