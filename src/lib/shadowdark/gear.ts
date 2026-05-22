// Thin compatibility layer on top of items.ts (which reads from items.yaml).
// Existing callers use these named exports — keep them stable.

import type { GearItem } from './types';
import {
  ITEMS,
  hasTag,
  itemsByCategory,
  type Item,
} from './items';

export {
  findItem,
  findWeapon,
  findArmor,
  findShield,
  findHelmet,
  itemsByCategory,
  itemsByTag,
  hasTag,
  type Item,
  type ItemCategory,
} from './items';

export const SHIELD_NAME = 'Shield';
export const HELMET_NAME = 'Helmet';

/** Adapt an `Item` to the older `GearItem` shape for the few places that still use it. */
function toGearItem(it: Item): GearItem {
  const tags = [...it.tags];
  if (it.category === 'weapon' && it.damageOne) {
    const dmg = `${it.damageOne} / ${it.damageTwo ?? it.damageOne}`;
    tags.unshift(dmg);
  }
  return {
    name: it.name,
    cost: it.cost,
    slots: it.slots,
    tags,
    notes: it.notes,
  };
}

export const WEAPONS: GearItem[] = itemsByCategory('weapon').map(toGearItem);
export const ARMOR: GearItem[] = [
  ...itemsByCategory('armor'),
  ...itemsByCategory('shield'),
  ...itemsByCategory('helmet'),
].map(toGearItem);
export const ADVENTURING_GEAR: GearItem[] = [
  ...itemsByCategory('gear'),
  ...itemsByCategory('consumable'),
].map(toGearItem);
export const ALL_GEAR: GearItem[] = ITEMS.map(toGearItem);

export function isShield(name: string | undefined): boolean {
  if (!name) return false;
  return name.toLowerCase() === SHIELD_NAME.toLowerCase();
}

export function isHelmet(name: string | undefined): boolean {
  if (!name) return false;
  return name.toLowerCase() === HELMET_NAME.toLowerCase();
}

export function isTwoHanded(weapon: GearItem | Item | undefined): boolean {
  if (!weapon) return false;
  if ('category' in weapon) return hasTag(weapon, 'two-handed');
  return !!weapon.tags?.includes('Two-handed') || !!weapon.tags?.includes('two-handed');
}

export function isRanged(weapon: GearItem | Item | undefined): boolean {
  if (!weapon) return false;
  if ('category' in weapon) return hasTag(weapon, 'ranged');
  return !!weapon.tags?.includes('Ranged') || !!weapon.tags?.includes('ranged');
}

/**
 * Damage die for a weapon. Versatile weapons return their two-handed die when
 * `twoHanded` is true; otherwise the one-handed die. Returns "d4" if unparseable.
 */
export function weaponDamageDie(weapon: GearItem | Item | undefined, twoHanded: boolean): string {
  if (!weapon) return 'd4';
  if ('category' in weapon) {
    return twoHanded ? (weapon.damageTwo ?? weapon.damageOne ?? 'd4') : (weapon.damageOne ?? 'd4');
  }
  // GearItem path — damage stored as "d8 / d6" in tags[0]
  const dmgTag = weapon.tags?.find((t) => /^d\d+\s*\/\s*d\d+$/i.test(t));
  if (!dmgTag) return 'd4';
  const parts = dmgTag.split('/').map((p) => p.trim().toLowerCase());
  return parts[twoHanded ? 1 : 0] ?? parts[0] ?? 'd4';
}

/**
 * Armor AC formula. Returns { base, addsDex } where total AC =
 * base + (addsDex ? DEX mod : 0). Shield (+2) and helmet (+1) add on top of this.
 */
export function armorACBase(armor: GearItem | Item | undefined): { base: number; addsDex: boolean } {
  if (!armor) return { base: 10, addsDex: true };
  if ('category' in armor) {
    return { base: armor.acBase ?? 10, addsDex: armor.acDex ?? true };
  }
  // GearItem path — legacy callers
  const tag = armor.tags?.[0] ?? '';
  const match = tag.match(/AC\s*(\d+)/i);
  const base = match ? parseInt(match[1], 10) : 10;
  const addsDex = /\+\s*DEX/i.test(tag);
  return { base, addsDex };
}

// ───────── Starting gear by class ─────────

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
