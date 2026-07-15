// The Adventure portal: pick an adventure + a ruleset + 1–4 heroes from the
// pool, then play a scripted text adventure. Replaces the old Dungeons tab; the
// random rollers + maps live on in the collapsible QuickTools panel.

import { useEffect, useMemo, useState } from 'react';
import { useArtUrl, useCharacters } from '../lib/hooks';
import { getAncestry } from '../lib/shadowdark/ancestries';
import { getClass } from '../lib/shadowdark/classes';
import type { Character } from '../lib/shadowdark/types';
import { ADVENTURES, getAdventure } from '../lib/adventure/data';
import { createGame, migrateGameState, step } from '../lib/adventure/engine';
import type { GameState } from '../lib/adventure/types';
import {
  clearAdventureSave,
  getAdventureSave,
  saveAdventure,
  type AdventureSave,
} from '../lib/storage';
import { AdventurePlayer } from '../components/Adventure/AdventurePlayer';
import { QuestGenerator } from '../components/Adventure/QuestGenerator';
import { QuickTools } from '../components/Adventure/QuickTools';

const MAX_PARTY = 4;

const RULESET_NAMES: Record<string, string> = {
  shadowdark: 'Shadowdark',
  'eq-rpg': 'EverQuest d20',
};

function rulesetName(system: string): string {
  return RULESET_NAMES[system] ?? system;
}

