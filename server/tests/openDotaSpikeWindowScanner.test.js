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
  scanPaceDeficits,
  _SIGNIFICANT_GAP_SECONDS,
  _PACE_GRACE_SECONDS,
  _PACE_SIGNIFICANT_GAP,
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

// ── scanPaceDeficits ─────────────────────────────────────────────────────────

console.log('\n── scanPaceDeficits: degenerate inputs → [] ─────────────────────────');

assert(Array.isArray(scanPaceDeficits(null, MY_SLOT)),    'pace: null players → array');
assert(scanPaceDeficits(null, MY_SLOT).length === 0,      'pace: null players → []');
assert(scanPaceDeficits(undefined, MY_SLOT).length === 0, 'pace: undefined players → []');
assert(scanPaceDeficits([], MY_SLOT).length === 0,        'pace: empty players → []');
assert(scanPaceDeficits(onlyMe, 999).length === 0,        'pace: unknown selected slot → []');

console.log('\n── scanPaceDeficits: unparsed (purchase_log missing) → [] ───────────');

// My player has purchase_log = null (unparsed) — cannot compute anything, even
// though the enemy has real purchases. Constructed directly (not via
// makePlayer) since makePlayer's `purchaseLog || []` default would otherwise
// mask a real null.
const paceUnparsedMe = [
  { player_slot: MY_SLOT, hero_id: MY_HERO_ID, purchase_log: null },
  makePlayer(128, 14, [makePurchase('blink', 1000)]),
  makePlayer(129, 8,  []),
  makePlayer(130, 5,  []),
  makePlayer(131, 4,  []),
  makePlayer(132, 3,  []),
];
assert(scanPaceDeficits(paceUnparsedMe, MY_SLOT).length === 0,
  'pace: my purchase_log = null (unparsed) → []');

console.log('\n── scanPaceDeficits: enemy never buys a key item → [] ───────────────');

const paceEnemyZero = [
  makePlayer(MY_SLOT, MY_HERO_ID, [makePurchase('blink', 1000)]),
  makePlayer(128, 14, []),
  makePlayer(129, 8,  []),
  makePlayer(130, 5,  []),
  makePlayer(131, 4,  []),
  makePlayer(132, 3,  []),
];
assert(scanPaceDeficits(paceEnemyZero, MY_SLOT).length === 0,
  'pace: enemy 0 completions throughout → [] (no deficit, no recovered)');

console.log('\n── scanPaceDeficits: my 0 items, enemy has some → normal output ─────');

// My purchase_log is present but empty (array, not null) — a legitimate
// "haven't bought a key item yet" state, not an unparsed-match state.
const paceMyZero = [
  makePlayer(MY_SLOT, MY_HERO_ID, []),
  makePlayer(128, 14, [makePurchase('blink', 1000)]),
  makePlayer(129, 8,  []),
  makePlayer(130, 5,  []),
  makePlayer(131, 4,  []),
  makePlayer(132, 3,  []),
];
const paceMyZeroResult = scanPaceDeficits(paceMyZero, MY_SLOT);
assert(paceMyZeroResult.length === 1,               'pace: my-0-items → 1 deficit anchor produced');
assert(paceMyZeroResult[0].type === 'pace_deficit', 'pace: my-0-items anchor type = pace_deficit');
assert(paceMyZeroResult[0].myCount === 0,           'pace: my-0-items myCount = 0');
assert(paceMyZeroResult[0].enemyCount === 1,        'pace: my-0-items enemyCount = 1');
assert(paceMyZeroResult[0].gap === 1,               'pace: my-0-items gap = 1');

console.log('\n── scanPaceDeficits: grace window absorbs a same-window catch-up ────');

