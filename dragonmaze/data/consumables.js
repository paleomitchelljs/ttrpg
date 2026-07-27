// One-shot items used in combat. Phase 1 = INSTANT effects only (lasting wards
// and damage-over-time wait for the condition engine). A consumable is spent on
// use and costs the user's whole turn, like casting a spell. Art is a tile in
// assets/tiles (see `tile`); acquired as loot, kept in a shared party pouch
// (state.meta.consumables).
//
//   use.target: 'self' | 'ally' | 'enemy' | 'all-enemies'
//   effects (any combination):
//     heal:          '2d4+2'  -> restore HP to an ally (revives the fallen)
//     tempHp:        '1d6+3'  -> a ward that soaks the next hits (see applyDamage)
//     restoreSpells: 'all' | N -> un-burn spells the caster spent this fight
//     damage:        '2d6' (+ dtype 'poison'|'acid'|'fire'|'physical';
//                    + saveDC for an 'all-enemies' DEX save for half)

export const CONSUMABLES = [
  {
    id: 'potion-healing', name: 'Healing Potion', tile: 'potion-healing',
    use: { target: 'ally', heal: '2d4+2' },
    blurb: 'a red draught that knits wounds — works even on a fallen ally',
  },
  {
    id: 'potion-mana', name: 'Draught of Recall', tile: 'potion-mana',
    use: { target: 'self', restoreSpells: 'all' },
    blurb: 'clears every spell you burned this fight',
  },
  {
    id: 'potion-protection', name: 'Potion of Warding', tile: 'potion-protection',
    use: { target: 'ally', tempHp: '1d6+3' },
    blurb: 'a shimmering ward that soaks the next blows to land',
  },
  {
    id: 'vial-poison', name: 'Vial of Venom', tile: 'vial-poison',
    use: { target: 'enemy', damage: '2d6', dtype: 'poison' },
    blurb: 'hurl a flask of venom at one foe',
  },
  {
    id: 'vial-caustic', name: 'Caustic Flask', tile: 'vial-caustic',
    use: { target: 'all-enemies', damage: '2d4', dtype: 'acid', saveDC: 12 },
    blurb: 'shatters in a spray of acid over the whole pack — save for half',
  },
];

export function consumableById(id) {
  return CONSUMABLES.find((c) => c.id === id);
}
