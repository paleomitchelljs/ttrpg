// Rules reference: browse the stored rulesets (the live Shadowdark engine + the
// EverQuest d20 reference) and the content-tag taxonomy. Read-only.

import { useState } from 'react';
import { RULESETS, getRuleset, nativeRuleset, type RuleEntry } from '../lib/rules';
import { THREAT_TAGS, ROLE_TAGS, CREATURE_TYPE_TAGS, THEME_TAGS, type TagEntry } from '../lib/shadowdark/tags';

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v : undefined;
}

function entryDesc(e: RuleEntry): string | undefined {
  return str(e.summary) ?? str(e.description) ?? str(e.text);
}

export function RulesTab() {
  const [rulesetId, setRulesetId] = useState(nativeRuleset().id);
  const ruleset = getRuleset(rulesetId) ?? RULESETS[0];

  const meta: [string, string | undefined][] = [
    ['Dice', ruleset.dice_system],
    ['Ability scores', ruleset.ability_scores?.join(', ')],
    ['Saves', ruleset.saving_throws?.join(', ')],
    ['Setting', ruleset.setting],
  ];

  return (
    <div className="col" style={{ gap: '1.25rem' }}>
      <h1 style={{ margin: 0 }}>Rules</h1>

      <div className="filter-pill-row">
        {RULESETS.map((r) => (
          <button
            key={r.id}
            className={`filter-pill ${r.id === rulesetId ? 'active' : ''}`}
            onClick={() => setRulesetId(r.id)}
          >
            {r.name}
            {r.native ? ' · engine' : ''}
          </button>
        ))}
      </div>

      <div className="card col" style={{ gap: '0.4rem' }}>
        <div className="big-label">{ruleset.name}</div>
        <div className="muted" style={{ fontSize: '0.85rem' }}>
          {[ruleset.publisher, ruleset.edition, ruleset.year, ruleset.license].filter(Boolean).join(' · ')}
        </div>
        {!ruleset.native && (
          <div className="mini-tag" style={{ alignSelf: 'flex-start' }}>reference only — play resolves in Shadowdark</div>
        )}
        {meta
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k} style={{ fontSize: '0.9rem' }}>
              <strong>{k}:</strong> {v}
            </div>
          ))}
        {ruleset.summary && (
          <p className="muted" style={{ whiteSpace: 'pre-wrap', margin: '0.3rem 0 0' }}>{ruleset.summary.trim()}</p>
        )}
      </div>

      {ruleset.books && ruleset.books.length > 0 && (
        <details className="card">
          <summary className="big-label">Books ({ruleset.books.length})</summary>
          <div style={{ marginTop: '0.5rem' }}>
            {ruleset.books.map((b) => (
              <div key={b.id} className="rule-entry">
                <div>
                  <strong>{b.name}</strong>
                  {(b.year || b.pages) && (
                    <span className="muted">
                      {' '}— {[b.year, b.pages ? `${b.pages}pp` : null].filter(Boolean).join(', ')}
                    </span>
                  )}
                </div>
                {b.summary && <div className="muted" style={{ fontSize: '0.85rem' }}>{b.summary}</div>}
              </div>
            ))}
          </div>
        </details>
      )}

      {ruleset.sections?.map((sec) => (
        <details key={sec.id} className="card">
          <summary className="big-label">
            {sec.name}
            {sec.entries ? ` (${sec.entries.length})` : ''}
          </summary>
          {sec.description && (
            <p className="muted" style={{ fontSize: '0.85rem', margin: '0.5rem 0' }}>{sec.description}</p>
          )}
          {sec.entries?.map((e, i) => {
            const desc = entryDesc(e);
            const title = str(e.title);
            return (
              <div key={e.id ?? i} className="rule-entry">
                <div>
                  <strong>{e.name}</strong>
                  {title && <span className="muted"> — {title}</span>}
                </div>
                {desc && <div className="muted" style={{ fontSize: '0.85rem' }}>{desc}</div>}
              </div>
            );
          })}
        </details>
      ))}

      <details className="card">
        <summary className="big-label">Content tags (taxonomy)</summary>
        <p className="muted" style={{ fontSize: '0.85rem', margin: '0.5rem 0' }}>
          The controlled vocabulary used to tag monsters and content. Threat and role are the
          axes a future cross-system converter would read.
        </p>
        <TagGroup title="Threat — how dangerous" tags={THREAT_TAGS} />
        <TagGroup title="Role — how it fights" tags={ROLE_TAGS} />
        <TagGroup title="Creature type" tags={CREATURE_TYPE_TAGS} inline />
        <TagGroup title="Theme" tags={THEME_TAGS} inline />
      </details>
    </div>
  );
}

function TagGroup({ title, tags, inline }: { title: string; tags: TagEntry[]; inline?: boolean }) {
  return (
    <div style={{ marginTop: '0.6rem' }}>
      <div className="big-label" style={{ fontSize: '0.85rem' }}>{title}</div>
      {inline ? (
        <div className="row" style={{ flexWrap: 'wrap', gap: '0.25rem', marginTop: '0.3rem' }}>
          {tags.map((t) => (
            <span key={t.id} className="mini-tag">{t.name ?? t.id}</span>
          ))}
        </div>
      ) : (
        tags.map((t) => (
          <div key={t.id} className="rule-entry">
            <div>
              <strong>{t.name ?? t.id}</strong>
              {t.profile && <span className="muted" style={{ fontSize: '0.8rem' }}> — {t.profile}</span>}
            </div>
            {t.description && <div className="muted" style={{ fontSize: '0.85rem' }}>{t.description}</div>}
          </div>
        ))
      )}
    </div>
  );
}