// Enemy completes at t=1000. I complete the same count within the grace
// window (t=1050, well inside 120s) — should NOT count as falling behind.
const paceGraceAbsorbed = [
  makePlayer(MY_SLOT, MY_HERO_ID, [makePurchase('force_staff', 1050)]),
  makePlayer(128, 14, [makePurchase('blink', 1000)]),
  makePlayer(129, 8,  []),
  makePlayer(130, 5,  []),
  makePlayer(131, 4,  []),
  makePlayer(132, 3,  []),
];
assert(scanPaceDeficits(paceGraceAbsorbed, MY_SLOT).length === 0,
  `pace: catch-up within grace window (${_PACE_GRACE_SECONDS}s) → no deficit anchor`);

console.log('\n── scanPaceDeficits: gap escalation dedup ────────────────────────────');

// Enemy completes 3 items over time; I never buy anything (purchase_log = []).
// gap escalates 1 → 2 → 3, one anchor per new high, no duplicates.
const paceEscalation = [
  makePlayer(MY_SLOT, MY_HERO_ID, []),
  makePlayer(128, 14, [
    makePurchase('blink', 1000),          // enemy count 1 → gap 1
    makePurchase('black_king_bar', 1400), // enemy count 2 → gap 2
    makePurchase('pipe', 1800),           // enemy count 3 → gap 3
  ]),
  makePlayer(129, 8,  []),
  makePlayer(130, 5,  []),
  makePlayer(131, 4,  []),
  makePlayer(132, 3,  []),
];
const escResult = scanPaceDeficits(paceEscalation, MY_SLOT);
assert(escResult.length === 3, `pace: 3 escalating deficit anchors (got ${escResult.length})`);
assert(escResult.every((a) => a.type === 'pace_deficit'), 'pace: all escalation anchors are pace_deficit');
assert(escResult[0].gap === 1 && escResult[1].gap === 2 && escResult[2].gap === 3,
  'pace: gaps escalate 1 → 2 → 3 in order');
assert(escResult[0].gameTime === 1000 && escResult[1].gameTime === 1400 && escResult[2].gameTime === 1800,
  'pace: escalation anchors fire at each enemy completion time');
assert(escResult[0].triggerItem === 'blink' && escResult[1].triggerItem === 'black_king_bar' && escResult[2].triggerItem === 'pipe',
  'pace: triggerItem is the enemy item that caused each escalation');

console.log('\n── scanPaceDeficits: significant flag ────────────────────────────────');

assert(escResult[0].significant === false, `pace: gap=1 < ${_PACE_SIGNIFICANT_GAP} → significant=false`);
assert(escResult[1].significant === true,  `pace: gap=2 >= ${_PACE_SIGNIFICANT_GAP} → significant=true`);
assert(escResult[2].significant === true,  'pace: gap=3 → significant=true');

console.log('\n── scanPaceDeficits: no re-emission when gap does not exceed watermark ─');

// After the 3-item escalation above, a 4th enemy completion where I've
// simultaneously bought one item (gap stays at 3, not a new high) should not
// produce a 4th anchor.
const paceNoReEmit = [
  makePlayer(MY_SLOT, MY_HERO_ID, [makePurchase('force_staff', 2000)]), // my count 1 by t=2000
  makePlayer(128, 14, [
    makePurchase('blink', 1000),
    makePurchase('black_king_bar', 1400),
    makePurchase('pipe', 1800),
    makePurchase('desolator', 2200), // enemy count 4; my count (at 2200+120) = 1 → gap 3, not > 3
  ]),
  makePlayer(129, 8,  []),
  makePlayer(130, 5,  []),
  makePlayer(131, 4,  []),
  makePlayer(132, 3,  []),
];
const noReEmitResult = scanPaceDeficits(paceNoReEmit, MY_SLOT);
assert(noReEmitResult.length === 3,
  `pace: 4th enemy completion with gap=3 (not a new high) produces no new anchor (got ${noReEmitResult.length})`);

console.log('\n── scanPaceDeficits: recovery after falling behind ──────────────────');

