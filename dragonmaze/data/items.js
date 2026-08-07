// Magic items — pure data, drawn directly from the 5e adventure guides in
// dungeons/ ("Treasure of Guk"; "Treasures of the God-City"). They are RARE:
// they drop only from named boss packs (and, later, quests) — never from
// ordinary loot piles or wandering monsters.
//
// **One item, one boss.** Every item is named by exactly one boss's `drops` in
// data/zones.js, and a boss carries exactly one item. There is no zone-wide
// fallback pool: an item no boss names simply cannot be found. Bosses stay dead
// (meta.defeatedBosses) and the drop is a single 50% roll, so a boss with two
// items could only ever yield one — hence one apiece. `zone` is now just
// bookkeeping for which dungeon an item belongs to.
//
// mods:
//   toHit / damage    flat bonuses on the wielder's attack (damage folds into
//                     the dice expression, so a crit doubles it)
//   ac / hpMax / init armour class, max HP, initiative
//   regen             N HP at the start of each combat turn, and N per step
//                     taken out in the dungeon
//   str/dex/con/int/wis/cha   raises the ability score itself, so every roll
//                     that reads it improves. DEX additionally gives AC and
//                     sharpens a finesse weapon; CON additionally gives max HP
//                     (see applyEquipment / the party HP setup in gameState).
//   castDC            shifts the caster's spell DC (negative is easier)
//   intimidate        bonus on Intimidate checks
// bane: 'undead' adds +2 damage against undead targets.
//
// A 'shield' item only pays out to someone with a hand free — a two-handed
// weapon cancels it, the same rule as the shield a hero already carries
// (shieldAcFor in data/weapons.js).

export const SLOTS = ['weapon', 'shield', 'armor', 'trinket'];

