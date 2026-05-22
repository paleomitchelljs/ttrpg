import rawData from '../../data/treasure.yaml';

export interface Treasure {
  id: string;
  name: string;
  tier: 1 | 2 | 3;
  tags: string[];
  value?: string;
  notes?: string;
}

interface RawTreasure {
  id: string;
  name: string;
  tier: 1 | 2 | 3;
  tags?: string[];
  value?: string;
  notes?: string;
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
}));

export function treasureByTier(tier: 1 | 2 | 3): Treasure[] {
  return TREASURE.filter((t) => t.tier === tier);
}

export function rollTreasure(tier: 1 | 2 | 3): Treasure {
  const pool = treasureByTier(tier);
  return pool[Math.floor(Math.random() * pool.length)];
}
