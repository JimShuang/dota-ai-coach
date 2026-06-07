// Run: node server/tests/openDotaRaw.test.js
//
// All tests use mock network injection (_setFetchFn) — no real HTTP calls.
// Tests write to coach.db using isolated match IDs (raw_test_*).

const service = require('../openDotaRawService');
const { detectParsedStatus, buildWarnings } = service;
const { getRawOpendotaMatch } = require('../db');

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

// ── Mock data ──────────────────────────────────────────────────────────────

// Unique per run so prior cached rows never interfere
const RUN = Date.now().toString().slice(-7);
const MATCH_OK_ID         = `raw_t${RUN}_ok`;
const MATCH_UNPARSED_ID   = `raw_t${RUN}_up`;
const MATCH_NO_PLAYERS_ID = `raw_t${RUN}_np`;
const MATCH_NO_RADIANT_ID = `raw_t${RUN}_nr`;
const MATCH_FORCE_ID      = `raw_t${RUN}_fo`;

const MOCK_OK = {
  match_id: 10001,
  radiant_win: true,
  duration: 2400,
  start_time: 1700000000,
  players: [
    {
      player_slot: 2, hero_id: 96,
      kills: 5, deaths: 2, assists: 8,
      gold_per_min: 450, xp_per_min: 520,
      last_hits: 120, denies: 5, net_worth: 18000,
      purchase_log: [
        { time: 540, key: 'vanguard' },
        { time: 900, key: 'blink' },
      ],
    },
  ],
};

const MOCK_UNPARSED = {
  match_id: 10002,
  radiant_win: false,
  duration: 1800,
  start_time: 1700001000,
  players: [
    {
      player_slot: 1, hero_id: 29,
      kills: 2, deaths: 4, assists: 6,
      gold_per_min: 320, xp_per_min: 380,
      purchase_log: null,
    },
  ],
};

const MOCK_NO_PLAYERS = {
  match_id: 10003,
  radiant_win: null,
  duration: 0,
  players: [],
};

const MOCK_NO_RADIANT = {
  match_id: 10004,
  radiant_win: null,
  duration: 1500,
  players: [
    {
      player_slot: 0, hero_id: 15,
      kills: 3, deaths: 3, assists: 3,
      gold_per_min: 400, xp_per_min: 450,
      purchase_log: [{ time: 600, key: 'blade_mail' }],
    },
  ],
};

// Install mock — routes URL suffix to the right fixture
service._setFetchFn(async (url) => {
  if (url.endsWith(`/${MATCH_OK_ID}`))         return MOCK_OK;
  if (url.endsWith(`/${MATCH_UNPARSED_ID}`))   return MOCK_UNPARSED;
  if (url.endsWith(`/${MATCH_NO_PLAYERS_ID}`)) return MOCK_NO_PLAYERS;
  if (url.endsWith(`/${MATCH_NO_RADIANT_ID}`)) return MOCK_NO_RADIANT;
  if (url.endsWith(`/${MATCH_FORCE_ID}`))      return MOCK_OK;
  if (url.includes('raw_test_404')) {
    const e = new Error('OpenDota: 比赛不存在（404）');
    e.code = 'NOT_FOUND';
    throw e;
  }
  if (url.includes('raw_test_429')) {
    const e = new Error('OpenDota: 请求过于频繁，请稍后重试（429）');
    e.code = 'RATE_LIMITED';
    throw e;
  }
  throw new Error(`Unexpected URL in test: ${url}`);
});

// ── Group 1: Pure helpers ──────────────────────────────────────────────────

console.log('\n── detectParsedStatus ───────────────────────────────────────────────');

assert(detectParsedStatus(MOCK_OK)         === 'ok',         'players + purchase_log → ok');
assert(detectParsedStatus(MOCK_UNPARSED)   === 'unparsed',   'players but null purchase_log → unparsed');
assert(detectParsedStatus(MOCK_NO_PLAYERS) === 'no_players', 'empty players array → no_players');
assert(detectParsedStatus({ players: null }) === 'no_players', 'null players → no_players');
assert(
  detectParsedStatus({ players: [{ player_slot: 0, purchase_log: [] }] }) === 'unparsed',
  'players with empty purchase_log array → unparsed'
);

console.log('\n── buildWarnings ────────────────────────────────────────────────────');

const warnOk      = buildWarnings(MOCK_OK);
const warnNullRW  = buildWarnings(MOCK_NO_RADIANT);
const warnNoDur   = buildWarnings({ radiant_win: true, duration: 0,  players: [{ gold_per_min: 400 }] });
const warnNoGpm   = buildWarnings({ radiant_win: true, duration: 600, players: [{ gold_per_min: null }] });

assert(Array.isArray(warnOk),                    'buildWarnings returns array');
assert(warnOk.length === 0,                      'no warnings for clean data');
assert(warnNullRW.some(w => w.includes('radiant_win')), 'null radiant_win triggers warning');
assert(warnNoDur.some(w => w.includes('duration')),     'missing duration triggers warning');
assert(warnNoGpm.some(w => w.includes('gold_per_min')), 'missing gpm triggers warning');

// ── Group 2: fetchAndCache (uses mock network) ─────────────────────────────

console.log('\n── fetchAndCache: cache miss ─────────────────────────────────────────');

let result;
try {
  result = await (async () => service.fetchAndCache(MATCH_OK_ID))();
} catch (e) {
  // await shim for non-top-level async — use a run helper
}

