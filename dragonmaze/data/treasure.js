// Loot table (d6) — pure data. Rolled with the SEEDED world-gen RNG at maze
// generation time so a given seed always yields the same treasure.

export const LOOT_TABLE = [
  { min: 1, max: 2, label: 'a scatter of coins', dice: '1d6', icon: '🪙' },
  { min: 3, max: 4, label: 'a pouch of gems', dice: '2d6', icon: '💎' },
  { min: 5, max: 5, label: 'a fine trinket', dice: '2d10', icon: '🏺' },
  { min: 6, max: 6, label: 'a treasure chest', dice: '4d10', icon: '🧰' },
];
