// Dragon age tiers — pure data (plan §6). Phase 0 plays entirely at
// wyrmling; hoardToNext and breath are wired up in Phase 1.

export const DRAGON_TIERS = [
  {
    tier: 'wyrmling',
    label: 'Wyrmling',
    hoardToNext: 1000,
    hpMax: 18,
    ac: 13,
    abilities: { str: 2, dex: 2, con: 1, int: 1, wis: 0, cha: 1 },
    attacks: [{ name: 'bite', toHit: 4, damage: '1d8+2', range: 'melee' }],
    breath: { damage: '2d6', dc: 11, recharge: 'd6>=5' },
    sprite: 'dragon_wyrmling',
    emoji: '🐉',
  },
  {
    tier: 'young',
    label: 'Young Dragon',
    hoardToNext: 5000,
    hpMax: 30,
    ac: 15,
    abilities: { str: 4, dex: 2, con: 2, int: 1, wis: 1, cha: 2 },
    attacks: [{ name: 'bite', toHit: 6, damage: '1d10+4', range: 'melee' }],
    breath: { damage: '3d6', dc: 13, recharge: 'd6>=5' },
    sprite: 'dragon_young',
    emoji: '🐉',
  },
  {
    tier: 'adult',
    label: 'Adult Dragon',
    hoardToNext: 20000,
    hpMax: 52,
    ac: 18,
    abilities: { str: 6, dex: 2, con: 4, int: 2, wis: 2, cha: 3 },
    attacks: [{ name: 'bite', toHit: 9, damage: '2d8+6', range: 'melee' }],
    breath: { damage: '5d6', dc: 16, recharge: 'd6>=5' },
    sprite: 'dragon_adult',
    emoji: '🐉',
  },
  {
    tier: 'ancient',
    label: 'Ancient Dragon',
    hoardToNext: null,
    hpMax: 90,
    ac: 20,
    abilities: { str: 8, dex: 2, con: 6, int: 4, wis: 3, cha: 5 },
    attacks: [{ name: 'bite', toHit: 13, damage: '2d10+8', range: 'melee' }],
    breath: { damage: '8d6', dc: 19, recharge: 'd6>=5' },
    sprite: 'dragon_ancient',
    emoji: '🐉',
  },
];

export function tierByName(tier) {
  return DRAGON_TIERS.find((t) => t.tier === tier) ?? DRAGON_TIERS[0];
}
