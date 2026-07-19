// One factory builds any combatant — dragon, monster, future ally — into the
// shared schema from plan §3.1.

let counter = 0;

const ABILITY_DEFAULTS = { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 };

/** Build a live combatant instance from a data template. */
export function makeCombatant(data) {
  return {
    id: `${data.id ?? data.name}-${++counter}`,
    templateId: data.id ?? null,
    name: data.name,
    kind: data.kind ?? 'monster',
    ac: data.ac,
    hp: { current: data.hp?.current ?? data.hpMax ?? data.hp, max: data.hp?.max ?? data.hpMax ?? data.hp },
    abilities: { ...ABILITY_DEFAULTS, ...(data.abilities ?? {}) },
    attacks: (data.attacks ?? []).map((a) => ({ ...a })),
    special: [...(data.special ?? [])],
    conditions: [],
    sprite: data.sprite ?? null,
    emoji: data.emoji ?? '❓',
    goldValue: data.goldValue ?? 0,
  };
}

/** Build the player's dragon combatant from a progression tier. */
export function makeDragonCombatant(tierData, currentHp = null) {
  const c = makeCombatant({
    id: `dragon-${tierData.tier}`,
    name: 'Red Dragon',
    kind: 'dragon',
    ac: tierData.ac,
    hpMax: tierData.hpMax,
    abilities: tierData.abilities,
    attacks: tierData.attacks,
    sprite: tierData.sprite,
    emoji: tierData.emoji,
  });
  if (currentHp != null) c.hp.current = Math.min(currentHp, c.hp.max);
  return c;
}
