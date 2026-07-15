// Typed view onto the rulesets under src/data/rules/.
//
// A ruleset is a structured, human-readable descriptor of a game system: its
// chassis (dice, ability scores, saves), its books, and reference sections
// (deities, classes, monsters-by-source, etc.). Adding a system is a new YAML
// here plus one import line below — same pattern as adventures.

import shadowdarkRaw from '../data/rules/shadowdark.yaml';
import brickQuestRaw from '../data/rules/brick-quest.yaml';
import eqRaw from '../data/rules/eq-rpg.yaml';
import gurpsRaw from '../data/rules/gurps.yaml';
import tesGurpsRaw from '../data/rules/tes-gurps.yaml';
import dnd5eRaw from '../data/rules/dnd-5e-srd.yaml';
import d20Raw from '../data/rules/d20-srd.yaml';
import pathfinder1eRaw from '../data/rules/pathfinder-1e.yaml';
import pathfinder2eRaw from '../data/rules/pathfinder-2e.yaml';
import basicFantasyRaw from '../data/rules/basic-fantasy.yaml';
import osricRaw from '../data/rules/osric.yaml';
import swordsWizardryRaw from '../data/rules/swords-wizardry.yaml';
import cairnRaw from '../data/rules/cairn.yaml';
import dungeonWorldRaw from '../data/rules/dungeon-world.yaml';
import fateCoreRaw from '../data/rules/fate-core.yaml';
import cepheusRaw from '../data/rules/cepheus-engine.yaml';
import basicRoleplayingRaw from '../data/rules/basic-roleplaying.yaml';
import miniSixRaw from '../data/rules/mini-six.yaml';

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
  /** True for house rules played out loud at the table (not reference-only). */
  house?: boolean;
  dice_system?: string;
  ability_scores?: string[];
  saving_throws?: string[];
  setting?: string;
  summary?: string;
  books?: RuleBook[];
  sections?: RuleSection[];
}

// Native engine first, then reference-only systems, grouped by family.
export const RULESETS: Ruleset[] = [
  shadowdarkRaw as Ruleset,
  // House kid rules — played out loud at the table, not in the engine.
  brickQuestRaw as Ruleset,
  // d20 family (the EverQuest RPG sits here too)
  dnd5eRaw as Ruleset,
  d20Raw as Ruleset,
  pathfinder1eRaw as Ruleset,
  pathfinder2eRaw as Ruleset,
  eqRaw as Ruleset,
  // OSR / NSR
  basicFantasyRaw as Ruleset,
  osricRaw as Ruleset,
  swordsWizardryRaw as Ruleset,
  cairnRaw as Ruleset,
  // narrative / parley-forward
  dungeonWorldRaw as Ruleset,
  fateCoreRaw as Ruleset,
  // other engines
  gurpsRaw as Ruleset,
  tesGurpsRaw as Ruleset,
  cepheusRaw as Ruleset,
  basicRoleplayingRaw as Ruleset,
  miniSixRaw as Ruleset,
];

export function getRuleset(id: string): Ruleset | undefined {
  return RULESETS.find((r) => r.id === id);
}

/** The system the app actually runs (falls back to the first ruleset). */
export function nativeRuleset(): Ruleset {
  return RULESETS.find((r) => r.native) ?? RULESETS[0];
}
