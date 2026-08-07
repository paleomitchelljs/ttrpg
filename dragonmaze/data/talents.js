// Talents — chosen one at a time at odd levels (3/5/7/9). Pure data; effects
// are read by heroWithGrowth (passive folds) and the combat engine (actions).
// `repeatable` may be taken more than once; everything else is one-and-done.
//
// Two families are **generated** rather than listed, because they exist per
// weapon type / per spell school and only for what a character actually uses:
//   'wf-<type>'      Weapon Focus  — +1 to hit with that weapon type
//   'wm-<type>'      Weapon Master — +1 damage as well; needs the Focus first
//   'focus-<school>' Spell Focus   — advantage casting that school
//
// **Prerequisites.** Shadowdark's own talents are small and flat (+1 to hit
// with a weapon type, +1 to spellcasting checks). The showy ones here — Cleave,
// Flurry — are far past that, so they sit behind a short tree instead of being
// on the level-3 menu next to "+1 AC":
//
//   Sword Focus  ──▶ Sword Master ──┐
//   Axe Focus    ──▶ Axe Master   ──┼──▶ Flurry   (any Weapon Master)
//   Hammer Focus ──▶ ...          ──┘
//   Axe/Hammer Focus ────────────────▶ Cleave
//
// `requires` is checked by meetsRequires: `all` (every id), `any` (one of), and
// `anyPrefix` (any chosen talent whose id starts with it). `requiresLabel` is
// what the picker shows on a locked option.

import { SPELLS, SCHOOL_LABEL } from './spells.js';

export const WEAPON_TYPE_LABEL = {
  sword: 'Sword',
  axe: 'Axe',
  hammer: 'Hammer',
  dagger: 'Dagger',
  staff: 'Staff',
};

// Cleave is a chopping talent: it wants a weapon with weight behind it.
const CLEAVE_TYPES = ['axe', 'hammer'];

export const TALENTS = [
  { id: 'armor', name: '+1 AC', blurb: 'a quicker guard: +1 to Armor Class', repeatable: true },
  {
    id: 'cleave',
    name: 'Cleave',
    blurb: 'unlock a Sweep action: hit every foe for half your weapon damage',
    requires: { any: CLEAVE_TYPES.map((t) => `wf-${t}`) },
    requiresLabel: 'an Axe or Hammer Focus',
  },
  {
    id: 'flurry',
    name: 'Flurry',
    blurb: 'land a Strike and a second swing follows it',
    requires: { anyPrefix: 'wm-' },
    requiresLabel: 'any Weapon Master talent',
  },
  { id: 'arcane-recovery', name: 'Arcane Recovery', blurb: "the first spell you fizzle each fight isn't spent; try again", caster: true },
  { id: 'silver-tongue', name: 'Silver Tongue', blurb: 'advantage on Parley and Intimidate (CHA) checks' },
];

export function talentById(id) {
  if (typeof id !== 'string') return null;
  if (id.startsWith('focus-')) {
    const school = id.slice('focus-'.length);
    const label = SCHOOL_LABEL[school] ?? school;
    return { id, name: `${label} Focus`, blurb: `advantage casting ${label} spells`, caster: true, focus: school };
  }
  if (id.startsWith('wf-')) {
    const type = id.slice('wf-'.length);
    const label = WEAPON_TYPE_LABEL[type] ?? type;
    return { id, name: `${label} Focus`, blurb: `+1 to hit with ${label.toLowerCase()} weapons`, weaponType: type };
  }
  if (id.startsWith('wm-')) {
    const type = id.slice('wm-'.length);
    const label = WEAPON_TYPE_LABEL[type] ?? type;
    return {
      id,
      name: `${label} Master`,
      blurb: `+1 damage with ${label.toLowerCase()} weapons, on top of the Focus`,
      weaponType: type,
      requires: { all: [`wf-${type}`] },
      requiresLabel: `${label} Focus`,
    };
  }
  return TALENTS.find((t) => t.id === id) ?? null;
}

/** Does this character's talent list satisfy a talent's prerequisites? */
export function meetsRequires(talent, chosenIds = []) {
  const r = talent?.requires;
  if (!r) return true;
  if (r.all && !r.all.every((id) => chosenIds.includes(id))) return false;
  if (r.any && !r.any.some((id) => chosenIds.includes(id))) return false;
  if (r.anyPrefix && !chosenIds.some((id) => id.startsWith(r.anyPrefix))) return false;
  return true;
}

/** One Focus option per spell school this caster actually knows. */
export function focusTalentsFor(spellIds = []) {
  const schools = new Set();
  for (const id of spellIds) {
    const s = SPELLS.find((sp) => sp.id === id);
    if (s?.school) schools.add(s.school);
  }
  return [...schools].map((sc) => talentById(`focus-${sc}`));
}

/** Focus and Master options for each weapon type this character wields. */
export function weaponTalentsFor(attacks = []) {
  const types = [...new Set(attacks.map((a) => a.type).filter(Boolean))];
  return types.flatMap((t) => [talentById(`wf-${t}`), talentById(`wm-${t}`)]);
}
