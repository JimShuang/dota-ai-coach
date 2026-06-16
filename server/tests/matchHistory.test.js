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
    is_excluded INTEGER DEFAULT 0,
    excluded_at TEXT,
    excluded_reason TEXT,
    source TEXT DEFAULT 'gsi',
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

function excludeMatch(matchId, reason) {
  return db.prepare(
    "UPDATE matches SET is_excluded = 1, excluded_at = datetime('now'), excluded_reason = ? WHERE match_id = ?"
  ).run(reason || null, matchId);
}

function includeMatch(matchId) {
  return db.prepare(
    'UPDATE matches SET is_excluded = 0, excluded_at = NULL, excluded_reason = NULL WHERE match_id = ?'
  ).run(matchId);
}

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

function getMatches(limit, includeExcluded) {
  const where = includeExcluded ? '' : 'WHERE is_excluded = 0';
  return db.prepare(`SELECT * FROM matches ${where} ORDER BY id DESC LIMIT ?`).all(limit || 50);
}

function getLongTermStats(recentCount) {
  recentCount = recentCount || 10;
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

// ── Tests: death snapshot persisted and round-trips correctly ─────────────

console.log('\n── death snapshot DB persistence ─────────────────────────────────────');

const MATCH_DEATH = 'test_match_death_snap';

const richDeathEvent = {
  game_time: 620,
  type: 'hero_death',
  severity: 'critical',
  message: '英雄阵亡（第 1 次） — 闪烁匕首（Blink Dagger） 差 450 金，可能严重拖慢节奏',
  snapshot: {
    goldBeforeDeathPenalty:           1800,
    currentGoldAfterDeathIfAvailable: 1350,
    itemsAtDeath:                     ['item_vanguard', 'item_tpscroll', 'item_magic_stick'],
    inventoryAtDeath:                 { slot0: 'item_vanguard', slot1: 'item_tpscroll', slot2: 'item_magic_stick' },
    stashAtDeath:                     {},
    neutralItemAtDeath:               null,
    tpAtDeath:                        { name: 'item_tpscroll', charges: 1 },
    keyItemAtDeath:                   'item_blink',
    goldToKeyItemAtDeath:             450,
    gpmAtDeath:                       380,
    xpmAtDeath:                       420,
    killsAtDeath:                     0,
    deathsAtDeath:                    0,
    assistsAtDeath:                   0,
    gameTimeAtDeath:                  620,
    wasNearKeyItem:                   true,
    wasInPowerSpikeWindow:            false,
    hadTpAtDeath:                     true,
    pre_key_item:                     true,
    gold_gap_to_key_item:             450,
    in_power_spike:                   false,
    has_tp:                           true,
  },
};

// Save to the in-memory DB
saveMatch({ ...mockMatchRow, match_id: MATCH_DEATH });
saveMatchEvents(MATCH_DEATH, [richDeathEvent]);

const deathDetail = getMatchById(MATCH_DEATH);

console.log('\nsnapshot_json contains new death fields:');
const savedDeathEvt = deathDetail.events.find((e) => e.type === 'hero_death');
assert(savedDeathEvt !== undefined, 'hero_death event found in DB');

const snap = savedDeathEvt.snapshot;
assert(snap !== null, 'snapshot deserialized from JSON');
assert(snap.goldBeforeDeathPenalty === 1800, 'goldBeforeDeathPenalty round-trips correctly');
assert(snap.currentGoldAfterDeathIfAvailable === 1350, 'currentGoldAfterDeathIfAvailable round-trips');
assert(Array.isArray(snap.itemsAtDeath), 'itemsAtDeath is array after round-trip');
assert(snap.itemsAtDeath.includes('item_vanguard'), 'itemsAtDeath contains item_vanguard');
assert(snap.itemsAtDeath.includes('item_tpscroll'), 'itemsAtDeath contains item_tpscroll');
assert(snap.keyItemAtDeath === 'item_blink', 'keyItemAtDeath round-trips');
assert(snap.goldToKeyItemAtDeath === 450, 'goldToKeyItemAtDeath round-trips');
assert(snap.wasNearKeyItem === true, 'wasNearKeyItem round-trips');
assert(snap.wasInPowerSpikeWindow === false, 'wasInPowerSpikeWindow round-trips');
assert(snap.hadTpAtDeath === true, 'hadTpAtDeath round-trips');
assert(typeof snap.inventoryAtDeath === 'object', 'inventoryAtDeath is object after round-trip');
assert(snap.inventoryAtDeath.slot0 === 'item_vanguard', 'inventoryAtDeath.slot0 round-trips');
assert(snap.tpAtDeath?.name === 'item_tpscroll', 'tpAtDeath.name round-trips');

// Backward-compat aliases also round-trip
assert(snap.has_tp === true, 'backward-compat has_tp round-trips');
assert(snap.pre_key_item === true, 'backward-compat pre_key_item round-trips');

// ── Tests: Exclude Match feature ───────────────────────────────────────────

console.log('\n── Exclude Match tests ───────────────────────────────────────────────');

// Seed two additional matches for isolation
const MATCH_EX1 = 'test_exclude_001';
const MATCH_EX2 = 'test_exclude_002';

saveMatch({ ...mockMatchRow, match_id: MATCH_EX1, hero: 'npc_dota_hero_dragon_knight', one_thing_to_improve: '避免过激进站位', gpm: 390 });
saveMatch({ ...mockMatchRow, match_id: MATCH_EX2, hero: 'npc_dota_hero_tidehunter',    one_thing_to_improve: '避免过激进站位', gpm: 410 });
saveMatchEvents(MATCH_EX1, mockEvents);
saveKeyItemTimings(MATCH_EX1, computeKeyItemTimings(MATCH_EX1, centaurProfile, mockEvents));

console.log('\nexcludeMatch sets is_excluded, excluded_at, excluded_reason:');
const exResult = excludeMatch(MATCH_EX1, 'bot_test');
assert(exResult.changes === 1, 'excludeMatch affects 1 row');
const exRow = db.prepare('SELECT * FROM matches WHERE match_id = ?').get(MATCH_EX1);
assert(exRow.is_excluded === 1, 'is_excluded set to 1');
assert(exRow.excluded_reason === 'bot_test', 'excluded_reason stored correctly');
assert(exRow.excluded_at !== null, 'excluded_at is not null');

console.log('\ngetMatches default (no excluded):');
const defaultList = getMatches(50, false);
const defaultIds = defaultList.map((m) => m.match_id);
assert(!defaultIds.includes(MATCH_EX1), 'excluded match hidden from default list');
assert(defaultIds.includes(MATCH_EX2), 'non-excluded match appears in default list');

console.log('\ngetMatches with includeExcluded=true:');
const fullList = getMatches(50, true);
const fullIds = fullList.map((m) => m.match_id);
assert(fullIds.includes(MATCH_EX1), 'excluded match visible with includeExcluded=true');
assert(fullIds.includes(MATCH_EX2), 'non-excluded match visible with includeExcluded=true');

console.log('\ngetLongTermStats excludes excluded matches:');
// Exclude MATCH_EX2 too so only original MATCH_ID and MATCH_DEATH count
excludeMatch(MATCH_EX2, 'development_test');
const stats = getLongTermStats(10);
// MATCH_ID (gpm=480) and MATCH_DEATH (gpm=480) are non-excluded; EX1 (gpm=390) and EX2 (gpm=410) are excluded
assert(stats.total_matches === 2, `total_matches counts only non-excluded (got ${stats.total_matches})`);
assert(stats.hero_usage.every((h) => h.hero !== 'npc_dota_hero_dragon_knight'), 'excluded hero absent from hero_usage');
assert(stats.hero_usage.every((h) => h.hero !== 'npc_dota_hero_tidehunter'), 'excluded hero absent from hero_usage');

console.log('\nincludeMatch resets exclusion fields:');
const incResult = includeMatch(MATCH_EX1);
assert(incResult.changes === 1, 'includeMatch affects 1 row');
const incRow = db.prepare('SELECT * FROM matches WHERE match_id = ?').get(MATCH_EX1);
assert(incRow.is_excluded === 0, 'is_excluded reset to 0');
assert(incRow.excluded_at === null, 'excluded_at cleared');
assert(incRow.excluded_reason === null, 'excluded_reason cleared');

console.log('\ndata preserved after exclude/include:');
const eventsAfterExclude = db.prepare('SELECT * FROM match_events WHERE match_id = ?').all(MATCH_EX1);
assert(eventsAfterExclude.length === mockEvents.length, 'match_events preserved after exclude');
const timingsAfterExclude = db.prepare('SELECT * FROM key_item_timings WHERE match_id = ?').all(MATCH_EX1);
assert(timingsAfterExclude.length > 0, 'key_item_timings preserved after exclude');

console.log('\nexclude non-existent match returns 0 changes:');
const noMatch = excludeMatch('nonexistent_match_xyz', 'other');
assert(noMatch.changes === 0, 'excludeMatch on missing match_id returns 0 changes');

// ── Tests: Hard Delete (deleteImportedMatch) ───────────────────────────────

console.log('\n── Hard Delete tests ─────────────────────────────────────────────────');

const MATCH_DEL_IMPORT = 'test_delete_import_001';
const MATCH_DEL_GSI    = 'test_delete_gsi_001';

saveMatch({ ...mockMatchRow, match_id: MATCH_DEL_IMPORT });
db.prepare("UPDATE matches SET source = 'opendota_import' WHERE match_id = ?").run(MATCH_DEL_IMPORT);
saveMatchEvents(MATCH_DEL_IMPORT, mockEvents);
saveKeyItemTimings(MATCH_DEL_IMPORT, computeKeyItemTimings(MATCH_DEL_IMPORT, centaurProfile, mockEvents));

saveMatch({ ...mockMatchRow, match_id: MATCH_DEL_GSI });

console.log('\ndelete an opendota_import match removes all three tables:');
const delResult = deleteImportedMatch(MATCH_DEL_IMPORT);
assert(delResult.deleted === true, 'deleteImportedMatch returns deleted: true');
assert(db.prepare('SELECT 1 FROM matches WHERE match_id = ?').get(MATCH_DEL_IMPORT) === undefined, 'matches row removed');
assert(db.prepare('SELECT 1 FROM match_events WHERE match_id = ?').get(MATCH_DEL_IMPORT) === undefined, 'match_events rows removed');
assert(db.prepare('SELECT 1 FROM key_item_timings WHERE match_id = ?').get(MATCH_DEL_IMPORT) === undefined, 'key_item_timings rows removed');

console.log('\nsame match_id can be re-inserted after delete:');
saveMatch({ ...mockMatchRow, match_id: MATCH_DEL_IMPORT });
const reinserted = db.prepare('SELECT 1 FROM matches WHERE match_id = ?').get(MATCH_DEL_IMPORT);
assert(reinserted !== undefined, 'match_id is reusable after hard delete');

console.log('\nattempting to delete a gsi match is rejected:');
const delGsiResult = deleteImportedMatch(MATCH_DEL_GSI);
assert(delGsiResult.deleted === false, 'gsi match deletion returns deleted: false');
assert(delGsiResult.reason === 'gsi_match', "reason is 'gsi_match'");
const gsiStillThere = db.prepare('SELECT 1 FROM matches WHERE match_id = ?').get(MATCH_DEL_GSI);
assert(gsiStillThere !== undefined, 'gsi match row is not deleted');

console.log('\ndeleting a non-existent match:');
const delMissing = deleteImportedMatch('nonexistent_match_for_delete');
assert(delMissing.deleted === false, 'missing match deletion returns deleted: false');
assert(delMissing.reason === 'not_found', "reason is 'not_found'");

// ── Summary ───────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(55)}`);
console.log(`Results: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
