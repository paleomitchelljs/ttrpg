import rawData from '../../data/treasure.yaml';
import { filterByActivePool } from './activePool';

export type TreasureTier = 1 | 2 | 3 | 4;

export interface Treasure {
  id: string;
  name: string;
  tier: TreasureTier;
  tags: string[];
  value?: string;
  notes?: string;
  /** Optional icon path relative to /public/, e.g. "icons/eq/cloak-of-flames.png". */
  icon?: string;
  system?: string;
  source_book?: string;
  source_page?: number;
}

interface RawTreasure {
  id: string;
  name: string;
  tier: TreasureTier;
  tags?: string[];
  value?: string;
  notes?: string;
  icon?: string;
  system?: string;
  source_book?: string;
  source_page?: number;
}

interface TreasureFile {
  treasure: RawTreasure[];
}

const file = rawData as TreasureFile;
export const TREASURE: Treasure[] = file.treasure.map((t) => ({
  id: t.id,
  name: t.name,
  tier: t.tier,
  tags: t.tags ?? [],
  value: t.value,
  notes: t.notes,
  icon: t.icon,
  system: t.system,
  source_book: t.source_book,
  source_page: t.source_page,
}));

export function treasureByTier(tier: TreasureTier): Treasure[] {
  return filterByActivePool(TREASURE).filter((t) => t.tier === tier);
}

export function rollTreasure(tier: TreasureTier): Treasure {
  const pool = treasureByTier(tier);
  // If active pool emptied this tier, fall back to unfiltered to avoid breaking the roll.
  const list = pool.length > 0 ? pool : TREASURE.filter((t) => t.tier === tier);
  return list[Math.floor(Math.random() * list.length)];
}
