const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'coach.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS game_states (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id TEXT,
    clock_time INTEGER,
    hero TEXT,
    level INTEGER,
    gold INTEGER,
    net_worth INTEGER,
    kills INTEGER,
    deaths INTEGER,
    assists INTEGER,
    last_hits INTEGER,
    denies INTEGER,
    gpm REAL,
    xpm REAL,
    map_name TEXT,
    game_state TEXT,
    raw_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id TEXT,
    clock_time INTEGER,
    rule_id TEXT,
    message TEXT,
    severity TEXT DEFAULT 'info',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id TEXT UNIQUE,
    hero TEXT,
    role TEXT DEFAULT 'offlane',
    archetype TEXT,
    playstyle TEXT,
    result TEXT,
    start_time INTEGER,
    end_time INTEGER,
    duration INTEGER,
    kills INTEGER DEFAULT 0,
    deaths INTEGER DEFAULT 0,
    assists INTEGER DEFAULT 0,
    gpm REAL DEFAULT 0,
    xpm REAL DEFAULT 0,
    last_hits INTEGER DEFAULT 0,
    denies INTEGER DEFAULT 0,
    final_gold INTEGER DEFAULT 0,
    suggested_key_item TEXT,
    user_override_key_item TEXT,
    overall_grade TEXT,
    one_thing_to_improve TEXT,
    pre_key_item_deaths INTEGER DEFAULT 0,
    spike_unused_count INTEGER DEFAULT 0,
    low_farm_windows INTEGER DEFAULT 0,
    is_excluded INTEGER DEFAULT 0,
    excluded_at TEXT,
    excluded_reason TEXT,
    import_source TEXT,
    source TEXT DEFAULT 'gsi',
    imported_at TEXT,
    import_match_id TEXT,
    player_slot INTEGER,
    account_id INTEGER,
    radiant_win INTEGER,
    team TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS match_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id TEXT,
    game_time INTEGER,
    type TEXT,
    severity TEXT,
    message TEXT,
    snapshot_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS key_item_timings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id TEXT,
    item_name TEXT,
    completed INTEGER DEFAULT 0,
    completed_time INTEGER,
    deaths_before_completion INTEGER DEFAULT 0,
    power_spike_used INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Raw OpenDota cache table (new table — IF NOT EXISTS handles fresh + existing DBs)
db.exec(`
  CREATE TABLE IF NOT EXISTS raw_opendota_matches (
    match_id     TEXT PRIMARY KEY,
    raw_json     TEXT NOT NULL,
    parsed_status TEXT,
    fetched_at   TEXT DEFAULT (datetime('now')),
    warnings_json TEXT
  );
`);

// Migrate existing DBs that pre-date added columns
const _migrations = [
  "ALTER TABLE matches ADD COLUMN is_excluded INTEGER DEFAULT 0",
  "ALTER TABLE matches ADD COLUMN excluded_at TEXT",
  "ALTER TABLE matches ADD COLUMN excluded_reason TEXT",
  "ALTER TABLE matches ADD COLUMN import_source TEXT",
  "ALTER TABLE matches ADD COLUMN source TEXT DEFAULT 'gsi'",
  "ALTER TABLE matches ADD COLUMN imported_at TEXT",
  "ALTER TABLE matches ADD COLUMN import_match_id TEXT",
  "ALTER TABLE matches ADD COLUMN player_slot INTEGER",
  "ALTER TABLE matches ADD COLUMN account_id INTEGER",
  "ALTER TABLE matches ADD COLUMN radiant_win INTEGER",
  "ALTER TABLE matches ADD COLUMN team TEXT",
];
for (const sql of _migrations) {
  try { db.exec(sql); } catch (_) { /* column already exists */ }
}

function saveGameState(data) {
  const player = data.player || {};
  const hero = data.hero || {};
  const map = data.map || {};

  const stmt = db.prepare(`
    INSERT INTO game_states
      (match_id, clock_time, hero, level, gold, net_worth, kills, deaths, assists,
       last_hits, denies, gpm, xpm, map_name, game_state, raw_json)
    VALUES
      (@match_id, @clock_time, @hero, @level, @gold, @net_worth, @kills, @deaths, @assists,
       @last_hits, @denies, @gpm, @xpm, @map_name, @game_state, @raw_json)
  `);

  return stmt.run({
    match_id: String(map.matchid || '0'),
    clock_time: map.clock_time || 0,
    hero: hero.name || 'unknown',
    level: hero.level || 0,
    gold: player.gold || 0,
    net_worth: player.net_worth || 0,
    kills: player.kills || 0,
    deaths: player.deaths || 0,
    assists: player.assists || 0,
    last_hits: player.last_hits || 0,
    denies: player.denies || 0,
    gpm: player.gpm || 0,
    xpm: player.xpm || 0,
    map_name: map.name || 'unknown',
    game_state: map.game_state || 'unknown',
    raw_json: JSON.stringify(data),
  });
}

