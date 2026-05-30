import { useState } from 'react';
import { CharacterTab } from './pages/CharacterTab';
import { DiceTab } from './pages/DiceTab';
import { EnemyTab } from './pages/EnemyTab';
import { AdventureTab } from './pages/AdventureTab';

type TabId = 'characters' | 'enemies' | 'adventure' | 'dice';

const TABS: { id: TabId; label: string }[] = [
  { id: 'characters', label: 'Heroes' },
  { id: 'enemies', label: 'Monsters' },
  { id: 'adventure', label: 'Adventure' },
  { id: 'dice', label: 'Dice' },
];

export function App() {
  const [tab, setTab] = useState<TabId>('characters');

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-title">RPG Portal</div>
        <nav className="tab-bar">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`tab ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              <span className="tab-label">{t.label}</span>
            </button>
          ))}
        </nav>
      </header>
      <main className="app-main">
        {tab === 'characters' && <CharacterTab />}
        {tab === 'enemies' && <EnemyTab />}
        {tab === 'adventure' && <AdventureTab />}
        {tab === 'dice' && <DiceTab />}
      </main>
    </div>
  );
}
