// Spellbook — pure data. Casting rolls d20 + the caster's stat vs castDC; on a
// failure the spell fizzles and is burned for the rest of that combat (rest to
// recover). target: 'enemy' (one foe), 'ally' (one hero — works on the fallen!),
// 'all-enemies' (everyone saves vs saveDC for half).
// `school` groups spells for the Spell Focus talent (advantage on that school).

export const SPELLS = [
  {
    id: 'ember-bolt',
    name: 'Ember Bolt',
    castDC: 11,
    target: 'enemy',
    dice: '1d8+1',
    school: 'fire',
    blurb: 'a dart of dragonfire strikes one enemy',
  },
  {
    id: 'magic-missile',
    name: 'Magic Missile',
    castDC: 10,
    target: 'enemy',
    dice: '1d4+1',
    school: 'force',
    tome: true,
    blurb: 'unerring darts of force — cheap and never misses',
  },
  {
    id: 'smite',
    name: 'Smite',
    castDC: 11,
    target: 'enemy',
    dice: '1d8',
    school: 'radiant',
    tome: true,
    blurb: 'divine flame lashes one foe',
  },
  {
    // id kept for save-compatibility; now the Shadowdark Cure Wounds
    id: 'healing-word',
    name: 'Cure Wounds',
    castDC: 11,
    target: 'ally',
    dice: '1d6+2',
    school: 'holy',
    blurb: 'mend a companion — even a fallen one',
  },
  {
    // id kept for save-compatibility; now the Shadowdark Fireball
    id: 'flame-wave',
    name: 'Fireball',
    castDC: 13,
    target: 'all-enemies',
    dice: '3d6',
    saveDC: 13,
    school: 'fire',
    blurb: 'a roaring blast engulfs every enemy, save for half',
  },
  {
    id: 'lightning-bolt',
    name: 'Lightning Bolt',
    castDC: 13,
    target: 'all-enemies',
    dice: '3d6',
    saveDC: 13,
    school: 'storm',
    tome: true,
    blurb: 'a forking bolt arcs through the whole line, save for half',
  },
];

SPELLS.push(
  {
    id: 'drain-life',
    name: 'Drain Life',
    castDC: 11,
    target: 'enemy',
    dice: '1d8',
    drain: true,
    school: 'drain',
    tome: false,
    blurb: 'darkness leaps from her hand — she keeps half of what it takes',
  },
  {
    id: 'dominate-undead',
    name: 'Dominate Undead',
    castDC: 12,
    target: 'enemy',
    dominate: true,
    school: 'charm',
    tome: false,
    blurb: 'her will crushes the mindless dead and sends them away',
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
};
