import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Character } from './shadowdark/types';

interface PortalDB extends DBSchema {
  characters: {
    key: string;
    value: Character;
    indexes: { 'by-updated': number };
  };
  art: {
    key: string;
    value: { id: string; blob: Blob; type: string; createdAt: number };
  };
}

const DB_NAME = 'shadowdark-portal';
const DB_VERSION = 1;

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

/** Convert all stored data into a JSON-serializable backup. */
export async function exportAll(): Promise<string> {
  const db = await getDB();
  const characters = await db.getAll('characters');
  const artRecords = await db.getAll('art');
  const art = await Promise.all(
    artRecords.map(async (r) => ({
      id: r.id,
      type: r.type,
      createdAt: r.createdAt,
      data: await blobToBase64(r.blob),
    }))
  );
  return JSON.stringify({ version: 1, characters, art }, null, 2);
}

export async function importAll(json: string): Promise<void> {
  const data = JSON.parse(json);
  const db = await getDB();
  const tx = db.transaction(['characters', 'art'], 'readwrite');
  if (Array.isArray(data.characters)) {
    for (const c of data.characters) await tx.objectStore('characters').put(c);
  }
  if (Array.isArray(data.art)) {
    for (const a of data.art) {
      const blob = await base64ToBlob(a.data, a.type);
      await tx.objectStore('art').put({ id: a.id, blob, type: a.type, createdAt: a.createdAt });
    }
  }
  await tx.done;
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
