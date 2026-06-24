// Run: node server/tests/openDotaSpikeWindowScanner.test.js

'use strict';

// ── Decoupling verification ─────────────────────────────────────────────────
// Read source BEFORE requiring the module so import-time side-effects surface.
const fs   = require('fs');
const path = require('path');
const src  = fs.readFileSync(
  path.resolve(__dirname, '../openDotaSpikeWindowScanner.js'),
  'utf8'
);

const {
  scanSpikeWindowDeltas,
  _SIGNIFICANT_GAP_SECONDS,
} = require('../openDotaSpikeWindowScanner');

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

// ── Decoupling checks ──────────────────────────────────────────────────────

console.log('\n── decoupling: no forbidden imports ────────────────────────────────');

function hasRequire(source, moduleName) {
  return new RegExp(`require\\(['"][^'"]*${moduleName}[^'"]*['"]\\)`).test(source);
}

assert(!hasRequire(src, 'openDotaDeathDigest'),        'no require openDotaDeathDigest');
assert(!hasRequire(src, 'openDotaEventBuilder'),       'no require openDotaEventBuilder');
assert(!hasRequire(src, 'openDotaKillDeath'),          'no require openDotaKillDeathExtractor');
assert(!hasRequire(src, 'openDotaEconomyTimeseries'),  'no require openDotaEconomyTimeseries');
assert(!hasRequire(src, 'openDotaMomentumScanner'),    'no require openDotaMomentumScanner');
assert(!hasRequire(src, 'eventLogger'),                'no require eventLogger');
assert(!hasRequire(src, 'matchHistory'),               'no require matchHistory');

// ── Test data helpers ──────────────────────────────────────────────────────

// Radiant slots: 0-4; Dire slots: 128-132.
function makePlayer(slot, heroId, purchaseLog) {
  return { player_slot: slot, hero_id: heroId, purchase_log: purchaseLog || [] };
}

function makePurchase(key, time) { return { key, time }; }

// A minimal 10-player fixture: one radiant player at slot 2 (us), five dire enemies.
const MY_SLOT = 2;   // radiant
const MY_HERO_ID = 96;  // Centaur

// ── Degenerate inputs → [] ─────────────────────────────────────────────────

console.log('\n── degenerate inputs → [] ───────────────────────────────────────────');

assert(Array.isArray(scanSpikeWindowDeltas(null, MY_SLOT)),      'null players → array');
assert(scanSpikeWindowDeltas(null, MY_SLOT).length === 0,        'null players → []');
assert(scanSpikeWindowDeltas(undefined, MY_SLOT).length === 0,   'undefined players → []');
assert(scanSpikeWindowDeltas([], MY_SLOT).length === 0,          'empty players → []');

// Selected slot not found in player list.
const onlyMe = [makePlayer(MY_SLOT, MY_HERO_ID, [makePurchase('blink', 600)])];
assert(scanSpikeWindowDeltas(onlyMe, 999).length === 0, 'unknown selected slot → []');

// ── purchase_log absent → [] ──────────────────────────────────────────────

console.log('\n── purchase_log absent or empty ─────────────────────────────────────');

// My player has no purchase_log; enemy has items.
const noPurchaseMe = [
  makePlayer(MY_SLOT, MY_HERO_ID, null),
  makePlayer(128, 14, [makePurchase('blink', 500)]),
  makePlayer(129, 14, []),
  makePlayer(130, 14, []),
  makePlayer(131, 14, []),
  makePlayer(132, 14, []),
];
assert(scanSpikeWindowDeltas(noPurchaseMe, MY_SLOT).length === 0,
  'my player has no purchase_log → []');

// My player has items; all enemies have empty purchase_log.
const noEnemyPurchase = [
  makePlayer(MY_SLOT, MY_HERO_ID, [makePurchase('blink', 600)]),
  makePlayer(128, 14, []),
  makePlayer(129, 14, []),
  makePlayer(130, 14, []),
  makePlayer(131, 14, []),
  makePlayer(132, 14, []),
];
assert(scanSpikeWindowDeltas(noEnemyPurchase, MY_SLOT).length === 0,
  'all enemies have empty purchase_log → []');

// ── spike_lead: I complete survivability before enemy ─────────────────────

console.log('\n── spike_lead: my survivability earlier than enemy ──────────────────');

const leadPlayers = [
  makePlayer(MY_SLOT, MY_HERO_ID, [
    makePurchase('black_king_bar', 1200),  // survivability
  ]),
  makePlayer(128, 14,  [makePurchase('black_king_bar', 1500)]),  // 300 s later
  makePlayer(129, 2,   []),
  makePlayer(130, 3,   []),
  makePlayer(131, 4,   []),
  makePlayer(132, 5,   []),
];

