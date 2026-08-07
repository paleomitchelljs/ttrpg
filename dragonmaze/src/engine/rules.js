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
/** Guaranteed gold for reaching the exit of a depth-N labyrinth.
 * Shadowdark scale: gold is XP, and even deep crawls pay modestly. */
export function endOfRunBonus(depth) {
  return 10 + depth * 5;
}

/** Treasure grows richer the deeper the labyrinth. */
export function lootScale(depth) {
  return 1 + 0.3 * (depth - 1);
}

/** Chance a slain beast leaves its venom or a trophy behind (see monster `harvest`). */
export const HARVEST_CHANCE = 0.25;

/** Chance the slain leave equipment among the spoils. Bosses carry the good stuff. */
export function victoryDropChance(isBoss) {
  return isBoss ? 0.5 : 0.08;
}

/** Hoard-pile visual tiers (gold thresholds for the canvas centerpiece). */
export const HOARD_PILE_TIERS = [0, 50, 180, 500];

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
  // A blessed weapon (Holy Weapon) sharpens the swing and bites harder. The
  // damage bonus folds into the dice expression the way an enchanted weapon's
  // does, so a critical doubles it too.
  const total = natural + attack.toHit + (opts.toHitBonus ?? 0);
  const crit = natural === 20;
  const fumble = natural === 1;
  const ac = target.ac + (opts.acBonus ?? 0); // a 'warded' target is harder to hit
  const hit = !fumble && (crit || total >= ac);
  let damage = 0;
  let damageRolls = [];
  if (hit) {
    const dmg = roll(bumpDamage(attack.damage, opts.damageBonus ?? 0), rng);
    damage = crit ? dmg.total * 2 : dmg.total;
    if (damage < 1) damage = 1;
    damageRolls = dmg.rolls;
  }
  return {
    natural,
    dieRolls: die.rolls,
    mode: die.mode,
    toHit: attack.toHit + (opts.toHitBonus ?? 0),
    total,
    targetAc: ac,
    crit,
    fumble,
    hit,
    damage,
    damageRolls,
    attackName: attack.name,
  };
}

