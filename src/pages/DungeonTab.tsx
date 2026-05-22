export function DungeonTab() {
  return (
    <div className="col" style={{ gap: '1.25rem' }}>
      <h1>Dungeons</h1>
      <div className="card placeholder-tile">
        <div className="placeholder-icon">🗺️</div>
        <div className="placeholder-title">A dungeon maker will live here.</div>
        <div className="placeholder-sub">
          Coming soon: tap to roll up a room, find treasure, or surprise the party
          with a random encounter.
        </div>
      </div>
    </div>
  );
}