const leadResult = scanSpikeWindowDeltas(leadPlayers, MY_SLOT);
const leadSurv   = leadResult.find((a) => a.bucket === 'survivability');

assert(leadSurv !== undefined,             'spike_lead: survivability anchor present');
assert(leadSurv.type === 'spike_lead',     'spike_lead: type is spike_lead');
assert(leadSurv.delta === 1200 - 1500,     'spike_lead: delta = myTime - enemyTime = -300');
assert(leadSurv.delta < 0,                'spike_lead: delta is negative');
assert(leadSurv.myItem === 'black_king_bar',   'spike_lead: myItem correct');
assert(leadSurv.enemyItem === 'black_king_bar', 'spike_lead: enemyItem correct');
assert(leadSurv.myTime === 1200,           'spike_lead: myTime = 1200');
assert(leadSurv.enemyTime === 1500,        'spike_lead: enemyTime = 1500');

// ── spike_deficit: enemy damage spike earlier than mine ───────────────────

console.log('\n── spike_deficit: enemy damage spike earlier than mine ──────────────');

const deficitPlayers = [
  makePlayer(MY_SLOT, MY_HERO_ID, [
    makePurchase('desolator', 2400),  // damage
  ]),
  makePlayer(128, 11,  [makePurchase('desolator', 1800)]),  // 600 s earlier
  makePlayer(129, 12,  []),
  makePlayer(130, 13,  []),
  makePlayer(131, 14,  []),
  makePlayer(132, 15,  []),
];

const deficitResult = scanSpikeWindowDeltas(deficitPlayers, MY_SLOT);
const defDamage     = deficitResult.find((a) => a.bucket === 'damage');

assert(defDamage !== undefined,                    'spike_deficit: damage anchor present');
assert(defDamage.type === 'spike_deficit',         'spike_deficit: type is spike_deficit');
assert(defDamage.delta === 2400 - 1800,            'spike_deficit: delta = 600');
assert(defDamage.delta > 0,                        'spike_deficit: delta is positive');
assert(defDamage.enemyHero !== undefined,          'spike_deficit: enemyHero present');
assert(typeof defDamage.enemyHero === 'string',    'spike_deficit: enemyHero is string');
assert(defDamage.enemyHero.length > 0,             'spike_deficit: enemyHero non-empty');

// Hero 11 = Shadow Fiend (no profile → English name)
assert(defDamage.enemyHero === 'Shadow Fiend',     'spike_deficit: enemyHero = Shadow Fiend');

// ── Enemy with fastest bucket completion is selected ─────────────────────

console.log('\n── enemy multi-player: fastest completer selected ───────────────────');

const fastestPlayers = [
  makePlayer(MY_SLOT, MY_HERO_ID, [
    makePurchase('blink', 1800),  // initiation
  ]),
  makePlayer(128, 14,  [makePurchase('blink', 1600)]),  // Pudge, 200 s earlier
  makePlayer(129, 8,   [makePurchase('blink', 1200)]),  // Juggernaut, 600 s earlier — fastest
  makePlayer(130, 5,   [makePurchase('blink', 1900)]),  // Crystal Maiden, later than me
  makePlayer(131, 4,   []),
  makePlayer(132, 3,   []),
];

const fastestResult = scanSpikeWindowDeltas(fastestPlayers, MY_SLOT);
const fastInit      = fastestResult.find((a) => a.bucket === 'initiation');

assert(fastInit !== undefined,              'fastest: initiation anchor present');
assert(fastInit.enemyTime === 1200,         'fastest: enemyTime is the minimum (1200)');
assert(fastInit.enemyHero === 'Juggernaut', 'fastest: enemyHero is Juggernaut (hero 8)');
assert(fastInit.delta === 1800 - 1200,      'fastest: delta = 600');
assert(fastInit.type === 'spike_deficit',   'fastest: type spike_deficit');

// ── Bucket with only my completion → unique anchor (no enemy same-item) ──

console.log('\n── bucket with only my completion → unique anchor (null delta) ───────');

const onlyMyBucket = [
  makePlayer(MY_SLOT, MY_HERO_ID, [
    makePurchase('force_staff', 1000),  // support bucket
  ]),
  makePlayer(128, 14, [makePurchase('blink', 1100)]),  // initiation only, not support
  makePlayer(129, 8,  []),
  makePlayer(130, 5,  []),
  makePlayer(131, 4,  []),
  makePlayer(132, 3,  []),
];

