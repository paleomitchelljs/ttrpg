// Recruitable companions — pure data, same combatant schema as monsters.
// The bard heals and charms, the swashbuckler knows the whole spellbook,
// and the spellblade splits the difference with a flaming sword.

export const COMPANIONS = [
  {
    id: 'bard',
    name: 'Swashbuckling Bard',
    kind: 'hero',
    ac: 15,
    hpMax: 13,
    abilities: { str: 1, dex: 2, con: 1, int: 1, wis: 0, cha: 3 },
    attacks: [{ name: 'gleaming rapier', toHit: 5, damage: '1d6+2', range: 'melee' }],
    sprite: 'hero_bard',
    emoji: '🎵',
    anim: { idle: 'bard-idle', attack: 'bard-attack' },
    spells: ['healing-word'],
  },
  {
    id: 'dragonkin-swashbuckler',
    name: 'Dragonkin Swashbuckler',
    kind: 'hero',
    ac: 14,
    hpMax: 10,
    abilities: { str: 0, dex: 3, con: 0, int: 1, wis: 0, cha: 2 },
    attacks: [{ name: 'twin blades', toHit: 5, damage: '1d6+3', range: 'melee' }],
    sprite: 'hero_swashbuckler',
    emoji: '🗡️',
    anim: { idle: 'swash-idle', attack: 'swash-attack' },
    spells: ['ember-bolt', 'healing-word', 'flame-wave'],
  },
  {
    id: 'dragonkin-spellblade',
    name: 'Dragonkin Spellblade',
    kind: 'hero',
    ac: 15,
    hpMax: 12,
    abilities: { str: 2, dex: 1, con: 1, int: 2, wis: 0, cha: 1 },
    attacks: [{ name: 'flame sword', toHit: 4, damage: '1d8+2', range: 'melee' }],
    sprite: 'hero_spellblade',
    emoji: '🔥',
    anim: { idle: 'spellblade-idle', attack: 'spellblade-attack' },
    spells: ['ember-bolt', 'flame-wave'],
  },
];

export function companionById(id) {
  return COMPANIONS.find((c) => c.id === id);
}