// Use an async IIFE so we can await
(async () => {

  // ── cache miss ────────────────────────────────────────────────────────────

  const r1 = await service.fetchAndCache(MATCH_OK_ID);
  assert(r1.match_id      === MATCH_OK_ID,  'fetchAndCache returns correct match_id');
  assert(r1.cached        === false,        'first fetch: cached = false');
  assert(r1.parsed_status === 'ok',         'parsed_status = ok for good data');
  assert(Array.isArray(r1.warnings),        'warnings is an array');
  assert(r1.warnings.length === 0,          'no warnings for clean match');
  assert(typeof r1.fetched_at === 'string', 'fetched_at is a string');

  // DB should contain the row
  const dbRow = getRawOpendotaMatch(MATCH_OK_ID);
  assert(dbRow !== null,                    'row stored in DB after fetch');
  assert(dbRow.match_id === MATCH_OK_ID,    'DB row match_id correct');
  assert(dbRow.parsed_status === 'ok',      'DB row parsed_status correct');
  assert(typeof dbRow.raw_json === 'string','raw_json stored as string in DB');
  assert(dbRow.raw_json.includes('"radiant_win"'), 'raw_json contains radiant_win');

  // ── cache hit ─────────────────────────────────────────────────────────────

  console.log('\n── fetchAndCache: cache hit ─────────────────────────────────────────');

  const r2 = await service.fetchAndCache(MATCH_OK_ID);
  assert(r2.cached        === true,         'second fetch: cached = true');
  assert(r2.match_id      === MATCH_OK_ID,  'cache hit returns correct match_id');
  assert(r2.parsed_status === 'ok',         'cache hit parsed_status preserved');

  // ── force refresh ─────────────────────────────────────────────────────────

  console.log('\n── fetchAndCache: force refresh ─────────────────────────────────────');

  const r3 = await service.fetchAndCache(MATCH_FORCE_ID);
  assert(r3.cached === false, 'initial fetch: cached = false');

  const r4 = await service.fetchAndCache(MATCH_FORCE_ID, { force: true });
  assert(r4.cached === false, 'force: true bypasses cache → cached = false');

  // ── unparsed match ────────────────────────────────────────────────────────

  console.log('\n── fetchAndCache: unparsed match ────────────────────────────────────');

  const rU = await service.fetchAndCache(MATCH_UNPARSED_ID);
  assert(rU.parsed_status === 'unparsed', 'unparsed match → parsed_status = unparsed');
  assert(rU.cached        === false,      'unparsed match is still cached (first time)');

  const rU2 = await service.fetchAndCache(MATCH_UNPARSED_ID);
  assert(rU2.cached === true, 'unparsed match cached on second call');

  // ── no_players match ──────────────────────────────────────────────────────

  console.log('\n── fetchAndCache: no_players match ──────────────────────────────────');

  const rNP = await service.fetchAndCache(MATCH_NO_PLAYERS_ID);
  assert(rNP.parsed_status === 'no_players', 'empty players → parsed_status = no_players');

  // ── warnings stored ───────────────────────────────────────────────────────

  console.log('\n── fetchAndCache: warnings ──────────────────────────────────────────');

  const rW = await service.fetchAndCache(MATCH_NO_RADIANT_ID);
  assert(rW.parsed_status === 'ok',              'match with null radiant_win is still ok');
  assert(rW.warnings.some(w => w.includes('radiant_win')), 'radiant_win warning in return value');

  const dbRowW = getRawOpendotaMatch(MATCH_NO_RADIANT_ID);
  const storedWarnings = JSON.parse(dbRowW.warnings_json);
  assert(Array.isArray(storedWarnings),           'warnings_json stored as JSON array in DB');
  assert(storedWarnings.some(w => w.includes('radiant_win')), 'warning persisted to DB');

  // ── error handling: 404 ───────────────────────────────────────────────────

  console.log('\n── error handling ───────────────────────────────────────────────────');

  let err404 = null;
  try { await service.fetchAndCache('raw_test_404'); }
  catch (e) { err404 = e; }
  assert(err404 !== null,           '404: error thrown');
  assert(err404.code === 'NOT_FOUND', '404: error.code = NOT_FOUND');
  assert(getRawOpendotaMatch('raw_test_404') === null, '404: nothing cached');

  let err429 = null;
  try { await service.fetchAndCache('raw_test_429'); }
  catch (e) { err429 = e; }
  assert(err429 !== null,              '429: error thrown');
  assert(err429.code === 'RATE_LIMITED', '429: error.code = RATE_LIMITED');
  assert(getRawOpendotaMatch('raw_test_429') === null, '429: nothing cached');

  // ── getCached ─────────────────────────────────────────────────────────────

  console.log('\n── getCached ────────────────────────────────────────────────────────');

  const { getCached } = service;

  const notFound = getCached('raw_test_does_not_exist');
  assert(notFound === null, 'getCached returns null for unknown matchId');

  const found = getCached(MATCH_OK_ID);
  assert(found !== null,                   'getCached returns object for cached match');
  assert(found.match_id === MATCH_OK_ID,   'getCached match_id correct');
  assert(typeof found.raw_json === 'object', 'getCached raw_json is parsed object (not string)');
  assert(found.raw_json.radiant_win === true, 'getCached raw_json.radiant_win preserved');
  assert(found.parsed_status === 'ok',     'getCached parsed_status correct');
  assert(Array.isArray(found.warnings),    'getCached warnings is array');

  // ── Summary ────────────────────────────────────────────────────────────────

  service._resetFetchFn();

  console.log(`\n${'─'.repeat(55)}`);
  console.log(`Results: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);

})().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
