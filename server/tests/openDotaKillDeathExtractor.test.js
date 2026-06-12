// Run: node server/tests/openDotaKillDeathExtractor.test.js

'use strict';

const { extractKillDeath, heroDisplayNameFromInternal } = require('../openDotaKillDeathExtractor');

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

// ── heroDisplayNameFromInternal ────────────────────────────────────────────

console.log('\n── heroDisplayNameFromInternal ──────────────────────────────────────');

// Profile heroes → 中文（English）
assert(heroDisplayNameFromInternal('npc_dota_hero_centaur')      === '半人马战行者（Centaur Warrunner）', 'centaur → Chinese+English');
assert(heroDisplayNameFromInternal('npc_dota_hero_tidehunter')   === '潮汐猎手（Tidehunter）',           'tidehunter → Chinese+English');
assert(heroDisplayNameFromInternal('npc_dota_hero_razor')        === '电魂（Razor）',                    'razor → Chinese+English');
assert(heroDisplayNameFromInternal('npc_dota_hero_viper')        === '冥毒蛇（Viper）',                  'viper → Chinese+English');
assert(heroDisplayNameFromInternal('npc_dota_hero_necrolyte')    === '死灵法师（Necrophos）',            'necrolyte → Chinese+English');
assert(heroDisplayNameFromInternal('npc_dota_hero_abaddon')      === '亚巴顿（Abaddon）',                'abaddon → Chinese+English');
assert(heroDisplayNameFromInternal('npc_dota_hero_vengefulspirit') === '复仇之魂（Vengeful Spirit）',   'vengefulspirit → Chinese+English');

// Non-profile heroes → English
assert(heroDisplayNameFromInternal('npc_dota_hero_axe')          === 'Axe',            'axe → English');
assert(heroDisplayNameFromInternal('npc_dota_hero_pudge')        === 'Pudge',          'pudge → English');
assert(heroDisplayNameFromInternal('npc_dota_hero_invoker')      === 'Invoker',        'invoker → English');
assert(heroDisplayNameFromInternal('npc_dota_hero_earthshaker')  === 'Earthshaker',    'earthshaker → English');

// Unknown internal name → strip + title-case
assert(heroDisplayNameFromInternal('npc_dota_hero_new_hero_xyz') === 'New Hero Xyz',   'unknown → stripped title-case');
assert(heroDisplayNameFromInternal('npc_dota_hero_test')         === 'Test',           'single word unknown');

// Edge cases
assert(heroDisplayNameFromInternal(null)    === '未知英雄',  'null → 未知英雄');
assert(heroDisplayNameFromInternal('')      === '未知英雄',  'empty string → 未知英雄');
assert(heroDisplayNameFromInternal(42)      === '未知英雄',  'non-string → 未知英雄');

// ── Fixtures ───────────────────────────────────────────────────────────────

// Centaur (slot 2, hero_id 96) kills Axe and Razor; dies to Axe once, tower once
const PLAYERS_NORMAL = [
  {
    player_slot: 2,
    hero_id: 96,    // Centaur
    kills: 2,
    deaths: 2,
    kills_log: [
      { time: 300, key: 'npc_dota_hero_axe'    },  // kills Axe
      { time: 650, key: 'npc_dota_hero_razor'  },  // kills Razor
    ],
  },
  {
    player_slot: 130,
    hero_id: 2,     // Axe
    kills: 1,
    deaths: 2,
    kills_log: [
      { time: 420, key: 'npc_dota_hero_centaur' }, // kills Centaur
    ],
  },
  {
    player_slot: 1,
    hero_id: 7,     // Earthshaker
    kills: 0,
    deaths: 0,
    kills_log: [],
  },
  // Fourth player with no kills_log (unparsed slot)
  {
    player_slot: 3,
    hero_id: 14,    // Pudge
    kills: 1,
    deaths: 1,
    kills_log: null,
  },
];

// ── Normal extraction ──────────────────────────────────────────────────────

console.log('\n── Normal case: Centaur, slot 2 ────────────────────────────────────');

const r1 = extractKillDeath(PLAYERS_NORMAL, 2);

// Kills
assert(r1.kills.length === 2,              '2 kills');
assert(r1.kills[0].time === 300,           'first kill at t=300');
assert(r1.kills[0].victim === 'Axe',       'first kill victim = Axe (English)');
assert(r1.kills[1].time === 650,           'second kill at t=650');
assert(r1.kills[1].victim === '电魂（Razor）', 'second kill victim = Razor (Chinese, profile hero)');