export function AdventureTab() {
  const { characters, loading } = useCharacters();
  const [adventureId, setAdventureId] = useState(ADVENTURES[0]?.id ?? '');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showTools, setShowTools] = useState(false);
  const [levelOverride, setLevelOverride] = useState<number | null>(null);

  const [game, setGame] = useState<GameState | null>(null);
  const [partyIds, setPartyIds] = useState<string[]>([]);
  const [save, setSave] = useState<AdventureSave | null>(null);

  useEffect(() => {
    getAdventureSave().then((s) => setSave(s ?? null));
  }, []);

  const adventure = useMemo(() => getAdventure(adventureId), [adventureId]);

  function toggle(id: string) {
    setSelectedIds((ids) =>
      ids.includes(id) ? ids.filter((x) => x !== id) : ids.length >= MAX_PARTY ? ids : [...ids, id],
    );
  }

  async function persist(state: GameState, ids: string[]) {
    await saveAdventure(state, ids);
    setSave((await getAdventureSave()) ?? null);
  }

  function embark() {
    if (!adventure) return;
    // One autosave slot: don't let a new embark silently eat a game in progress.
    if (save && !save.state.outcome && !confirm('Starting a new adventure will overwrite your saved game. Continue?')) {
      return;
    }
    const party = selectedIds
      .map((id) => characters.find((c) => c.id === id))
      .filter((c): c is Character => !!c);
    if (party.length === 0) return;
    const state = createGame(adventure, party, levelOverride ?? undefined);
    setGame(state);
    setPartyIds(party.map((c) => c.id));
    void persist(state, party.map((c) => c.id));
  }

  function resume() {
    if (!save) return;
    // Old autosaves predate the crawler overhaul; patch in torchlight/initiative.
    setGame(migrateGameState(save.state));
    setPartyIds(save.partyIds);
  }

  function runCommand(cmd: string) {
    if (!game) return;
    const adv = getAdventure(game.adventureId);
    if (!adv) return;
    const next = step(game, adv, cmd);
    setGame(next);
    void persist(next, partyIds);
  }

  function exitToLobby() {
    setGame(null);
    getAdventureSave().then((s) => setSave(s ?? null));
  }

  async function finishAndClear() {
    await clearAdventureSave();
    setSave(null);
    setGame(null);
  }

  // ───────── active play ─────────
  if (game) {
    const adv = getAdventure(game.adventureId);
    if (adv) {
      return (
        <AdventurePlayer
          adventure={adv}
          state={game}
          onCommand={runCommand}
          onExit={exitToLobby}
          onFinish={finishAndClear}
        />
      );
    }
  }

  // ───────── lobby ─────────
  const selectedCount = selectedIds.length;
  const canEmbark = !!adventure && selectedCount >= 1 && selectedCount <= MAX_PARTY;
  const resumeAdventure = save ? getAdventure(save.adventureId) : undefined;

  // Dungeon scaling target: defaults to the selected party's average level.
  const selectedParty = selectedIds
    .map((id) => characters.find((c) => c.id === id))
    .filter((c): c is Character => !!c);
  const autoLevel = selectedParty.length
    ? Math.max(1, Math.round(selectedParty.reduce((s, c) => s + Math.max(1, c.level || 1), 0) / selectedParty.length))
    : 1;
  const effectiveLevel = levelOverride ?? autoLevel;

  return (
    <div className="col" style={{ gap: '1.25rem' }}>
      <h1 style={{ margin: 0 }}>Adventure</h1>

      {save && resumeAdventure && (
        <div className="card adv-resume row" style={{ alignItems: 'center', gap: '0.75rem' }}>
          <div className="col grow" style={{ gap: '0.15rem' }}>
            <div className="big-label">Continue your adventure</div>
            <div className="muted" style={{ fontSize: '0.85rem' }}>
              {resumeAdventure.title} · {save.state.party.length} hero{save.state.party.length === 1 ? '' : 'es'} ·{' '}
              {save.state.outcome ? (save.state.outcome === 'win' ? 'finished (won)' : 'finished (lost)') : 'in progress'}
            </div>
          </div>
          <button className="primary" onClick={resume}>Resume</button>
          <button className="ghost danger" onClick={finishAndClear}>Discard</button>
        </div>
      )}

      <div className="col" style={{ gap: '0.6rem' }}>
        <div className="big-label">Choose an adventure</div>
        <div className="adv-pick-grid">
          {ADVENTURES.map((a) => (
            <button
              key={a.id}
              className={`adv-pick-card ${a.id === adventureId ? 'active' : ''}`}
              onClick={() => setAdventureId(a.id)}
            >
              {a.mapImage && (
                <img
                  className="adv-pick-thumb"
                  src={`${import.meta.env.BASE_URL}${a.mapImage}`}
                  alt=""
                  loading="lazy"
                />
              )}
              <div className="adv-pick-body">
                <div className="adv-pick-title">{a.title}</div>
                <div className="adv-pick-system">Ruleset: {rulesetName(a.system)}</div>
                <div className="adv-pick-synopsis">{a.synopsis}</div>
                {a.recommendedParty && (
                  <div className="muted" style={{ fontSize: '0.8rem' }}>{a.recommendedParty}</div>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="col" style={{ gap: '0.6rem' }}>
        <div className="row" style={{ alignItems: 'baseline' }}>
          <div className="big-label grow">Choose your party</div>
          <div className={`muted ${selectedCount > MAX_PARTY ? 'over' : ''}`} style={{ fontSize: '0.85rem' }}>
            {selectedCount}/{MAX_PARTY} selected
          </div>
        </div>

        {loading ? (
          <div className="placeholder">Loading heroes…</div>
        ) : characters.length === 0 ? (
          <div className="card placeholder">
            No heroes yet. Create some on the <strong>Heroes</strong> tab, then come back to embark.
          </div>
        ) : (
          <div className="adv-party-grid">
            {characters.map((c) => (
              <PartyPickCard
                key={c.id}
                character={c}
                selected={selectedIds.includes(c.id)}
                order={selectedIds.indexOf(c.id)}
                disabled={!selectedIds.includes(c.id) && selectedCount >= MAX_PARTY}
                onToggle={() => toggle(c.id)}
              />
            ))}
          </div>
        )}

        <div className="row" style={{ alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <label style={{ margin: 0 }}>Scale dungeon to level</label>
          <input
            type="number"
            min={1}
            max={20}
            value={effectiveLevel}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              setLevelOverride(Number.isNaN(v) ? null : Math.max(1, Math.min(20, v)));
            }}
            style={{ width: '4rem' }}
          />
          <span className="muted" style={{ fontSize: '0.8rem' }}>
            {levelOverride == null
              ? `auto from party (avg level ${autoLevel})`
              : (
                <>
                  manual ·{' '}
                  <button className="ghost" style={{ fontSize: '0.75rem' }} onClick={() => setLevelOverride(null)}>
                    reset to auto
                  </button>
                </>
              )}
          </span>
        </div>

        <button className="primary" onClick={embark} disabled={!canEmbark} style={{ alignSelf: 'flex-start' }}>
          Embark{selectedCount > 0 ? ` with ${selectedCount}` : ''}
          {effectiveLevel > 1 ? ` · level ${effectiveLevel}` : ''}
        </button>
      </div>

      <QuestGenerator />

      <div className="col" style={{ gap: '0.5rem' }}>
        <button className="ghost" onClick={() => setShowTools((s) => !s)} style={{ alignSelf: 'flex-start' }}>
          {showTools ? 'Hide GM quick tools' : 'GM quick tools (scenes, treasure, traps, maps)'}
        </button>
        {showTools && <QuickTools />}
      </div>
    </div>
  );
}

function PartyPickCard({
  character,
  selected,
  order,
  disabled,
  onToggle,
}: {
  character: Character;
  selected: boolean;
  order: number;
  disabled: boolean;
  onToggle: () => void;
}) {
  const url = useArtUrl(character.portraitArtId);
  const ancestry = getAncestry(character.ancestryId);
  const cls = getClass(character.classId);
  return (
    <button
      className={`adv-party-card ${selected ? 'selected' : ''} ${disabled ? 'disabled' : ''}`}
      onClick={onToggle}
      disabled={disabled}
    >
      {selected && <span className="adv-party-badge">{order + 1}</span>}
      {url ? (
        <img src={url} alt={character.name} className="adv-party-portrait" />
      ) : (
        <div className="adv-party-portrait placeholder">{character.name.slice(0, 1).toUpperCase()}</div>
      )}
      <div className="adv-party-name">{character.name}</div>
      <div className="muted" style={{ fontSize: '0.75rem' }}>
        L{character.level} {ancestry?.name ?? ''} {cls?.name ?? ''}
      </div>
      <div className="muted" style={{ fontSize: '0.75rem' }}>
        HP {character.hp.current}/{character.hp.max} · AC {character.ac}
      </div>
    </button>
  );
}
