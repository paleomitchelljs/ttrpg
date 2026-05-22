import type { GearItem } from './types';

export const WEAPONS: GearItem[] = [
  { name: 'Dagger', cost: '1gp', slots: 1, tags: ['Melee', 'Thrown', 'd4 / d4'] },
  { name: 'Staff', cost: '5sp', slots: 1, tags: ['Melee', 'Two-handed', 'd4 / d4'] },
  { name: 'Club', cost: '5cp', slots: 1, tags: ['Melee', 'd4 / d4'] },
  { name: 'Shortbow', cost: '6gp', slots: 1, tags: ['Ranged', 'Two-handed', 'd4 / d4'] },
  { name: 'Shortsword', cost: '7gp', slots: 1, tags: ['Melee', 'd6 / d6'] },
  { name: 'Mace', cost: '5gp', slots: 1, tags: ['Melee', 'd6 / d6'] },
  { name: 'Crossbow', cost: '8gp', slots: 1, tags: ['Ranged', 'Two-handed', 'Loading', 'd6 / d6'] },
  { name: 'Spear', cost: '5sp', slots: 1, tags: ['Melee', 'Thrown', 'd6 / d6'] },
  { name: 'Warhammer', cost: '10gp', slots: 1, tags: ['Melee', 'd6 / d6'] },
  { name: 'Longsword', cost: '9gp', slots: 1, tags: ['Melee', 'd8 / d6'] },
  { name: 'Battleaxe', cost: '10gp', slots: 1, tags: ['Melee', 'd8 / d6'] },
  { name: 'Bastard sword', cost: '10gp', slots: 2, tags: ['Melee', 'd8 / d10'] },
  { name: 'Greataxe', cost: '12gp', slots: 2, tags: ['Melee', 'Two-handed', 'd10 / d10'] },
  { name: 'Greatsword', cost: '12gp', slots: 2, tags: ['Melee', 'Two-handed', 'd12 / d12'] },
  { name: 'Longbow', cost: '12gp', slots: 2, tags: ['Ranged', 'Two-handed', 'd8 / d8'] },
];

export const ARMOR: GearItem[] = [
  { name: 'Leather armor', cost: '10gp', slots: 1, tags: ['AC 11 + DEX'] },
  { name: 'Chainmail', cost: '60gp', slots: 2, tags: ['AC 13 + DEX, disadv. on stealth/swim'] },
  { name: 'Plate mail', cost: '130gp', slots: 3, tags: ['AC 15, no DEX, disadv. stealth/swim'] },
  { name: 'Shield', cost: '10gp', slots: 1, tags: ['+2 AC, one-handed only'] },
  { name: 'Helmet', cost: '10gp', slots: 1, tags: ['+1 AC'] },
];

export const ADVENTURING_GEAR: GearItem[] = [
  { name: 'Backpack', cost: '2gp', slots: 0, notes: 'Holds the items you carry.' },
  { name: 'Caltrops, one bag', cost: '1gp', slots: 1 },
  { name: 'Crowbar', cost: '5sp', slots: 1 },
  { name: 'Flask or bottle', cost: '3sp', slots: 1 },
  { name: 'Flint and steel', cost: '5sp', slots: 1 },
  { name: 'Gem (10gp value, 100gp value)', cost: 'varies', slots: 1 },
  { name: 'Grappling hook', cost: '1gp', slots: 1 },
  { name: 'Iron spikes (10)', cost: '1gp', slots: 1 },
  { name: 'Lantern', cost: '5gp', slots: 1, notes: 'Sheds light, requires oil.' },
  { name: 'Mirror', cost: '10gp', slots: 1 },
  { name: 'Oil, flask', cost: '5sp', slots: 1 },
  { name: 'Pole, 10-foot', cost: '5sp', slots: 1 },
  { name: 'Rations (3)', cost: '5sp', slots: 1 },
  { name: 'Rope, 60ft', cost: '1gp', slots: 1 },
  { name: 'Torch', cost: '5cp', slots: 1, notes: 'Sheds light for one hour.' },
  { name: 'Holy symbol', cost: '1gp', slots: 1 },
  { name: 'Holy water, flask', cost: '25gp', slots: 1 },
  { name: 'Spellbook', cost: '50gp', slots: 1, notes: 'Required for wizards.' },
];

export const ALL_GEAR = [...WEAPONS, ...ARMOR, ...ADVENTURING_GEAR];

// Starting gear by class (Shadowdark Quickstart defaults).
export interface StartingGear {
  gold: string;
  items: string[];
}

export const STARTING_GEAR: Record<string, StartingGear> = {
  fighter: {
    gold: '2d6×5gp + 60gp',
    items: ['Backpack', 'Flint and steel', 'Torch (×2)', 'Rations (3)', 'Iron spikes (10)', 'Rope, 60ft'],
  },
  priest: {
    gold: '2d6×5gp',
    items: ['Backpack', 'Flint and steel', 'Torch (×2)', 'Rations (3)', 'Holy symbol'],
  },
  thief: {
    gold: '2d6×5gp',
    items: ['Backpack', 'Flint and steel', 'Torch (×2)', 'Rations (3)', 'Thieves\' tools'],
  },
  wizard: {
    gold: '2d6×5gp',
    items: ['Backpack', 'Flint and steel', 'Torch (×2)', 'Rations (3)', 'Spellbook'],
  },
};
