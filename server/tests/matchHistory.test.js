// Run: node server/tests/matchHistory.test.js

const Database = require('better-sqlite3');
const { computeKeyItemTimings } = require('../matchHistory');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  PASS  ${message}`);
    passed++;
  } else {
    console.error(`  FAIL  ${message}`);
    failed++;
  }
}

// ── In-memory DB with same schema as db.js ─────────────────────────────────

const db = new Database(':memory:');

db.exec(`
  CREATE TABLE matches (
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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE match_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id TEXT,
    game_time INTEGER,
    type TEXT,
    severity TEXT,
    message TEXT,
    snapshot_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE key_item_timings (
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

// Replicate the three write functions using the in-memory DB

function saveMatch(row) {
  return db.prepare(`
    INSERT OR IGNORE INTO matches
      (match_id, hero, role, archetype, playstyle, result,
       start_time, end_time, duration,
       kills, deaths, assists, gpm, xpm, last_hits, denies, final_gold,
       suggested_key_item, user_override_key_item,
       overall_grade, one_thing_to_improve,
       pre_key_item_deaths, spike_unused_count, low_farm_windows)
    VALUES
      (@match_id, @hero, @role, @archetype, @playstyle, @result,
       @start_time, @end_time, @duration,
       @kills, @deaths, @assists, @gpm, @xpm, @last_hits, @denies, @final_gold,
       @suggested_key_item, @user_override_key_item,
       @overall_grade, @one_thing_to_improve,
       @pre_key_item_deaths, @spike_unused_count, @low_farm_windows)
  `).run(row);
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

function getMatchById(matchId) {
  const match = db.prepare('SELECT * FROM matches WHERE match_id = ?').get(matchId);
  if (!match) return null;
  const events = db.prepare('SELECT * FROM match_events WHERE match_id = ? ORDER BY game_time ASC').all(matchId)
    .map((e) => ({ ...e, snapshot: e.snapshot_json ? JSON.parse(e.snapshot_json) : null }));
  const keyItemTimings = db.prepare('SELECT * FROM key_item_timings WHERE match_id = ? ORDER BY id ASC').all(matchId);
  return { match, events, keyItemTimings };
}

// ── Fixtures ───────────────────────────────────────────────────────────────

const centaurProfile = {
  heroName: 'Centaur Warrunner',
  dotaHeroName: 'npc_dota_hero_centaur',
  archetype: 'teamfight_initiator',
  keyItems: ['item_vanguard', 'item_blink', 'item_pipe', 'item_crimson_guard'],
  powerSpikeItems: ['item_blink'],
};

const MATCH_ID = 'test_match_001';

const mockEvents = [
  { game_time: 300,  type: 'hero_death',         severity: 'danger',  message: '第1次死亡', snapshot: { gold: 1200 } },
  { game_time: 600,  type: 'hero_death',         severity: 'danger',  message: '第2次死亡', snapshot: { gold: 900 } },
  { game_time: 900,  type: 'key_item_completed', severity: 'success', message: 'Vanguard 完成', snapshot: { item: 'item_vanguard' } },
  { game_time: 1200, type: 'hero_death',         severity: 'danger',  message: '第3次死亡 (after Vanguard)', snapshot: null },
  { game_time: 1500, type: 'key_item_completed', severity: 'success', message: 'Blink 完成', snapshot: { item: 'item_blink' } },
  // No power_spike_unused event → blink spike was used
  { game_time: 2100, type: 'low_farm_window',    severity: 'warning', message: '低收益窗口', snapshot: null },
  { game_time: 2700, type: 'game_end',           severity: 'info',    message: '比赛结束', snapshot: null },
];

const mockMatchRow = {
  match_id:              MATCH_ID,
  hero:                  'npc_dota_hero_centaur',
  role:                  'offlane',
  archetype:             'teamfight_initiator',
  playstyle:             'team_fight',
  result:                '胜利',
  start_time:            1700000000,
  end_time:              1700002700,
  duration:              2700,
  kills:                 4,
  deaths:                3,
  assists:               10,
  gpm:                   480,
  xpm:                   520,
  last_hits:             110,
  denies:                8,
  final_gold:            2200,
  suggested_key_item:    'item_vanguard',
  user_override_key_item: null,
  overall_grade:         '良好',
  one_thing_to_improve:  '关键装备前避免死亡',
  pre_key_item_deaths:   2,
  spike_unused_count:    0,
  low_farm_windows:      1,
};

// ── Tests: computeKeyItemTimings ───────────────────────────────────────────

console.log('\n── computeKeyItemTimings tests ──────────────────────────────────────');

console.log('\nVanguard (completed at 900s, 2 deaths before):');
const timings = computeKeyItemTimings(MATCH_ID, centaurProfile, mockEvents);

const vanguardTiming = timings.find((t) => t.item_name === 'item_vanguard');
assert(vanguardTiming !== undefined, 'Vanguard timing entry exists');
assert(vanguardTiming.completed === 1, 'Vanguard marked as completed');
assert(vanguardTiming.completed_time === 900, 'Vanguard completion time is 900');
assert(vanguardTiming.deaths_before_completion === 2, '2 deaths before Vanguard completion');
assert(vanguardTiming.power_spike_used === 0, 'Vanguard is not a spike item → power_spike_used=0');

console.log('\nBlink (power spike item, completed at 1500s, no unused event):');
const blinkTiming = timings.find((t) => t.item_name === 'item_blink');
assert(blinkTiming !== undefined, 'Blink timing entry exists');
assert(blinkTiming.completed === 1, 'Blink marked as completed');
assert(blinkTiming.completed_time === 1500, 'Blink completion time is 1500');
assert(blinkTiming.deaths_before_completion === 3, '3 deaths before Blink (2 pre-Vanguard + 1 at 1200)');
assert(blinkTiming.power_spike_used === 1, 'Blink spike used (no power_spike_unused event in window)');

console.log('\nPipe and Crimson Guard (not completed):');
const pipeTiming = timings.find((t) => t.item_name === 'item_pipe');
assert(pipeTiming !== undefined, 'Pipe timing entry exists');
assert(pipeTiming.completed === 0, 'Pipe not completed');
assert(pipeTiming.completed_time === null, 'Pipe completion_time is null');
assert(pipeTiming.deaths_before_completion === 3, 'deaths_before_completion = total deaths when not completed');

console.log('\nSpike unused scenario:');
const eventsWithUnused = [
  ...mockEvents,
  { game_time: 1550, type: 'power_spike_unused', severity: 'warning', message: '强势期未转化', snapshot: null },
];
const timingsWithUnused = computeKeyItemTimings(MATCH_ID, centaurProfile, eventsWithUnused);
const blinkUnused = timingsWithUnused.find((t) => t.item_name === 'item_blink');
assert(blinkUnused.power_spike_used === 0, 'power_spike_unused within 300s → spike not used');

console.log('\nNo hero profile:');
const noProfileTimings = computeKeyItemTimings(MATCH_ID, null, mockEvents);
assert(Array.isArray(noProfileTimings) && noProfileTimings.length === 0, 'null profile returns empty array');

const noKeyItemsTimings = computeKeyItemTimings(MATCH_ID, { heroName: 'test' }, mockEvents);
assert(Array.isArray(noKeyItemsTimings) && noKeyItemsTimings.length === 0, 'profile without keyItems returns empty array');

// ── Tests: DB write and read ───────────────────────────────────────────────

console.log('\n── DB write and read tests ───────────────────────────────────────────');

console.log('\nsaveMatch:');
saveMatch(mockMatchRow);
const detail = getMatchById(MATCH_ID);
assert(detail !== null, 'match is retrievable after saveMatch');
assert(detail.match.match_id === MATCH_ID, 'match_id stored correctly');
assert(detail.match.result === '胜利', 'result stored correctly');
assert(detail.match.kills === 4, 'kills stored correctly');
assert(detail.match.overall_grade === '良好', 'overall_grade stored correctly');
assert(detail.match.pre_key_item_deaths === 2, 'pre_key_item_deaths stored correctly');
assert(detail.match.spike_unused_count === 0, 'spike_unused_count stored correctly');
assert(detail.match.low_farm_windows === 1, 'low_farm_windows stored correctly');

console.log('\nsaveMatch idempotency (INSERT OR IGNORE):');
saveMatch(mockMatchRow);
const count = db.prepare('SELECT COUNT(*) as n FROM matches WHERE match_id = ?').get(MATCH_ID).n;
assert(count === 1, 'duplicate saveMatch does not create second row');

console.log('\nsaveMatchEvents:');
saveMatchEvents(MATCH_ID, mockEvents);
assert(detail.events !== undefined, 'events field present in getMatchById result');
const eventsAfterSave = db.prepare('SELECT * FROM match_events WHERE match_id = ?').all(MATCH_ID);
assert(eventsAfterSave.length === mockEvents.length, `${mockEvents.length} events stored`);

const deathEvents = eventsAfterSave.filter((e) => e.type === 'hero_death');
assert(deathEvents.length === 3, '3 hero_death events saved');

const eventWithSnapshot = eventsAfterSave.find((e) => e.type === 'hero_death' && e.game_time === 300);
assert(eventWithSnapshot !== null, 'event at game_time 300 exists');
const parsedSnapshot = JSON.parse(eventWithSnapshot.snapshot_json);
assert(parsedSnapshot?.gold === 1200, 'snapshot JSON round-trips correctly');

const nullSnapshotEvent = eventsAfterSave.find((e) => e.type === 'game_end');
assert(JSON.parse(nullSnapshotEvent.snapshot_json) === null, 'null snapshot stored as JSON null');

console.log('\nsaveKeyItemTimings:');
const timingsToSave = computeKeyItemTimings(MATCH_ID, centaurProfile, mockEvents);
saveKeyItemTimings(MATCH_ID, timingsToSave);

const savedTimings = db.prepare('SELECT * FROM key_item_timings WHERE match_id = ? ORDER BY id ASC').all(MATCH_ID);
assert(savedTimings.length === centaurProfile.keyItems.length, `${centaurProfile.keyItems.length} timing rows saved`);

const savedVanguard = savedTimings.find((t) => t.item_name === 'item_vanguard');
assert(savedVanguard.completed === 1, 'Vanguard completed=1 in DB');
assert(savedVanguard.completed_time === 900, 'Vanguard completed_time=900 in DB');
assert(savedVanguard.deaths_before_completion === 2, 'Vanguard deaths_before_completion=2 in DB');

const savedBlink = savedTimings.find((t) => t.item_name === 'item_blink');
assert(savedBlink.power_spike_used === 1, 'Blink power_spike_used=1 in DB');

const savedPipe = savedTimings.find((t) => t.item_name === 'item_pipe');
assert(savedPipe.completed === 0, 'Pipe completed=0 in DB');
assert(savedPipe.completed_time === null, 'Pipe completed_time=null in DB');

console.log('\ngetMatchById full structure:');
const fullDetail = getMatchById(MATCH_ID);
assert(fullDetail.match !== undefined, 'match object present');
assert(Array.isArray(fullDetail.events), 'events is array');
assert(Array.isArray(fullDetail.keyItemTimings), 'keyItemTimings is array');
assert(fullDetail.events[0].snapshot !== undefined, 'snapshot deserialized from JSON');
assert(fullDetail.events.find((e) => e.type === 'game_end').snapshot === null, 'null snapshot deserialized as null');

// ── Summary ───────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(55)}`);
console.log(`Results: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
