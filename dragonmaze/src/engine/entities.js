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
    anim: data.anim ?? null,
    facesLeft: data.facesLeft ?? false,
    undead: data.undead ?? false,
    abilityLabel: data.abilityLabel ?? null,
    initBonus: 0,
    bane: null,
    resist: [...(data.resist ?? [])],
    vulnerable: [...(data.vulnerable ?? [])],
    ability: data.ability ?? null,
    traits: [...(data.traits ?? [])], // hero passives, e.g. Beren's 'beast-dread'
    faction: data.faction ?? null, // 'wild' == beast, for Beren and parley
    relentlessUsed: false,
    spells: [...(data.spells ?? [])],
    castStat: data.castStat ?? 'cha', // which ability powers this caster's spells
    spellPower: data.spellPower ?? 0, // bonus damage added to this caster's spells
    talents: [...(data.talents ?? [])], // chosen level-up talents (Cleave, Flurry, …)
    recoveredThisCombat: false, // Arcane Recovery: one saved fizzle per fight
    burned: [],
    goldValue: data.goldValue ?? 0,
    morale: data.morale ?? null,
    moraleChecked: false,
    panicked: false,
    fled: false,
  };
}

/** Build the player's dragon combatant from a progression tier. */
export function makeDragonCombatant(tierData, currentHp = null, opts = {}) {
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
    spells: opts.spells ?? [],
  });
  c.breath = tierData.breath ? { ...tierData.breath } : null;
  c.familiar = opts.familiar ?? null;
  if (currentHp != null) c.hp.current = Math.min(currentHp, c.hp.max);
  return c;
}
