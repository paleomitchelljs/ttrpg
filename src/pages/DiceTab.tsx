import { useState } from 'react';
import { roll, type RollMode, type RollResult } from '../lib/dice';
import { RollLog } from '../components/Dice/RollLog';

const QUICK_DICE = ['1d4', '1d6', '1d8', '1d10', '1d12', '1d20', '1d100', '2d6', '3d6', '4d6'];

export function DiceTab() {
  const [expr, setExpr] = useState('1d20');
  const [mode, setMode] = useState<RollMode>('normal');
  const [rolls, setRolls] = useState<RollResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  function doRoll(expression: string) {
    try {
      const result = roll(expression, mode);
      setRolls((prev) => [result, ...prev].slice(0, 100));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="col" style={{ gap: '1.25rem' }}>
      <h1>Dice</h1>
      <div className="card col">
        <div className="row">
          <input
            value={expr}
            onChange={(e) => setExpr(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') doRoll(expr);
            }}
            placeholder="e.g. 1d20+5"
            className="grow"
            style={{ fontFamily: 'var(--font-mono)' }}
          />
          <select value={mode} onChange={(e) => setMode(e.target.value as RollMode)}>
            <option value="normal">Normal</option>
            <option value="advantage">Advantage</option>
            <option value="disadvantage">Disadvantage</option>
          </select>
          <button className="primary" onClick={() => doRoll(expr)}>
            Roll
          </button>
        </div>
        {error && <div style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{error}</div>}
        <div className="dice-quick">
          {QUICK_DICE.map((d) => (
            <button key={d} onClick={() => doRoll(d)}>
              {d}
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="row" style={{ marginBottom: '0.5rem' }}>
          <h3 style={{ margin: 0 }} className="grow">
            History
          </h3>
          {rolls.length > 0 && (
            <button className="ghost" onClick={() => setRolls([])}>
              Clear
            </button>
          )}
        </div>
        <RollLog rolls={rolls} />
      </div>
    </div>
  );
}
