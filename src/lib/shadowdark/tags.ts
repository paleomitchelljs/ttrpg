// Typed view onto src/data/tags.yaml — the controlled content-tag vocabulary.
//
// Threat and role are the two axes that matter for play and for any future
// cross-system stat conversion. Threat is read straight off a monster's `tier-N`
// tag; role is read off an explicit role keyword if present, otherwise derived
// from the creature type. Special abilities are NOT derivable from tags — they
// live in each monster's `notes` and stay as authored.

import rawData from '../../data/tags.yaml';

export interface TagEntry {
  id: string;
  name?: string;
  description?: string;
  profile?: string;
}

interface TagsFile {
  threats: TagEntry[];
  roles: TagEntry[];
  creature_types: TagEntry[];
  themes: TagEntry[];
}

const file = rawData as TagsFile;
export const THREAT_TAGS: TagEntry[] = file.threats ?? [];
export const ROLE_TAGS: TagEntry[] = file.roles ?? [];
export const CREATURE_TYPE_TAGS: TagEntry[] = file.creature_types ?? [];
export const THEME_TAGS: TagEntry[] = file.themes ?? [];

const THREAT_IDS = new Set(THREAT_TAGS.map((t) => t.id));

// Creature type → default role, used only when a monster carries no role keyword.
const TYPE_DEFAULT_ROLE: Record<string, string> = {
  giant: 'brute',
  ooze: 'brute',
  elemental: 'brute',
  plant: 'brute',
  humanoid: 'soldier',
  goblinoid: 'soldier',
  gnoll: 'soldier',
  construct: 'soldier',
  undead: 'soldier',
  reptilian: 'soldier',
  beast: 'skirmisher',
  vermin: 'skirmisher',
  aberration: 'skirmisher',
  fiend: 'caster',
  vampire: 'caster',
  dragon: 'solo',
  kobold: 'minion',
};

/**
 * A monster's threat tier from its tags. A `boss`/`solo` foe with no explicit
 * `tier-N` is treated as tier-3 (apex); everything else defaults to tier-1.
 */
export function monsterThreat(m: { tags: string[] }): string {
  const explicit = m.tags.find((t) => THREAT_IDS.has(t));
  if (explicit) return explicit;
  if (m.tags.includes('boss') || m.tags.includes('solo')) return 'tier-3';
  return 'tier-1';
}

/**
 * A monster's combat role. Honors an explicit role keyword if there is one;
 * an apex (tier-3) boss is a `solo`, a lesser boss with no clearer role reads as
 * a `leader`, and anything still unresolved derives from its creature type.
 * Always returns one of the role ids in tags.yaml.
 */
export function monsterRole(m: { tags: string[] }): string {
  const tags = m.tags;
  const apex = (tags.includes('boss') || tags.includes('solo')) && monsterThreat(m) === 'tier-3';
  if (apex) return 'solo';
  if (tags.includes('leader')) return 'leader';
  if (tags.includes('swarm') || tags.includes('minion')) return 'minion';
  if (tags.includes('caster')) return 'caster';
  if (tags.includes('artillery')) return 'artillery';
  if (tags.includes('brute')) return 'brute';
  if (tags.includes('soldier')) return 'soldier';
  if (tags.includes('skirmisher')) return 'skirmisher';
  if (tags.includes('boss') || tags.includes('solo')) return 'leader';
  for (const t of tags) {
    if (TYPE_DEFAULT_ROLE[t]) return TYPE_DEFAULT_ROLE[t];
  }
  return 'skirmisher';
}
