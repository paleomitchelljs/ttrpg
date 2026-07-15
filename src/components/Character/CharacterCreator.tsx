import { useMemo, useState } from 'react';
import { formatMod, statMod } from '../../lib/dice';
import {
  computeAC,
  newCharacterId,
  rollAlignment,
  rollBackground,
  rollDeity,
  rollGold,
  rollName,
  rollQuickCharacter,
  rollStartingHP,
} from '../../lib/shadowdark/character';
import { ANCESTRIES, getAncestry } from '../../lib/shadowdark/ancestries';
import { BACKGROUNDS } from '../../lib/shadowdark/backgrounds';
import { CLASSES, getClass } from '../../lib/shadowdark/classes';
import { DEITIES } from '../../lib/shadowdark/deities';
import { STARTING_GEAR } from '../../lib/shadowdark/gear';
import { spellsForClass } from '../../lib/shadowdark/spells';
import { saveCharacter } from '../../lib/storage';
import { emitCharactersChanged } from '../../lib/hooks';
import type { Alignment, Character, StatBlock } from '../../lib/shadowdark/types';
import { StatBlockEditor } from './StatBlockEditor';
import { ChoiceGrid } from './ChoiceGrid';
import { PortraitUploader } from './PortraitUploader';

interface Props {
  initial?: Character;
  onSaved: (character: Character) => void;
  onCancel: () => void;
}

const ALIGNMENTS: Alignment[] = ['Lawful', 'Neutral', 'Chaotic'];

