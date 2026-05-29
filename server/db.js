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
`);

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

function getRecentStates(limit = 60) {
  return db.prepare('SELECT * FROM game_states ORDER BY id DESC LIMIT ?').all(limit);
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

module.exports = { saveGameState, saveAlert, getRecentStates, getRecentAlerts, getLatestState, getMatchAlerts, getStatesByMatch };
