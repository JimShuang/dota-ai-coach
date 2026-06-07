// Run: node server/tests/importPreview.test.js
//
// Tests buildPreview (pure function) and getHeroName.
// No network, no DB.

const { buildPreview } = require('../importPreviewService');
const { getHeroName, HERO_NAMES } = require('../data/dotaHeroNames');

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

// ── Mock raw match data ────────────────────────────────────────────────────

const PLAYER_CENTAUR = {
  player_slot: 2,   // radiant
  hero_id: 96,
  account_id: 100001,
  kills: 5, deaths: 2, assists: 8,
  gold_per_min: 450, xp_per_min: 520,
  last_hits: 120, denies: 5,
  purchase_log: [{ time: 540, key: 'vanguard' }, { time: 900, key: 'blink' }],
};

const PLAYER_AXE = {
  player_slot: 130,  // dire
  hero_id: 2,
  account_id: 200001,
  kills: 8, deaths: 5, assists: 4,
  gold_per_min: 520, xp_per_min: 600,
  last_hits: 200, denies: 12,
  purchase_log: [{ time: 480, key: 'vanguard' }],
};

const PLAYER_UNKNOWN_HERO = {
  player_slot: 4,   // radiant
  hero_id: 999,
  account_id: null,
  kills: 0, deaths: 0, assists: 0,
  gold_per_min: 0, xp_per_min: 0,
  last_hits: 0, denies: 0,
  purchase_log: null,
};

const MATCH_OK = {
  match_id: 77777001,
  radiant_win: true,
  duration: 2400,
  start_time: 1700000000,
  players: [PLAYER_CENTAUR, PLAYER_AXE, PLAYER_UNKNOWN_HERO],
};

const MATCH_UNPARSED = {
  match_id: 77777002,
  radiant_win: false,
  duration: 1800,
  players: [
    { player_slot: 0, hero_id: 14, kills: 10, deaths: 3, assists: 5,
      gold_per_min: 480, xp_per_min: 550, last_hits: 180, denies: 8, purchase_log: null },
    { player_slot: 128, hero_id: 96, kills: 2, deaths: 6, assists: 3,
      gold_per_min: 300, xp_per_min: 350, last_hits: 70, denies: 1, purchase_log: [] },
  ],
};

const MATCH_NULL_RADIANT = {
  match_id: 77777003,
  radiant_win: null,
  duration: 3000,
  players: [
    { player_slot: 1, hero_id: 47, kills: 3, deaths: 4, assists: 7,
      gold_per_min: 380, xp_per_min: 420, last_hits: 100, denies: 3,
      purchase_log: [{ time: 600, key: 'hood_of_defiance' }] },
  ],
};

// ── getHeroName ────────────────────────────────────────────────────────────

console.log('\n── getHeroName ──────────────────────────────────────────────────────');

assert(getHeroName(96)   === '半人马战行者（Centaur Warrunner）', 'Centaur has Chinese name');
assert(getHeroName(29)   === '潮汐猎手（Tidehunter）',           'Tidehunter has Chinese name');
assert(getHeroName(15)   === '电魂（Razor）',                    'Razor has Chinese name');
assert(getHeroName(47)   === '冥毒蛇（Viper）',                  'Viper has Chinese name');
assert(getHeroName(36)   === '死灵法师（Necrophos）',             'Necrophos has Chinese name');
assert(getHeroName(102)  === '亚巴顿（Abaddon）',                'Abaddon has Chinese name');
assert(getHeroName(20)   === '复仇之魂（Vengeful Spirit）',       'VS has Chinese name');
assert(getHeroName(2)    === 'Axe',                               'Axe returns English name');
assert(getHeroName(14)   === 'Pudge',                             'Pudge returns English name');
assert(getHeroName(74)   === 'Invoker',                           'Invoker returns English name');
assert(getHeroName(999)  === 'Hero #999',                         'unknown hero ID → fallback');
assert(getHeroName(null) === '未知英雄',                           'null → 未知英雄');
assert(getHeroName(undefined) === '未知英雄',                      'undefined → 未知英雄');

// HERO_NAMES has all 7 profile heroes
assert(96  in HERO_NAMES, 'HERO_NAMES contains Centaur (96)');
assert(102 in HERO_NAMES, 'HERO_NAMES contains Abaddon (102)');

// ── buildPreview: structure ────────────────────────────────────────────────

console.log('\n── buildPreview: structure ──────────────────────────────────────────');

const p1 = buildPreview(MATCH_OK);

