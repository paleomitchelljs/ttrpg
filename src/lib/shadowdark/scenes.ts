import rawData from '../../data/scenes.yaml';

export interface Scene {
  id: string;
  name: string;
  tags: string[];
  description: string;
}

interface RawScene {
  id: string;
  name: string;
  tags?: string[];
  description: string;
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
}));

export function rollScene(filterTag?: string): Scene {
  const pool = filterTag ? SCENES.filter((s) => s.tags.includes(filterTag)) : SCENES;
  const list = pool.length > 0 ? pool : SCENES;
  return list[Math.floor(Math.random() * list.length)];
}