// Deaths
assert(r1.deaths.length === 1,             '1 reconstructed death (tower kill absent)');
assert(r1.deaths[0].time === 420,          'death at t=420');
assert(r1.deaths[0].killer === 'Axe',      'killer = Axe');

// deathStats
assert(r1.deathStats.reconstructed === 1,  'reconstructed = 1');
assert(r1.deathStats.total === 2,          'total = player.deaths = 2');
assert(r1.deathStats.missing === 1,        'missing = 1 (tower death)');

// ── Kills/deaths are sorted ascending by time ─────────────────────────────

console.log('\n── Sort order ───────────────────────────────────────────────────────');

const PLAYERS_UNSORTED = [
  {
    player_slot: 0,
    hero_id: 96,   // Centaur
    kills: 3,
    deaths: 2,
    kills_log: [
      { time: 800, key: 'npc_dota_hero_axe'      },
      { time: 200, key: 'npc_dota_hero_pudge'    },
      { time: 500, key: 'npc_dota_hero_invoker'  },
    ],
  },
  {
    player_slot: 5,
    hero_id: 2,   // Axe
    kills: 1,
    deaths: 1,
    kills_log: [{ time: 700, key: 'npc_dota_hero_centaur' }],
  },
  {
    player_slot: 6,
    hero_id: 14,  // Pudge
    kills: 1,
    deaths: 1,
    kills_log: [{ time: 300, key: 'npc_dota_hero_centaur' }],
  },
];

const rSort = extractKillDeath(PLAYERS_UNSORTED, 0);
assert(rSort.kills[0].time === 200,       'kills sorted: first t=200');
assert(rSort.kills[1].time === 500,       'kills sorted: second t=500');
assert(rSort.kills[2].time === 800,       'kills sorted: third t=800');
assert(rSort.deaths[0].time === 300,      'deaths sorted: first t=300');
assert(rSort.deaths[1].time === 700,      'deaths sorted: second t=700');

// ── Negative times preserved ──────────────────────────────────────────────

console.log('\n── Negative time (pre-game) ─────────────────────────────────────────');

const PLAYERS_NEG = [
  {
    player_slot: 0,
    hero_id: 96,
    kills: 1,
    deaths: 0,
    kills_log: [{ time: -30, key: 'npc_dota_hero_axe' }],
  },
  { player_slot: 5, hero_id: 2, kills: 0, deaths: 0, kills_log: [] },
];

const rNeg = extractKillDeath(PLAYERS_NEG, 0);
assert(rNeg.kills.length === 1,         '1 kill with negative time');
assert(rNeg.kills[0].time === -30,      'negative time preserved');

// ── kills_log null / missing ───────────────────────────────────────────────

console.log('\n── kills_log null / missing ─────────────────────────────────────────');

const PLAYERS_NO_LOG = [
  {
    player_slot: 0,
    hero_id: 96,
    kills: 5,
    deaths: 3,
    kills_log: null,      // unparsed
  },
  {
    player_slot: 5,
    hero_id: 2,
    kills: 3,
    deaths: 5,
    kills_log: null,
  },
];

const rNull = extractKillDeath(PLAYERS_NO_LOG, 0);
assert(rNull.kills.length === 0,              'kills empty when kills_log=null');
assert(rNull.deaths.length === 0,             'deaths empty when all kills_logs=null');
assert(rNull.deathStats.total === 3,          'total = player.deaths = 3');
assert(rNull.deathStats.reconstructed === 0,  'reconstructed = 0');
assert(rNull.deathStats.missing === 3,        'all 3 deaths are missing');

// ── 0 kills 0 deaths ──────────────────────────────────────────────────────

console.log('\n── 0 kills, 0 deaths ────────────────────────────────────────────────');

const PLAYERS_ZERO = [
  { player_slot: 0, hero_id: 96, kills: 0, deaths: 0, kills_log: [] },
  { player_slot: 1, hero_id: 2,  kills: 0, deaths: 0, kills_log: [] },
];

const rZero = extractKillDeath(PLAYERS_ZERO, 0);
assert(rZero.kills.length === 0,              '0 kills');
assert(rZero.deaths.length === 0,             '0 deaths');
assert(rZero.deathStats.total === 0,          'total = 0');
assert(rZero.deathStats.missing === 0,        'missing = 0');

// ── Selected player not found ──────────────────────────────────────────────

