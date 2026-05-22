import { useEffect, useState } from 'react';
import { roll, type RollMode, type RollResult } from './dice';

export interface LoggedRoll extends RollResult {
  /** Friendly label like "Goff's Attack" or "Save: STR". */
  label?: string;
  /** When the roll occurred (ms since epoch). */
  timestamp: number;
  /** Unique id for React keys / animations. */
  id: number;
}

const MAX_ROLLS = 100;
let nextId = 1;
let rolls: LoggedRoll[] = [];
const listeners = new Set<(rolls: LoggedRoll[]) => void>();

function emit() {
  for (const l of listeners) l(rolls);
}

export function pushRoll(result: RollResult, label?: string): LoggedRoll {
  const logged: LoggedRoll = { ...result, label, timestamp: Date.now(), id: nextId++ };
  rolls = [logged, ...rolls].slice(0, MAX_ROLLS);
  emit();
  return logged;
}

/** Roll an expression and push the result onto the shared log. */
export function rollAndLog(expression: string, mode: RollMode = 'normal', label?: string): LoggedRoll {
  return pushRoll(roll(expression, mode), label);
}

export function clearRolls() {
  rolls = [];
  emit();
}

export function useRollLog(): LoggedRoll[] {
  const [snapshot, setSnapshot] = useState<LoggedRoll[]>(rolls);
  useEffect(() => {
    listeners.add(setSnapshot);
    return () => {
      listeners.delete(setSnapshot);
    };
  }, []);
  return snapshot;
}

/** Most recent roll, or null. */
export function useLatestRoll(): LoggedRoll | null {
  const log = useRollLog();
  return log[0] ?? null;
}
