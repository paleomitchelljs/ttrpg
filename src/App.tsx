import { useState } from 'react';
import { CharacterTab } from './pages/CharacterTab';
import { DiceTab } from './pages/DiceTab';
import { EnemyTab } from './pages/EnemyTab';
import { AdventureTab } from './pages/AdventureTab';
import { RulesTab } from './pages/RulesTab';

type TabId = 'characters' | 'enemies' | 'adventure' | 'dice' | 'rules';

const TABS: { id: TabId; label: string }[] = [
  { id: 'characters', label: 'Heroes' },
  { id: 'enemies', label: 'Monsters' },
  { id: 'adventure', label: 'Adventure' },
  { id: 'dice', label: 'Dice' },
  { id: 'rules', label: 'Rules' },
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
          <a className="tab" href={`${import.meta.env.BASE_URL}dragon.html`} target="_blank" rel="noopener">
            <span className="tab-label">🐉 Dragon Maze</span>
          </a>
        </nav>
      </header>
      <main className="app-main">
        {tab === 'characters' && <CharacterTab />}
        {tab === 'enemies' && <EnemyTab />}
        {tab === 'adventure' && <AdventureTab />}
        {tab === 'dice' && <DiceTab />}
        {tab === 'rules' && <RulesTab />}
      </main>
    </div>
  );
}
