// One-shot items used in combat. A consumable is spent on use and costs the
// user's whole turn, like casting a spell. Art is a tile in assets/tiles (see
// `tile`); acquired as loot, kept in a shared party pouch (state.meta.consumables).
//
//   use.target: 'self' | 'ally' | 'enemy' | 'all-enemies'
//   effects (any combination):
//     heal:          '2d4+2'  -> restore HP to an ally (revives the fallen)
//     tempHp:        '1d6+3'  -> a ward that soaks the next hits (see applyDamage)
//     restoreSpells: 'all' | N -> un-burn spells the caster spent this fight
//     damage:        '2d6' (+ dtype 'poison'|'acid'|'fire'|'physical';
//                    + saveDC for an 'all-enemies' DEX save for half)
//     condition:     { id, rounds, ac?, disadv?, dot?:{amount,dtype} } -> a timed
//                    buff/debuff: warded (+AC), greased (attack at disadvantage),
//                    burning (damage each turn). Ticks in combat.js advanceTurn.

export const CONSUMABLES = [
  {
    id: 'potion-healing', name: 'Healing Potion', tile: 'potion-healing',
    use: { target: 'ally', heal: '2d4+2' },
    blurb: 'a red draught that knits wounds; works even on a fallen ally',
  },
  {
    id: 'potion-mana', name: 'Draught of Recall', tile: 'potion-mana',
    use: { target: 'self', restoreSpells: 'all' },
    blurb: 'clears every spell you burned this fight',
  },
  {
    id: 'potion-protection', name: 'Potion of Warding', tile: 'potion-protection',
    use: { target: 'ally', condition: { id: 'warded', rounds: 3, ac: 2 } },
    blurb: 'a shimmering ward: +2 AC for 3 rounds',
  },
  {
    id: 'vial-poison', name: 'Vial of Venom', tile: 'vial-poison',
    use: { target: 'enemy', damage: '2d6', dtype: 'poison' },
    blurb: 'hurl a flask of venom at one foe',
  },
  {
    id: 'vial-caustic', name: 'Caustic Flask', tile: 'vial-caustic',
    use: { target: 'all-enemies', damage: '2d4', dtype: 'acid', saveDC: 12 },
    blurb: 'shatters in a spray of acid over the whole pack; save for half',
  },
  {
    id: 'grease', name: 'Flask of Grease', tile: 'grease',
    use: { target: 'all-enemies', condition: { id: 'greased', rounds: 2, disadv: true } },
    blurb: 'slick oil underfoot; the whole pack fights off-balance (disadvantage) for 2 rounds',
  },
  {
    id: 'flaming-pitch', name: 'Flaming Pitch', tile: 'flaming-pitch',
    use: { target: 'all-enemies', damage: '1d6', dtype: 'fire', saveDC: 12, condition: { id: 'burning', rounds: 2, dot: { amount: 2, dtype: 'fire' } } },
    blurb: 'a burst of fire that clings; burns the pack for 2 more each turn (save for half the splash)',
  },
];

export function consumableById(id) {
  return CONSUMABLES.find((c) => c.id === id);
}
