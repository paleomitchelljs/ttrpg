// BG3-style cinematic dice. Hero d20 rolls get the full-screen treatment: a
// tumbling die that settles on the natural roll, modifier chips that slide in,
// an AC/DC plate, and a verdict banner. Enemy rolls and quick damage play as a
// compact corner toast so a full monster round doesn't drag.
//
// Both components are pure presentation: the roll was already resolved in the
// engine; these just replay the recorded RollPayload, then call onDone.

import { useEffect, useRef, useState } from 'react';
import type { RollOutcome, RollPayload } from '../../lib/adventure/types';

// ───────── shared bits ─────────

function verdictText(p: RollPayload): string {
  switch (p.outcome) {
    case 'crit': return p.kind === 'attack' ? 'CRITICAL HIT!' : 'NATURAL 20!';
    case 'fumble': return 'FUMBLE!';
    case 'hit': return 'HIT!';
    case 'miss': return 'MISS';
    case 'success': return 'SUCCESS!';
    case 'failure': return 'FAILED';
    case 'plain':
      return p.kind === 'heal' ? `+${p.total} HP` : `${p.total} DAMAGE`;
  }
}

function verdictClass(outcome: RollOutcome): string {
  switch (outcome) {
    case 'crit': return 'crit';
    case 'hit': case 'success': return 'good';
    case 'miss': case 'failure': return 'bad';
    case 'fumble': return 'fumble';
    default: return 'plain';
  }
}

/** A number that churns while `spinning`, then shows `value`. */
function useTumble(value: number, sides: number, spinning: boolean): number {
  const [shown, setShown] = useState(value);
  useEffect(() => {
    if (!spinning || sides <= 1) {
      setShown(value);
      return;
    }
    const t = setInterval(() => setShown(1 + Math.floor(Math.random() * sides)), 70);
    return () => clearInterval(t);
  }, [spinning, sides, value]);
  return spinning ? shown : value;
}

function Die({ value, sides, spinning, dropped, small }: {
  value: number;
  sides: number;
  spinning: boolean;
  dropped?: boolean;
  small?: boolean;
}) {
  const shown = useTumble(value, sides, spinning);
  const face = sides === 20 && !spinning && (value === 20 || value === 1);
  return (
    <div
      className={[
        'dice-die',
        small ? 'small' : '',
        spinning ? 'spinning' : 'settled',
        dropped ? 'dropped' : '',
        face && value === 20 ? 'nat20' : '',
        face && value === 1 ? 'nat1' : '',
      ].join(' ')}
      data-sides={sides}
    >
      <span className="dice-die-num">{shown}</span>
      <span className="dice-die-sides">d{sides}</span>
    </div>
  );
}

// ───────── full-screen cinematic (hero rolls) ─────────

type Phase = 'rolling' | 'settled' | 'total' | 'verdict';

const PHASE_MS: Record<Phase, number> = {
  rolling: 950,
  settled: 500,
  total: 550,
  verdict: 1350,
};

export function DiceCinematic({ payload, onDone }: { payload: RollPayload; onDone: () => void }) {
  const isDamage = payload.kind === 'damage' || payload.kind === 'heal';
  const [phase, setPhase] = useState<Phase>('rolling');
  const done = useRef(false);

  useEffect(() => {
    const next: Record<Phase, Phase | null> = {
      rolling: 'settled',
      settled: 'total',
      total: 'verdict',
      verdict: null,
    };
    // Damage rolls skip the drum-roll pacing: settle fast, flash the total.
    const ms = isDamage ? Math.round(PHASE_MS[phase] * 0.6) : PHASE_MS[phase];
    const t = setTimeout(() => {
      const n = next[phase];
      if (n) setPhase(n);
      else if (!done.current) {
        done.current = true;
        onDone();
      }
    }, ms);
    return () => clearTimeout(t);
  }, [phase, isDamage, onDone]);

  function skip() {
    if (phase !== 'verdict') {
      setPhase('verdict');
    } else if (!done.current) {
      done.current = true;
      onDone();
    }
  }

  const spinning = phase === 'rolling';
  const showParts = phase !== 'rolling';
  const showTotal = phase === 'total' || phase === 'verdict';
  const showVerdict = phase === 'verdict';
  const vclass = verdictClass(payload.outcome);

  return (
    <div className={`dice-overlay ${vclass}`} onClick={skip} role="dialog" aria-label={payload.title}>
      <div className="dice-stage">
        <div className="dice-title">{payload.title}</div>
        {payload.targetLabel && (
          <div className={`dice-target ${showVerdict ? vclass : ''}`}>vs {payload.targetLabel}</div>
        )}

        <div className="dice-tray">
          {payload.rolls.map((v, i) => (
            <Die key={i} value={v} sides={payload.sides} spinning={spinning} small={payload.rolls.length > 2} />
          ))}
          {payload.dropped !== undefined && (
            <Die value={payload.dropped} sides={payload.sides} spinning={spinning} dropped={!spinning} />
          )}
        </div>
        {payload.mode !== 'normal' && (
          <div className={`dice-mode ${payload.mode}`}>
            {payload.mode === 'advantage' ? '▲ advantage — keep the best' : '▼ disadvantage — keep the worst'}
          </div>
        )}

        <div className={`dice-parts ${showParts ? 'shown' : ''}`}>
          {payload.parts.map((p, i) => (
            <span key={i} className={`dice-part ${p.value < 0 ? 'neg' : ''}`} style={{ transitionDelay: `${i * 110}ms` }}>
              {p.value >= 0 ? '+' : '−'}{Math.abs(p.value)} <em>{p.label}</em>
            </span>
          ))}
        </div>

        <div className={`dice-total ${showTotal ? 'shown' : ''} ${showVerdict ? vclass : ''}`}>{payload.total}</div>

        <div className={`dice-verdict ${vclass} ${showVerdict ? 'shown' : ''}`}>{verdictText(payload)}</div>
        <div className="dice-hint">tap to skip</div>
      </div>
    </div>
  );
}

// ───────── corner toast (enemy rolls, quick beats) ─────────

export function RollToast({ payload, onDone }: { payload: RollPayload; onDone: () => void }) {
  const [spinning, setSpinning] = useState(true);
  const done = useRef(false);

  useEffect(() => {
    const settle = setTimeout(() => setSpinning(false), 420);
    const finish = setTimeout(() => {
      if (!done.current) {
        done.current = true;
        onDone();
      }
    }, 1250);
    return () => {
      clearTimeout(settle);
      clearTimeout(finish);
    };
  }, [onDone]);

  function skip() {
    if (!done.current) {
      done.current = true;
      onDone();
    }
  }

  const vclass = verdictClass(payload.outcome);
  return (
    <div className={`roll-toast ${vclass}`} onClick={skip}>
      <div className="roll-toast-title">{payload.title}</div>
      <div className="roll-toast-body">
        <div className="roll-toast-dice">
          {payload.rolls.slice(0, 4).map((v, i) => (
            <Die key={i} value={v} sides={payload.sides} spinning={spinning} small />
          ))}
        </div>
        <div className="roll-toast-math">
          {!spinning && (
            <>
              <span className={`roll-toast-total ${vclass}`}>{payload.total}</span>
              {payload.targetLabel && <span className="roll-toast-target">vs {payload.targetLabel}</span>}
              <span className={`roll-toast-verdict ${vclass}`}>{verdictText(payload)}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
