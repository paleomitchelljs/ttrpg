// Typed view onto src/data/monsters.yaml.

import rawData from '../../data/monsters.yaml';

export interface MonsterAttack {
  name: string;
  bonus: number;
  damage: string;
  note?: string;
}

export interface Monster {
  id: string;
  name: string;
  hpMax: number;
  ac: number;
  move?: string;
  level: number;
  tags: string[];
  attacks: MonsterAttack[];
  notes?: string;
  /** Icon path relative to /public/, e.g. "icons/game-icons/lorc/dragon-head.svg". */
  icon?: string;
  /** Source-tracking fields — preserved so the active pool can filter by origin. */
  system?: string;
  source_book?: string;
  source_page?: number;
}

interface RawAttack {
  name: string;
  bonus: number;
  damage: string | number;
  note?: string;
}

interface RawMonster {
  id: string;
  name: string;
  hp_max: number;
  ac: number;
  move?: string;
  level?: number;
  tags?: string[];
  attacks?: RawAttack[];
  notes?: string;
  icon?: string;
  system?: string;
  source_book?: string;
  source_page?: number;
}

interface MonstersFile {
  monsters: RawMonster[];
}

function normalize(raw: RawMonster): Monster {
  return {
    id: raw.id,
    name: raw.name,
    hpMax: raw.hp_max,
    ac: raw.ac,
    move: raw.move,
    level: raw.level ?? 1,
    tags: raw.tags ?? [],
    attacks: (raw.attacks ?? []).map((a) => ({ ...a, damage: String(a.damage) })),
    notes: raw.notes,
    icon: raw.icon,
    system: raw.system,
    source_book: raw.source_book,
    source_page: raw.source_page,
  };
}

const file = rawData as MonstersFile;
export const MONSTERS: Monster[] = file.monsters.map(normalize);

const byId = new Map(MONSTERS.map((m) => [m.id, m]));

export function getMonster(id: string): Monster | undefined {
  return byId.get(id);
}

export function monstersByTag(tag: string): Monster[] {
  return MONSTERS.filter((m) => m.tags.includes(tag));
}

export function monstersByTier(tier: 1 | 2 | 3): Monster[] {
  return monstersByTag(`tier-${tier}`);
}
