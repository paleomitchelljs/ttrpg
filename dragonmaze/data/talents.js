// Talents — chosen one at a time at odd levels (3/5/7/9). Pure data; effects
// are read by heroWithGrowth (passive folds) and the combat engine (actions).
// `repeatable` may be taken more than once; everything else is one-and-done.
// Spell Focus talents (id 'focus-<school>') are generated per school from a
// caster's known spells, so they're not listed here.

import { SPELLS, SCHOOL_LABEL } from './spells.js';

export const TALENTS = [
  { id: 'armor', name: '+1 AC', blurb: 'a quicker guard — +1 to Armor Class', repeatable: true },
  { id: 'cleave', name: 'Cleave', blurb: 'unlock a Sweep action: hit every foe for half your weapon damage' },
  { id: 'flurry', name: 'Flurry', blurb: 'your Strike lands twice each turn' },
  { id: 'arcane-recovery', name: 'Arcane Recovery', blurb: "the first spell you fizzle each fight isn't spent — try again", caster: true },
  { id: 'silver-tongue', name: 'Silver Tongue', blurb: 'advantage on Parley and Intimidate (CHA) checks' },
];

export function talentById(id) {
  if (typeof id === 'string' && id.startsWith('focus-')) {
    const school = id.slice('focus-'.length);
    const label = SCHOOL_LABEL[school] ?? school;
    return { id, name: `${label} Focus`, blurb: `advantage casting ${label} spells`, caster: true, focus: school };
  }
  return TALENTS.find((t) => t.id === id) ?? null;
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
