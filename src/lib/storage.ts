import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Character, Encounter } from './shadowdark/types';
import type { GameState } from './adventure/types';

export interface AdventureSave {
  /** Single autosave slot per device for now. */
  id: string;
  adventureId: string;
  partyIds: string[];
  state: GameState;
  updatedAt: number;
}

interface PortalDB extends DBSchema {
  characters: {
    key: string;
    value: Character;
    indexes: { 'by-updated': number };
  };
  encounters: {
    key: string;
    value: Encounter;
    indexes: { 'by-updated': number };
  };
  art: {
    key: string;
    value: { id: string; blob: Blob; type: string; createdAt: number };
  };
  adventureSaves: {
    key: string;
    value: AdventureSave;
  };
}

const DB_NAME = 'shadowdark-portal';
const DB_VERSION = 3;

/** Fixed key for the single autosave slot. */
export const CURRENT_SAVE_ID = 'current';

let dbPromise: Promise<IDBPDatabase<PortalDB>> | null = null;

function getDB(): Promise<IDBPDatabase<PortalDB>> {
  if (!dbPromise) {
    dbPromise = openDB<PortalDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('characters')) {
          const store = db.createObjectStore('characters', { keyPath: 'id' });
          store.createIndex('by-updated', 'updatedAt');
        }
        if (!db.objectStoreNames.contains('art')) {
          db.createObjectStore('art', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('encounters')) {
          const store = db.createObjectStore('encounters', { keyPath: 'id' });
          store.createIndex('by-updated', 'updatedAt');
        }
        if (!db.objectStoreNames.contains('adventureSaves')) {
          db.createObjectStore('adventureSaves', { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
}

export async function listCharacters(): Promise<Character[]> {
  const db = await getDB();
  const all = await db.getAll('characters');
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getCharacter(id: string): Promise<Character | undefined> {
  const db = await getDB();
  return db.get('characters', id);
}

export async function saveCharacter(character: Character): Promise<void> {
  const db = await getDB();
  await db.put('characters', { ...character, updatedAt: Date.now() });
}

export async function deleteCharacter(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('characters', id);
}

export async function saveArt(blob: Blob): Promise<string> {
  const db = await getDB();
  const id = `art_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await db.put('art', { id, blob, type: blob.type, createdAt: Date.now() });
  return id;
}

export async function getArt(id: string): Promise<Blob | undefined> {
  const db = await getDB();
  const record = await db.get('art', id);
  return record?.blob;
}

export async function deleteArt(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('art', id);
}

export async function listEncounters(): Promise<Encounter[]> {
  const db = await getDB();
  const all = await db.getAll('encounters');
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getEncounter(id: string): Promise<Encounter | undefined> {
  const db = await getDB();
  return db.get('encounters', id);
}

export async function saveEncounter(encounter: Encounter): Promise<void> {
  const db = await getDB();
  await db.put('encounters', { ...encounter, updatedAt: Date.now() });
}

export async function deleteEncounter(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('encounters', id);
}

export async function saveAdventure(
  state: GameState,
  partyIds: string[],
  id: string = CURRENT_SAVE_ID,
): Promise<void> {
  const db = await getDB();
  await db.put('adventureSaves', {
    id,
    adventureId: state.adventureId,
    partyIds,
    state,
    updatedAt: Date.now(),
  });
}

export async function getAdventureSave(id: string = CURRENT_SAVE_ID): Promise<AdventureSave | undefined> {
  const db = await getDB();
  return db.get('adventureSaves', id);
}

export async function clearAdventureSave(id: string = CURRENT_SAVE_ID): Promise<void> {
  const db = await getDB();
  await db.delete('adventureSaves', id);
}

/** Convert all stored data into a JSON-serializable backup. */
export async function exportAll(): Promise<string> {
  const db = await getDB();
  const characters = await db.getAll('characters');
  const encounters = await db.getAll('encounters');
  const adventureSaves = await db.getAll('adventureSaves');
  const artRecords = await db.getAll('art');
  const art = await Promise.all(
    artRecords.map(async (r) => ({
      id: r.id,
      type: r.type,
      createdAt: r.createdAt,
      data: await blobToBase64(r.blob),
    }))
  );
  return JSON.stringify({ version: 3, characters, encounters, adventureSaves, art }, null, 2);
}

export async function importAll(json: string): Promise<void> {
  const data = JSON.parse(json);
  const db = await getDB();
  const tx = db.transaction(['characters', 'encounters', 'adventureSaves', 'art'], 'readwrite');
  if (Array.isArray(data.characters)) {
    for (const c of data.characters) await tx.objectStore('characters').put(c);
  }
  if (Array.isArray(data.encounters)) {
    for (const e of data.encounters) await tx.objectStore('encounters').put(e);
  }
  if (Array.isArray(data.adventureSaves)) {
    for (const a of data.adventureSaves) await tx.objectStore('adventureSaves').put(a);
  }
  if (Array.isArray(data.art)) {
    for (const a of data.art) {
      const blob = await base64ToBlob(a.data, a.type);
      await tx.objectStore('art').put({ id: a.id, blob, type: a.type, createdAt: a.createdAt });
    }
  }
  await tx.done;
}

interface ArtExport {
  id: string;
  type: string;
  createdAt?: number;
  data: string;
}

/**
 * Export selected characters (or all, if no ids) plus their portrait art as a
 * portable, self-contained hero pack. Re-importable on any device.
 */
export async function exportCharacters(ids?: string[]): Promise<string> {
  const db = await getDB();
  let characters = await db.getAll('characters');
  if (ids && ids.length) characters = characters.filter((c) => ids.includes(c.id));
  characters.sort((a, b) => b.updatedAt - a.updatedAt);
  const artIds = [...new Set(characters.map((c) => c.portraitArtId).filter((x): x is string => !!x))];
  const art: ArtExport[] = [];
  for (const id of artIds) {
    const rec = await db.get('art', id);
    if (rec) art.push({ id: rec.id, type: rec.type, createdAt: rec.createdAt, data: await blobToBase64(rec.blob) });
  }
  return JSON.stringify({ kind: 'shadowdark-heroes', version: 1, exportedAt: Date.now(), characters, art }, null, 2);
}

/**
 * Import characters (with their art) from a hero pack, a single character, a raw
 * array, or a full backup. Merges by id, so re-importing your own pack updates in
 * place rather than duplicating. Returns the number of characters imported.
 */
export async function importCharacters(json: string): Promise<number> {
  const data = JSON.parse(json);
  let characters: Character[] = [];
  let art: ArtExport[] = [];
  if (Array.isArray(data)) {
    characters = data as Character[];
  } else if (data && Array.isArray(data.characters)) {
    characters = data.characters;
    art = Array.isArray(data.art) ? data.art : [];
  } else if (data && typeof data === 'object' && data.id && data.stats) {
    characters = [data as Character];
  } else {
    throw new Error('Not a recognized hero file.');
  }
  characters = characters.filter((c) => c && c.id && c.stats);
  if (!characters.length) throw new Error('No heroes found in this file.');

  // Convert art blobs up front: an IndexedDB transaction can't stay open across
  // the fetch() inside base64ToBlob.
  const artRecords: { id: string; blob: Blob; type: string; createdAt: number }[] = [];
  for (const a of art) {
    try {
      artRecords.push({
        id: a.id,
        blob: await base64ToBlob(a.data, a.type),
        type: a.type,
        createdAt: a.createdAt ?? Date.now(),
      });
    } catch {
      // Skip unreadable art; the character still imports, just without its portrait.
    }
  }

  const db = await getDB();
  const tx = db.transaction(['characters', 'art'], 'readwrite');
  for (const c of characters) await tx.objectStore('characters').put(c);
  for (const a of artRecords) await tx.objectStore('art').put(a);
  await tx.done;
  return characters.length;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function base64ToBlob(dataUrl: string, type: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  const arrayBuffer = await res.arrayBuffer();
  return new Blob([arrayBuffer], { type });
}