// Enemy completes 4 items (1000, 1200, 1400, 1600, all with grace windows
// resolved before my first purchase) → escalating deficit to gap=4. I then
// complete 4 items (2000..2600), the last of which brings my count to match
// the enemy's max (4) → one pace_recovered anchor.
const paceRecoveryPlayers = [
  makePlayer(MY_SLOT, MY_HERO_ID, [
    makePurchase('force_staff', 2000),
    makePurchase('glimmer_cape', 2200),
    makePurchase('rod_of_atos', 2400),
    makePurchase('sheepstick', 2600),
  ]),
  makePlayer(128, 14, [
    makePurchase('blink', 1000),
    makePurchase('black_king_bar', 1200),
    makePurchase('pipe', 1400),
    makePurchase('desolator', 1600),
  ]),
  makePlayer(129, 8,  []),
  makePlayer(130, 5,  []),
  makePlayer(131, 4,  []),
  makePlayer(132, 3,  []),
];
const recoveryResult = scanPaceDeficits(paceRecoveryPlayers, MY_SLOT);
const deficits  = recoveryResult.filter((a) => a.type === 'pace_deficit');
const recovered = recoveryResult.filter((a) => a.type === 'pace_recovered');

assert(deficits.length === 4,   `pace: 4 escalating deficits before recovery (got ${deficits.length})`);
assert(recovered.length === 1,  `pace: exactly 1 recovered anchor (got ${recovered.length})`);
assert(recovered[0].gameTime === 2600,     'pace: recovered fires at my 4th completion (t=2600)');
assert(recovered[0].myCount === 4,         'pace: recovered myCount = 4');
assert(recovered[0].enemyCount === 4,      'pace: recovered enemyCount = 4 (enemy max at that time)');
assert(recovered[0].gap === 0,             'pace: recovered gap = enemyCount - myCount = 0');
assert(recovered[0].significant === false, 'pace: recovered anchors are never significant');
assert(recovered[0].triggerItem === 'sheepstick', 'pace: recovered triggerItem is my own completed item');
assert(typeof recovered[0].enemyHero === 'string', 'pace: recovered enemyHero identifies the caught-up enemy');

console.log('\n── scanPaceDeficits: repeated fall-behind / catch-up cycles ─────────');

// Two independent cycles: fall behind, recover, fall behind again, recover again.
// My purchases land AFTER each enemy purchase's grace window (120s) so the
// deficit registers, then catch up (raw count, no grace) to trigger recovery.
const paceMultiCycle = [
  makePlayer(MY_SLOT, MY_HERO_ID, [
    makePurchase('force_staff', 1200),  // 200s after enemy's 1st item (outside grace) → recovers cycle 1
    makePurchase('glimmer_cape', 2200), // 200s after enemy's 2nd item (outside grace) → recovers cycle 2
  ]),
  makePlayer(128, 14, [
    makePurchase('blink', 1000),          // enemy count 1 at t=1000 → deficit #1 (gap=1)
    makePurchase('black_king_bar', 2000), // enemy count 2 at t=2000 → deficit #2 (gap=1, fresh episode)
  ]),
  makePlayer(129, 8,  []),
  makePlayer(130, 5,  []),
  makePlayer(131, 4,  []),
  makePlayer(132, 3,  []),
];
const multiCycleResult = scanPaceDeficits(paceMultiCycle, MY_SLOT);
const mcDeficits  = multiCycleResult.filter((a) => a.type === 'pace_deficit');
const mcRecovered = multiCycleResult.filter((a) => a.type === 'pace_recovered');
assert(mcDeficits.length === 2,  `pace: 2 separate deficit episodes (got ${mcDeficits.length})`);
assert(mcRecovered.length === 2, `pace: 2 recovered anchors, one per cycle (got ${mcRecovered.length})`);
assert(mcDeficits[0].gap === 1 && mcDeficits[1].gap === 1,
  'pace: each new episode restarts gap escalation from 1 (not cumulative)');

console.log('\n── scanPaceDeficits: dedup — repeated purchase of same item ─────────');