export const ITEMS = [
  // ---------------------------------------------- Upper Guk
  {
    id: 'mithril-two-hander',
    name: 'Mithril Two-Handed Sword',
    slot: 'weapon',
    zone: 'upper-guk',
    mods: { toHit: 1, damage: 2 },
    blurb: 'the Shin Lord’s pale blade, light as reed (+1 to hit, +2 damage)',
  },
  {
    id: 'gatorscale-sleeves',
    name: 'Gatorscale Sleeves',
    slot: 'armor',
    zone: 'upper-guk',
    mods: { ac: 1 },
    blurb: 'supple hide of the gator pools (+1 AC)',
  },
  {
    id: 'deepwater-circlet',
    name: 'Deepwater Circlet',
    slot: 'trinket',
    zone: 'upper-guk',
    mods: { hpMax: 2 },
    blurb: 'cool as the drowned streets (+2 max HP)',
  },
  {
    id: 'testament-of-marr',
    name: 'The Testament of the Marr',
    slot: 'trinket',
    zone: 'upper-guk',
    mods: { hpMax: 3 },
    blurb: 'the old temple’s blessing, still legible (+3 max HP)',
  },
  {
    id: 'croak-horn',
    name: 'Guktan Croak-Horn',
    slot: 'trinket',
    zone: 'upper-guk',
    mods: { init: 2 },
    blurb: 'sound the alarm before they do (+2 initiative)',
  },
  {
    id: 'guktan-warshield',
    name: 'Guktan War-Shield',
    slot: 'shield',
    zone: 'upper-guk',
    mods: { ac: 1 },
    blurb: 'a croaker\u2019s broad shell-shield (+1 AC, needs a hand free)',
  },
  // ---------------------------------------------- Lower Guk
  {
    id: 'ghoulbane',
    name: 'Ghoulbane',
    slot: 'weapon',
    zone: 'lower-guk',
    mods: { toHit: 1, damage: 1 },
    bane: 'undead',
    blurb: 'the paladins’ answer to the dead side (+1/+1, +2 damage vs undead)',
  },
  {
    id: 'ykesha-short-sword',
    name: 'Short Sword of Ykesha',
    slot: 'weapon',
    zone: 'lower-guk',
    mods: { damage: 2 },
    blurb: 'crackles with the ghoul magi’s stolen lightning (+2 damage)',
  },
  {
    id: 'kaltusk-axe',
    name: 'Minotaur Battle Axe',
    slot: 'weapon',
    zone: 'lower-guk',
    mods: { damage: 3 },
    blurb: 'Kaltusk’s own, notched by a hundred sieges (+3 damage)',
  },
  {
    id: 'flowing-black-sash',
    name: 'Flowing Black Silk Sash',
    slot: 'trinket',
    zone: 'lower-guk',
    mods: { init: 2, toHit: 1 },
    blurb: 'the assassin’s silk; you are always first (+2 initiative, +1 to hit)',
  },
  {
    id: 'froglok-crown',
    name: 'Crown of the Froglok Kings',
    slot: 'trinket',
    zone: 'lower-guk',
    mods: { ac: 1, hpMax: 2 },
    blurb: 'heavy with drowned history (+1 AC, +2 max HP)',
  },
  {
    id: 'silt-lich-robe',
    name: 'Robe of the Silt-Lich',
    slot: 'armor',
    zone: 'lower-guk',
    mods: { ac: 1, hpMax: 1 },
    blurb: 'Vethyl’s cast-off shroud, cold and dry (+1 AC, +1 max HP)',
  },
  {
    id: 'drowned-bulwark',
    name: 'Bulwark of the Drowned',
    slot: 'shield',
    zone: 'lower-guk',
    mods: { ac: 2 },
    blurb: 'a sunken tower-shield, still barring the way (+2 AC, needs a hand free)',
  },
  // ---------------------------------------------- The Lost Temple
  {
    id: 'thulian-claws',
    name: 'Bladed Thulian Claws',
    slot: 'weapon',
    zone: 'lost-temple',
    mods: { toHit: 1, damage: 1 },
    blurb: 'the Tae Ew champions’ fighting claws (+1 to hit, +1 damage)',
  },
  {
    id: 'rubicite-breastplate',
    name: 'Rubicite Breastplate',
    slot: 'armor',
    zone: 'lost-temple',
    mods: { ac: 2, regen: 1 },
    blurb: 'the red ore of legend, warm to the touch — it knits what it can (+2 AC, +1 HP each combat turn and each step you walk)',
  },
  {
    id: 'aegis-of-the-serpent',
    name: 'Aegis of the Serpent',
    slot: 'shield',
    zone: 'lost-temple',
    mods: { ac: 1, hpMax: 2 },
    blurb: 'coiled bronze that turns a blow aside (+1 AC, +2 max HP, needs a hand free)',
  },
  {
    id: 'rubicite-greaves',
    name: 'Rubicite Greaves',
    slot: 'armor',
    zone: 'lost-temple',
    mods: { ac: 1 },
    blurb: 'red-sheened legguards of the silvered ranks (+1 AC)',
  },
  {
    id: 'lizardscale-cloak',
    name: 'Lizardscale Cloak',
    slot: 'trinket',
    zone: 'lost-temple',
    mods: { ac: 1 },
    blurb: 'sheds rain, arrows, and suspicion (+1 AC)',
  },
  {
    id: 'tribal-mask',
    name: 'Lizardskin Tribal Mask',
    slot: 'trinket',
    zone: 'lost-temple',
    mods: { dex: 1 },
    blurb: 'you move as the lizard moves, quick and low (+1 DEX)',
  },
  {
    id: 'idol-of-thule',
    name: 'Idol of Thule',
    slot: 'trinket',
    zone: 'lost-temple',
    mods: { intimidate: 2 },
    blurb: 'a sliver of the god-city’s dread; hold it up and they remember (+2 to Intimidate)',
  },
  {
    id: 'shard-of-golem-stone',
    name: 'Shard of Golem Stone',
    slot: 'trinket',
    zone: 'lost-temple',
    mods: { ac: 1 },
    blurb: 'a chip of the courtyard sentinel, and it still refuses to break (+1 AC)',
  },
  {
    id: 'metal-wand',
    name: 'Metal Wand',
    slot: 'trinket',
    zone: 'lost-temple',
    mods: { castDC: -1 },
    blurb: 'cold iron drawn from the drain-golem’s core; the words come easier (−1 to your spell DCs)',
  },
  {
    id: 'darkforge-breastplate',
    name: 'Darkforge Breastplate',
    slot: 'armor',
    zone: 'lost-temple',
    mods: { ac: 1, con: 2 },
    blurb: 'crusader plate beaten in a lightless forge (+1 AC, +2 CON)',
  },
  // ---------------------------------------------- Common gear (treasure.png art)
  // Plainer finds spread across the zones' boss pools. `tile` links the sliced
  // icon in assets/tiles for when the UI shows item art.
  {
    id: 'scimitar', name: 'Fine Scimitar', slot: 'weapon', zone: 'upper-guk',
    tile: 'scimitar', mods: { toHit: 1, damage: 1 },
    blurb: 'a curved, well-balanced blade (+1 to hit, +1 damage)',
  },
  {
    id: 'ring-ruby', name: 'Ruby Ring', slot: 'trinket', zone: 'upper-guk',
    tile: 'ring-ruby', mods: { damage: 1 },
    blurb: 'the red stone lends your blows a bite (+1 damage)',
  },
  {
    id: 'chainmail', name: 'Chainmail', slot: 'armor', zone: 'lower-guk',
    tile: 'chainmail', mods: { ac: 2 },
    blurb: 'a shirt of good riveted rings (+2 AC)',
  },
  {
    id: 'crown', name: 'Gilded Crown', slot: 'trinket', zone: 'lower-guk',
    tile: 'crown', mods: { hpMax: 2, init: 1 },
    blurb: 'wear it and they follow your lead (+2 max HP, +1 initiative)',
  },
  {
    id: 'shield-round', name: 'Round Shield', slot: 'shield', zone: 'lost-temple',
    tile: 'shield-round', mods: { ac: 1 },
    blurb: 'banded oak and iron, quick to raise (+1 AC, needs a hand free)',
  },
  {
    id: 'amulet-sun', name: 'Sun Amulet', slot: 'trinket', zone: 'lost-temple',
    tile: 'amulet-sun', mods: { hpMax: 3 },
    blurb: 'a warm ward against the dark (+3 max HP)',
  },
];

export function itemById(id) {
  return ITEMS.find((i) => i.id === id);
}
