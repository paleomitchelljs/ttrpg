export type StatId = 'STR' | 'DEX' | 'CON' | 'INT' | 'WIS' | 'CHA';

export const STAT_IDS: StatId[] = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];

export const STAT_NAMES: Record<StatId, string> = {
  STR: 'Strength',
  DEX: 'Dexterity',
  CON: 'Constitution',
  INT: 'Intelligence',
  WIS: 'Wisdom',
  CHA: 'Charisma',
};

export type StatBlock = Record<StatId, number>;

export type Alignment = 'Lawful' | 'Neutral' | 'Chaotic';

export interface Ancestry {
  id: string;
  name: string;
  description: string;
  trait: string;
  languages: string[];
}

export interface CharacterClass {
  id: string;
  name: string;
  hitDie: number;
  weapons: string;
  armor: string;
  description: string;
  features: { name: string; text: string }[];
  /** Spellcasting stat if this is a caster. */
  spellStat?: StatId;
  /** Tier 1 spells learnable at level 1. */
  startingSpellCount?: number;
}

export interface Background {
  roll: number;
  name: string;
  description: string;
}

export interface Deity {
  name: string;
  alignment: Alignment;
  description: string;
}

export interface Spell {
  name: string;
  tier: number;
  duration: string;
  range: string;
  type: 'Wizard' | 'Priest';
  text: string;
}

export interface GearItem {
  name: string;
  cost?: string;
  slots: number;
  tags?: string[];
  notes?: string;
}

export interface Character {
  id: string;
  createdAt: number;
  updatedAt: number;
  name: string;
  ancestryId: string;
  classId: string;
  alignment: Alignment;
  background: string;
  deity?: string;
  level: number;
  xp: number;
  stats: StatBlock;
  hp: { max: number; current: number };
  ac: number;
  gold: number;
  gear: { name: string; quantity?: number; slots?: number }[];
  spells: string[];
  portraitArtId?: string;
  notes?: string;
  /** Title from the class table. */
  title?: string;
}
