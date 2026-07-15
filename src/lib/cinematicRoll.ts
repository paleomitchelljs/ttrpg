// Cinematic roll builders, shared by the adventure engine and the character
// sheet. Each performs a real roll (logged to the shared Dice log) and returns
// a serializable RollPayload the DiceOverlay components replay as a BG3-style
// animated roll.

import { formatMod, roll, type RollMode } from './dice';
import { pushRoll } from './rollLog';
import type { RollPart, RollPayload } from './adventure/types';

export interface CheckOpts {
  kind: RollPayload['kind'];
  side: 'hero' | 'enemy';
  title: string;
  mode?: RollMode;
  /** Labeled modifier breakdown; the sum is the flat bonus on the d20. */
  parts: RollPart[];
  /** Number to beat (AC or DC). Omit for uncontested rolls. */
  target?: number;
  targetLabel?: string;
}

export function checkRoll(opts: CheckOpts): RollPayload {
  const mode = opts.mode ?? 'normal';
  const bonus = opts.parts.reduce((a, p) => a + p.value, 0);
  const expr = `1d20${bonus !== 0 ? formatMod(bonus) : ''}`;
  const r = pushRoll(roll(expr, mode), opts.title);
  let outcome: RollPayload['outcome'] = 'plain';
  const win = opts.kind === 'attack' ? 'hit' : 'success';
  const lose = opts.kind === 'attack' ? 'miss' : 'failure';
  if (r.isCrit) outcome = 'crit';
  else if (r.isFumble) outcome = 'fumble';
  else if (opts.target !== undefined) outcome = r.total >= opts.target ? win : lose;
  return {
    kind: opts.kind,
    side: opts.side,
    title: opts.title,
    expression: expr,
    mode,
    sides: 20,
    rolls: r.dice.map((d) => Math.abs(d.value)),
    dropped: r.dice[0]?.dropped,
    parts: opts.parts.filter((p) => p.value !== 0),
    total: r.total,
    target: opts.target,
    targetLabel: opts.targetLabel,
    outcome,
  };
}

/** A payload-check succeeded (crits always do, fumbles never). */
export function checkPassed(p: RollPayload): boolean {
  return p.outcome === 'crit' || p.outcome === 'hit' || p.outcome === 'success';
}

export interface DamageOpts {
  side: 'hero' | 'enemy';
  title: string;
  /** "2d6+1" or a flat number; dice are doubled on a crit. */
  damage: string;
  crit?: boolean;
  kind?: 'damage' | 'heal';
}

/** Roll damage/healing with a payload. Total is min 1. */
export function damageRoll(opts: DamageOpts): RollPayload {
  const kind = opts.kind ?? 'damage';
  const m = opts.damage.match(/^(\d+)d(\d+)([+-]\d+)?$/i);
  if (m) {
    const count = parseInt(m[1], 10) * (opts.crit ? 2 : 1);
    const sides = parseInt(m[2], 10);
    const mod = m[3] ? parseInt(m[3], 10) : 0;
    const expr = `${count}d${sides}${mod !== 0 ? formatMod(mod) : ''}`;
    const r = pushRoll(roll(expr, 'normal'), opts.title);
    return {
      kind,
      side: opts.side,
      title: opts.title,
      expression: expr,
      mode: 'normal',
      sides,
      rolls: r.dice.map((d) => Math.abs(d.value)),
      parts: mod !== 0 ? [{ label: 'bonus', value: mod }] : [],
      total: Math.max(1, r.total),
      outcome: 'plain',
    };
  }
  const flat = Math.max(1, (parseInt(opts.damage, 10) || 1) * (opts.crit ? 2 : 1));
  return {
    kind,
    side: opts.side,
    title: opts.title,
    expression: String(flat),
    mode: 'normal',
    sides: 0,
    rolls: [],
    parts: [{ label: 'flat', value: flat }],
    total: flat,
    outcome: 'plain',
  };
}