const onlyMyResult = scanSpikeWindowDeltas(onlyMyBucket, MY_SLOT);

// No enemy has force_staff → support anchor present with null delta (my unique power spike).
const uniqueSupport = onlyMyResult.find((a) => a.bucket === 'support');
assert(uniqueSupport !== undefined,          'only-my-bucket: support anchor present (unique spike)');
assert(uniqueSupport.delta === null,         'only-my-bucket: delta is null (no enemy same-item)');
assert(uniqueSupport.type === 'spike_lead',  'only-my-bucket: type = spike_lead');
assert(uniqueSupport.enemyHero === null,     'only-my-bucket: enemyHero = null');
assert(uniqueSupport.enemyItem === null,     'only-my-bucket: enemyItem = null');
assert(uniqueSupport.enemyTime === null,     'only-my-bucket: enemyTime = null');
assert(uniqueSupport.significant === true,   'only-my-bucket: unique items are always significant');
// I did not buy any initiation item → still no initiation anchor.
assert(onlyMyResult.find((a) => a.bucket === 'initiation') === undefined,
  'only-my-bucket: no initiation anchor (I did not buy it)');

// ── Bucket with only enemy completion → no anchor ────────────────────────

console.log('\n── bucket with only enemy completion → no anchor ────────────────────');

const onlyEnemyBucket = [
  makePlayer(MY_SLOT, MY_HERO_ID, [
    makePurchase('blink', 1000),  // initiation only
  ]),
  makePlayer(128, 14, [makePurchase('force_staff', 900)]),  // support
  makePlayer(129, 8,  []),
  makePlayer(130, 5,  []),
  makePlayer(131, 4,  []),
  makePlayer(132, 3,  []),
];

const onlyEnemyResult = scanSpikeWindowDeltas(onlyEnemyBucket, MY_SLOT);
assert(onlyEnemyResult.find((a) => a.bucket === 'support') === undefined,
  'only-enemy-bucket: no support anchor when I did not complete support bucket');

// ── My player buys multiple items in one bucket → one anchor per item ────

console.log('\n── multi-item in same bucket: one anchor per purchased item ─────────');

const multiItemPlayers = [
  makePlayer(MY_SLOT, MY_HERO_ID, [
    makePurchase('pipe', 2000),           // survivability
    makePurchase('black_king_bar', 1500), // survivability
    makePurchase('crimson_guard', 2500),  // survivability
  ]),
  makePlayer(128, 14, [makePurchase('black_king_bar', 1800)]),
  makePlayer(129, 8,  []),
  makePlayer(130, 5,  []),
  makePlayer(131, 4,  []),
  makePlayer(132, 3,  []),
];

const multiItemResult = scanSpikeWindowDeltas(multiItemPlayers, MY_SLOT);

// One anchor per item I bought in the bucket (3 items → 3 anchors).
assert(multiItemResult.length === 3, 'multi-item: 3 anchors (one per purchased spike item)');

// BKB: exact same-item comparison (enemy also bought BKB).
const bkbAnchor = multiItemResult.find((a) => a.myItem === 'black_king_bar');
assert(bkbAnchor !== undefined,                        'multi-item: BKB anchor present');
assert(bkbAnchor.myTime === 1500,                      'multi-item: BKB myTime = 1500');
assert(bkbAnchor.enemyItem === 'black_king_bar',       'multi-item: BKB same-item comparison');
assert(bkbAnchor.delta === 1500 - 1800,                'multi-item: BKB delta = -300 (spike_lead)');
assert(bkbAnchor.type === 'spike_lead',                'multi-item: BKB spike_lead (earlier than enemy)');

// pipe: no enemy pipe → null delta (my unique advantage, no bucket fallback).
const pipeAnchor = multiItemResult.find((a) => a.myItem === 'pipe');
assert(pipeAnchor !== undefined,                       'multi-item: pipe anchor present');
assert(pipeAnchor.myTime === 2000,                     'multi-item: pipe myTime = 2000');
assert(pipeAnchor.delta === null,                      'multi-item: pipe delta null (no enemy pipe)');
assert(pipeAnchor.type === 'spike_lead',               'multi-item: pipe spike_lead (unique item)');
assert(pipeAnchor.enemyHero === null,                  'multi-item: pipe enemyHero null');

