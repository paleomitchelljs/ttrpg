// Types for the scripted text-adventure engine.
//
// An Adventure is an authored room graph (see src/data/adventures/*.yaml). A
// GameState is a single playthrough by a party of 1–4 characters. Everything in
// GameState is JSON-serializable so a run can be autosaved to IndexedDB and
// resumed.

// ───────── Authored adventure (static, from YAML) ─────────

export interface AdvExit {
  /** Direction keyword: n/s/e/w/up/down/in/out (or any custom word). */
  dir: string;
  /** Target room id. */
  to: string;
  /** Button label, e.g. "Climb down the knotted rope". */
  label?: string;
  /** If set, the exit is blocked until this flag is present in state. */
  lockedBy?: string;
  /** Message shown when the exit is locked. */
  lockedText?: string;
}

export interface AdvItem {
  name: string;
  description?: string;
  /** Optional flavour gold value, surfaced in the end summary. */
  gold?: number;
}

export interface AdvFeature {
  /** Words the player can examine, e.g. ["pillar", "runes"]. */
  keywords: string[];
  text: string;
  /** Only revealed by `search`. */
  hidden?: boolean;
}

export interface AdvNpc {
  name: string;
  keywords: string[];
  text: string;
  /** Flag set the first time the party talks to this NPC. */
  setsFlag?: string;
}

export interface AdvParley {
  /** Reaction-roll DC (1d20 + party's best CHA mod). If omitted, there is no
   *  talk-your-way-out option: the foe will only stand down for the price. */
  dc?: number;
  /** The price. Holding this item lets you pay it; on success it is SURRENDERED
   *  (removed from inventory). The hard choice: give up a thing you wanted. */
  costItem?: string;
  /** A toll in vitality: every conscious hero loses this much HP (current & max,
   *  floored at 1) on a successful parley. Blood, courage, years. */
  costHp?: number;
  /** Only offer this parley once this flag is set (e.g. you freed someone first). */
  requiresFlag?: string;
  /** The foe's demand and drive, shown when the fight begins. */
  prompt?: string;
  /** Text on a successful parley (the foe stands down / cuts a deal). */
  successText: string;
  /** Text on a failed or impossible parley. Combat continues; if a roll failed,
   *  the foes also act. */
  failureText?: string;
  /** Flag set on a successful parley (in addition to the encounter flag). */
  grantsFlag?: string;
}

export interface AdvEncounter {
  id: string;
  /** Monster ids from monsters.yaml; repeats allowed. */
  monsters: string[];
  intro?: string;
  victoryText?: string;
  /** Flag set on victory (or successful parley) so it never repeats. */
  flag?: string;
  /** Items dropped into the room when the fight is won. */
  loot?: AdvItem[];
  /** If present, the party can `negotiate` their way past this fight. */
  parley?: AdvParley;
}

export interface AdvRoom {
  id: string;
  name: string;
  description: string;
  /** Extra text shown only on first entry. */
  firstVisit?: string;
  /** Text revealed by `search`. */
  searchText?: string;
  exits: AdvExit[];
  items: AdvItem[];
  features: AdvFeature[];
  npcs: AdvNpc[];
  encounter?: AdvEncounter;
  /** Whether resting (short recovery) is allowed here. */
  safe?: boolean;
  /** Winning this room's fight (or entering it, if no fight) ends the adventure. */
  objective?: boolean;
  winText?: string;
}

export interface Adventure {
  id: string;
  title: string;
  system: string;
  synopsis: string;
  recommendedParty?: string;
  /** Path under public/ for the reference map. */
  mapImage?: string;
  /** Read-aloud text shown when the party embarks. */
  intro?: string;
  start: string;
  rooms: AdvRoom[];
  roomsById: Record<string, AdvRoom>;
}

// ───────── Live playthrough (serializable) ─────────

export type MessageKind =
  | 'room'
  | 'echo'
  | 'result'
  | 'combat'
  | 'system'
  | 'error'
  | 'win'
  | 'lose';

export interface GameMessage {
  id: number;
  kind: MessageKind;
  text: string;
}

export interface PartyMemberState {
  /** Stored Character id. */
  id: string;
  name: string;
  portraitArtId?: string;
  className?: string;
  // Combat profile snapshot (taken at embark).
  attackMod: number;
  damageDie: string;
  damageMod: number;
  ac: number;
  /** Charisma modifier, used for parley reaction rolls. */
  chaMod: number;
  weaponName: string;
  hp: { current: number; max: number };
  /** Has this member acted in the current combat round. */
  acted: boolean;
}

export interface EnemyState {
  /** Unique instance id within the fight. */
  id: string;
  monsterId: string;
  name: string;
  ac: number;
  hp: { current: number; max: number };
  attacks: { name: string; bonus: number; damage: string }[];
  /** Monster tags, used to decide whether a foe can be reasoned with. */
  tags: string[];
}

export interface CombatState {
  encounterId: string;
  enemies: EnemyState[];
  round: number;
}

export interface GameState {
  adventureId: string;
  currentRoomId: string;
  prevRoomId?: string;
  party: PartyMemberState[];
  /** Index of the member whose turn/selection is active. */
  activeIndex: number;
  visited: string[];
  inventory: AdvItem[];
  flags: string[];
  /** "roomId::itemName" markers for items already collected. */
  takenItems: string[];
  /** Items added to a room at runtime (combat loot, dropped items). */
  extraItems: { roomId: string; item: AdvItem }[];
  /** Room ids already searched. */
  searched: string[];
  /** Room ids where the party has already rested (one short rest per room). */
  rested: string[];
  mode: 'explore' | 'combat' | 'over';
  outcome?: 'win' | 'lose';
  combat?: CombatState;
  transcript: GameMessage[];
  /** Monotonic id counter for transcript messages. */
  messageSeq: number;
}
