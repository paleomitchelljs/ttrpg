// Spellbook — pure data. Casting rolls d20 + CHA vs castDC; on a failure the
// spell fizzles and is burned for the rest of that combat (rest to recover).
// target: 'enemy' (one foe), 'ally' (one hero — works on the fallen!),
// 'all-enemies' (everyone saves vs saveDC for half).

export const SPELLS = [
  {
    id: 'ember-bolt',
    name: 'Ember Bolt',
    castDC: 11,
    target: 'enemy',
    dice: '1d8+1',
    blurb: 'a dart of dragonfire strikes one enemy',
  },
  {
    id: 'healing-word',
    name: 'Healing Word',
    castDC: 11,
    target: 'ally',
    dice: '1d6+2',
    blurb: 'mend a companion — even a fallen one',
  },
  {
    id: 'flame-wave',
    name: 'Flame Wave',
    castDC: 12,
    target: 'all-enemies',
    dice: '2d6',
    saveDC: 12,
    blurb: 'a searing wave over every enemy, save for half',
  },
];

export function spellById(id) {
  return SPELLS.find((s) => s.id === id);
}