console.log('\n── Selected player not found ────────────────────────────────────────');

const rMissing = extractKillDeath(PLAYERS_NORMAL, 999);
assert(rMissing.kills.length === 0,           'empty kills when slot not found');
assert(rMissing.deaths.length === 0,          'empty deaths when slot not found');
assert(rMissing.deathStats.missing === 0,     'missing = 0 when slot not found');

// ── Empty / invalid players array ─────────────────────────────────────────

console.log('\n── Edge cases: empty/invalid players ────────────────────────────────');

const rEmpty = extractKillDeath([], 0);
assert(rEmpty.kills.length === 0,   'empty players → empty kills');

const rNull2 = extractKillDeath(null, 0);
assert(rNull2.kills.length === 0,   'null players → empty kills');

// ── hero_id not in HERO_INTERNAL_NAMES (unknown hero) ─────────────────────

console.log('\n── Unknown hero_id (no internal name mapping) ───────────────────────');

const PLAYERS_UNKNOWN_HERO = [
  {
    player_slot: 0,
    hero_id: 9999,   // Not in HERO_INTERNAL_NAMES
    kills: 1,
    deaths: 2,
    kills_log: [{ time: 100, key: 'npc_dota_hero_axe' }],
  },
  {
    player_slot: 1,
    hero_id: 2,   // Axe
    kills: 2,
    deaths: 1,
    kills_log: [
      // Cannot find selected player without internal name, so neither is a death
      { time: 200, key: 'npc_dota_hero_axe' },  // Axe kills Axe (self-kill? ignore for test)
    ],
  },
];

const rUnknown = extractKillDeath(PLAYERS_UNKNOWN_HERO, 0);
assert(rUnknown.kills.length === 1,           'kills still extracted (from kills_log)');
assert(rUnknown.kills[0].victim === 'Axe',    'victim display name works');
assert(rUnknown.deaths.length === 0,          'deaths = 0 (no internal name to match against)');
assert(rUnknown.deathStats.missing === 2,     'all 2 deaths are missing (no internal name)');

// ── Multiple killers of the same hero ────────────────────────────────────

console.log('\n── Multiple different killers ───────────────────────────────────────');

const PLAYERS_MULTI = [
  {
    player_slot: 0,
    hero_id: 96,   // Centaur
    kills: 0,
    deaths: 3,
    kills_log: [],
  },
  { player_slot: 5,  hero_id: 2,  kills: 1, deaths: 0, kills_log: [{ time: 100, key: 'npc_dota_hero_centaur' }] },
  { player_slot: 6,  hero_id: 14, kills: 1, deaths: 0, kills_log: [{ time: 200, key: 'npc_dota_hero_centaur' }] },
  { player_slot: 7,  hero_id: 7,  kills: 1, deaths: 0, kills_log: [{ time: 300, key: 'npc_dota_hero_centaur' }] },
];

const rMulti = extractKillDeath(PLAYERS_MULTI, 0);
assert(rMulti.deaths.length === 3,                  '3 reconstructed deaths');
assert(rMulti.deaths[0].killer === 'Axe',           'first killer = Axe');
assert(rMulti.deaths[1].killer === 'Pudge',         'second killer = Pudge');
assert(rMulti.deaths[2].killer === 'Earthshaker',   'third killer = Earthshaker');
assert(rMulti.deathStats.reconstructed === 3,       'all 3 reconstructed');
assert(rMulti.deathStats.missing === 0,             'no missing deaths');

// ── Profile hero as killer (Chinese display name) ─────────────────────────

console.log('\n── Profile hero as killer ───────────────────────────────────────────');

const PLAYERS_PROFILE_KILLER = [
  {
    player_slot: 0,
    hero_id: 2,    // Axe (non-profile)
    kills: 0,
    deaths: 1,
    kills_log: [],
  },
  {
    player_slot: 5,
    hero_id: 96,   // Centaur (profile hero)
    kills: 1,
    deaths: 0,
    kills_log: [{ time: 500, key: 'npc_dota_hero_axe' }],
  },
];

const rProfileKiller = extractKillDeath(PLAYERS_PROFILE_KILLER, 0);
assert(rProfileKiller.deaths.length === 1,
  'death reconstructed from profile hero killer');
assert(rProfileKiller.deaths[0].killer === '半人马战行者（Centaur Warrunner）',
  'profile hero killer name in Chinese+English format');

// ── Summary ────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(55)}`);
console.log(`Results: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