export function CharacterCreator({ initial, onSaved, onCancel }: Props) {
  const seed = useMemo(() => initial ?? buildBlank(), [initial]);
  const [draft, setDraft] = useState<Character>(seed);

  const cls = getClass(draft.classId);
  const ancestry = getAncestry(draft.ancestryId);
  const isCaster = Boolean(cls?.spellStat);
  const conMod = statMod(draft.stats.CON);

  function patch(p: Partial<Character>) {
    setDraft((d) => ({ ...d, ...p }));
  }

  function patchStats(stats: StatBlock) {
    setDraft((d) => ({ ...d, stats, ac: computeAC(stats) }));
  }

  function rerollEverything() {
    const fresh = rollQuickCharacter();
    setDraft({
      ...fresh,
      id: draft.id,
      createdAt: draft.createdAt,
      updatedAt: Date.now(),
      portraitArtId: draft.portraitArtId,
    });
  }

  function rerollHP() {
    const hp = rollStartingHP(draft.classId, draft.ancestryId, conMod);
    patch({ hp: { max: hp, current: hp } });
  }

  function rerollGold() {
    patch({ gold: rollGold(draft.classId) });
  }

  function rerollBackground() {
    patch({ background: rollBackground().name });
  }

  function rerollAlignment() {
    patch({ alignment: rollAlignment() });
  }

  function rerollName() {
    patch({ name: rollName(draft.ancestryId) });
  }

  function rerollDeity() {
    patch({ deity: rollDeity(draft.alignment).name });
  }

  function toggleSpell(name: string) {
    const has = draft.spells.includes(name);
    if (has) patch({ spells: draft.spells.filter((s) => s !== name) });
    else patch({ spells: [...draft.spells, name] });
  }

  function rerollSpells() {
    if (!cls?.startingSpellCount) return;
    const pool = spellsForClass(cls.id);
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    let spells = shuffled.slice(0, cls.startingSpellCount).map((s) => s.name);
    if (cls.id === 'priest' && !spells.includes('Turn Undead')) {
      spells = ['Turn Undead', ...spells].slice(0, cls.startingSpellCount);
    }
    patch({ spells });
  }

  function changeClass(id: string) {
    const next = getClass(id);
    if (!next) return;
    const updates: Partial<Character> = {
      classId: id,
      gold: rollGold(id),
      gear: (STARTING_GEAR[id]?.items ?? []).map((name) => ({ name })),
      equipment: { ...(STARTING_GEAR[id]?.equipment ?? {}) },
      spells: [],
    };
    updates.hp = (() => {
      const hp = rollStartingHP(id, draft.ancestryId, conMod);
      return { max: hp, current: hp };
    })();
    if (next.spellStat && next.startingSpellCount) {
      const pool = spellsForClass(id);
      const shuffled = [...pool].sort(() => Math.random() - 0.5);
      updates.spells = shuffled.slice(0, next.startingSpellCount).map((s) => s.name);
      if (id === 'priest' && !updates.spells.includes('Turn Undead')) {
        updates.spells = ['Turn Undead', ...updates.spells].slice(0, next.startingSpellCount);
      }
    }
    if (id === 'priest') updates.deity = rollDeity(draft.alignment).name;
    else updates.deity = undefined;
    patch(updates);
  }

  function changeAncestry(id: string) {
    patch({ ancestryId: id });
  }

  async function save() {
    const toSave: Character = { ...draft, updatedAt: Date.now() };
    await saveCharacter(toSave);
    emitCharactersChanged();
    onSaved(toSave);
  }

  const availableSpells = spellsForClass(draft.classId);

  return (
    <div className="col" style={{ gap: '1.25rem' }}>
      <div className="row">
        <h1 style={{ margin: 0 }} className="grow">
          {initial ? 'Edit Hero' : 'New Hero'}
        </h1>
        <button onClick={rerollEverything}>↻ Roll everything</button>
        <button className="ghost" onClick={onCancel}>
          Cancel
        </button>
        <button className="primary" onClick={save} disabled={!draft.name.trim()}>
          Save
        </button>
      </div>

      <div className="card col">
        <h2 className="section-title">Identity</h2>
        <div className="row">
          <div className="col grow">
            <label>Name</label>
            <div className="row">
              <input
                className="grow"
                value={draft.name}
                onChange={(e) => patch({ name: e.target.value })}
                placeholder="Adventurer's name"
              />
              <button className="ghost" onClick={rerollName}>↻</button>
            </div>
          </div>
          <div className="col">
            <label>Alignment</label>
            <div className="row">
              <select
                value={draft.alignment}
                onChange={(e) => patch({ alignment: e.target.value as Alignment })}
              >
                {ALIGNMENTS.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
              <button className="ghost" onClick={rerollAlignment}>↻</button>
            </div>
          </div>
          <div className="col">
            <label>Level</label>
            <input
              type="number"
              min={1}
              max={10}
              value={draft.level}
              onChange={(e) => patch({ level: Math.max(1, parseInt(e.target.value, 10) || 1) })}
              style={{ width: '4rem' }}
            />
          </div>
        </div>
        <div className="col">
          <label>Ancestry</label>
          <ChoiceGrid
            items={ANCESTRIES.map((a) => ({
              id: a.id,
              title: a.name,
              blurb: a.trait,
            }))}
            selectedId={draft.ancestryId}
            onSelect={changeAncestry}
          />
        </div>
        <div className="col">
          <label>Class</label>
          <ChoiceGrid
            items={CLASSES.map((c) => ({
              id: c.id,
              title: c.name,
              blurb: `HD d${c.hitDie} · ${c.description}`,
            }))}
            selectedId={draft.classId}
            onSelect={changeClass}
          />
        </div>
      </div>

      <div className="card col">
        <h2 className="section-title">Ability Scores</h2>
        <StatBlockEditor stats={draft.stats} onChange={patchStats} />
      </div>

      <div className="row" style={{ alignItems: 'stretch' }}>
        <div className="card col grow">
          <h2 className="section-title">Vitals</h2>
          <div className="row">
            <div className="col grow">
              <label>Max HP</label>
              <div className="row">
                <input
                  type="number"
                  value={draft.hp.max}
                  onChange={(e) => {
                    const max = Math.max(1, parseInt(e.target.value, 10) || 1);
                    patch({ hp: { max, current: max } });
                  }}
                  style={{ width: '5rem' }}
                />
                <span className="muted" style={{ fontSize: '0.85rem' }}>
                  d{cls?.hitDie ?? 6} {formatMod(conMod)} CON
                  {ancestry?.id === 'dwarf' ? ' (dwarf +2, adv.)' : ''}
                </span>
                <button className="ghost" onClick={rerollHP}>↻ Roll</button>
              </div>
            </div>
            <div className="col">
              <label>AC</label>
              <input
                type="number"
                value={draft.ac}
                onChange={(e) => patch({ ac: parseInt(e.target.value, 10) || 10 })}
                style={{ width: '4rem' }}
              />
            </div>
          </div>
        </div>
        <div className="card col grow">
          <h2 className="section-title">Background</h2>
          <div className="row">
            <select
              value={draft.background}
              onChange={(e) => patch({ background: e.target.value })}
              className="grow"
            >
              {BACKGROUNDS.map((b) => (
                <option key={b.roll} value={b.name}>
                  {b.roll}. {b.name}
                </option>
              ))}
            </select>
            <button className="ghost" onClick={rerollBackground}>↻</button>
          </div>
          <p className="muted" style={{ fontSize: '0.85rem', margin: 0 }}>
            {BACKGROUNDS.find((b) => b.name === draft.background)?.description}
          </p>
        </div>
      </div>

      {draft.classId === 'priest' && (
        <div className="card col">
          <h2 className="section-title">Deity</h2>
          <div className="row">
            <select
              className="grow"
              value={draft.deity ?? ''}
              onChange={(e) => patch({ deity: e.target.value })}
            >
              <option value="">— Choose —</option>
              {DEITIES.map((d) => (
                <option key={d.name} value={d.name}>
                  {d.name} ({d.alignment})
                </option>
              ))}
            </select>
            <button className="ghost" onClick={rerollDeity}>↻</button>
          </div>
          <p className="muted" style={{ fontSize: '0.85rem', margin: 0 }}>
            {DEITIES.find((d) => d.name === draft.deity)?.description}
          </p>
        </div>
      )}

      {isCaster && (
        <div className="card col">
          <div className="row">
            <h2 className="section-title grow" style={{ marginBottom: 0 }}>
              Starting Spells
            </h2>
            <span className="muted" style={{ fontSize: '0.85rem' }}>
              Pick {cls?.startingSpellCount}. Selected {draft.spells.length}.
            </span>
            <button className="ghost" onClick={rerollSpells}>↻ Roll</button>
          </div>
          <div className="choice-grid">
            {availableSpells.map((s) => {
              const selected = draft.spells.includes(s.name);
              return (
                <button
                  key={s.name}
                  className={`choice ${selected ? 'selected' : ''}`}
                  onClick={() => toggleSpell(s.name)}
                >
                  <h4>{s.name}</h4>
                  <p className="blurb">
                    <span className="faint">{s.range} · {s.duration}</span>
                    <br />
                    {s.text}
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="card col">
        <div className="row">
          <h2 className="section-title grow" style={{ marginBottom: 0 }}>
            Gear & Gold
          </h2>
          <button className="ghost" onClick={rerollGold}>↻ Roll gold</button>
        </div>
        <div className="row">
          <div className="col">
            <label>Gold</label>
            <input
              type="number"
              value={draft.gold}
              onChange={(e) => patch({ gold: parseInt(e.target.value, 10) || 0 })}
              style={{ width: '6rem' }}
            />
          </div>
          <span className="muted" style={{ fontSize: '0.85rem' }}>
            Starting: {STARTING_GEAR[draft.classId]?.gold ?? '2d6×5gp'}
          </span>
        </div>
        <div>
          <label>Items</label>
          <ul className="gear-list">
            {draft.gear.map((item, i) => (
              <li key={i}>
                <input
                  className="item-name grow"
                  style={{ background: 'transparent', border: 'none', padding: 0 }}
                  value={item.name}
                  onChange={(e) => {
                    const next = [...draft.gear];
                    next[i] = { ...next[i], name: e.target.value };
                    patch({ gear: next });
                  }}
                />
                <button
                  className="ghost"
                  onClick={() => patch({ gear: draft.gear.filter((_, j) => j !== i) })}
                  style={{ fontSize: '0.75rem' }}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <button
            className="ghost"
            style={{ marginTop: '0.5rem' }}
            onClick={() => patch({ gear: [...draft.gear, { name: 'New item' }] })}
          >
            + Add item
          </button>
        </div>
      </div>

      <div className="row" style={{ alignItems: 'stretch' }}>
        <div className="card col">
          <h2 className="section-title">Portrait</h2>
          <PortraitUploader
            artId={draft.portraitArtId}
            onChange={(id) => patch({ portraitArtId: id })}
          />
        </div>
        <div className="card col grow">
          <h2 className="section-title">Notes</h2>
          <textarea
            value={draft.notes ?? ''}
            onChange={(e) => patch({ notes: e.target.value })}
            rows={8}
            placeholder="Backstory, personality, goals..."
            style={{ resize: 'vertical' }}
          />
        </div>
      </div>

      <div className="row">
        <span className="grow" />
        <button className="ghost" onClick={onCancel}>
          Cancel
        </button>
        <button className="primary" onClick={save} disabled={!draft.name.trim()}>
          Save
        </button>
      </div>
    </div>
  );
}

function buildBlank(): Character {
  const fresh = rollQuickCharacter();
  return {
    id: newCharacterId(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...fresh,
  };
}