// crimson_guard: no enemy crimson_guard → null delta.
const cgAnchor = multiItemResult.find((a) => a.myItem === 'crimson_guard');
assert(cgAnchor !== undefined,                         'multi-item: crimson_guard anchor present');
assert(cgAnchor.myTime === 2500,                       'multi-item: crimson_guard myTime = 2500');
assert(cgAnchor.delta === null,                        'multi-item: crimson_guard delta null');
assert(cgAnchor.type === 'spike_lead',                 'multi-item: crimson_guard spike_lead');
assert(cgAnchor.enemyHero === null,                    'multi-item: crimson_guard enemyHero null');

// ── significant flag: above and below threshold ───────────────────────────

console.log('\n── significant flag ─────────────────────────────────────────────────');

// 121 s gap → significant (> 120)
const sigPlayers = [
  makePlayer(MY_SLOT, MY_HERO_ID, [makePurchase('blink', 1000)]),
  makePlayer(128, 14,  [makePurchase('blink', 1121)]),
  makePlayer(129, 8,   []),
  makePlayer(130, 5,   []),
  makePlayer(131, 4,   []),
  makePlayer(132, 3,   []),
];
const sigResult = scanSpikeWindowDeltas(sigPlayers, MY_SLOT);
const sigInit   = sigResult.find((a) => a.bucket === 'initiation');
assert(sigInit !== undefined,      'significant: anchor present');
assert(sigInit.significant === true, `significant: |${sigInit.delta}| > ${_SIGNIFICANT_GAP_SECONDS} → true`);

// Exactly at threshold (120 s gap) → NOT significant (strictly >)
const notSigPlayers = [
  makePlayer(MY_SLOT, MY_HERO_ID, [makePurchase('blink', 1000)]),
  makePlayer(128, 14,  [makePurchase('blink', 1120)]),
  makePlayer(129, 8,   []),
  makePlayer(130, 5,   []),
  makePlayer(131, 4,   []),
  makePlayer(132, 3,   []),
];
const notSigResult = scanSpikeWindowDeltas(notSigPlayers, MY_SLOT);
const notSigInit   = notSigResult.find((a) => a.bucket === 'initiation');
assert(notSigInit !== undefined,        'not-significant: anchor present');
assert(notSigInit.significant === false, `not-significant: |120| = THRESHOLD → false (strict >)`);

// Well under threshold (30 s gap)
const smallGapPlayers = [
  makePlayer(MY_SLOT, MY_HERO_ID, [makePurchase('blink', 1000)]),
  makePlayer(128, 14,  [makePurchase('blink', 1030)]),
  makePlayer(129, 8,   []),
  makePlayer(130, 5,   []),
  makePlayer(131, 4,   []),
  makePlayer(132, 3,   []),
];
const smallGapResult = scanSpikeWindowDeltas(smallGapPlayers, MY_SLOT);
const smallGapInit   = smallGapResult.find((a) => a.bucket === 'initiation');
assert(smallGapInit !== undefined,          'small-gap: anchor present');
assert(smallGapInit.significant === false,  'small-gap: |30| < threshold → false');

// ── Sort order: |delta| descending ────────────────────────────────────────

console.log('\n── sort order: |delta| descending ───────────────────────────────────');

// Set up two buckets with different gap sizes.
// initiation gap: 600 s (I'm later); survivability gap: 200 s (I'm earlier)
const sortPlayers = [
  makePlayer(MY_SLOT, MY_HERO_ID, [
    makePurchase('blink', 1800),          // initiation
    makePurchase('black_king_bar', 1000), // survivability
  ]),
  makePlayer(128, 14, [
    makePurchase('blink', 1200),          // initiation, 600 s earlier than me
    makePurchase('black_king_bar', 1200), // survivability, 200 s later than me
  ]),
  makePlayer(129, 8,  []),
  makePlayer(130, 5,  []),
  makePlayer(131, 4,  []),
  makePlayer(132, 3,  []),
];

const sortResult = scanSpikeWindowDeltas(sortPlayers, MY_SLOT);

assert(sortResult.length === 2, 'sort: 2 anchors');
assert(Math.abs(sortResult[0].delta) >= Math.abs(sortResult[1].delta),
  'sort: first anchor has |delta| >= second');
assert(sortResult[0].bucket === 'initiation',     'sort: initiation (|600|) is first');
assert(sortResult[1].bucket === 'survivability',  'sort: survivability (|200|) is second');

// ── Anchor shape: required fields ─────────────────────────────────────────

console.log('\n── anchor shape: required fields ────────────────────────────────────');

