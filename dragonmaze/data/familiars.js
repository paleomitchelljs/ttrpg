// Familiars — a small creature a single hero keeps (chosen as a level-up feat).
// Each grants ONE knack to its OWNER (not the party). Pure data; the engine
// implements each effect key:
//   'fire-boost'  — +1 damage on the owner's damage spells
//   'gold-nose'   — loot piles yield 25% more gold (any owner; gold is shared)
//   'far-light'   — the owner's light reveals farther into the dark (party-wide)
//   'spell-focus' — the owner's spells fizzle less: casting DC is 1 lower
//   'drain-boost' — the owner casts Drain Life with advantage

export const FAMILIARS = [
  {
    id: 'ember-wisp',
    name: 'Ember Wisp',
    effect: 'fire-boost',
    emoji: '🔥',
    blurb: 'a mote of living flame; all your fire burns 1 hotter',
  },
  {
    id: 'pack-rat',
    name: 'Pack Rat',
    effect: 'gold-nose',
    emoji: '🐀',
    blurb: 'a keen-nosed little hoarder; loot piles yield 25% more gold',
  },
  {
    id: 'lantern-beetle',
    name: 'Lantern Beetle',
    effect: 'far-light',
    emoji: '🪲',
    blurb: 'a gleaming shellback; its light reveals farther into the dark',
  },
  {
    id: 'fae-drake',
    name: 'Fae Drake',
    effect: 'spell-focus',
    emoji: '🐲',
    blurb: 'a gossamer-winged dragonet; its presence steadies your casting (spell DC −1)',
  },
  {
    id: 'dusk-bat',
    name: 'Dusk Bat',
    effect: 'drain-boost',
    emoji: '🦇',
    blurb: 'a leathery night-flitter that hungers with you; advantage when you cast Drain Life',
  },
];

export function familiarById(id) {
  return FAMILIARS.find((f) => f.id === id);
}
