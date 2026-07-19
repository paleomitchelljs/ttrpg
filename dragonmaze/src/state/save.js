// localStorage persistence. Every save carries a version and passes through
// migrate(); anything unreadable falls back to null (fresh game), never a
// crash. The run is only persisted while exploring — quitting mid-combat
// resumes from just before the fight.

const KEY = 'red-dragon-labyrinth';
export const SAVE_VERSION = 1;

export function migrate(data) {
  if (!data || typeof data !== 'object') return null;
  if (typeof data.version !== 'number') return null;
  if (data.version === SAVE_VERSION) return data;
  // Future: step old versions forward here. Unknown versions start fresh.
  return null;
}

export function loadSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = migrate(JSON.parse(raw));
    if (!data || !data.meta || typeof data.meta.hoardGold !== 'number') return null;
    return data;
  } catch {
    return null;
  }
}

export function persist(state) {
  try {
    localStorage.setItem(KEY, exportJSON(state));
  } catch {
    // Storage full/blocked: play on without saving.
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function exportJSON(state) {
  const run = state.run && state.run.phase === 'explore' ? state.run : null;
  return JSON.stringify({
    version: SAVE_VERSION,
    meta: state.meta,
    run: run && { ...run, combat: null },
  });
}

export function importJSON(raw) {
  return migrate(JSON.parse(raw));
}
