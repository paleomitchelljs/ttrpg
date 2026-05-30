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

/** What a spell does when cast in adventure combat. Data-driven so new combat
 *  spells need no engine change (as long as `kind` is one the engine handles). */
export type SpellCombatKind =
  | 'damage'
  | 'heal'
  | 'turn'
  | 'sleep'
  | 'charm'
  | 'buff-ac'
  | 'buff-atk'
  | 'none';

export interface SpellCombat {
  kind: SpellCombatKind;
  /** Dice for damage/heal, e.g. "1d4+1". */
  dice?: string;
  /** AC bonus for buff-ac. */
  amount?: number;
  /** Attack/damage bonuses for buff-atk. */
  atk?: number;
  dmg?: number;
  /** buff-ac that always targets the caster. */
  self?: boolean;
}

export interface Spell {
  /** kebab-case unique id. */
  id: string;
  name: string;
  tier: number;
  /** Classes that can learn it (lowercase class ids), e.g. ["wizard"] or ["wizard","priest"]. */
  classes: string[];
  duration: string;
  range: string;
  text: string;
  /** Free-form tags for search/filter: damage, healing, fire, undead, control, buff, utility… */
  tags: string[];
  /** Combat behavior; absent means it does nothing useful in a fight. */
  combat?: SpellCombat;
  /** Source-tracking (matches the rest of the data; enables active-pool filtering). */
  system?: string;
  source_book?: string;
  source_page?: number;
}

export interface GearItem {
  name: string;
  cost?: string;
  slots: number;
  tags?: string[];
  notes?: string;
}

export interface Equipment {
  /** Weapon name (must match a WEAPONS entry). */
  mainHand?: string;
  /** Off-hand weapon or shield name. */
  offHand?: string;
  /** Armor name (chest piece). */
  armor?: string;
  /** Helmet name. */
  helmet?: string;
}

export interface EncounterMonster {
  /** Unique instance id within the encounter. */
  id: string;
  /** ID into MONSTERS (monsters.yaml). */
  monsterId: string;
  /** Display label, e.g. "Goblin A" — defaults to monster name. */
  label: string;
  hp: { current: number; max: number };
  /** Optional notes the GM can scribble per-instance. */
  notes?: string;
  /** Optional zone label (front, back, far, hidden…). */
  zone?: string;
}

export interface Encounter {
  id: string;
  createdAt: number;
  updatedAt: number;
  name: string;
  monsters: EncounterMonster[];
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
  equipment?: Equipment;
  spells: string[];
  portraitArtId?: string;
  notes?: string;
  /** Title from the class table. */
  title?: string;
}
