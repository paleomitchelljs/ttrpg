// Every tunable constant and rule function lives here. Nothing elsewhere
// hard-codes a game number. Combat resolution follows rules-light d20
// convention: d20 + bonus vs AC, natural 20 auto-hits and doubles damage,
// natural 1 auto-misses.

import { roll, d20 } from './dice.js';
import { DRAGON_TIERS, tierByName } from '../../data/dragonProgression.js';

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

/** Treasure grows richer the deeper the labyrinth. */
export function lootScale(depth) {
  return 1 + 0.3 * (depth - 1);
}

/** Hoard-pile visual tiers (gold thresholds for the canvas centerpiece). */
export const HOARD_PILE_TIERS = [0, 150, 600, 1500];

/**
 * Hoard-gated growth: every tier whose threshold the hoard now clears.
 * Returns the tier objects gained, in order (usually zero or one).
 */
export function tierAfterBanking(currentTierName, hoardGold) {
  let tier = tierByName(currentTierName);
  const gained = [];
  while (tier.hoardToNext != null && hoardGold >= tier.hoardToNext) {
    const next = DRAGON_TIERS[DRAGON_TIERS.indexOf(tier) + 1];
    if (!next) break;
    gained.push(next);
    tier = next;
  }
  return gained;
}

// ---------------------------------------------------------------- combat
/**
 * Roll one attack. Advantage/disadvantage roll the d20 twice and keep
 * best/worst. Returns everything a view needs to narrate it.
 */
export function resolveAttack(attacker, attack, target, rng = Math.random, opts = {}) {
  const die = d20({ rng, advantage: !!opts.advantage, disadvantage: !!opts.disadvantage });
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
  return {
    natural,
    dieRolls: die.rolls,
    mode: die.mode,
    toHit: attack.toHit,
    total,
    targetAc: target.ac,
    crit,
    fumble,
    hit,
    damage,
    damageRolls,
    attackName: attack.name,
  };
}

/** Initiative: d20 + DEX modifier, once per combat, high goes first. */
export function rollInitiative(combatant, rng = Math.random) {
  return d20({ rng }).total + (combatant.abilities?.dex ?? 0);
}

// ---------------------------------------------------------------- breath
/** One creature caught in the flames: DEX save vs DC, half damage on a save. */
export function resolveBreathOn(target, dc, damageTotal, rng = Math.random) {
  const die = d20({ rng });
  const total = die.total + (target.abilities?.dex ?? 0);
  const saved = total >= dc;
  const damage = saved ? Math.max(1, Math.floor(damageTotal / 2)) : damageTotal;
  return { natural: die.total, total, dc, saved, damage };
}

/** Breath recharge: d6, ready again on 5+ (rolled when the dragon's turn comes up). */
export function rollBreathRecharge(rng = Math.random) {
  const die = 1 + Math.floor(rng() * 6);
  return { roll: die, ready: die >= 5 };
}

/** Fold a flat bonus into a dice expression's modifier: '1d8+2' +1 → '1d8+3'. */
export function bumpDamage(expr, n) {
  if (!n) return expr;
  const m = /^\s*(\d*)d(\d+)\s*(?:([+-])\s*(\d+))?\s*$/i.exec(expr);
  if (!m) return expr;
  const count = m[1] || '1';
  const mod = (m[4] ? (m[3] === '-' ? -1 : 1) * parseInt(m[4], 10) : 0) + n;
  return `${count}d${m[2]}${mod ? (mod > 0 ? `+${mod}` : `${mod}`) : ''}`;
}

// ---------------------------------------------------------------- spells
/**
 * Casting check: d20 + CHA vs the spell's castDC. Natural 20 always works,
 * natural 1 always fizzles. A fizzled spell burns out for the combat.
 */
export function resolveSpellCast(caster, spell, rng = Math.random) {
  const die = d20({ rng });
  const bonus = caster.abilities?.cha ?? 0;
  const total = die.total + bonus;
  const success = die.total !== 1 && (die.total === 20 || total >= spell.castDC);
  return { natural: die.total, bonus, total, dc: spell.castDC, success };
}

// ---------------------------------------------------------------- morale
export const MORALE_DC = 12;

/**
 * Courage check when the fight turns grim (badly wounded, or an ally falls).
 * d20 + the monster's morale bonus vs MORALE_DC. Fearless monsters
 * (morale: null — undead, constructs) never check.
 */
export function moraleCheck(monster, rng = Math.random) {
  if (monster.morale == null) return { fearless: true, pass: true };
  const die = d20({ rng });
  const total = die.total + monster.morale;
  return { fearless: false, roll: die.total, bonus: monster.morale, total, dc: MORALE_DC, pass: total >= MORALE_DC };
}
