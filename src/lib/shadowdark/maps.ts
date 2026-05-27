import rawData from '../../data/maps.yaml';

export type MapCategory = 'region' | 'settlement' | 'dungeon' | 'building' | 'overview';

export interface DungeonMap {
  id: string;
  name: string;
  source: string;
  sourcePage?: number;
  category: MapCategory;
  image: string;
  tags: string[];
  description?: string;
}

interface RawMap {
  id: string;
  name: string;
  source: string;
  source_page?: number;
  category: MapCategory;
  image: string;
  tags?: string[];
  description?: string;
}

interface MapsFile {
  maps: RawMap[];
}

const file = rawData as MapsFile;
export const MAPS: DungeonMap[] = file.maps.map((m) => ({
  id: m.id,
  name: m.name,
  source: m.source,
  sourcePage: m.source_page,
  category: m.category,
  image: m.image,
  tags: m.tags ?? [],
  description: m.description,
}));

export function mapsBySource(): { source: string; maps: DungeonMap[] }[] {
  const groups = new Map<string, DungeonMap[]>();
  for (const m of MAPS) {
    const list = groups.get(m.source) ?? [];
    list.push(m);
    groups.set(m.source, list);
  }
  return Array.from(groups.entries()).map(([source, maps]) => ({ source, maps }));
}
