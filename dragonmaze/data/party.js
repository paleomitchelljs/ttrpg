// Recruitable companions — pure data, same combatant schema as monsters.
// Spawnee is a friendly vampire spawn warrior with a few limited vampire
// powers; the swashbuckler knows the whole spellbook; the spellblade
// splits the difference with a flaming sword.
//
// Scaled to Shadowdark's level-1 PCs (see references/shadowdark), with a house
// "softening": each class uses one hit-die tier UP (d4->d6, d6->d8, d8->d10),
// and a level-1 hero starts at the MAX of that die + CON (not an average roll),
// so hitDie: 8/10 here. AC is armour base + DEX (leather 11, chain 13, +2 for a
// shield); a weapon deals its die ONLY (no ability bonus on damage), and the
// attack bonus is the wielding ability's modifier + a small trained bump.

export const COMPANIONS = [
  {
    id: 'spawnee',
    name: 'Spawnee',
    kind: 'hero',
    ac: 15, // chainmail 13 + DEX 2
    hpMax: 12, // d10 + CON 2
    hitDie: 10,
    abilities: { str: 2, dex: 2, con: 2, int: 1, wis: 0, cha: 2 },
    attacks: [{ name: 'Longsword', toHit: 3, damage: '1d8', range: 'melee' }],
    sprite: 'hero_spawnee',
    emoji: '🌙',
    anim: { idle: 'spawnee-idle', attack: 'spawnee-attack' },
    walk: 'spawnee-walk',
    undead: true,
    darkvision: true, // vampire's-eye — widens the party's view underground
    ability: 'relentless',
    abilityLabel: 'slowfall: she drifts away from the first killing blow, once per fight',
    blurb: 'A friendly vampire spawn warrior; her stolen life keeps her on her feet, and the mindless dead answer to her.',
    role: 'Vampire Spawn',
    castStat: 'cha', // innate blood-magic — force of will
    // Both tier 2: innate vampire powers, not spells she studied, so they're
    // hers from the start rather than gated by maxSpellTier.
    spells: ['drain-life', 'dominate-undead'],
  },
  {
    id: 'dragonkin-swashbuckler',
    name: 'Dragonkin Swashbuckler',
    kind: 'hero',
    ac: 14, // unarmoured 10 + DEX 4 (a duelist trusts footwork over plate)
    hpMax: 9, // d8 + CON 1
    hitDie: 8,
    abilities: { str: 1, dex: 4, con: 1, int: 0, wis: 0, cha: 1 },
    attacks: [{ name: 'Rapier', toHit: 5, damage: '1d6', range: 'melee' }],
    sprite: 'hero_swashbuckler',
    emoji: '🗡️',
    anim: { idle: 'swash-idle', attack: 'swash-attack' },
    walk: 'swash-walk',
    blurb: 'A pure duelist: no magic, just impossibly fast steel (the deadliest blade in the party).',
    role: 'Duelist',
    spells: [],
  },
  {
    id: 'dragonkin-spellblade',
    name: 'Dragonkin Spellblade',
    kind: 'hero',
    ac: 14, // chainmail 13 + DEX 1
    hpMax: 9, // d8 + CON 1
    hitDie: 8,
    abilities: { str: 2, dex: 1, con: 1, int: 3, wis: 1, cha: 1 },
    attacks: [{ name: 'Longsword', toHit: 3, damage: '1d8', range: 'melee' }],
    sprite: 'hero_spellblade',
    emoji: '🔥',
    anim: { idle: 'spellblade-idle', attack: 'spellblade-attack' },
    walk: 'spellblade-walk',
    blurb: 'The party’s arcanist: fire in one hand, mending in the other.',
    role: 'Arcane Spellblade',
    castStat: 'int', // trained arcane magic
    // A level-1 arcanist knows tier-1 spells only (see maxSpellTier). Fireball
    // and Lightning Bolt are tier 3 — hers to learn at 5th, from a level-up
    // pick or a found tome. Burning Hands is the tier-1 way to burn a whole room.
    spells: ['ember-bolt', 'magic-missile', 'burning-hands', 'healing-word'],
  },
  {
    id: 'beren',
    name: 'Beren',
    kind: 'hero',
    ac: 16, // chainmail 13 + DEX 1 + shield 2
    hpMax: 12, // d10 + CON 2
    hitDie: 10,
    abilities: { str: 3, dex: 1, con: 2, int: 0, wis: 1, cha: 1 },
    attacks: [{ name: 'Warhammer', toHit: 4, damage: '1d8', range: 'melee' }],
    sprite: 'hero_beren',
    emoji: '🗡️',
    anim: { idle: 'beren-idle', attack: 'beren-attack' },
    walk: 'beren-walk',
    traits: ['beast-dread', 'animal-friend'],
    abilityLabel: 'beastfriend: beasts rout more easily against him; once a day he can charm one',
    blurb: 'A stalwart human warrior: steel, shield, and a level head with wild things.',
    role: 'Warrior',
    spells: [],
  },
  {
    id: 'turquoise',
    name: 'Turquoise',
    kind: 'hero',
    ac: 13, // leather 11 + DEX 2 (a barbarian shuns heavy plate)
    hpMax: 13, // d10 + CON 3
    hitDie: 10,
    abilities: { str: 4, dex: 2, con: 3, int: -1, wis: 0, cha: 0 },
    attacks: [{ name: 'Greataxe', toHit: 5, damage: '1d10', range: 'melee' }],
    sprite: 'hero_turquoise',
    emoji: '🪓',
    anim: { idle: 'turquoise-idle', attack: 'turquoise-attack' },
    walk: 'turquoise-walk',
    darkvision: true, // Yuan-Ti serpent-sight — widens the party's view underground
    ability: 'relentless',
    abilityLabel: 'unyielding: she shrugs off the first killing blow, once per fight',
    blurb: 'A Yuan-Ti barbarian; her serpent blood keeps her swinging past mortal wounds.',
    role: 'Barbarian',
    spells: [],
  },
  {
    id: 'gowra',
    name: 'Gowra',
    kind: 'hero',
    ac: 12, // leather 11 + DEX 1
    hpMax: 10, // d8 + CON 2
    hitDie: 8,
    // Rolled 3d6 in order and arranged for a priest (WIS prime): 17,14,13,12,12,11.
    abilities: { str: 1, dex: 1, con: 2, int: 0, wis: 3, cha: 1 },
    attacks: [{ name: 'Blessed Khopesh', toHit: 2, damage: '1d6', range: 'melee' }],
    sprite: 'hero_gowra',
    emoji: '🐍',
    anim: { idle: 'gowra-idle', attack: 'gowra-attack' },
    walk: 'gowra-walk',
    darkvision: true, // Yuan-Ti serpent-sight — widens the party's view underground
    castStat: 'wis', // divine prayers — a priest of the serpent gods
    // Cure Wounds and Smite are tier 1; the venom-drain (tier 2) is the gift of
    // her serpent gods, granted rather than learned.
    spells: ['healing-word', 'smite', 'drain-life'],
    blurb: 'A Yuan-Ti priest of the serpent gods; her prayers mend the faithful, and her venom-blessed blade drinks the life of the unworthy.',
    role: 'Serpent Priest',
  },
];

export function companionById(id) {
  return COMPANIONS.find((c) => c.id === id);
}