function saveAlert(alert) {
  const stmt = db.prepare(`
    INSERT INTO alerts (match_id, clock_time, rule_id, message, severity)
    VALUES (@match_id, @clock_time, @rule_id, @message, @severity)
  `);
  return stmt.run(alert);
}

function getRecentAlerts(limit = 20) {
  return db.prepare('SELECT * FROM alerts ORDER BY id DESC LIMIT ?').all(limit);
}

function getLatestState() {
  return db.prepare('SELECT * FROM game_states ORDER BY id DESC LIMIT 1').get();
}

function getMatchAlerts(matchId) {
  return db.prepare('SELECT * FROM alerts WHERE match_id = ? ORDER BY clock_time ASC').all(matchId);
}

function getStatesByMatch(matchId, fromClock, toClock) {
  return db.prepare(
    'SELECT clock_time, raw_json FROM game_states WHERE match_id = ? AND clock_time BETWEEN ? AND ? ORDER BY clock_time'
  ).all(matchId, fromClock ?? 0, toClock ?? 99999);
}

// ── Match history ──────────────────────────────────────────────────────────

function matchExists(matchId) {
  return !!db.prepare('SELECT 1 FROM matches WHERE match_id = ?').get(matchId);
}

function saveMatch(row) {
  return db.prepare(`
    INSERT OR IGNORE INTO matches
      (match_id, hero, role, archetype, playstyle, result,
       start_time, end_time, duration,
       kills, deaths, assists, gpm, xpm, last_hits, denies, final_gold,
       suggested_key_item, user_override_key_item,
       overall_grade, one_thing_to_improve,
       pre_key_item_deaths, spike_unused_count, low_farm_windows,
       import_source,
       source, imported_at, import_match_id,
       player_slot, account_id, radiant_win, team)
    VALUES
      (@match_id, @hero, @role, @archetype, @playstyle, @result,
       @start_time, @end_time, @duration,
       @kills, @deaths, @assists, @gpm, @xpm, @last_hits, @denies, @final_gold,
       @suggested_key_item, @user_override_key_item,
       @overall_grade, @one_thing_to_improve,
       @pre_key_item_deaths, @spike_unused_count, @low_farm_windows,
       @import_source,
       @source, @imported_at, @import_match_id,
       @player_slot, @account_id, @radiant_win, @team)
  `).run({
    import_source:    null,
    source:           'gsi',
    imported_at:      null,
    import_match_id:  null,
    player_slot:      null,
    account_id:       null,
    radiant_win:      null,
    team:             null,
    ...row,
  });
}

function saveMatchEvents(matchId, events) {
  const stmt = db.prepare(
    'INSERT INTO match_events (match_id, game_time, type, severity, message, snapshot_json) VALUES (?, ?, ?, ?, ?, ?)'
  );
  db.transaction((evts) => {
    for (const e of evts) {
      stmt.run(matchId, e.game_time, e.type, e.severity, e.message, JSON.stringify(e.snapshot ?? null));
    }
  })(events);
}

function saveKeyItemTimings(matchId, timings) {
  const stmt = db.prepare(
    'INSERT INTO key_item_timings (match_id, item_name, completed, completed_time, deaths_before_completion, power_spike_used) VALUES (?, ?, ?, ?, ?, ?)'
  );
  db.transaction((rows) => {
    for (const t of rows) {
      stmt.run(matchId, t.item_name, t.completed, t.completed_time ?? null, t.deaths_before_completion, t.power_spike_used);
    }
  })(timings);
}

function excludeMatch(matchId, reason = null) {
  return db.prepare(
    "UPDATE matches SET is_excluded = 1, excluded_at = datetime('now'), excluded_reason = ? WHERE match_id = ?"
  ).run(reason, matchId);
}

function includeMatch(matchId) {
  return db.prepare(
    'UPDATE matches SET is_excluded = 0, excluded_at = NULL, excluded_reason = NULL WHERE match_id = ?'
  ).run(matchId);
}

