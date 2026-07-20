// Magic items — pure data, drawn directly from the 5e adventure guides in
// dungeons/ ("Treasure of Guk"; "Treasures of the God-City"). They are RARE:
// they drop only from named boss packs (and, later, quests) — never from
// ordinary loot piles or wandering monsters. `zone` ties an item to its
// dungeon's pool; bosses can name preferred drops.
// mods: toHit / damage (flat) / ac / hpMax / init. bane: 'undead' adds +2
// damage against undead targets.

export const SLOTS = ['weapon', 'armor', 'trinket'];

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
    blurb: 'the assassin’s silk — you are always first (+2 initiative, +1 to hit)',
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
    mods: { ac: 2 },
    blurb: 'the red ore of legend, warm to the touch (+2 AC)',
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
    mods: { toHit: 1 },
    blurb: 'the fear it wears becomes yours to aim (+1 to hit)',
  },
  {
    id: 'idol-of-thule',
    name: 'Idol of Thule',
    slot: 'trinket',
    zone: 'lost-temple',
    mods: { damage: 1, hpMax: 1 },
    blurb: 'a sliver of the god-city’s dread (+1 damage, +1 max HP)',
  },
];

export function itemById(id) {
  return ITEMS.find((i) => i.id === id);
}
