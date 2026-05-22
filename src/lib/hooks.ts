import { useEffect, useState } from 'react';
import { getArt, listCharacters, listEncounters } from './storage';
import type { Character, Encounter } from './shadowdark/types';

/** Subscribe to the character list. Auto-refreshes via the shared event bus. */
export function useCharacters(): {
  characters: Character[];
  loading: boolean;
  refresh: () => Promise<void>;
} {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    const list = await listCharacters();
    setCharacters(list);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
    const handler = () => refresh();
    window.addEventListener('portal:characters-changed', handler);
    return () => window.removeEventListener('portal:characters-changed', handler);
  }, []);

  return { characters, loading, refresh };
}

/** Notify all listeners that the character list changed. */
export function emitCharactersChanged() {
  window.dispatchEvent(new Event('portal:characters-changed'));
}

export function useEncounters(): {
  encounters: Encounter[];
  loading: boolean;
  refresh: () => Promise<void>;
} {
  const [encounters, setEncounters] = useState<Encounter[]>([]);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    const list = await listEncounters();
    setEncounters(list);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
    const handler = () => refresh();
    window.addEventListener('portal:encounters-changed', handler);
    return () => window.removeEventListener('portal:encounters-changed', handler);
  }, []);

  return { encounters, loading, refresh };
}

export function emitEncountersChanged() {
  window.dispatchEvent(new Event('portal:encounters-changed'));
}

/** Resolve an art ID to a blob URL for use in <img src>. */
export function useArtUrl(artId: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let revoked = false;
    let currentUrl: string | null = null;
    if (!artId) {
      setUrl(null);
      return;
    }
    getArt(artId).then((blob) => {
      if (revoked) return;
      if (blob) {
        currentUrl = URL.createObjectURL(blob);
        setUrl(currentUrl);
      } else {
        setUrl(null);
      }
    });
    return () => {
      revoked = true;
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, [artId]);

  return url;
}
