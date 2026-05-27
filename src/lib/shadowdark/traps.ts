import rawData from '../../data/traps.yaml';
import { filterByActivePool } from './activePool';

export interface Trap {
  id: string;
  name: string;
  detectDc: number | null;
  disarmDc: number | null;
  trigger: string;
  effect: string;
  tags: string[];
  notes?: string;
  system?: string;
  source_book?: string;
  source_page?: number;
}

interface RawTrap {
  id: string;
  name: string;
  detect_dc: number | string | null;
  disarm_dc: number | string | null;
  trigger: string;
  effect: string;
  tags?: string[];
  notes?: string;
  system?: string;
  source_book?: string;
  source_page?: number;
}

interface TrapsFile {
  traps: RawTrap[];
}

function parseDc(v: number | string | null | undefined): number | null {
  if (typeof v === 'number') return v;
  return null;
}

const file = rawData as TrapsFile;
export const TRAPS: Trap[] = file.traps.map((t) => ({
  id: t.id,
  name: t.name,
  detectDc: parseDc(t.detect_dc),
  disarmDc: parseDc(t.disarm_dc),
  trigger: t.trigger,
  effect: t.effect,
  tags: t.tags ?? [],
  notes: t.notes,
  system: t.system,
  source_book: t.source_book,
  source_page: t.source_page,
}));

export function rollTrap(filterTag?: string): Trap {
  let pool = filterByActivePool(TRAPS);
  if (filterTag) pool = pool.filter((t) => t.tags.includes(filterTag));
  const list = pool.length > 0 ? pool : TRAPS;
  return list[Math.floor(Math.random() * list.length)];
}
