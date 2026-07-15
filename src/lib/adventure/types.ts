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
  /** Torch fuel: taking this item adds N spare torches instead of going into
   *  the pack (it can't be dropped, offered, or lost — it's light, not loot). */
  torches?: number;
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

/** One lever that improves a parley check. Exactly one trigger is set; when that
 *  trigger is satisfied the modifier's `bonus` is added to the 1d20 + CHA roll.
 *  This is how legwork pays off: an offering, a learned secret, a faction won
 *  over, or a costly gesture each tilt the odds instead of auto-winning. */
export interface AdvParleyModifier {
  /** An item the foe covets. Held in inventory → bonus; SURRENDERED on success
   *  unless `consume: false`. The hard choice: give up a thing you wanted. */
  offer?: string;
  /** A flag standing for information learned (an NPC's secret, a clue). */
  knows?: string;
  /** A flag standing for factional work: a favor done, an alliance struck. */
  allied?: string;
  /** A toll in vitality paid ON SUCCESS: every conscious hero loses this much HP
   *  (current & max, floored at 1). Blood, courage, years, traded for goodwill. */
  sacrificeHp?: number;
  /** Bonus added to the CHA check when this modifier is active. */
  bonus: number;
  /** For `offer`: surrender the item on success (default true). */
  consume?: boolean;
  /** Short label for the play-UI breakdown, e.g. "the witch's truth". */
  label?: string;
}

export interface AdvParley {
  /** Target number for the speech check: 1d20 + party's best CHA mod + the sum of
   *  every active modifier's bonus. A natural 20 always succeeds. */
  dc: number;
  /** Levers that add to the check: offerings, information, faction work, deals. */
  modifiers?: AdvParleyModifier[];
  /** Hard gate: the foe will not even listen until this flag is set. Rare; most
   *  prerequisites should be a `knows`/`allied` bonus instead of a wall. */
  requiresFlag?: string;
  /** The foe's demand and drive, shown when the fight begins. */
  prompt?: string;
  /** Text on a successful parley (the foe stands down / cuts a deal). */
  successText: string;
  /** Text on a failed parley. Combat continues and the foes act. */
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

/** A point on the reference map, in normalized 0–1 image coordinates. */
export interface MapPoint {
  x: number;
  y: number;
}

/** A rectangle on the reference map, normalized 0–1 (x/y = top-left). */
export interface MapRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AdvRoom {
  id: string;
  name: string;
  description: string;
  /** Where the party marker sits on the reference map (normalized coords).
   *  Authored via the adventure-level `map_calibration` YAML block. */
  mapPin?: MapPoint;
  /** The patch of reference map this room reveals through the fog. */
  mapRegion?: MapRect;
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

/** How a resolved roll turned out, used to pick the verdict banner. */
export type RollOutcome =
  | 'crit'
  | 'hit'
  | 'miss'
  | 'fumble'
  | 'success'
  | 'failure'
  | 'plain';

/** One labeled slice of a roll's flat bonus, e.g. { label: "STR", value: 3 }. */
export interface RollPart {
  label: string;
  value: number;
}

/** A die roll rendered cinematically (BG3-style) before its message is shown.
 *  Serializable snapshot of everything the dice overlay needs to replay it. */
export interface RollPayload {
  kind: 'attack' | 'damage' | 'heal' | 'cast' | 'parley' | 'check';
  /** Hero rolls get the full-screen treatment; enemy rolls play as toasts. */
  side: 'hero' | 'enemy';
  /** Headline, e.g. "Thorn attacks Goblin 2". */
  title: string;
  expression: string;
  mode: 'normal' | 'advantage' | 'disadvantage';
  /** Die size of the rolled dice (20 for checks; 6/8/… for damage). */
  sides: number;
  /** Kept die values, in roll order. */
  rolls: number[];
  /** The die dropped by advantage/disadvantage, if any. */
  dropped?: number;
  /** Modifier breakdown chips. */
  parts: RollPart[];
  total: number;
  /** Number to beat (AC or DC), when this is a contested roll. */
  target?: number;
  /** Plate label, e.g. "AC 13" or "DC 12". */
  targetLabel?: string;
  outcome: RollOutcome;
}

export interface GameMessage {
  id: number;
  kind: MessageKind;
  text: string;
  /** When set, the UI plays this roll before revealing the message text. */
  roll?: RollPayload;
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
  /** Dexterity modifier, used for initiative. */
  dexMod: number;
  weaponName: string;
  /** Known spell names (empty for non-casters). */
  spells: string[];
  /** Spellcasting modifier: INT for wizards, WIS for priests. */
  spellMod: number;
  hp: { current: number; max: number };
  /** Has this member acted in the current combat round. */
  acted: boolean;
  /** Spells lost (failed cast) this fight; reset on a new combat. */
  spentSpells: string[];
  /** Temporary combat buffs from spells; reset on a new combat. */
  atkBonus: number;
  dmgBonus: number;
  acBonus: number;
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
  /** Icon path relative to /public/, for the combat HUD card. */
  icon?: string;
}

/** One slot in the initiative order: a hero (by character id) or an enemy
 *  instance (by its fight-local id). */
export interface TurnRef {
  side: 'hero' | 'enemy';
  refId: string;
  name: string;
  /** The initiative roll, shown on the tracker. */
  init: number;
}

export interface CombatState {
  encounterId: string;
  enemies: EnemyState[];
  round: number;
  /** Full initiative order (heroes and enemies interleaved), high roll first. */
  order: TurnRef[];
  /** Index into `order` of whoever is acting now. */
  turnIndex: number;
  /** Set once the surviving foes have tested their nerve (one check per fight). */
  moraleChecked?: boolean;
}

/** Party light source. `lit` is the burn left on the current torch, measured in
 *  "ticks" (one per room entered, one per combat round). 0 means darkness:
 *  heroes attack with disadvantage, foes with advantage, and searching fails. */
export interface LightState {
  lit: number;
  /** Spare torches carried. */
  spares: number;
}

export interface GameState {
  adventureId: string;
  /** Target level the dungeon's monsters are scaled to (party avg, or override). */
  powerLevel: number;
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
  /** Torchlight tracking (Shadowdark's clock). */
  light: LightState;
  mode: 'explore' | 'combat' | 'over';
  outcome?: 'win' | 'lose';
  combat?: CombatState;
  transcript: GameMessage[];
  /** Monotonic id counter for transcript messages. */
  messageSeq: number;
}
