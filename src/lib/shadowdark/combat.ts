// Shared combat math for Shadowdark characters.
//
// This is the single source of truth for turning a stored Character + its
// equipment into the numbers a fight needs (attack bonus, damage, AC). Both
// the character sheet HUD and the text-adventure engine read from here so the
// two never drift apart.

import { statMod } from '../dice';
import {
  armorACBase,
  findArmor,
  findHelmet,
  findItem,
  findWeapon,
  isRanged,
  isShield,
  isTwoHanded,
  weaponDamageDie,
} from './gear';
import type { Character } from './types';

export interface CombatProfile {
  /** d20 attack modifier (STR for melee, DEX for ranged). */
  attackMod: number;
  /** Damage die for the equipped weapon, e.g. "d8". */
  damageDie: string;
  /** Flat damage modifier added to the weapon die. */
  damageMod: number;
  /** Computed armor class from equipped armor + shield + helmet. */
  ac: number;
  /** Whether the main weapon is a ranged weapon. */
  ranged: boolean;
  /** Display name of the main weapon, or "Unarmed". */
  weaponName: string;
}

/**
 * Derive Shadowdark combat numbers from a character's stats + equipment.
 * Mirrors the rules used on the character sheet: melee uses STR, ranged uses
 * DEX, a weapon with no off-hand is swung two-handed, AC stacks shield (+2)
 * and helmet (+1) on top of the armor base.
 */
export function characterCombatProfile(character: Character): CombatProfile {
  const equipment = character.equipment ?? {};
  const mainHand = findWeapon(equipment.mainHand);
  // The off-hand may hold a weapon OR a shield — resolve either, since a
  // shield is not a "weapon" and would otherwise read as an empty hand.
  const offHand = findItem(equipment.offHand);
  const offHandIsShield = isShield(equipment.offHand);
  const armor = findArmor(equipment.armor);
  const helmet = findHelmet(equipment.helmet);

  const strMod = statMod(character.stats.STR);
  const dexMod = statMod(character.stats.DEX);
  const ranged = isRanged(mainHand);
  const attackMod = ranged ? dexMod : strMod;
  // A versatile weapon swings two-handed only when nothing (weapon or shield)
  // occupies the off-hand.
  const twoHanded = isTwoHanded(mainHand) || !offHand;
  const damageDie = weaponDamageDie(mainHand, twoHanded);
  const damageMod = ranged ? dexMod : strMod;

  const { base, addsDex } = armorACBase(armor);
  let ac = base + (addsDex ? dexMod : 0);
  if (offHandIsShield) ac += 2;
  if (helmet) ac += 1;

  return {
    attackMod,
    damageDie,
    damageMod,
    ac,
    ranged,
    weaponName: mainHand?.name ?? 'Unarmed',
  };
}
