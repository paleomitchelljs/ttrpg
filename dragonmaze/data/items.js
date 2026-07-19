// Equipment — pure data. Items are found in gleaming caches (rare loot) and
// live in the shared inventory; any character can equip one item per slot
// from their character sheet. mods: toHit / damage (flat) / ac / hpMax.
// Equipment locks in when a labyrinth is entered.

export const SLOTS = ['weapon', 'armor', 'trinket'];

export const ITEMS = [
  {
    id: 'coral-blade',
    name: 'Guk Coral Blade',
    slot: 'weapon',
    mods: { toHit: 1 },
    blurb: 'a keen edge of living coral (+1 to hit)',
  },
  {
    id: 'flaming-fang',
    name: 'Flaming Fang',
    slot: 'weapon',
    mods: { damage: 2 },
    blurb: 'a fang of frozen dragonfire (+2 damage)',
  },
  {
    id: 'silvered-scale',
    name: 'Silvered Scale',
    slot: 'armor',
    mods: { ac: 1 },
    blurb: 'a polished scale worn over the heart (+1 AC)',
  },
  {
    id: 'marr-aegis',
    name: 'Aegis of Marr',
    slot: 'armor',
    mods: { ac: 2 },
    blurb: 'the drowned temple’s blessing still holds (+2 AC)',
  },
  {
    id: 'marr-charm',
    name: 'Charm of Marr',
    slot: 'trinket',
    mods: { hpMax: 3 },
    blurb: 'warm to the touch, even underwater (+3 max HP)',
  },
  {
    id: 'underhorn-girdle',
    name: 'Underhorn Girdle',
    slot: 'trinket',
    mods: { damage: 1, hpMax: 1 },
    blurb: 'minotaur-forged and battle-worn (+1 damage, +1 max HP)',
  },
];

export function itemById(id) {
  return ITEMS.find((i) => i.id === id);
}