const shapePlayers = [
  makePlayer(MY_SLOT, MY_HERO_ID, [makePurchase('blink', 1000)]),
  makePlayer(128, 96, [makePurchase('blink', 1300)]),
  makePlayer(129, 8,  []),
  makePlayer(130, 5,  []),
  makePlayer(131, 4,  []),
  makePlayer(132, 3,  []),
];
const shapeResult = scanSpikeWindowDeltas(shapePlayers, MY_SLOT);
assert(shapeResult.length >= 1, 'shape: at least one anchor');
const anchor = shapeResult.find((a) => a.bucket === 'initiation');
assert(anchor !== undefined,           'shape: initiation anchor present');
assert('bucket'      in anchor,        'shape: bucket present');
assert('myItem'      in anchor,        'shape: myItem present');
assert('myTime'      in anchor,        'shape: myTime present');
assert('enemyHero'   in anchor,        'shape: enemyHero present');
assert('enemyItem'   in anchor,        'shape: enemyItem present');
assert('enemyTime'   in anchor,        'shape: enemyTime present');
assert('delta'       in anchor,        'shape: delta present');
assert('type'        in anchor,        'shape: type present');
assert('significant' in anchor,        'shape: significant present');
assert(Object.keys(anchor).length === 9, 'shape: exactly 9 fields');

// ── type values are valid strings ─────────────────────────────────────────

console.log('\n── type values ──────────────────────────────────────────────────────');

// spike_lead (I'm earlier)
const typLeadP = [
  makePlayer(MY_SLOT, MY_HERO_ID, [makePurchase('blink', 900)]),
  makePlayer(128, 14, [makePurchase('blink', 1200)]),
  makePlayer(129, 8,  []),
  makePlayer(130, 5,  []),
  makePlayer(131, 4,  []),
  makePlayer(132, 3,  []),
];
const typLead = scanSpikeWindowDeltas(typLeadP, MY_SLOT).find((a) => a.bucket === 'initiation');
assert(typLead.type === 'spike_lead',    'type: spike_lead when I am earlier');

// spike_deficit (I'm later)
const typDefP = [
  makePlayer(MY_SLOT, MY_HERO_ID, [makePurchase('blink', 1400)]),
  makePlayer(128, 14, [makePurchase('blink', 900)]),
  makePlayer(129, 8,  []),
  makePlayer(130, 5,  []),
  makePlayer(131, 4,  []),
  makePlayer(132, 3,  []),
];
const typDef = scanSpikeWindowDeltas(typDefP, MY_SLOT).find((a) => a.bucket === 'initiation');
assert(typDef.type === 'spike_deficit',  'type: spike_deficit when I am later');

// ── Dire player as selected slot ──────────────────────────────────────────

console.log('\n── dire player as selected slot ─────────────────────────────────────');

const DIRE_SLOT = 128;
const direPlayers = [
  makePlayer(0,   14, [makePurchase('blink', 1000)]),  // radiant enemy
  makePlayer(1,   8,  []),
  makePlayer(2,   5,  []),
  makePlayer(3,   4,  []),
  makePlayer(4,   3,  []),
  makePlayer(DIRE_SLOT, MY_HERO_ID, [makePurchase('blink', 1500)]),  // us, dire
  makePlayer(129, 11, []),
  makePlayer(130, 12, []),
  makePlayer(131, 13, []),
  makePlayer(132, 15, []),
];

const direResult = scanSpikeWindowDeltas(direPlayers, DIRE_SLOT);
const direInit   = direResult.find((a) => a.bucket === 'initiation');
assert(direInit !== undefined,           'dire: initiation anchor present');
assert(direInit.type === 'spike_deficit', 'dire: type spike_deficit (radiant blinked at 1000)');
assert(direInit.delta === 1500 - 1000,   'dire: delta = 500');

// ── Profile hero gets correct display name ────────────────────────────────

console.log('\n── profile hero display name ─────────────────────────────────────────');

const profileHeroPlayers = [
  makePlayer(MY_SLOT, MY_HERO_ID, [makePurchase('blink', 1200)]),
  // Hero 96 = 半人马战行者（Centaur Warrunner） — a profile hero
  makePlayer(128, 96, [makePurchase('blink', 1000)]),
  makePlayer(129, 8,  []),
  makePlayer(130, 5,  []),
  makePlayer(131, 4,  []),
  makePlayer(132, 3,  []),
];
const profileResult = scanSpikeWindowDeltas(profileHeroPlayers, MY_SLOT);
const profileInit   = profileResult.find((a) => a.bucket === 'initiation');
assert(profileInit !== undefined, 'profile hero: initiation anchor present');
assert(profileInit.enemyHero === '半人马战行者（Centaur Warrunner）',
  'profile hero: enemyHero uses 中文（English）format');

// ── Summary ────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(60)}`);
console.log(`openDotaSpikeWindowScanner: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
