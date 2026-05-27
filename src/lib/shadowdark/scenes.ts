import rawData from '../../data/scenes.yaml';
import { filterByActivePool } from './activePool';

export interface Scene {
  id: string;
  name: string;
  tags: string[];
  description: string;
  system?: string;
  source_book?: string;
  source_page?: number;
}

interface RawScene {
  id: string;
  name: string;
  tags?: string[];
  description: string;
  system?: string;
  source_book?: string;
  source_page?: number;
}

interface ScenesFile {
  scenes: RawScene[];
}

const file = rawData as ScenesFile;
export const SCENES: Scene[] = file.scenes.map((s) => ({
  id: s.id,
  name: s.name,
  tags: s.tags ?? [],
  description: s.description,
  system: s.system,
  source_book: s.source_book,
  source_page: s.source_page,
}));

export function rollScene(filterTag?: string): Scene {
  let pool = filterByActivePool(SCENES);
  if (filterTag) pool = pool.filter((s) => s.tags.includes(filterTag));
  const list = pool.length > 0 ? pool : SCENES;
  return list[Math.floor(Math.random() * list.length)];
}
