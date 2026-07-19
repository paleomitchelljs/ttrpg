// Adapter: an RPG Portal character (the Heroes tab's exported JSON) becomes a
// Dragon Maze companion. Pure function, defensive against partial data — a
// malformed entry returns null rather than throwing.
//
// Conversion rules (see docs/character-link-plan.md):
// - raw Shadowdark stats -> modifiers, floor((score - 10) / 2)
// - weapon guessed from gear names; attack bonus = best of STR/DEX + level/2
// - portal spells map to the nearest Dragon Maze spell by name keywords;
//   known caster classes always get at least Ember Bolt
// - battle sprite picked by class until per-hero sheets exist

import { bumpDamage } from '../engine/rules.js';

const WEAPON_DICE = [
  [/greatsword|great sword|greataxe/i, '1d12'],
  [/longsword|bastard sword|warhammer/i, '1d8'],
  [/axe|morningstar/i, '1d8'],
  [/mace|hammer|flail|spear|javelin|shortsword|short sword/i, '1d6'],
  [/bow|crossbow|sling/i, '1d6'],
  [/dagger|knife|staff|club|cudgel/i, '1d4'],
  [/sword|blade|rapier|scimitar/i, '1d6'],
];

const STRIP_BY_CLASS = [
  [/wizard|mage|sorcer|priest|cleric|shaman/i, 'spellblade'],
  [/bard|thief|rogue|ranger|scout/i, 'spawnee'],
  [/./, 'swash'],
];

function mapSpell(name) {
  if (/heal|cure|mend|restor/i.test(name)) return 'healing-word';
  if (/wave|blast|burst|storm|fear|sleep/i.test(name)) return 'flame-wave';
  if (/fire|burn|flame|bolt|missile|zap|shock/i.test(name)) return 'ember-bolt';
  return null;
}

export function portalToCompanion(char) {
  try {
    if (!char || typeof char.name !== 'string' || !char.stats || !char.hp || char.ac == null) {
      return null;
    }
    const mod = (v) => Math.floor(((v ?? 10) - 10) / 2);
    const abilities = {
      str: mod(char.stats.STR),
      dex: mod(char.stats.DEX),
      con: mod(char.stats.CON),
      int: mod(char.stats.INT),
      wis: mod(char.stats.WIS),
      cha: mod(char.stats.CHA),
    };
    const level = char.level ?? 1;
    const gear = char.gear ?? [];
    let dice = '1d4';
    let weaponName = 'improvised strike';
    for (const [re, d] of WEAPON_DICE) {
      const found = gear.find((g) => g?.name && re.test(g.name));
      if (found) {
        dice = d;
        weaponName = found.name.toLowerCase();
        break;
      }
    }
    const classId = char.classId ?? '';
    const strip = STRIP_BY_CLASS.find(([re]) => re.test(classId))?.[1] ?? 'swash';
    let spells = [...new Set((char.spells ?? []).map(mapSpell).filter(Boolean))];
    if (!spells.length && /wizard|mage|sorcer|priest|cleric|shaman|bard/i.test(classId)) {
      spells = ['ember-bolt'];
    }
    return {
      id: `hero-${char.id ?? char.name.toLowerCase().replace(/\W+/g, '-')}`,
      name: char.name,
      kind: 'hero',
      ac: char.ac,
      hpMax: Math.max(1, char.hp.max ?? 1),
      abilities,
      attacks: [{
        name: weaponName,
        toHit: Math.max(abilities.str, abilities.dex) + Math.floor(level / 2),
        damage: bumpDamage(dice, Math.max(abilities.str, 0)),
        range: 'melee',
      }],
      sprite: 'hero_imported',
      emoji: '❖',
      anim: { idle: `${strip}-idle`, attack: `${strip}-attack` },
      spells,
      imported: true,
    };
  } catch {
    return null;
  }
}

/** Accepts the Heroes tab's export: a bare array or { characters: [...] }. */
export function parseHeroExport(json) {
  const list = Array.isArray(json) ? json : Array.isArray(json?.characters) ? json.characters : [];
  return list.map(portalToCompanion).filter(Boolean);
}
