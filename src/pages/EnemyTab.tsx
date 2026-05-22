export function EnemyTab() {
  return (
    <div className="col" style={{ gap: '1.25rem' }}>
      <h1>Monsters</h1>
      <div className="card placeholder-tile">
        <div className="placeholder-icon">👹</div>
        <div className="placeholder-title">A bestiary will live here.</div>
        <div className="placeholder-sub">
          Coming soon: quick monster cards with HP and AC you can tap to track in battle,
          plus a roll-up for random encounters.
        </div>
      </div>
    </div>
  );
}
