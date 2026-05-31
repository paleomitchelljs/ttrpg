// Scale a monster's stat block toward a target party level. Same idea as the
// cross-system converter, aimed at a power level instead of another ruleset:
// read the monster's (role, threat) from its tags and grow HP / AC / attack /
// damage accordingly. Per-instance jitter — wide for low tiers, tight for apex —
// keeps a scaled room of mooks ragged instead of identical, while bosses stay
// precise. Only upscales; an authored block is never weakened below as-written.
//
// Special abilities (the save DCs in `notes`) are not scaled — they don't convert.

import type { Monster } from '../shadowdark/monsters';
import { monsterRole, monsterThreat } from '../shadowdark/tags';

interface RoleRates {
  hp: number;
  ac: number;
  atk: number;
  dmg: number;
}

// Per-level growth, by role. Role decides what climbs: brutes gain HP, soldiers
// AC, casters/artillery damage, solos a bit of everything, minions the least.
const ROLE_RATES: Record<string, RoleRates> = {
  brute: { hp: 0.6, ac: 0.3, atk: 0.4, dmg: 0.5 },
  soldier: { hp: 0.4, ac: 0.5, atk: 0.4, dmg: 0.35 },
  skirmisher: { hp: 0.35, ac: 0.4, atk: 0.45, dmg: 0.4 },
  artillery: { hp: 0.3, ac: 0.3, atk: 0.45, dmg: 0.6 },
  caster: { hp: 0.3, ac: 0.3, atk: 0.4, dmg: 0.55 },
  leader: { hp: 0.45, ac: 0.45, atk: 0.5, dmg: 0.4 },
  minion: { hp: 0.25, ac: 0.25, atk: 0.4, dmg: 0.3 },
  solo: { hp: 0.55, ac: 0.4, atk: 0.5, dmg: 0.45 },
};

// HP jitter per instance, by threat tier. Low tiers vary a lot; apex barely.
const TIER_JITTER: Record<string, number> = {
  'tier-1': 0.25,
  'tier-2': 0.15,
  'tier-3': 0.08,
};

function jitter(amount: number): number {
  return 1 + (Math.random() * 2 - 1) * amount;
}

/** Add a flat bonus to a damage expression, e.g. addFlat("1d6", 3) → "1d6+3". */
function addFlat(damage: string, plus: number): string {
  if (plus <= 0) return damage;
  const m = damage.match(/^(\d+)d(\d+)([+-]\d+)?$/i);
  if (m) {
    const mod = (m[3] ? parseInt(m[3], 10) : 0) + plus;
    return `${m[1]}d${m[2]}${mod > 0 ? `+${mod}` : mod < 0 ? `${mod}` : ''}`;
  }
  const flat = parseInt(damage, 10);
  return Number.isNaN(flat) ? damage : String(flat + plus);
}

export interface ScaledStats {
  ac: number;
  hpMax: number;
  attacks: { name: string; bonus: number; damage: string }[];
}

/** A monster's native power, used as the baseline to scale up from. */
function nativeLevel(m: Monster): number {
  return Math.max(1, m.level || 1);
}

/**
 * Scale a monster to `targetLevel`. Returns the as-written block unchanged when
 * the target is at or below the monster's native level (no downscaling).
 */
export function scaleMonster(m: Monster, targetLevel: number): ScaledStats {
  const attacks = m.attacks.map((a) => ({ name: a.name, bonus: a.bonus, damage: String(a.damage) }));
  const delta = targetLevel - nativeLevel(m);
  if (delta <= 0) {
    return { ac: m.ac, hpMax: m.hpMax, attacks };
  }
  const rates = ROLE_RATES[monsterRole(m)] ?? ROLE_RATES.skirmisher;
  const jit = TIER_JITTER[monsterThreat(m)] ?? 0.15;

  const hpMax = Math.max(1, Math.round(m.hpMax * (1 + rates.hp * delta) * jitter(jit)));
  const ac = m.ac + Math.round(rates.ac * delta);
  const atkPlus = Math.round(rates.atk * delta);
  const dmgPlus = Math.floor(rates.dmg * delta);

  return {
    ac,
    hpMax,
    attacks: attacks.map((a) => ({
      name: a.name,
      bonus: a.bonus + atkPlus,
      damage: addFlat(a.damage, dmgPlus),
    })),
  };
}
