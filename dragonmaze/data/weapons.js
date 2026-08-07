// Weapons — the catalogue every armed character draws from. Pure data.
//
// Shadowdark's rule holds: a weapon deals its **die only**. An ability modifier
// sharpens the swing (to-hit), it never pads the damage. So the whole of a
// weapon's power is its die and its properties.
//
//   type       groups weapons for the Weapon Focus / Weapon Master talents
//              ('sword', 'axe', 'hammer', 'dagger', 'staff').
//   props      'finesse'    — swings off DEX when that's the better arm
//              'two-handed' — both hands, so no shield (see shieldAcFor)
//
// A character carries `weapon: '<id>'` (plus optional `weaponName` for a
// personal blade, and `trained` if they're better than the standard +1) rather
// than a hand-written attack line; `attackFor` builds the attack from it, so
// changing a weapon changes the to-hit and the die together and can't drift.

export const WEAPONS = [
  { id: 'dagger', name: 'Dagger', type: 'dagger', damage: '1d4', props: ['finesse'], blurb: 'quick, quiet, and always to hand (1d4, finesse)' },
  { id: 'staff', name: 'Staff', type: 'staff', damage: '1d4', props: ['two-handed'], blurb: 'a scholar’s walking stick, and her last argument (1d4, two-handed)' },
  { id: 'shortsword', name: 'Shortsword', type: 'sword', damage: '1d6', props: ['finesse'], blurb: 'a short, fast blade (1d6, finesse)' },
  { id: 'rapier', name: 'Rapier', type: 'sword', damage: '1d6', props: ['finesse'], blurb: 'all point and footwork (1d6, finesse)' },
  { id: 'khopesh', name: 'Khopesh', type: 'sword', damage: '1d6', blurb: 'a hooked temple blade (1d6)' },
  { id: 'mace', name: 'Mace', type: 'hammer', damage: '1d6', blurb: 'simple, blunt, and hard to break (1d6)' },
  { id: 'handaxe', name: 'Handaxe', type: 'axe', damage: '1d6', blurb: 'chops wood, chops other things (1d6)' },
  { id: 'longsword', name: 'Longsword', type: 'sword', damage: '1d8', blurb: 'the soldier’s blade (1d8)' },
  { id: 'battleaxe', name: 'Battleaxe', type: 'axe', damage: '1d8', blurb: 'a bearded war-axe (1d8)' },
  { id: 'warhammer', name: 'Warhammer', type: 'hammer', damage: '1d8', blurb: 'made for plate and for skulls (1d8)' },
  { id: 'greataxe', name: 'Greataxe', type: 'axe', damage: '1d10', props: ['two-handed'], blurb: 'swung with the whole body (1d10, two-handed)' },
  { id: 'greatsword', name: 'Greatsword', type: 'sword', damage: '1d12', props: ['two-handed'], blurb: 'a slab of steel with a grip (1d12, two-handed)' },
];

export function weaponById(id) {
  return WEAPONS.find((w) => w.id === id) ?? null;
}

export const hasProp = (weapon, p) => !!weapon?.props?.includes(p);

/** Everyone trained adds this much to the swing on top of their ability. */
export const TRAINED_BONUS = 1;

/**
 * Build a character's attack line from their weapon and abilities.
 * A finesse weapon swings off whichever of STR/DEX is better; everything else
 * is STR. `stat` rides along so a later ability increase raises the right one
 * (see heroWithGrowth) and so the sheet can say what the swing keys off.
 */
export function attackFor(weapon, abilities = {}, trained = TRAINED_BONUS, name = null) {
  const str = abilities.str ?? 0;
  const dex = abilities.dex ?? 0;
  const stat = hasProp(weapon, 'finesse') && dex > str ? 'dex' : 'str';
  return {
    name: name ?? weapon.name,
    toHit: (stat === 'dex' ? dex : str) + trained,
    damage: weapon.damage,
    range: 'melee',
    type: weapon.type,
    stat,
    twoHanded: hasProp(weapon, 'two-handed'),
  };
}

/**
 * A shield is worth +2 AC, and only to someone with a hand free — a two-handed
 * weapon cancels it. Returns 0 when there's no shield or no spare hand, so both
 * the innate shield a hero carries and an equipped magic one go through here.
 */
export const SHIELD_AC = 2;
export function shieldAcFor(hero, weapon) {
  if (!hero?.shield) return 0;
  return hasProp(weapon, 'two-handed') ? 0 : SHIELD_AC;
}
