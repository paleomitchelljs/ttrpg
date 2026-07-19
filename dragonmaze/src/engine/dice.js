// Standalone dice primitive. Zero game state, zero imports — designed to be
// lifted verbatim into other tools. Every function accepts an optional rng
// (a () => [0,1) function) and defaults to Math.random.

const DICE_RE = /^\s*(\d*)d(\d+)\s*(?:([+-])\s*(\d+))?\s*$/i;

/** roll("2d6+1") -> { expr, count, sides, mod, rolls, total } */
export function roll(expr, rng = Math.random) {
  const m = DICE_RE.exec(expr);
  if (!m) throw new Error(`Bad dice expression: ${expr}`);
  const count = m[1] ? parseInt(m[1], 10) : 1;
  const sides = parseInt(m[2], 10);
  const mod = m[4] ? (m[3] === '-' ? -1 : 1) * parseInt(m[4], 10) : 0;
  if (count < 1 || sides < 2) throw new Error(`Bad dice expression: ${expr}`);
  const rolls = [];
  for (let i = 0; i < count; i++) rolls.push(1 + Math.floor(rng() * sides));
  const total = rolls.reduce((a, b) => a + b, 0) + mod;
  return { expr, count, sides, mod, rolls, total };
}

/** d20({ advantage, disadvantage, rng }) -> { total, rolls, mode } */
export function d20({ advantage = false, disadvantage = false, rng = Math.random } = {}) {
  const a = 1 + Math.floor(rng() * 20);
  if (advantage === disadvantage) return { total: a, rolls: [a], mode: 'straight' };
  const b = 1 + Math.floor(rng() * 20);
  return {
    total: advantage ? Math.max(a, b) : Math.min(a, b),
    rolls: [a, b],
    mode: advantage ? 'advantage' : 'disadvantage',
  };
}

/** save(dc, bonus, opts) -> { success, roll, bonus, total, dc } */
export function save(dc, bonus = 0, opts = {}) {
  const die = d20(opts);
  const total = die.total + bonus;
  return { success: total >= dc, roll: die.total, bonus, total, dc };
}
