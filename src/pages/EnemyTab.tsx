import { useEffect, useMemo, useState } from 'react';
import { MONSTERS, getMonster, monstersByTier } from '../lib/shadowdark/monsters';
import type { Monster, MonsterAttack } from '../lib/shadowdark/monsters';
import { roll } from '../lib/dice';
import type { Encounter, EncounterMonster } from '../lib/shadowdark/types';
import { deleteEncounter, saveEncounter } from '../lib/storage';
import { emitEncountersChanged, useEncounters } from '../lib/hooks';
import { rollAndLog, useLatestRoll } from '../lib/rollLog';

const TAG_FILTERS: { tag: string; label: string }[] = [
  { tag: '', label: 'All' },
  { tag: 'tier-1', label: 'Tier 1' },
  { tag: 'tier-2', label: 'Tier 2' },
  { tag: 'tier-3', label: 'Bosses' },
  { tag: 'undead', label: 'Undead' },
  { tag: 'beast', label: 'Beasts' },
  { tag: 'humanoid', label: 'Humanoids' },
];

function newEncounterId() {
  return `enc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
function newInstanceId() {
  return `m_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

export function EnemyTab() {
  const { encounters } = useEncounters();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<string>('');
  const latestRoll = useLatestRoll();

  // Keep active encounter from going stale when storage changes.
  const active = activeId ? encounters.find((e) => e.id === activeId) ?? null : null;

  // Auto-select most recent encounter when one exists and nothing is selected.
  useEffect(() => {
    if (!activeId && encounters.length > 0) setActiveId(encounters[0].id);
  }, [encounters, activeId]);

  const filteredMonsters = useMemo(() => {
    if (!tagFilter) return MONSTERS;
    return MONSTERS.filter((m) => m.tags.includes(tagFilter));
  }, [tagFilter]);

  async function createEncounter(): Promise<Encounter> {
    const enc: Encounter = {
      id: newEncounterId(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      name: `Encounter ${encounters.length + 1}`,
      monsters: [],
    };
    await saveEncounter(enc);
    emitEncountersChanged();
    setActiveId(enc.id);
    return enc;
  }

  async function spawnMonster(monster: Monster) {
    let enc = active;
    if (!enc) enc = await createEncounter();
    const sameTypeCount = enc.monsters.filter((m) => m.monsterId === monster.id).length;
    const suffix = sameTypeCount > 0 ? ` ${String.fromCharCode(65 + sameTypeCount)}` : '';
    const instance: EncounterMonster = {
      id: newInstanceId(),
      monsterId: monster.id,
      label: `${monster.name}${suffix}`,
      hp: { current: monster.hpMax, max: monster.hpMax },
    };
    const next: Encounter = { ...enc, monsters: [...enc.monsters, instance] };
    await saveEncounter(next);
    emitEncountersChanged();
  }

  async function rollEncounter(tier: 1 | 2 | 3) {
    const pool = monstersByTier(tier);
    if (pool.length === 0) return;
    // Pick 1d4 monsters; if any are tagged "boss", cap that group to a single instance.
    const groupCount = roll('1d4').total;
    const enc: Encounter = {
      id: newEncounterId(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      name: `Random Tier ${tier}`,
      monsters: [],
    };
    for (let i = 0; i < groupCount; i++) {
      const chosen = pool[Math.floor(Math.random() * pool.length)];
      const sameTypeCount = enc.monsters.filter((m) => m.monsterId === chosen.id).length;
      if (chosen.tags.includes('boss') && sameTypeCount > 0) continue;
      const suffix = sameTypeCount > 0 ? ` ${String.fromCharCode(65 + sameTypeCount)}` : '';
      enc.monsters.push({
        id: newInstanceId(),
        monsterId: chosen.id,
        label: `${chosen.name}${suffix}`,
        hp: { current: chosen.hpMax, max: chosen.hpMax },
      });
    }
    await saveEncounter(enc);
    emitEncountersChanged();
    setActiveId(enc.id);
  }

  async function patchEncounter(updates: Partial<Encounter>) {
    if (!active) return;
    await saveEncounter({ ...active, ...updates });
    emitEncountersChanged();
  }

  async function patchInstance(instanceId: string, updates: Partial<EncounterMonster>) {
    if (!active) return;
    const next = active.monsters.map((m) =>
      m.id === instanceId ? { ...m, ...updates } : m
    );
    await patchEncounter({ monsters: next });
  }

  async function removeInstance(instanceId: string) {
    if (!active) return;
    await patchEncounter({ monsters: active.monsters.filter((m) => m.id !== instanceId) });
  }

  async function removeEncounter(id: string) {
    if (!confirm('Delete this encounter?')) return;
    await deleteEncounter(id);
    emitEncountersChanged();
    if (activeId === id) setActiveId(null);
  }

  async function clearDeadFromActive() {
    if (!active) return;
    await patchEncounter({ monsters: active.monsters.filter((m) => m.hp.current > 0) });
  }

  return (
    <div className="col" style={{ gap: '1.25rem' }}>
      <div className="row" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
        <h1 style={{ margin: 0 }} className="grow">Monsters</h1>
        <button className="ghost" onClick={() => rollEncounter(1)}>🎲 Tier 1</button>
        <button className="ghost" onClick={() => rollEncounter(2)}>🎲 Tier 2</button>
        <button className="ghost" onClick={() => rollEncounter(3)}>🎲 Boss</button>
        <button className="primary" onClick={createEncounter}>+ New encounter</button>
      </div>

      {encounters.length > 1 && (
        <div className="encounter-pills">
          {encounters.map((e) => (
            <button
              key={e.id}
              className={`encounter-pill ${e.id === activeId ? 'active' : ''}`}
              onClick={() => setActiveId(e.id)}
            >
              {e.name}
              <span className="muted" style={{ marginLeft: '0.4rem' }}>({e.monsters.length})</span>
            </button>
          ))}
        </div>
      )}

      {active && (
        <EncounterView
          encounter={active}
          onRename={(name) => patchEncounter({ name })}
          onPatchInstance={patchInstance}
          onRemoveInstance={removeInstance}
          onClearDead={clearDeadFromActive}
          onDeleteEncounter={() => removeEncounter(active.id)}
          latestRoll={latestRoll}
        />
      )}

      <div className="card col">
        <div className="row">
          <div className="big-label grow">Monster library</div>
          <span className="muted">Tap a card to add to {active ? `"${active.name}"` : 'a new encounter'}.</span>
        </div>
        <div className="row" style={{ flexWrap: 'wrap', gap: '0.3rem' }}>
          {TAG_FILTERS.map((f) => (
            <button
              key={f.tag}
              className={`filter-pill ${tagFilter === f.tag ? 'active' : ''}`}
              onClick={() => setTagFilter(f.tag)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="monster-library">
          {filteredMonsters.map((m) => (
            <MonsterLibraryCard key={m.id} monster={m} onAdd={() => spawnMonster(m)} />
          ))}
        </div>
      </div>
    </div>
  );
}

function MonsterLibraryCard({ monster, onAdd }: { monster: Monster; onAdd: () => void }) {
  return (
    <button className="monster-lib-card" onClick={onAdd}>
      <div className="monster-lib-header">
        {monster.icon && (
          <img src={`${import.meta.env.BASE_URL}${monster.icon}`} alt="" className="monster-icon" />
        )}
        <div className="monster-lib-name grow">{monster.name}</div>
      </div>
      <div className="monster-lib-stats">
        <span>❤️ {monster.hpMax}</span>
        <span>🛡️ {monster.ac}</span>
        <span className="muted">L{monster.level}</span>
      </div>
      {monster.tags.length > 0 && (
        <div className="monster-lib-tags">
          {monster.tags.slice(0, 3).map((t) => (
            <span key={t} className="mini-tag">{t}</span>
          ))}
        </div>
      )}
    </button>
  );
}

interface EncounterViewProps {
  encounter: Encounter;
  onRename: (name: string) => void;
  onPatchInstance: (id: string, updates: Partial<EncounterMonster>) => void;
  onRemoveInstance: (id: string) => void;
  onClearDead: () => void;
  onDeleteEncounter: () => void;
  latestRoll: ReturnType<typeof useLatestRoll>;
}

function EncounterView({
  encounter,
  onRename,
  onPatchInstance,
  onRemoveInstance,
  onClearDead,
  onDeleteEncounter,
  latestRoll,
}: EncounterViewProps) {
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(encounter.name);
  const hasDead = encounter.monsters.some((m) => m.hp.current <= 0);

  return (
    <div className="card col" style={{ gap: '0.9rem' }}>
      <div className="row">
        {editingName ? (
          <>
            <input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={() => { onRename(nameDraft); setEditingName(false); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { onRename(nameDraft); setEditingName(false); }
                if (e.key === 'Escape') { setNameDraft(encounter.name); setEditingName(false); }
              }}
              className="grow"
              style={{ fontSize: '1.4rem', fontFamily: 'var(--font-display)' }}
            />
          </>
        ) : (
          <h2
            className="grow"
            style={{ margin: 0, cursor: 'pointer' }}
            onClick={() => { setNameDraft(encounter.name); setEditingName(true); }}
          >
            {encounter.name}
          </h2>
        )}
        {hasDead && <button className="ghost" onClick={onClearDead}>Clear dead</button>}
        <button className="ghost danger" onClick={onDeleteEncounter}>Delete</button>
      </div>

      {latestRoll && (
        <div className={`roll-banner ${latestRoll.isCrit ? 'crit' : latestRoll.isFumble ? 'fumble' : ''}`}>
          <div className="roll-banner-label">{latestRoll.label ?? latestRoll.expression}</div>
          <div className="roll-banner-total">{latestRoll.total}</div>
          <div className="roll-banner-detail">{latestRoll.breakdown}</div>
        </div>
      )}

      {encounter.monsters.length === 0 ? (
        <div className="placeholder" style={{ padding: '1.5rem' }}>
          Empty. Tap a monster below to add it.
        </div>
      ) : (
        <div className="encounter-grid">
          {encounter.monsters.map((inst) => (
            <MonsterInstanceCard
              key={inst.id}
              instance={inst}
              onPatch={(updates) => onPatchInstance(inst.id, updates)}
              onRemove={() => onRemoveInstance(inst.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface MonsterInstanceProps {
  instance: EncounterMonster;
  onPatch: (updates: Partial<EncounterMonster>) => void;
  onRemove: () => void;
}

function MonsterInstanceCard({ instance, onPatch, onRemove }: MonsterInstanceProps) {
  const template = getMonster(instance.monsterId);
  if (!template) {
    return (
      <div className="monster-card">
        <div className="row">
          <div className="grow">{instance.label} (unknown)</div>
          <button className="ghost" onClick={onRemove}>✕</button>
        </div>
      </div>
    );
  }
  const dead = instance.hp.current <= 0;

  function adjustHP(delta: number) {
    const current = Math.max(0, Math.min(instance.hp.max, instance.hp.current + delta));
    onPatch({ hp: { ...instance.hp, current } });
  }

  function rollAttack(atk: MonsterAttack) {
    const expr = `1d20${atk.bonus >= 0 ? '+' : ''}${atk.bonus}`;
    rollAndLog(expr, 'normal', `${instance.label}: ${atk.name}`);
    const dmg = String(atk.damage).trim();
    if (dmg && dmg !== '—' && dmg !== '0' && dmg !== 'special' && /\d+d\d+/i.test(dmg)) {
      try {
        rollAndLog(dmg, 'normal', `${instance.label}: ${atk.name} damage`);
      } catch {
        // ignore malformed damage expressions
      }
    }
  }

  return (
    <div className={`monster-card ${dead ? 'dead' : ''}`}>
      <div className="row">
        {template.icon && (
          <img src={`${import.meta.env.BASE_URL}${template.icon}`} alt="" className="monster-icon-lg" />
        )}
        <div className="grow monster-card-name">{instance.label}</div>
        <button className="ghost monster-card-x" onClick={onRemove} aria-label="remove">✕</button>
      </div>
      <div className="monster-card-hud">
        <div className="monster-hp">
          <div className="monster-hp-value">
            <span className="hud-icon">❤️</span> {instance.hp.current}<span className="hud-sub">/{instance.hp.max}</span>
          </div>
          <div className="monster-hp-buttons">
            <button className="hp-button" onClick={() => adjustHP(-1)}>−</button>
            <button className="hp-button" onClick={() => adjustHP(+1)}>＋</button>
          </div>
        </div>
        <div className="monster-ac">
          <span className="hud-icon">🛡️</span> {template.ac}
        </div>
      </div>
      <div className="monster-card-attacks">
        {template.attacks.map((atk, i) => (
          <button
            key={i}
            className="attack-button"
            onClick={() => rollAttack(atk)}
            disabled={dead}
          >
            <span className="attack-name">{atk.name}</span>
            <span className="attack-mod">
              {atk.bonus >= 0 ? `+${atk.bonus}` : atk.bonus} · {atk.damage}
            </span>
          </button>
        ))}
      </div>
      {template.notes && <div className="muted monster-card-notes">{template.notes}</div>}
    </div>
  );
}
