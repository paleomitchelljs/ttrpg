// Typed view onto the authored adventures under src/data/adventures/.
//
// Rooms may borrow their prose from scenes.yaml via `scene_id` so the same
// hand-written room descriptions power both the "Roll a scene" tool and the
// text adventure (DRY). Anything authored inline on the room overrides it.

import sunlessRaw from '../../data/adventures/sunless-citadel.yaml';
import permafrostRaw from '../../data/adventures/permafrost.yaml';
import kaesoraRaw from '../../data/adventures/kaesora.yaml';
import charasisRaw from '../../data/adventures/charasis.yaml';
import cityOfMistRaw from '../../data/adventures/city-of-mist.yaml';
import dalnirRaw from '../../data/adventures/dalnir.yaml';
import cazicThuleRaw from '../../data/adventures/cazic-thule.yaml';
import najenaRaw from '../../data/adventures/najena.yaml';
import redDragonsTaleRaw from '../../data/adventures/red-dragons-tale.yaml';
import tombOfTheSerpentKingsRaw from '../../data/adventures/tomb-of-the-serpent-kings.yaml';
import blackWyrmRaw from '../../data/adventures/black-wyrm-of-brandonsford.yaml';
import hatedPretenderRaw from '../../data/adventures/prison-of-the-hated-pretender.yaml';
import chaoticCavesRaw from '../../data/adventures/chaotic-caves.yaml';
import { SCENES } from '../shadowdark/scenes';
import type {
  Adventure,
  AdvEncounter,
  AdvExit,
  AdvFeature,
  AdvItem,
  AdvNpc,
  AdvRoom,
} from './types';

interface RawNpc {
  name: string;
  keywords?: string[];
  text: string;
  sets_flag?: string;
}

interface RawExit {
  dir: string;
  to: string;
  label?: string;
  locked_by?: string;
  locked_text?: string;
}

interface RawParleyModifier {
  offer?: string;
  knows?: string;
  allied?: string;
  sacrifice_hp?: number;
  bonus: number;
  consume?: boolean;
  label?: string;
}

interface RawParley {
  dc: number;
  modifiers?: RawParleyModifier[];
  requires_flag?: string;
  prompt?: string;
  success_text: string;
  failure_text?: string;
  grants_flag?: string;
}

interface RawEncounter {
  id: string;
  monsters: string[];
  intro?: string;
  victory_text?: string;
  flag?: string;
  loot?: AdvItem[];
  parley?: RawParley;
}

interface RawRoom {
  id: string;
  scene_id?: string;
  name?: string;
  description?: string;
  first_visit?: string;
  search_text?: string;
  exits?: RawExit[];
  items?: AdvItem[];
  features?: AdvFeature[];
  npcs?: RawNpc[];
  encounter?: RawEncounter;
  safe?: boolean;
  objective?: boolean;
  win_text?: string;
}

/** Per-room map geometry: `pin: [x, y]` and/or `region: [x, y, w, h]`, all in
 *  normalized 0–1 image coordinates. Authored (or pasted from the in-app
 *  calibration tool) as one adventure-level block so room bodies stay clean. */
interface RawCalibration {
  pin?: [number, number];
  region?: [number, number, number, number];
}

interface RawAdventure {
  id: string;
  title: string;
  system: string;
  synopsis: string;
  recommended_party?: string;
  map_image?: string;
  map_calibration?: Record<string, RawCalibration>;
  intro?: string;
  start: string;
  rooms: RawRoom[];
}

const sceneById = new Map(SCENES.map((s) => [s.id, s]));

function normExit(r: RawExit): AdvExit {
  return {
    dir: r.dir,
    to: r.to,
    label: r.label,
    lockedBy: r.locked_by,
    lockedText: r.locked_text,
  };
}

function normNpc(r: RawNpc): AdvNpc {
  return {
    name: r.name,
    keywords: r.keywords ?? [],
    text: r.text,
    setsFlag: r.sets_flag,
  };
}

function normEncounter(r: RawEncounter): AdvEncounter {
  return {
    id: r.id,
    monsters: r.monsters ?? [],
    intro: r.intro,
    victoryText: r.victory_text,
    flag: r.flag,
    loot: r.loot,
    parley: r.parley
      ? {
          dc: r.parley.dc,
          modifiers: (r.parley.modifiers ?? []).map((m) => ({
            offer: m.offer,
            knows: m.knows,
            allied: m.allied,
            sacrificeHp: m.sacrifice_hp,
            bonus: m.bonus,
            consume: m.consume,
            label: m.label,
          })),
          requiresFlag: r.parley.requires_flag,
          prompt: r.parley.prompt,
          successText: r.parley.success_text,
          failureText: r.parley.failure_text,
          grantsFlag: r.parley.grants_flag,
        }
      : undefined,
  };
}

function normRoom(r: RawRoom): AdvRoom {
  const scene = r.scene_id ? sceneById.get(r.scene_id) : undefined;
  const name = r.name ?? scene?.name ?? r.id;
  const description = r.description ?? scene?.description ?? '';
  return {
    id: r.id,
    name,
    description,
    firstVisit: r.first_visit,
    searchText: r.search_text,
    exits: (r.exits ?? []).map(normExit),
    items: r.items ?? [],
    features: (r.features ?? []) as AdvFeature[],
    npcs: (r.npcs ?? []).map(normNpc),
    encounter: r.encounter ? normEncounter(r.encounter) : undefined,
    safe: r.safe,
    objective: r.objective,
    winText: r.win_text,
  };
}

function normAdventure(raw: RawAdventure): Adventure {
  const rooms = raw.rooms.map(normRoom);
  for (const room of rooms) {
    const cal = raw.map_calibration?.[room.id];
    if (!cal) continue;
    if (cal.pin) room.mapPin = { x: cal.pin[0], y: cal.pin[1] };
    if (cal.region) room.mapRegion = { x: cal.region[0], y: cal.region[1], w: cal.region[2], h: cal.region[3] };
  }
  const roomsById: Record<string, AdvRoom> = {};
  for (const room of rooms) roomsById[room.id] = room;
  return {
    id: raw.id,
    title: raw.title,
    system: raw.system,
    synopsis: raw.synopsis,
    recommendedParty: raw.recommended_party,
    mapImage: raw.map_image,
    intro: raw.intro,
    start: raw.start,
    rooms,
    roomsById,
  };
}

export const ADVENTURES: Adventure[] = [
  normAdventure(sunlessRaw as RawAdventure),
  normAdventure(permafrostRaw as RawAdventure),
  normAdventure(kaesoraRaw as RawAdventure),
  normAdventure(charasisRaw as RawAdventure),
  normAdventure(cityOfMistRaw as RawAdventure),
  normAdventure(dalnirRaw as RawAdventure),
  normAdventure(cazicThuleRaw as RawAdventure),
  normAdventure(najenaRaw as RawAdventure),
  normAdventure(redDragonsTaleRaw as RawAdventure),
  normAdventure(tombOfTheSerpentKingsRaw as RawAdventure),
  normAdventure(blackWyrmRaw as RawAdventure),
  normAdventure(hatedPretenderRaw as RawAdventure),
  normAdventure(chaoticCavesRaw as RawAdventure),
];

export function getAdventure(id: string): Adventure | undefined {
  return ADVENTURES.find((a) => a.id === id);
}
