// Typed view onto the rulesets under src/data/rules/.
//
// A ruleset is a structured, human-readable descriptor of a game system: its
// chassis (dice, ability scores, saves), its books, and reference sections
// (deities, classes, monsters-by-source, etc.). Adding a system is a new YAML
// here plus one import line below — same pattern as adventures.

import shadowdarkRaw from '../data/rules/shadowdark.yaml';
import eqRaw from '../data/rules/eq-rpg.yaml';
import gurpsRaw from '../data/rules/gurps.yaml';
import tesGurpsRaw from '../data/rules/tes-gurps.yaml';

export interface RuleBook {
  id: string;
  name: string;
  year?: number | null;
  pages?: number;
  summary?: string;
}

/** Section entries vary by section (a deity, a class, a spell…). Common fields
 *  are typed; everything else is preserved for generic display. */
export interface RuleEntry {
  id?: string;
  name: string;
  summary?: string;
  description?: string;
  text?: string;
  [key: string]: unknown;
}

export interface RuleSection {
  id: string;
  name: string;
  source_book?: string;
  source_page?: number;
  description?: string;
  entries?: RuleEntry[];
}

export interface Ruleset {
  id: string;
  name: string;
  publisher?: string;
  license?: string;
  year?: number | null;
  edition?: string;
  /** True for the system the app actually resolves play with (Shadowdark). */
  native?: boolean;
  dice_system?: string;
  ability_scores?: string[];
  saving_throws?: string[];
  setting?: string;
  summary?: string;
  books?: RuleBook[];
  sections?: RuleSection[];
}

// Native engine first, then reference-only systems.
export const RULESETS: Ruleset[] = [
  shadowdarkRaw as Ruleset,
  eqRaw as Ruleset,
  gurpsRaw as Ruleset,
  tesGurpsRaw as Ruleset,
];

export function getRuleset(id: string): Ruleset | undefined {
  return RULESETS.find((r) => r.id === id);
}

/** The system the app actually runs (falls back to the first ruleset). */
export function nativeRuleset(): Ruleset {
  return RULESETS.find((r) => r.native) ?? RULESETS[0];
}
