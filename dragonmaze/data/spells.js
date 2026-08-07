// Spellbook — pure data, aligned to Shadowdark's casting rules.
//
// Casting (see resolveSpellCast): roll d20 + the caster's spellcasting stat vs
// the spell's DC, which is always 10 + the spell's tier. Natural 20 is a crit
// (its numerical effect is doubled); natural 1 always fizzles. On any failure
// the spell is lost until the party makes camp (Shadowdark: "until you rest") —
// not just for the current combat.
//
// Damage/heal is the spell's dice ONLY — a caster's ability modifier sharpens
// the *cast* (hitting the DC), never the effect (Shadowdark deals flat dice).
//
// target: 'enemy' (one foe), 'ally' (one hero — works on the fallen!),
// 'all-enemies' (everyone saves vs saveDC for half), 'self' (conjuration).
// `school` groups spells for the Spell Focus talent (advantage on that school).
// `tier` sets the DC and gates learning: a caster unlocks a tier every other
// level (1st/3rd/5th/7th/9th — see maxSpellTier in engine/rules.js), so Fireball
// is out of reach until 5th and a level-1 arcanist burns things with Burning
// Hands instead. Only *learning* is gated; a character's starting list is
// authored and may carry a signature power above their tier.

export const SPELLS = [
  {
    id: 'ember-bolt',
    name: 'Ember Bolt',
    tier: 1,
    castDC: 11, // 10 + tier
    target: 'enemy',
    dice: '1d6',
    school: 'fire',
    blurb: 'a dart of dragonfire strikes one enemy (1d6)',
  },
  {
    id: 'magic-missile',
    name: 'Magic Missile',
    tier: 1,
    castDC: 11,
    target: 'enemy',
    dice: '1d4',
    castAdvantage: true, // Shadowdark: you always cast Magic Missile with advantage
    school: 'force',
    tome: true,
    blurb: 'unerring darts of force; advantage to cast, never a whiff (1d4)',
  },
  {
    id: 'burning-hands',
    name: 'Burning Hands',
    tier: 1,
    castDC: 11,
    target: 'all-enemies',
    dice: '1d6',
    saveDC: 11,
    school: 'fire',
    tome: true,
    blurb: 'a sheet of flame washes over every enemy, save for half (1d6)',
  },
  {
    id: 'smite',
    name: 'Smite',
    tier: 1, // a single 1d6 on one foe — the same weight as Ember Bolt
    castDC: 11,
    target: 'enemy',
    dice: '1d6',
    school: 'radiant',
    tome: true,
    blurb: 'divine flame lashes one foe (1d6)',
  },
  {
    // id kept for save-compatibility; now the Shadowdark Cure Wounds
    id: 'healing-word',
    name: 'Cure Wounds',
    tier: 1,
    castDC: 11,
    target: 'ally',
    dice: '1d6',
    school: 'holy',
    blurb: 'your touch mends a companion, even a fallen one (1d6)',
  },
  {
    // id kept for save-compatibility; now the Shadowdark Fireball
    id: 'flame-wave',
    name: 'Fireball',
    tier: 3,
    castDC: 13,
    target: 'all-enemies',
    dice: '3d6',
    saveDC: 13,
    school: 'fire',
    blurb: 'a roaring blast engulfs every enemy, save for half (3d6)',
  },
  {
    id: 'lightning-bolt',
    name: 'Lightning Bolt',
    tier: 3,
    castDC: 13,
    target: 'all-enemies',
    dice: '3d6',
    saveDC: 13,
    school: 'storm',
    tome: true,
    blurb: 'a forking bolt arcs through the whole line, save for half (3d6)',
  },
];