// Enemy "rebuys" the same item (e.g. sells and rebuilds) — only the first
// purchase counts toward the completion count.
const paceDedup = [
  makePlayer(MY_SLOT, MY_HERO_ID, []),
  makePlayer(128, 14, [
    makePurchase('blink', 1000),
    makePurchase('blink', 1500), // restock/rebuy — should not count as a 2nd item
  ]),
  makePlayer(129, 8,  []),
  makePlayer(130, 5,  []),
  makePlayer(131, 4,  []),
  makePlayer(132, 3,  []),
];
const dedupResult = scanPaceDeficits(paceDedup, MY_SLOT);
assert(dedupResult.length === 1, `pace: repeated purchase of same item → 1 anchor only (got ${dedupResult.length})`);
assert(dedupResult[0].enemyCount === 1, 'pace: repeated purchase of same item → enemyCount = 1, not 2');
assert(dedupResult[0].gameTime === 1000, 'pace: repeated purchase — anchor uses the earliest purchase time');

console.log('\n── scanPaceDeficits: anchor shape ────────────────────────────────────');

const shapePaceResult = scanPaceDeficits(paceMyZero, MY_SLOT);
const paceAnchor = shapePaceResult[0];
assert('gameTime'    in paceAnchor, 'pace shape: gameTime present');
assert('type'        in paceAnchor, 'pace shape: type present');
assert('myCount'     in paceAnchor, 'pace shape: myCount present');
assert('enemyCount'  in paceAnchor, 'pace shape: enemyCount present');
assert('gap'         in paceAnchor, 'pace shape: gap present');
assert('enemyHero'   in paceAnchor, 'pace shape: enemyHero present');
assert('triggerItem' in paceAnchor, 'pace shape: triggerItem present');
assert('significant' in paceAnchor, 'pace shape: significant present');
assert(Object.keys(paceAnchor).length === 8, 'pace shape: exactly 8 fields');

console.log('\n── scanPaceDeficits: sort order (gameTime ascending) ─────────────────');

const paceSortTimes = recoveryResult.map((a) => a.gameTime);
for (let i = 1; i < paceSortTimes.length; i++) {
  assert(paceSortTimes[i] >= paceSortTimes[i - 1], `pace sort: gameTimes[${i}] >= gameTimes[${i - 1}]`);
}

console.log('\n── scanPaceDeficits: generic list corrections (ultimate_scepter, vanguard, hood) ─');

// ultimate_scepter (the corrected key — real OpenDota purchase_log spelling for
// Aghanim's Scepter) now matches, and counts toward the enemy's key-item total.
const paceUltimateScepter = [
  makePlayer(MY_SLOT, MY_HERO_ID, []),
  makePlayer(128, 96, [makePurchase('ultimate_scepter', 1000)]),
  makePlayer(129, 8,  []),
  makePlayer(130, 5,  []),
  makePlayer(131, 4,  []),
  makePlayer(132, 3,  []),
];
const usResult = scanPaceDeficits(paceUltimateScepter, MY_SLOT);
assert(usResult.length === 1 && usResult[0].triggerItem === 'ultimate_scepter',
  'pace: ultimate_scepter counts as a key item (corrected key spelling)');

// vanguard / hood_of_defiance now count toward my own completion total too.
const paceVanguardHood = [
  makePlayer(MY_SLOT, MY_HERO_ID, [
    makePurchase('vanguard', 500),
    makePurchase('hood_of_defiance', 700),
  ]),
  makePlayer(128, 14, [makePurchase('blink', 2000), makePurchase('black_king_bar', 2100), makePurchase('pipe', 2200)]),
  makePlayer(129, 8,  []),
  makePlayer(130, 5,  []),
  makePlayer(131, 4,  []),
  makePlayer(132, 3,  []),
];
const vhResult = scanPaceDeficits(paceVanguardHood, MY_SLOT);
// At the enemy's 3rd completion (t=2200+grace), my count should be 2 (vanguard + hood), so gap = 3 - 2 = 1.
const vhLast = vhResult[vhResult.length - 1];
assert(vhLast.myCount === 2, `pace: vanguard + hood_of_defiance both count toward my total (myCount=2, got ${vhLast.myCount})`);

// ── Summary ────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(60)}`);
console.log(`openDotaSpikeWindowScanner: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
