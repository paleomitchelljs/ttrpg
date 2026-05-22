import type { Ancestry } from './types';

export const ANCESTRIES: Ancestry[] = [
  {
    id: 'dwarf',
    name: 'Dwarf',
    description: 'Stout folk of mountain and stone, masters of forge and axe.',
    trait: 'Stout: Start with +2 HP. Roll your hit point gains with advantage.',
    languages: ['Common', 'Dwarvish'],
  },
  {
    id: 'elf',
    name: 'Elf',
    description: 'Ageless wanderers of starlit wood, keen of eye and arrow.',
    trait: 'Farsight: You get a +1 bonus to attack rolls with ranged weapons OR a +1 bonus to spellcasting checks.',
    languages: ['Common', 'Elvish', 'Sylvan'],
  },
  {
    id: 'goblin',
    name: 'Goblin',
    description: 'Sharp-toothed scuttlers of dark places, quick and cunning.',
    trait: 'Keen Senses: You can\'t be surprised.',
    languages: ['Common', 'Goblin'],
  },
  {
    id: 'halfling',
    name: 'Halfling',
    description: 'Small folk with stout hearts and a fondness for hearth and home.',
    trait: 'Stealthy: Once per day, you can become invisible for 3 rounds.',
    languages: ['Common'],
  },
  {
    id: 'half-orc',
    name: 'Half-Orc',
    description: 'Children of two worlds, fierce of temper and mighty of arm.',
    trait: 'Mighty: You have a +1 bonus to attack and damage rolls with melee weapons.',
    languages: ['Common', 'Orcish'],
  },
  {
    id: 'human',
    name: 'Human',
    description: 'Ambitious and adaptable, the most numerous of folk.',
    trait: 'Ambitious: You gain one additional talent roll at 1st level.',
    languages: ['Common', 'Common (any one extra)'],
  },
];

export function getAncestry(id: string): Ancestry | undefined {
  return ANCESTRIES.find((a) => a.id === id);
}
