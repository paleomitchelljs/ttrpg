// Dice expression parser & roller.
//
// Supports expressions like:
//   "1d20", "2d6+3", "1d20+5-1", "3d6", "1d100"
// And programmatic options for advantage/disadvantage.

export type RollMode = 'normal' | 'advantage' | 'disadvantage';

export interface DieResult {
  sides: number;
  value: number;
  /** For adv/dis: the other rolled die that was dropped. */
  dropped?: number;
}

export interface RollResult {
  expression: string;
  mode: RollMode;
  dice: DieResult[];
  modifier: number;
  total: number;
  /** True if any d20 in the roll came up natural 20. */
  isCrit: boolean;
  /** True if any d20 in the roll came up natural 1. */
  isFumble: boolean;
  /** Human-readable breakdown like "[18] + 3". */
  breakdown: string;
}

interface DiceTerm {
  count: number;
  sides: number;
  sign: 1 | -1;
}

interface ParsedExpression {
  terms: DiceTerm[];
  modifier: number;
}

const TERM_RE = /([+-]?)\s*(?:(\d+)d(\d+)|(\d+))/gi;

export function parseExpression(expr: string): ParsedExpression {
  const cleaned = expr.replace(/\s+/g, '');
  if (!cleaned) throw new Error('Empty dice expression');
  const terms: DiceTerm[] = [];
  let modifier = 0;
  let matched = '';
  let m: RegExpExecArray | null;
  TERM_RE.lastIndex = 0;
  while ((m = TERM_RE.exec(cleaned)) !== null) {
    const [whole, signStr, countStr, sidesStr, flatStr] = m;
    matched += whole;
    const sign: 1 | -1 = signStr === '-' ? -1 : 1;
    if (sidesStr) {
      const count = parseInt(countStr || '1', 10);
      const sides = parseInt(sidesStr, 10);
      if (count <= 0 || sides <= 0) throw new Error(`Invalid die term: ${whole}`);
      if (count > 100 || sides > 1000) throw new Error('Die term too large');
      terms.push({ count, sides, sign });
    } else if (flatStr) {
      modifier += sign * parseInt(flatStr, 10);
    }
  }
  if (matched.length !== cleaned.length) {
    throw new Error(`Could not parse dice expression: "${expr}"`);
  }
  if (terms.length === 0) throw new Error(`No dice in expression: "${expr}"`);
  return { terms, modifier };
}

function rollDie(sides: number): number {
  return Math.floor(Math.random() * sides) + 1;
}

export function roll(expression: string, mode: RollMode = 'normal'): RollResult {
  const { terms, modifier } = parseExpression(expression);
  const dice: DieResult[] = [];
  let diceSum = 0;

  for (const term of terms) {
    for (let i = 0; i < term.count; i++) {
      let value: number;
      let dropped: number | undefined;
      if (mode !== 'normal' && term.sides === 20) {
        const a = rollDie(20);
        const b = rollDie(20);
        if (mode === 'advantage') {
          value = Math.max(a, b);
          dropped = Math.min(a, b);
        } else {
          value = Math.min(a, b);
          dropped = Math.max(a, b);
        }
      } else {
        value = rollDie(term.sides);
      }
      const signed = term.sign * value;
      diceSum += signed;
      dice.push({ sides: term.sides, value: signed, dropped });
    }
  }

  const total = diceSum + modifier;
  const d20s = dice.filter((d) => d.sides === 20);
  const isCrit = d20s.some((d) => Math.abs(d.value) === 20);
  const isFumble = d20s.some((d) => Math.abs(d.value) === 1);

  const breakdownParts: string[] = [];
  for (const d of dice) {
    const sign = d.value < 0 ? '-' : '+';
    const abs = Math.abs(d.value);
    const part = d.dropped !== undefined ? `[${abs}/(${d.dropped})]` : `[${abs}]`;
    breakdownParts.push(breakdownParts.length === 0 && sign === '+' ? part : `${sign} ${part}`);
  }
  if (modifier !== 0) {
    const sign = modifier < 0 ? '-' : '+';
    breakdownParts.push(`${sign} ${Math.abs(modifier)}`);
  }

  return {
    expression,
    mode,
    dice,
    modifier,
    total,
    isCrit,
    isFumble,
    breakdown: breakdownParts.join(' '),
  };
}

/** Roll 3d6 once. */
export function roll3d6(): number {
  return rollDie(6) + rollDie(6) + rollDie(6);
}

/** Roll 4d6 drop lowest (alternative stat generation). */
export function roll4d6DropLowest(): number {
  const rolls = [rollDie(6), rollDie(6), rollDie(6), rollDie(6)];
  rolls.sort((a, b) => a - b);
  return rolls[1] + rolls[2] + rolls[3];
}

/** Pick a random entry from a list. */
export function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

/** Roll on a weighted table (entries with a `weight` field). */
export function rollTable<T extends { weight?: number }>(table: readonly T[]): T {
  const total = table.reduce((s, e) => s + (e.weight ?? 1), 0);
  let r = Math.random() * total;
  for (const entry of table) {
    r -= entry.weight ?? 1;
    if (r <= 0) return entry;
  }
  return table[table.length - 1];
}

/** Standard Shadowdark stat modifier from a score. */
export function statMod(score: number): number {
  if (score <= 3) return -4;
  if (score <= 5) return -3;
  if (score <= 7) return -2;
  if (score <= 9) return -1;
  if (score <= 11) return 0;
  if (score <= 13) return 1;
  if (score <= 15) return 2;
  if (score <= 17) return 3;
  return 4;
}

export function formatMod(mod: number): string {
  return mod >= 0 ? `+${mod}` : `${mod}`;
}
