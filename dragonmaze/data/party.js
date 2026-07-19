// Recruitable companions — pure data, same combatant schema as monsters.
// Both come from the playable dragonkin sheets. The knight is a durable
// blade; the swashbuckler is fragile but fights with flair and knows the
// whole spellbook.

export const COMPANIONS = [
  {
    id: 'dragonkin-knight',
    name: 'Dragonkin Knight',
    kind: 'hero',
    ac: 16,
    hpMax: 14,
    abilities: { str: 2, dex: 0, con: 1, int: 0, wis: 1, cha: 0 },
    attacks: [{ name: 'longsword', toHit: 4, damage: '1d8+2', range: 'melee' }],
    sprite: 'hero_knight',
    emoji: '🛡️',
    anim: { idle: 'knight-idle', attack: 'knight-attack' },
    spells: [],
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
];

export function companionById(id) {
  return COMPANIONS.find((c) => c.id === id);
}