// ---------------------------------------------------------------- ongoing spells
// Three durations now exist beyond "it happens and it's over":
//
//   focus: {...}   — lasts while the caster concentrates (Shadowdark's Focus).
//                    One at a time; a spellcasting check at the start of each of
//                    your turns keeps it up; an ordinary failure just ends it, a
//                    natural 1 is a critical failure (burned until rest, mishap);
//                    taking a hit forces an immediate check. `dice` is dealt to
//                    the target each turn the focus holds.
//   cond: {...}    — a fixed-duration condition on the target: `rounds` long,
//                    carrying any of {toHit, damage, ac, disadv, disable,
//                    wakeOnDamage}. No concentration, so it survives anything.
//   save: 'wis'    — the target rolls to shrug the condition off entirely.
//
// A condition with `disable` costs its owner their turns, and anyone striking a
// disabled target rolls with advantage. `wakeOnDamage` drops it on the first hit.
SPELLS.push(
  {
    id: 'acid-arrow',
    name: 'Acid Arrow',
    // Shadowdark books this at tier 2, partly for its *far* range. This game has
    // no range bands at all, so that half of the spell simply doesn't exist —
    // it sits at tier 1 (where a 1st-level caster can learn a focus spell) and
    // keeps the book's 1d6 to pay for what the missing range took away.
    tier: 1,
    castDC: 11,
    target: 'enemy',
    dice: '1d6',
    dtype: 'acid',
    focus: { dice: '1d6', cond: { id: 'acid-burn', dtype: 'acid' } },
    school: 'acid',
    tome: true,
    blurb: 'a dart of acid that keeps eating: 1d6 now, and 1d6 more each round you focus',
  },
  {
    id: 'holy-weapon',
    name: 'Holy Weapon',
    tier: 1,
    castDC: 11,
    target: 'ally',
    cond: { id: 'holy-weapon', rounds: 5, toHit: 1, damage: 1 },
    school: 'holy',
    tome: true,
    blurb: 'you bless a companion’s weapon: +1 to hit and +1 damage for 5 rounds',
  },
  {
    id: 'sleep',
    name: 'Sleep',
    tier: 1,
    castDC: 11,
    target: 'enemy',
    // Shadowdark's Sleep has no save — it's gated by how big the thing is, so
    // here a boss simply shrugs it off. Wakes the moment anything hits it.
    cond: { id: 'asleep', rounds: '1d4', disable: true, wakeOnDamage: true },
    bossImmune: true,
    school: 'charm',
    tome: true,
    blurb: 'one foe drops into a magical slumber (1d4 rounds, and any hit wakes it)',
  },
  {
    id: 'hold-person',
    name: 'Hold Person',
    tier: 2,
    castDC: 12,
    target: 'enemy',
    cond: { id: 'held', disable: true },
    focus: { cond: { id: 'held', disable: true } },
    save: 'wis',
    bossImmune: true,
    school: 'charm',
    tome: true,
    blurb: 'one foe is frozen where it stands for as long as you focus (WIS save resists)',
  }
);

SPELLS.push(
  {
    // Spawnee's signature. `tome: false` keeps it off both learning paths (found
    // tomes and the level-up pick), so the only way to have it is to start with
    // it — and she is the only one who does.
    id: 'drain-life',
    name: 'Drain Life',
    tier: 2,
    castDC: 12,
    target: 'enemy',
    dice: '1d8',
    drain: true,
    school: 'drain',
    tome: false,
    blurb: 'darkness leaps from her hand, and she keeps every drop of what it takes (1d8)',
  },
  {
    id: 'dominate-undead',
    name: 'Dominate Undead',
    tier: 2,
    castDC: 12,
    target: 'enemy',
    dominate: true,
    school: 'charm',
    tome: false,
    blurb: 'her will crushes the mindless dead and bends them to her side',
  },
  {
    id: 'summon-ember',
    name: 'Summon Ember Spirit',
    tier: 2,
    castDC: 12,
    target: 'self',
    summon: 'ember-spirit',
    school: 'fire',
    tome: true,
    blurb: 'a mote of fire takes shape and fights at your side for the battle',
  }
);

export function spellById(id) {
  return SPELLS.find((s) => s.id === id);
}

/** Human label for a spell school (for Focus talents). */
export const SCHOOL_LABEL = {
  fire: 'Fire',
  force: 'Force',
  radiant: 'Radiant',
  holy: 'Holy',
  storm: 'Storm',
  drain: 'Drain',
  charm: 'Charm',
  acid: 'Acid',
};
