// Familiars — a small creature a single hero keeps (chosen as a level-up feat).
// Each grants ONE knack to its OWNER (not the party). Pure data; the engine
// implements each effect key:
//   'fire-boost'  — +1 damage on the owner's damage spells
//   'gold-nose'   — loot piles yield 25% more gold (any owner; gold is shared)
//   'far-light'   — the owner's light reveals farther into the dark (party-wide)
//   'spell-focus' — the owner's spells fizzle less: casting DC is 1 lower
//   'drain-boost' — the owner casts Drain Life with advantage
//
// `anim` (optional) names sprite strips the way monsters do; without it the
// combat card falls back to `emoji`. Only the fae drake is drawn so far.

export const FAMILIARS = [
  {
    id: 'ember-wisp',
    name: 'Ember Wisp',
    effect: 'fire-boost',
    emoji: '🔥',
    // Shares the summoned Ember Spirit's art — same creature, one kept and one
    // conjured. Inert as a familiar, so it needs only the idle strip.
    anim: { idle: 'ember-spirit-idle' },
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
    anim: { idle: 'fae-drake-idle', attack: 'fae-drake-attack' },
    blurb: 'a gossamer-winged dragonet; its presence steadies your casting (spell DC −1)',
  },
  {
    id: 'dusk-bat',
    name: 'Dusk Bat',
    effect: 'drain-boost',
    emoji: '🦇',
    // Two frames of wingbeat, eye-registered so the head holds still
    // (tools/slice_duskbat.py). Inert, so it never needs an attack strip.
    // `beat` runs the pair fast enough to read as a wingbeat (see .sprite.beat).
    anim: { idle: 'dusk-bat-idle', beat: true },
    // Drain Life is Spawnee's alone, so this knack only ever fires for her —
    // the blurb says so plainly, or it reads as a trap pick for anyone else.
    blurb: 'a leathery night-flitter that hungers with you; advantage when you cast Drain Life (Spawnee only)',
  },
];

export function familiarById(id) {
  return FAMILIARS.find((f) => f.id === id);
}
