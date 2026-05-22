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

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function findWeapon(name: string | undefined): GearItem | undefined {
  if (!name) return undefined;
  const n = norm(name);
  return WEAPONS.find((w) => norm(w.name) === n);
}

export function findArmor(name: string | undefined): GearItem | undefined {
  if (!name) return undefined;
  const n = norm(name);
  return ARMOR.find((a) => norm(a.name) === n);
}

export const SHIELD_NAME = 'Shield';
export const HELMET_NAME = 'Helmet';

export function isShield(name: string | undefined): boolean {
  return !!name && norm(name) === norm(SHIELD_NAME);
}

export function isHelmet(name: string | undefined): boolean {
  return !!name && norm(name) === norm(HELMET_NAME);
}

export function isTwoHanded(weapon: GearItem | undefined): boolean {
  return !!weapon?.tags?.some((t) => t === 'Two-handed');
}

export function isRanged(weapon: GearItem | undefined): boolean {
  return !!weapon?.tags?.some((t) => t === 'Ranged');
}

/**
 * Pick the damage die for a weapon. Weapons list two dice as "d8 / d6"
 * (one-handed / two-handed) for versatile weapons; otherwise the same die twice.
 * Returns "d8" style string, or "d4" if unparseable.
 */
export function weaponDamageDie(weapon: GearItem | undefined, twoHanded: boolean): string {
  if (!weapon) return 'd4';
  const dmgTag = weapon.tags?.find((t) => /^d\d+\s*\/\s*d\d+$/i.test(t));
  if (!dmgTag) return 'd4';
  const parts = dmgTag.split('/').map((p) => p.trim().toLowerCase());
  return parts[twoHanded ? 1 : 0] ?? parts[0] ?? 'd4';
}

/**
 * Armor AC formula. Returns { base, addsDex } where total AC =
 * base + (addsDex ? DEX mod : 0) + shield(+2) + helmet(+1).
 */
export function armorACBase(armor: GearItem | undefined): { base: number; addsDex: boolean } {
  if (!armor) return { base: 10, addsDex: true };
  const tag = armor.tags?.[0] ?? '';
  const match = tag.match(/AC\s*(\d+)/i);
  const base = match ? parseInt(match[1], 10) : 10;
  const addsDex = /\+\s*DEX/i.test(tag);
  return { base, addsDex };
}

// Starting gear by class (Shadowdark Quickstart defaults).
export interface StartingGear {
  gold: string;
  items: string[];
  equipment: {
    mainHand?: string;
    offHand?: string;
    armor?: string;
    helmet?: string;
  };
}

export const STARTING_GEAR: Record<string, StartingGear> = {
  fighter: {
    gold: '2d6×5gp + 60gp',
    items: ['Backpack', 'Flint and steel', 'Torch (×2)', 'Rations (3)', 'Iron spikes (10)', 'Rope, 60ft'],
    equipment: { mainHand: 'Longsword', offHand: 'Shield', armor: 'Chainmail' },
  },
  priest: {
    gold: '2d6×5gp',
    items: ['Backpack', 'Flint and steel', 'Torch (×2)', 'Rations (3)', 'Holy symbol'],
    equipment: { mainHand: 'Mace', offHand: 'Shield', armor: 'Chainmail' },
  },
  thief: {
    gold: '2d6×5gp',
    items: ['Backpack', 'Flint and steel', 'Torch (×2)', 'Rations (3)', 'Thieves\' tools'],
    equipment: { mainHand: 'Shortsword', armor: 'Leather armor' },
  },
  wizard: {
    gold: '2d6×5gp',
    items: ['Backpack', 'Flint and steel', 'Torch (×2)', 'Rations (3)', 'Spellbook'],
    equipment: { mainHand: 'Staff' },
  },
};
