// Typed view onto src/data/items.yaml. This module is the single source of
// truth for item data; gear.ts re-exports the legacy API on top of it.

import rawData from '../../data/items.yaml';

export type ItemCategory =
  | 'weapon'
  | 'armor'
  | 'shield'
  | 'helmet'
  | 'gear'
  | 'consumable';

export interface Item {
  id: string;
  name: string;
  category: ItemCategory;
  cost?: string;
  slots: number;
  tags: string[];
  notes?: string;
  /** Weapons: damage die wielded one-handed, e.g. "d8". */
  damageOne?: string;
  /** Weapons: damage die wielded two-handed (versatile). */
  damageTwo?: string;
  /** Armor: base AC value before DEX. */
  acBase?: number;
  /** Armor: whether DEX modifier applies on top of base. */
  acDex?: boolean;
  /** Shield/helmet: flat AC bonus. */
  acBonus?: number;
}

interface ItemsFile {
  items: RawItem[];
}

interface RawItem {
  id: string;
  name: string;
  category: ItemCategory;
  cost?: string;
  slots?: number;
  tags?: string[];
  notes?: string;
  damage_one?: string;
  damage_two?: string;
  ac_base?: number;
  ac_dex?: boolean;
  ac_bonus?: number;
}

function normalize(raw: RawItem): Item {
  return {
    id: raw.id,
    name: raw.name,
    category: raw.category,
    cost: raw.cost,
    slots: raw.slots ?? 1,
    tags: raw.tags ?? [],
    notes: raw.notes,
    damageOne: raw.damage_one,
    damageTwo: raw.damage_two,
    acBase: raw.ac_base,
    acDex: raw.ac_dex,
    acBonus: raw.ac_bonus,
  };
}

const file = rawData as ItemsFile;
export const ITEMS: Item[] = file.items.map(normalize);

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const byNormName = new Map<string, Item>();
const byId = new Map<string, Item>();
for (const it of ITEMS) {
  byNormName.set(norm(it.name), it);
  byId.set(it.id, it);
}

export function findItem(nameOrId: string | undefined): Item | undefined {
  if (!nameOrId) return undefined;
  return byId.get(nameOrId) ?? byNormName.get(norm(nameOrId));
}

function findByCategory(category: ItemCategory) {
  return (name: string | undefined): Item | undefined => {
    const it = findItem(name);
    return it?.category === category ? it : undefined;
  };
}

export const findWeapon = findByCategory('weapon');
export const findArmor = findByCategory('armor');
export const findShield = findByCategory('shield');
export const findHelmet = findByCategory('helmet');

export function itemsByCategory(category: ItemCategory): Item[] {
  return ITEMS.filter((i) => i.category === category);
}

export function itemsByTag(tag: string): Item[] {
  return ITEMS.filter((i) => i.tags.includes(tag));
}

export function hasTag(item: Item | undefined, tag: string): boolean {
  return !!item?.tags.includes(tag);
}