// Hard delete — opendota_import matches only. GSI matches are irreplaceable and
// must go through excludeMatch() instead. raw_opendota_matches cache is left
// intact so the match can be re-imported (e.g. once OpenDota finishes parsing it).
function deleteImportedMatch(matchId) {
  const row = db.prepare('SELECT source FROM matches WHERE match_id = ?').get(matchId);
  if (!row) return { deleted: false, reason: 'not_found' };
  if (row.source !== 'opendota_import') return { deleted: false, reason: 'gsi_match' };

  db.transaction(() => {
    db.prepare('DELETE FROM match_events WHERE match_id = ?').run(matchId);
    db.prepare('DELETE FROM key_item_timings WHERE match_id = ?').run(matchId);
    db.prepare("DELETE FROM matches WHERE match_id = ? AND source = 'opendota_import'").run(matchId);
  })();

  return { deleted: true };
}

function getMatches(limit = 50, includeExcluded = false) {
  const where = includeExcluded ? '' : 'WHERE is_excluded = 0';
  return db.prepare(`SELECT * FROM matches ${where} ORDER BY id DESC LIMIT ?`).all(limit);
}

function getMatchById(matchId) {
  const match = db.prepare('SELECT * FROM matches WHERE match_id = ?').get(matchId);
  if (!match) return null;
  const events = db.prepare('SELECT * FROM match_events WHERE match_id = ? ORDER BY game_time ASC').all(matchId)
    .map((e) => ({ ...e, snapshot: e.snapshot_json ? JSON.parse(e.snapshot_json) : null }));
  const keyItemTimings = db.prepare('SELECT * FROM key_item_timings WHERE match_id = ? ORDER BY id ASC').all(matchId);
  return { match, events, keyItemTimings };
}

function getLongTermStats(recentCount = 10) {
  const total = db.prepare('SELECT COUNT(*) as n FROM matches WHERE is_excluded = 0').get()?.n || 0;
  if (total === 0) return { total_matches: 0, recent: null, hero_usage: [], top_improvement: null };

  const recent = db.prepare(`
    SELECT
      ROUND(AVG(deaths), 2)              as avg_deaths,
      ROUND(AVG(gpm), 0)                 as avg_gpm,
      ROUND(AVG(xpm), 0)                 as avg_xpm,
      ROUND(AVG(pre_key_item_deaths), 2) as avg_pre_key_item_deaths,
      ROUND(AVG(spike_unused_count), 2)  as avg_spike_unused,
      ROUND(AVG(low_farm_windows), 2)    as avg_low_farm_windows
    FROM (SELECT * FROM matches WHERE is_excluded = 0 ORDER BY id DESC LIMIT ?)
  `).get(recentCount);

  const heroUsage = db.prepare(
    'SELECT hero, COUNT(*) as count FROM matches WHERE hero IS NOT NULL AND is_excluded = 0 GROUP BY hero ORDER BY count DESC'
  ).all();

  const topImprovement = db.prepare(
    'SELECT one_thing_to_improve, COUNT(*) as count FROM matches WHERE one_thing_to_improve IS NOT NULL AND is_excluded = 0 GROUP BY one_thing_to_improve ORDER BY count DESC LIMIT 1'
  ).get();

  return {
    total_matches: total,
    recent_count: recentCount,
    recent,
    hero_usage: heroUsage,
    top_improvement: topImprovement?.one_thing_to_improve || null,
  };
}

// ── Raw OpenDota cache ─────────────────────────────────────────────────────

function saveRawOpendotaMatch(matchId, rawJson, parsedStatus, warningsJson) {
  return db.prepare(`
    INSERT OR REPLACE INTO raw_opendota_matches
      (match_id, raw_json, parsed_status, fetched_at, warnings_json)
    VALUES (?, ?, ?, datetime('now'), ?)
  `).run(matchId, rawJson, parsedStatus, warningsJson);
}

function getRawOpendotaMatch(matchId) {
  return db.prepare('SELECT * FROM raw_opendota_matches WHERE match_id = ?').get(matchId) || null;
}

function rawOpendotaMatchExists(matchId) {
  return !!db.prepare('SELECT 1 FROM raw_opendota_matches WHERE match_id = ?').get(matchId);
}

module.exports = {
  saveGameState, saveAlert, getRecentAlerts, getLatestState, getMatchAlerts, getStatesByMatch,
  matchExists, saveMatch, saveMatchEvents, saveKeyItemTimings,
  getMatches, getMatchById, getLongTermStats,
  excludeMatch, includeMatch, deleteImportedMatch,
  saveRawOpendotaMatch, getRawOpendotaMatch, rawOpendotaMatchExists,
};