/** Initiative: d20 + DEX modifier (+ equipment), once per combat. */
export function rollInitiative(combatant, rng = Math.random) {
  return d20({ rng }).total + (combatant.abilities?.dex ?? 0) + (combatant.initBonus ?? 0);
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

// ---------------------------------------------------------------- leveling
// **Treasure is XP** (Shadowdark). Not gold *value* — a hoard is worth what it
// is worth whether it holds 30gp or 200gp. Every hero on the delve gets the
// full award the moment the treasure is found; nothing is tallied at the exit
// and nothing is divided. Gold still exists, but only to grow the dragon.
//
//   normal     a ground treasure pile               1 XP
//   fabulous   a named boss's permanent magic item  3 XP
//   legendary  an end-of-dungeon, one-of-a-kind     10 XP
export const XP_FOR = { normal: 1, fabulous: 3, legendary: 10 };

// Advancing costs 10 XP x your current level, so a 1st-level hero reaches 2nd
// on 10 XP, 3rd on 20 more, and so on. These are the cumulative totals.
export const LEVEL_XP = [0, 10, 30, 60, 100, 150, 210, 280, 360, 450];

export function levelForXp(xp) {
  let level = 1;
  for (let i = 1; i < LEVEL_XP.length; i++) {
    if (xp >= LEVEL_XP[i]) level = i + 1;
  }
  return level;
}

// HP gained automatically per level, by class and CON: martials get a bigger
// hit die than casters, plus their Constitution modifier (min 1). Applied on
// every level-up so toughness scales without spending a pick on it.
function hitDieOf(hero) {
  // Fall back to a caster's d4 / a martial's d6 for a hero predating `hitDie`.
  return hero?.hitDie ?? (hero?.castStat ? 4 : 6);
}

/**
 * What a level is *expected* to add — the hit die's average plus CON. Used for
 * the sheet's "+N HP each level" estimate and to backfill saves that levelled
 * before HP was rolled. The real gain is rolled (see rollHpGain).
 */
export function hpPerLevel(hero) {
  const con = hero?.abilities?.con ?? 0;
  return Math.max(1, Math.round((hitDieOf(hero) + 1) / 2) + con);
}

/**
 * Shadowdark: every level past the first **rolls** the class hit die and adds
 * CON, minimum 1. First level is not rolled — a hero starts at the die's max
 * (see data/party.js), so only 2nd level onward comes to this.
 * The result is stored per level in the growth record, never re-rolled.
 */
export function rollHpGain(hero, rng = Math.random) {
  const con = hero?.abilities?.con ?? 0;
  return Math.max(1, roll(`1d${hitDieOf(hero)}`, rng).total + con);
}

// Level cadence: an ability score increase at 2/4/6/8/10, a talent at 3/5/7/9.
// Ability modifiers cap at +5 (a score of 20) without magic items.
export const ABILITY_CAP = 5;
export function asiEarned(level) {
  return Math.max(0, Math.floor(level / 2)); // count of 2,4,6,8,10 <= level
}
export function talentEarned(level) {
  return Math.min(4, Math.max(0, Math.floor((level - 1) / 2))); // 3,5,7,9 <= level
}

// ---------------------------------------------------------------- spells
/**
 * Casting check: d20 + CHA vs the spell's castDC. Natural 20 always works,
 * natural 1 always fizzles. A fizzled spell burns out for the combat.
 */
export function resolveSpellCast(caster, spell, rng = Math.random, opts = {}) {
  // Advantage on the cast comes from Spell Focus (talent, matched school), a
  // spell cast with advantage (Shadowdark's Magic Missile), or a familiar knack
  // the caller passes in (opts.advantage, e.g. the Dusk Bat on Drain Life).
  // advSource names which one, so the dice cinematic can say why the second die
  // is on the table; both dice ride out on dieRolls/mode the way an attack's do.
  const focused = !!(spell.school && caster.talents?.includes(`focus-${spell.school}`));
  const advSource = spell.castAdvantage ? 'spell' : focused ? 'focus' : opts.advantage ? 'familiar' : null;
  const advantage = !!advSource;
  const die = d20({ rng, advantage });
  // Casting keys off the caster's spellcasting ability (Shadowdark: wizards
  // INT, priests WIS; our dragon and vampire cast on CHA). Defaults to CHA.
  const stat = caster.castStat ?? 'cha';
  // The cast adds the caster's spellcasting ability plus any spellcasting-check
  // bonus (Shadowdark's "+1 to spellcasting checks" talents live in spellPower).
  const bonus = (caster.abilities?.[stat] ?? 0) + (caster.spellPower ?? 0);
  const total = die.total + bonus;
  // Shadowdark: the DC is always 10 + the spell's tier. dcMod shifts it (e.g. the
  // fae-drake familiar's 'spell-focus' -1). castDC is kept in the data as a
  // self-documenting mirror of 10 + tier.
  const dc = (spell.castDC ?? 10 + (spell.tier ?? 1)) + (opts.dcMod ?? 0);
  const success = die.total !== 1 && (die.total === 20 || total >= dc);
  const crit = die.total === 20; // a natural 20 doubles the spell's numerical effect
  return { natural: die.total, dieRolls: die.rolls, mode: die.mode, advantage, advSource, bonus, stat, total, dc, success, crit, focused };
}

// Shadowdark gates spells by tier: a caster unlocks a new tier every other
// level — tier 1 at 1st, tier 2 at 3rd, tier 3 at 5th, tier 4 at 7th, tier 5 at
// 9th. This gates what a caster may LEARN (a level-up pick or a found tome). A
// character's starting spells are authored data and may include a signature
// power above their tier (Spawnee's vampiric drain, Gowra's serpent prayers).
export const MAX_SPELL_TIER = 5;

export function maxSpellTier(level) {
  return Math.max(1, Math.min(MAX_SPELL_TIER, Math.ceil((level ?? 1) / 2)));
}

export function canLearnSpell(level, spell) {
  return (spell?.tier ?? 1) <= maxSpellTier(level);
}

// ---------------------------------------------------------------- parley & renown
// Old grudges of the dungeons: slaying a faction's enemies earns its trust,
// slaying its own erodes it (Shadowdark-style renown).
export const FACTION_ENEMIES = {
  froglok: ['undead', 'lizardfolk'],
  undead: ['froglok'],
  lizardfolk: ['froglok'],
  goblinoid: [],
  sarnak: [],
  aberrant: [],
  wild: [],
  construct: [],
  bandit: [],
};

// Faction ranks run -10..+10; clamp any standing into that band.
export const REP_MIN = -10;
export const REP_MAX = 10;
export function clampRep(n) {
  return Math.max(REP_MIN, Math.min(REP_MAX, n));
}

/** Parley DC by disposition only — standing now rides on the roll, not the DC. */
export function parleyDC(parley) {
  return parley === 'willing' ? 11 : 13;
}

/** How a faction greets you at this standing. */
export function dispositionLabel(rep) {
  if (rep >= 5) return 'friendly';
  if (rep <= -10) return 'hateful';
  if (rep <= -5) return 'hostile';
  return 'wary';
}

/** A CHA check to talk instead of fight. Nat 20 always lands, nat 1 never.
 * `mod` folds in standing: +faction for persuasion, -faction for intimidation. */
export function resolveParleyCheck(actor, dc, rng = Math.random, opts = {}) {
  // Silver Tongue (talent) grants advantage on CHA social checks.
  const die = d20({ rng, advantage: !!opts.advantage });
  const bonus = (actor.abilities?.cha ?? 0) + (opts.mod ?? 0);
  const total = die.total + bonus;
  const success = die.total !== 1 && (die.total === 20 || total >= dc);
  return { natural: die.total, bonus, mod: opts.mod ?? 0, total, dc, success };
}

// ---------------------------------------------------------------- morale
export const MORALE_DC = 12;

/**
 * Courage check when the fight turns grim (badly wounded, or an ally falls).
 * d20 + the monster's morale bonus vs MORALE_DC. Fearless monsters
 * (morale: null — undead, constructs) never check.
 */
export function moraleCheck(monster, rng = Math.random, disadvantage = false) {
  if (monster.morale == null) return { fearless: true, pass: true };
  let die = d20({ rng });
  if (disadvantage) {
    const other = d20({ rng }); // beasts fighting Beren rout easier: keep the worse roll
    if (other.total < die.total) die = other;
  }
  const total = die.total + monster.morale;
  return { fearless: false, roll: die.total, bonus: monster.morale, total, dc: MORALE_DC, pass: total >= MORALE_DC, disadvantage };
}
