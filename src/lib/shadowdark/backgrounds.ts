import type { Background } from './types';

// Shadowdark's d20 Background table.
export const BACKGROUNDS: Background[] = [
  { roll: 1, name: 'Urchin', description: 'You grew up in the dirty streets of a large city.' },
  { roll: 2, name: 'Wanted', description: 'There is a price on your head, but you have allies.' },
  { roll: 3, name: 'Cult Initiate', description: 'You know blasphemous secrets and rituals.' },
  { roll: 4, name: 'Thieves\' Guild', description: 'You have connections to the local thieves\' guild.' },
  { roll: 5, name: 'Banished', description: 'Your tribe or family cast you out.' },
  { roll: 6, name: 'Orphaned', description: 'You were raised in an orphanage or by strangers.' },
  { roll: 7, name: 'Wizard\'s Apprentice', description: 'You served a wizard and learned a bit of magic.' },
  { roll: 8, name: 'Jeweler', description: 'You can appraise gems and jewelry.' },
  { roll: 9, name: 'Herbalist', description: 'You know plants, herbs, and their uses.' },
  { roll: 10, name: 'Barbarian', description: 'You hail from an uncivilized land.' },
  { roll: 11, name: 'Mercenary', description: 'You sold your blade to whomever could pay.' },
  { roll: 12, name: 'Sailor', description: 'You crewed a ship and know the sea.' },
  { roll: 13, name: 'Acolyte', description: 'You trained in a temple to a god.' },
  { roll: 14, name: 'Soldier', description: 'You served in an army or city guard.' },
  { roll: 15, name: 'Ranger', description: 'You guarded the borderlands and wilds.' },
  { roll: 16, name: 'Scout', description: 'You guided travelers through hostile lands.' },
  { roll: 17, name: 'Minstrel', description: 'You traveled and performed for coin.' },
  { roll: 18, name: 'Scholar', description: 'You studied lore in libraries and academies.' },
  { roll: 19, name: 'Noble', description: 'You hail from a wealthy and powerful family.' },
  { roll: 20, name: 'Chosen One', description: 'A prophecy or destiny rests upon your shoulders.' },
];
