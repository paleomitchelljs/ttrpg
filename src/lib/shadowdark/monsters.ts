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
}

interface RawAttack {
  name: string;
  bonus: number;
  damage: string;
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
    attacks: raw.attacks ?? [],
    notes: raw.notes,
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
