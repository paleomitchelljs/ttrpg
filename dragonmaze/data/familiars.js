// Familiars — small creatures that ride along with the dragon and grant one
// passive knack each. Pure data; the engine implements each effect key:
//   'fire-boost'  — +1 damage on the dragon's side's fire (breath and spells)
//   'gold-nose'   — loot piles yield 25% more gold
//   'far-light'   — the dragon's glow reveals farther into the dark

export const FAMILIARS = [
  {
    id: 'ember-wisp',
    name: 'Ember Wisp',
    effect: 'fire-boost',
    blurb: 'a mote of living flame — all your fire burns 1 hotter',
  },
  {
    id: 'pack-rat',
    name: 'Pack Rat',
    effect: 'gold-nose',
    blurb: 'a keen-nosed little hoarder — loot piles yield 25% more gold',
  },
  {
    id: 'lantern-beetle',
    name: 'Lantern Beetle',
    effect: 'far-light',
    blurb: 'a gleaming shellback — its light reveals farther into the dark',
  },
];

export function familiarById(id) {
  return FAMILIARS.find((f) => f.id === id);
}
