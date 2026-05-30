import { useState } from 'react';
import { formatMod, statMod } from '../../lib/dice';
import { getAncestry } from '../../lib/shadowdark/ancestries';
import { getClass } from '../../lib/shadowdark/classes';
import { characterCombatProfile } from '../../lib/shadowdark/combat';
import {
  findArmor,
  findHelmet,
  findWeapon,
  isRanged,
  isShield,
  isTwoHanded,
  itemsByCategory,
  weaponDamageDie,
} from '../../lib/shadowdark/gear';
import { getSpell } from '../../lib/shadowdark/spells';
import { STAT_IDS, STAT_NAMES } from '../../lib/shadowdark/types';
import type { Character, Equipment, StatId } from '../../lib/shadowdark/types';
import { useArtUrl, emitCharactersChanged } from '../../lib/hooks';
import { saveCharacter } from '../../lib/storage';
import { rollAndLog, useLatestRoll } from '../../lib/rollLog';

type SheetTab = 'stats' | 'gear' | 'spells' | 'about';

interface Props {
  character: Character;
  onEdit: () => void;
  onClose: () => void;
  onDelete: () => void;
}

export function CharacterSheet({ character, onEdit, onClose, onDelete }: Props) {
  const ancestry = getAncestry(character.ancestryId);
  const cls = getClass(character.classId);
  const portraitUrl = useArtUrl(character.portraitArtId);
  const [tab, setTab] = useState<SheetTab>('stats');
  const latestRoll = useLatestRoll();

  const equipment: Equipment = character.equipment ?? {};
  const mainHand = findWeapon(equipment.mainHand);
  const armor = findArmor(equipment.armor);
  const helmet = findHelmet(equipment.helmet);

  const { attackMod, damageDie, damageMod, ac: computedAC } = characterCombatProfile(character);

  async function patch(p: Partial<Character>) {
    const next: Character = { ...character, ...p, ac: computedAC, updatedAt: Date.now() };
    await saveCharacter(next);
    emitCharactersChanged();
  }

  function adjustHP(delta: number) {
    const current = Math.max(0, Math.min(character.hp.max, character.hp.current + delta));
    patch({ hp: { ...character.hp, current } });
  }

  function setEquipSlot(slot: keyof Equipment, name: string | undefined) {
    const next: Equipment = { ...equipment, [slot]: name || undefined };
    patch({ equipment: next });
  }

  function rollAttack() {
    const mod = attackMod;
    const expr = `1d20${mod >= 0 ? '+' : ''}${mod}`;
    const label = `${character.name}: Attack${mainHand ? ` (${mainHand.name})` : ''}`;
    const attack = rollAndLog(expr, 'normal', label);
    // Always roll damage too so kid sees the number to subtract.
    const dmgExpr = `1${damageDie}${damageMod >= 0 ? '+' : ''}${damageMod}`;
    rollAndLog(dmgExpr, 'normal', `${character.name}: Damage`);
    return attack;
  }

  function rollStat(stat: StatId) {
    const mod = statMod(character.stats[stat]);
    const expr = `1d20${mod >= 0 ? '+' : ''}${mod}`;
    rollAndLog(expr, 'normal', `${character.name}: ${STAT_NAMES[stat]} check`);
  }

  // One-handed melee weapons that can sit in an off-hand.
  const weapons = itemsByCategory('weapon');
  const offHandWeapons = weapons.filter((w) => !isTwoHanded(w) && !isRanged(w));
  const bodyArmor = itemsByCategory('armor');

  return (
    <div className="col" style={{ gap: '1rem' }}>
      <div className="row">
        <button className="ghost" onClick={onClose}>← Back</button>
        <span className="grow" />
        <button className="ghost" onClick={onEdit}>Edit</button>
        <button className="ghost danger" onClick={onDelete}>Delete</button>
      </div>

      <div className="sheet-hero">
        {portraitUrl ? (
          <img src={portraitUrl} alt={character.name} className="hero-portrait" />
        ) : (
          <div className="hero-portrait placeholder-portrait">
            <span>{character.name.slice(0, 1).toUpperCase()}</span>
          </div>
        )}
        <div className="hero-meta">
          <div className="hero-name">{character.name}</div>
          <div className="hero-sub">
            Level {character.level} · {ancestry?.name ?? ''} {cls?.name ?? ''}
          </div>
          <div className="hero-sub muted">{character.alignment} · {character.background}</div>
        </div>
      </div>

      <RollBanner roll={latestRoll} />

      <div className="hud-grid">
        <div className="hud-tile hud-hp">
          <div className="hud-label">HP</div>
          <div className="hud-value">
            {character.hp.current}<span className="hud-sub">/{character.hp.max}</span>
          </div>
          <div className="hud-controls">
            <button className="hp-button" onClick={() => adjustHP(-1)} aria-label="lose hp">−</button>
            <button className="hp-button" onClick={() => adjustHP(+1)} aria-label="heal hp">＋</button>
          </div>
        </div>

        <div className="hud-tile hud-ac">
          <div className="hud-label">AC</div>
          <div className="hud-value">{computedAC}</div>
          <div className="hud-controls muted hud-foot">
            {armor?.name ?? 'No armor'}{isShield(equipment.offHand) ? ' · shield' : ''}{helmet ? ' · helm' : ''}
          </div>
        </div>

        <button className="hud-tile hud-attack" onClick={rollAttack}>
          <div className="hud-label">Attack</div>
          <div className="hud-value">{formatMod(attackMod)}</div>
          <div className="hud-controls muted hud-foot">
            {mainHand ? `${mainHand.name} · ${damageDie}${damageMod !== 0 ? formatMod(damageMod) : ''}` : 'Unarmed · d4'}
          </div>
          <div className="hud-tap">Tap to roll</div>
        </button>
      </div>

      <div className="card equip-card">
        <div className="equip-row">
          <EquipSlot
            label="Main hand"
            value={equipment.mainHand}
            options={weapons.map((w) => ({ value: w.name, label: `${w.name} (${weaponDamageDie(w, isTwoHanded(w))})` }))}
            onChange={(v) => setEquipSlot('mainHand', v)}
          />
          <EquipSlot
            label="Off hand"
            value={equipment.offHand}
            options={[
              { value: 'Shield', label: 'Shield (+2 AC)' },
              ...offHandWeapons.map((w) => ({ value: w.name, label: w.name })),
            ]}
            onChange={(v) => setEquipSlot('offHand', v)}
            disabled={isTwoHanded(mainHand)}
            disabledHint="Two-handed weapon equipped"
          />
          <EquipSlot
            label="Armor"
            value={equipment.armor}
            options={bodyArmor.map((a) => ({ value: a.name, label: a.name }))}
            onChange={(v) => setEquipSlot('armor', v)}
          />
          <EquipSlot
            label="Helmet"
            value={equipment.helmet}
            options={[{ value: 'Helmet', label: 'Helmet (+1 AC)' }]}
            onChange={(v) => setEquipSlot('helmet', v)}
          />
        </div>
      </div>

      <div className="sheet-tabs">
        <button className={`sheet-tab ${tab === 'stats' ? 'active' : ''}`} onClick={() => setTab('stats')}>Stats</button>
        <button className={`sheet-tab ${tab === 'gear' ? 'active' : ''}`} onClick={() => setTab('gear')}>Gear</button>
        <button
          className={`sheet-tab ${tab === 'spells' ? 'active' : ''}`}
          onClick={() => setTab('spells')}
          disabled={character.spells.length === 0}
        >
          Spells
        </button>
        <button className={`sheet-tab ${tab === 'about' ? 'active' : ''}`} onClick={() => setTab('about')}>About</button>
      </div>

      {tab === 'stats' && (
        <div className="stat-tile-grid">
          {STAT_IDS.map((id) => {
            const mod = statMod(character.stats[id]);
            return (
              <button key={id} className="stat-tile" onClick={() => rollStat(id)}>
                <div className="stat-tile-name">{id}</div>
                <div className="stat-tile-score">{character.stats[id]}</div>
                <div className="stat-tile-mod">{formatMod(mod)}</div>
                <div className="stat-tile-tap">tap to roll</div>
              </button>
            );
          })}
        </div>
      )}

      {tab === 'gear' && (
        <div className="card">
          <div className="row" style={{ marginBottom: '0.75rem' }}>
            <span className="big-label grow">Carrying</span>
            <span className="muted">{character.gold}gp</span>
          </div>
          {character.gear.length === 0 ? (
            <div className="placeholder">No items.</div>
          ) : (
            <ul className="gear-list">
              {character.gear.map((item, i) => (
                <li key={`${item.name}-${i}`}>
                  <span className="item-name">{item.name}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'spells' && character.spells.length > 0 && (
        <div className="card col">
          {character.spells.map((name) => {
            const s = getSpell(name);
            if (!s) return <div key={name}><strong>{name}</strong></div>;
            return (
              <div key={name} className="spell-row">
                <div className="spell-name">{s.name}</div>
                <div className="spell-meta muted">{s.range} · {s.duration}</div>
                <div className="spell-text">{s.text}</div>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'about' && (
        <div className="col" style={{ gap: '0.75rem' }}>
          {ancestry && (
            <div className="card">
              <div className="big-label">{ancestry.name}</div>
              <p className="muted" style={{ margin: '0.25rem 0' }}>{ancestry.description}</p>
              <p style={{ margin: '0.25rem 0' }}><strong>Trait.</strong> {ancestry.trait}</p>
              <p className="faint" style={{ margin: '0.25rem 0', fontSize: '0.85rem' }}>
                Languages: {ancestry.languages.join(', ')}
              </p>
            </div>
          )}
          {cls && (
            <div className="card">
              <div className="big-label">{cls.name}</div>
              <p className="muted" style={{ margin: '0.25rem 0' }}>{cls.description}</p>
              <p className="faint" style={{ margin: '0.25rem 0', fontSize: '0.85rem' }}>
                Hit Die: d{cls.hitDie} · Weapons: {cls.weapons} · Armor: {cls.armor}
              </p>
              {cls.features.map((f) => (
                <p key={f.name} style={{ margin: '0.25rem 0' }}>
                  <strong>{f.name}.</strong> {f.text}
                </p>
              ))}
            </div>
          )}
          {character.deity && (
            <div className="card">
              <div className="big-label">Deity</div>
              <p style={{ margin: '0.25rem 0' }}>{character.deity}</p>
            </div>
          )}
          {character.notes && (
            <div className="card">
              <div className="big-label">Notes</div>
              <p style={{ whiteSpace: 'pre-wrap', margin: '0.25rem 0' }}>{character.notes}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface EquipSlotProps {
  label: string;
  value?: string;
  options: { value: string; label: string }[];
  onChange: (value: string | undefined) => void;
  disabled?: boolean;
  disabledHint?: string;
}

function EquipSlot({ label, value, options, onChange, disabled, disabledHint }: EquipSlotProps) {
  return (
    <label className={`equip-slot ${disabled ? 'disabled' : ''}`}>
      <div className="equip-slot-label">{label}</div>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || undefined)}
        disabled={disabled}
      >
        <option value="">{disabled ? (disabledHint ?? '—') : '— none —'}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

function RollBanner({ roll }: { roll: ReturnType<typeof useLatestRoll> }) {
  if (!roll) return null;
  const cls = roll.isCrit ? 'crit' : roll.isFumble ? 'fumble' : '';
  return (
    <div key={roll.id} className={`roll-banner ${cls}`}>
      <div className="roll-banner-label">{roll.label ?? roll.expression}</div>
      <div className="roll-banner-total">{roll.total}</div>
      <div className="roll-banner-detail">{roll.breakdown}</div>
    </div>
  );
}
