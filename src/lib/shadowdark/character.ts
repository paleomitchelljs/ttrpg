// Character generation helpers tying together the Shadowdark rules data.

import { pick, roll, roll3d6, statMod } from '../dice';
import { ANCESTRIES, getAncestry } from './ancestries';
import { BACKGROUNDS } from './backgrounds';
import { CLASSES, getClass } from './classes';
import { DEITIES } from './deities';
import { NAMES } from './names';
import { spellsForClass } from './spells';
import { STARTING_GEAR } from './gear';
import { STAT_IDS, type Alignment, type Character, type StatBlock } from './types';

export function rollStats(): StatBlock {
  return STAT_IDS.reduce((acc, id) => {
    acc[id] = roll3d6();
    return acc;
  }, {} as StatBlock);
}

export function rollAncestry() {
  return pick(ANCESTRIES);
}

export function rollClass() {
  return pick(CLASSES);
}

export function rollAlignment(): Alignment {
  // 1 = Lawful, 2-4 = Neutral, 5-6 = Chaotic per typical Shadowdark distribution
  const r = roll('1d6').total;
  if (r === 1) return 'Lawful';
  if (r <= 4) return 'Neutral';
  return 'Chaotic';
}

export function rollBackground() {
  return pick(BACKGROUNDS);
}

export function rollName(ancestryId: string): string {
  const list = NAMES[ancestryId] ?? NAMES.human;
  return pick(list);
}

export function rollGold(classId: string): number {
  const base = roll('2d6').total * 5;
  if (classId === 'fighter') return base + 60;
  return base;
}

export function rollDeity(alignment: Alignment) {
  const matching = DEITIES.filter((d) => d.alignment === alignment);
  return matching.length > 0 ? pick(matching) : pick(DEITIES);
}

/**
 * Compute starting HP per Shadowdark: roll class HD + CON mod (min 1).
 * Dwarves get +2 and roll their HD with advantage.
 */
export function rollStartingHP(classId: string, ancestryId: string, conMod: number): number {
  const cls = getClass(classId);
  if (!cls) return 1;
  const die = `1d${cls.hitDie}`;
  let rollVal: number;
  if (ancestryId === 'dwarf') {
    rollVal = Math.max(roll(die).total, roll(die).total);
  } else {
    rollVal = roll(die).total;
  }
  let hp = rollVal + conMod;
  if (ancestryId === 'dwarf') hp += 2;
  return Math.max(1, hp);
}

/** Base AC = 10 + DEX modifier with no armor. Armor modifies this. */
export function computeAC(stats: StatBlock): number {
  return 10 + statMod(stats.DEX);
}

export function newCharacterId(): string {
  return `char_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Roll a full character in one shot for the "Quick roll" button. */
export function rollQuickCharacter(): Omit<Character, 'id' | 'createdAt' | 'updatedAt'> {
  const stats = rollStats();
  const ancestry = rollAncestry();
  const cls = rollClass();
  const alignment = rollAlignment();
  const background = rollBackground();
  const name = rollName(ancestry.id);
  const conMod = statMod(stats.CON);
  const hp = rollStartingHP(cls.id, ancestry.id, conMod);
  const gold = rollGold(cls.id);
  const starting = STARTING_GEAR[cls.id];
  const gear = (starting?.items ?? []).map((name) => ({ name }));
  const deity = cls.id === 'priest' ? rollDeity(alignment).name : undefined;
  let spells: string[] = [];
  if (cls.spellStat && cls.startingSpellCount) {
    const pool = spellsForClass(cls.id);
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    spells = shuffled.slice(0, cls.startingSpellCount).map((s) => s.name);
    if (cls.id === 'priest' && !spells.includes('Turn Undead')) {
      spells = ['Turn Undead', ...spells].slice(0, cls.startingSpellCount);
    }
  }
  const equipment = { ...(starting?.equipment ?? {}) };
  return {
    name,
    ancestryId: ancestry.id,
    classId: cls.id,
    alignment,
    background: background.name,
    deity,
    level: 1,
    xp: 0,
    stats,
    hp: { max: hp, current: hp },
    ac: computeAC(stats),
    gold,
    gear,
    equipment,
    spells,
    notes: '',
  };
}

export { getAncestry, getClass };