assert(p1.matchId      === '77777001',  'matchId is stringified');
assert(p1.duration     === 2400,        'duration preserved');
assert(p1.radiantWin   === true,        'radiantWin preserved');
assert(p1.isParsed     === true,        'isParsed = true when purchase_log present');
assert(Array.isArray(p1.warnings),      'warnings is an array');
assert(p1.warnings.length === 0,        'no warnings from empty input');
assert(Array.isArray(p1.players),       'players is an array');
assert(p1.players.length === 3,         '3 players from mock data');

// ── buildPreview: player fields ────────────────────────────────────────────

console.log('\n── buildPreview: player fields ──────────────────────────────────────');

const centaurPlayer = p1.players.find((p) => p.heroId === 96);
assert(centaurPlayer !== undefined,                     'Centaur player found');
assert(centaurPlayer.team      === 'radiant',           'slot 2 → radiant');
assert(centaurPlayer.playerSlot === 2,                  'playerSlot preserved');
assert(centaurPlayer.accountId  === 100001,             'accountId preserved');
assert(centaurPlayer.heroName   === '半人马战行者（Centaur Warrunner）', 'heroName resolved via getHeroName');
assert(centaurPlayer.kills      === 5,                  'kills preserved');
assert(centaurPlayer.deaths     === 2,                  'deaths preserved');
assert(centaurPlayer.assists    === 8,                  'assists preserved');
assert(centaurPlayer.gpm        === 450,                'gpm preserved');
assert(centaurPlayer.xpm        === 520,                'xpm preserved');
assert(centaurPlayer.lastHits   === 120,                'lastHits preserved');
assert(centaurPlayer.denies     === 5,                  'denies preserved');

const axePlayer = p1.players.find((p) => p.heroId === 2);
assert(axePlayer.team === 'dire',          'slot 130 → dire');
assert(axePlayer.heroName === 'Axe',       'Axe resolved to English name');
assert(axePlayer.accountId === 200001,     'Axe accountId correct');

const unknownPlayer = p1.players.find((p) => p.heroId === 999);
assert(unknownPlayer.heroName === 'Hero #999', 'unknown hero uses fallback name');
assert(unknownPlayer.accountId === null,       'null accountId preserved');

// ── buildPreview: sort order ───────────────────────────────────────────────

console.log('\n── buildPreview: sort order ─────────────────────────────────────────');

// Slots 2, 4 (radiant) should come before 130 (dire)
assert(p1.players[0].playerSlot < p1.players[p1.players.length - 1].playerSlot,
  'players sorted by playerSlot ascending (radiant before dire)');

// ── buildPreview: unparsed match ───────────────────────────────────────────

console.log('\n── buildPreview: unparsed / edge cases ──────────────────────────────');

const p2 = buildPreview(MATCH_UNPARSED);
assert(p2.isParsed     === false,    'isParsed = false when no purchase_log');
assert(p2.radiantWin   === false,    'radiantWin = false');
assert(p2.players.length === 2,      '2 players in unparsed match');

// ── buildPreview: null radiantWin + warnings ──────────────────────────────

const p3 = buildPreview(MATCH_NULL_RADIANT, { warnings: ['radiant_win is null — win/loss cannot be determined'] });
assert(p3.radiantWin === null,       'null radiantWin preserved');
assert(p3.warnings.length === 1,     'warnings passed through');
assert(p3.warnings[0].includes('radiant_win'), 'warning content preserved');
assert(p3.isParsed === true,         'match with purchase_log is parsed even with null radiantWin');

// ── buildPreview: input validation ────────────────────────────────────────

console.log('\n── buildPreview: input validation ───────────────────────────────────');

let threw = false;
try { buildPreview(null); } catch { threw = true; }
assert(threw, 'buildPreview(null) throws');

threw = false;
try { buildPreview('string'); } catch { threw = true; }
assert(threw, 'buildPreview("string") throws');

// Empty players array is valid
const emptyMatch = buildPreview({ match_id: 0, radiant_win: null, duration: 0, players: [] });
assert(emptyMatch.players.length === 0, 'empty players array produces empty preview');
assert(emptyMatch.isParsed === false,   'empty players → isParsed = false');

// warnings defensive copy — mutating returned array doesn't affect preview
const p4 = buildPreview(MATCH_OK, { warnings: ['test warning'] });
p4.warnings.push('injected');
const p5 = buildPreview(MATCH_OK, { warnings: ['test warning'] });
assert(p5.warnings.length === 1, 'returned warnings array is a defensive copy');

// ── Summary ────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(55)}`);
console.log(`Results: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
