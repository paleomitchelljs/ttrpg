// Typed view onto src/data/spells.yaml. Mirrors monsters.ts / scenes.ts.
//
// Spells are hand-editable YAML: tagged, searchable, and expandable. A new spell
// is a YAML entry, not a code change — including its combat behavior, which lives
// in the `combat` block and is read by the adventure engine.

import rawData from '../../data/spells.yaml';
import type { Spell, SpellCombat } from './types';
import { filterByActivePool } from './activePool';

interface RawSpell {
  id: string;
  name: string;
  tier?: number;
  classes?: string[];
  duration?: string;
  range?: string;
  text?: string;
  tags?: string[];
  combat?: SpellCombat;
  system?: string;
  source_book?: string;
  source_page?: number;
}

interface SpellsFile {
  spells: RawSpell[];
}

function normalize(raw: RawSpell): Spell {
  return {
    id: raw.id,
    name: raw.name,
    tier: raw.tier ?? 1,
    classes: raw.classes ?? [],
    duration: raw.duration ?? '',
    range: raw.range ?? '',
    text: raw.text ?? '',
    tags: raw.tags ?? [],
    combat: raw.combat,
    system: raw.system,
    source_book: raw.source_book,
    source_page: raw.source_page,
  };
}

const file = rawData as SpellsFile;
export const SPELLS: Spell[] = file.spells.map(normalize);

const byId = new Map(SPELLS.map((s) => [s.id, s]));
const byName = new Map(SPELLS.map((s) => [s.name.toLowerCase(), s]));

/** Look up by display name (case-insensitive). Characters store spells by name. */
export function getSpell(name: string): Spell | undefined {
  return byName.get(name.toLowerCase());
}

export function getSpellById(id: string): Spell | undefined {
  return byId.get(id);
}

/** Spells a given class can learn (lowercase class id, e.g. "wizard"). */
export function spellsForClass(classId: string): Spell[] {
  return SPELLS.filter((s) => s.classes.includes(classId));
}

export function spellsByTier(tier: number): Spell[] {
  return SPELLS.filter((s) => s.tier === tier);
}

export function spellsByTag(tag: string): Spell[] {
  const t = tag.toLowerCase();
  return SPELLS.filter((s) => s.tags.some((x) => x.toLowerCase() === t));
}

/**
 * Free-text search across name, tags, class, and rules text. Multiple
 * space-separated terms must all match (AND).
 */
export function searchSpells(query: string): Spell[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return SPELLS;
  return SPELLS.filter((s) => {
    const hay = [s.name, s.text, s.classes.join(' '), s.tags.join(' '), `tier${s.tier}`]
      .join(' ')
      .toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}

/** Spells eligible under the active pool (by system/source_book/tags). */
export function spellsInActivePool(): Spell[] {
  return filterByActivePool(SPELLS);
}
