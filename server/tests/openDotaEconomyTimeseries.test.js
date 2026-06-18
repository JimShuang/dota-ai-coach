// Run: node server/tests/openDotaEconomyTimeseries.test.js

'use strict';

const {
  buildEconomyTimeseries,
  economyDeltaAroundDeath,
  _ABS_THRESHOLD,
  _REL_THRESHOLD,
  _BASELINE_MIN,
} = require('../openDotaEconomyTimeseries');

const { buildDeathDigest } = require('../openDotaDeathDigest');

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

// ── Fixtures ───────────────────────────────────────────────────────────────

// 10-minute match, radiant leads (+2000g at min 5, -1000g at min 9)
const GOLD_ADV = [0, 200, 500, 800, 1500, 2000, 1800, 1200, 300, -1000];
const XP_ADV   = [0, 100, 300, 600, 900,  1200, 1100,  900, 400,  -500];

const RAW_PARSED = {
  radiant_gold_adv: GOLD_ADV,
  radiant_xp_adv:   XP_ADV,
  duration:         540,
  radiant_win:      true,
  players:          [{ player_slot: 0, kills: 5, deaths: 2 }],
};

const RAW_NO_ADV = {
  radiant_gold_adv: null,
  players: [],
};

// ── buildEconomyTimeseries ─────────────────────────────────────────────────

console.log('\n── buildEconomyTimeseries: null / missing data ──────────────────────');

const noAdv = buildEconomyTimeseries(RAW_NO_ADV, 0);
assert(noAdv.available === false, 'null radiant_gold_adv → available=false');
assert(Array.isArray(noAdv.gold) && noAdv.gold.length === 0, 'null radiant_gold_adv → gold=[]');
assert(Array.isArray(noAdv.xp)  && noAdv.xp.length  === 0,  'null radiant_gold_adv → xp=[]');
assert(noAdv.perspective === null, 'null radiant_gold_adv → perspective=null');

const nullRaw = buildEconomyTimeseries(null, 0);
assert(nullRaw.available === false, 'null raw → available=false');

const noField = buildEconomyTimeseries({}, 0);
assert(noField.available === false, 'missing radiant_gold_adv field → available=false');

console.log('\n── buildEconomyTimeseries: radiant player (slot 0) ──────────────────');

const radiant = buildEconomyTimeseries(RAW_PARSED, 0);
assert(radiant.available === true,      'slot 0 → available=true');
assert(radiant.perspective === 'radiant', 'slot 0 → perspective=radiant');
assert(radiant.gold.length === GOLD_ADV.length, 'gold array length matches source');
assert(radiant.xp.length   === XP_ADV.length,  'xp array length matches source');

// Radiant player: sign unchanged
assert(radiant.gold[5].adv === 2000,  'radiant slot 5 gold adv = +2000');
assert(radiant.gold[9].adv === -1000, 'radiant slot 9 gold adv = -1000');
assert(radiant.xp[5].adv   === 1200,  'radiant xp adv at min 5 = +1200');

// minute index is preserved
assert(radiant.gold[0].minute === 0, 'gold[0].minute === 0');
assert(radiant.gold[5].minute === 5, 'gold[5].minute === 5');

console.log('\n── buildEconomyTimeseries: dire player (slot 128) ───────────────────');

const dire = buildEconomyTimeseries(RAW_PARSED, 128);
assert(dire.available === true,    'slot 128 → available=true');
assert(dire.perspective === 'dire', 'slot 128 → perspective=dire');

// Dire player: sign flipped — radiant +2000 → dire perspective -2000
assert(dire.gold[5].adv === -2000, 'dire slot 5 gold adv = -2000 (radiant leads)');
assert(dire.gold[9].adv === 1000,  'dire slot 9 gold adv = +1000 (dire leads)');
assert(dire.xp[5].adv   === -1200, 'dire xp adv at min 5 = -1200');

console.log('\n── buildEconomyTimeseries: other slot values ────────────────────────');

// Slot 4 is still radiant
const slot4 = buildEconomyTimeseries(RAW_PARSED, 4);
assert(slot4.perspective === 'radiant', 'slot 4 → radiant');
assert(slot4.gold[5].adv === 2000, 'slot 4 gold[5] unchanged');

// Slot 132 is dire
const slot132 = buildEconomyTimeseries(RAW_PARSED, 132);
assert(slot132.perspective === 'dire', 'slot 132 → dire');
assert(slot132.gold[5].adv === -2000, 'slot 132 gold[5] negated');

// Missing xp_adv → xp is empty, gold still works
const noXp = buildEconomyTimeseries({ radiant_gold_adv: GOLD_ADV }, 0);
assert(noXp.available === true, 'missing radiant_xp_adv → still available');
assert(noXp.xp.length === 0,   'missing radiant_xp_adv → xp=[]');
assert(noXp.gold.length === GOLD_ADV.length, 'missing radiant_xp_adv → gold intact');

// ── economyDeltaAroundDeath ───────────────────────────────────────────────

console.log('\n── economyDeltaAroundDeath: null / unavailable timeseries ───────────');

const tsClear = { available: false, gold: [], xp: [] };

const nullResult = economyDeltaAroundDeath(null, 300);
assert(nullResult.available === false,    'null timeseries → available=false');
assert(nullResult.delta === null,         'null timeseries → delta=null');
assert(nullResult.significant === false,  'null timeseries → significant=false');
assert(nullResult.minuteAtDeath === null, 'null timeseries → minuteAtDeath=null');

const clearResult = economyDeltaAroundDeath(tsClear, 300);
assert(clearResult.available === false, 'unavailable timeseries → available=false');

console.log('\n── economyDeltaAroundDeath: minuteAtDeath calculation ───────────────');

const tsRadiant = buildEconomyTimeseries(RAW_PARSED, 0);

// t=300s → minute 5 (floor(300/60)=5)
const d300 = economyDeltaAroundDeath(tsRadiant, 300);
assert(d300.available === true, 't=300 → available=true');
assert(d300.minuteAtDeath === 5, 't=300s → minute 5');
assert(d300.advBefore === 2000,  'advBefore = gold[5] = 2000');
assert(d300.advAfter  === 1800,  'advAfter = gold[6] = 1800');
assert(d300.delta     === -200,  'delta = 1800 - 2000 = -200');

// t=0 → minute 0
const d0 = economyDeltaAroundDeath(tsRadiant, 0);
assert(d0.minuteAtDeath === 0, 't=0 → minute 0');
assert(d0.advBefore === 0,     'advBefore = gold[0] = 0');
assert(d0.advAfter  === 200,   'advAfter = gold[1] = 200');
assert(d0.delta     === 200,   'delta = 200 - 0 = 200');

// t=359s → floor(359/60)=5 (still minute 5)
const d359 = economyDeltaAroundDeath(tsRadiant, 359);
assert(d359.minuteAtDeath === 5, 't=359s → minute 5 (floor)');

// t=360s → floor(360/60)=6 (minute 6)
const d360 = economyDeltaAroundDeath(tsRadiant, 360);
assert(d360.minuteAtDeath === 6, 't=360s → minute 6');

console.log('\n── economyDeltaAroundDeath: out-of-range death times ────────────────');

// minute 9 is last index (length=10, indices 0-9) → no next point
const d9 = economyDeltaAroundDeath(tsRadiant, 9 * 60);
assert(d9.available === true,     'last minute → available=true');
assert(d9.minuteAtDeath === 9,    'last minute → minuteAtDeath=9');
assert(d9.advAfter === null,      'last minute → advAfter=null (no next point)');
assert(d9.delta === null,         'last minute → delta=null');
assert(d9.significant === false,  'last minute → significant=false');

// minute > length → out of range
const dOut = economyDeltaAroundDeath(tsRadiant, 9999);
assert(dOut.available === false,  'minute > array → available=false');
assert(dOut.delta === null,       'minute > array → delta=null');

// negative death time (pre-game)
const dNeg = economyDeltaAroundDeath(tsRadiant, -30);
assert(dNeg.available === false, 'negative game_time → available=false');

// non-number death time
const dNaN = economyDeltaAroundDeath(tsRadiant, 'bad');
assert(dNaN.available === false, 'non-number game_time → available=false');

console.log('\n── economyDeltaAroundDeath: significant dual-threshold ──────────────');

// Build a synthetic timeseries to exercise each threshold combination
function makeSyntheticTs(gold0, gold1) {
  return { available: true, gold: [{ minute: 0, adv: gold0 }, { minute: 1, adv: gold1 }], xp: [] };
}

// 1. Only absolute threshold exceeded (delta > 1000, but rel is small because baseline is huge)
const ts1 = makeSyntheticTs(20000, 20000 - (_ABS_THRESHOLD + 100));
const r1 = economyDeltaAroundDeath(ts1, 0);
assert(Math.abs(r1.delta) > _ABS_THRESHOLD, 'setup: |delta| > ABS_THRESHOLD');
assert(Math.abs(r1.delta) <= Math.abs(ts1.gold[0].adv) * _REL_THRESHOLD, 'setup: |delta| <= REL_THRESHOLD * baseline');
assert(r1.significant === true, 'abs threshold alone triggers significant');

// 2. Only relative threshold exceeded (delta <= 1000, but rel > 20% and baseline >= BASELINE_MIN)
const baseline2 = _BASELINE_MIN + 100;  // e.g. 600
const delta2 = Math.floor(baseline2 * (_REL_THRESHOLD + 0.05));  // 25% — above rel threshold
const ts2 = makeSyntheticTs(baseline2, baseline2 - delta2);
const r2 = economyDeltaAroundDeath(ts2, 0);
assert(Math.abs(r2.delta) <= _ABS_THRESHOLD,                                  'setup: |delta| <= ABS_THRESHOLD');
assert(Math.abs(ts2.gold[0].adv) >= _BASELINE_MIN,                            'setup: baseline >= BASELINE_MIN');
assert(Math.abs(r2.delta) > Math.abs(ts2.gold[0].adv) * _REL_THRESHOLD,       'setup: |delta| > REL% of baseline');
assert(r2.significant === true, 'relative threshold alone triggers significant');

// 3. Neither threshold exceeded → significant=false
const ts3 = makeSyntheticTs(5000, 5000 - 300);  // delta=300 < 1000, 300/5000=6% < 20%
const r3 = economyDeltaAroundDeath(ts3, 0);
assert(r3.significant === false, 'below both thresholds → significant=false');

// 4. Baseline < BASELINE_MIN → relative threshold does NOT apply; only absolute
// delta = 400, baseline = 200 → 400/200=200% would trigger relative, but baseline is tiny
const ts4 = makeSyntheticTs(_BASELINE_MIN - 100, _BASELINE_MIN - 100 - 400);
const r4 = economyDeltaAroundDeath(ts4, 0);
assert(Math.abs(ts4.gold[0].adv) < _BASELINE_MIN, 'setup: baseline < BASELINE_MIN');
assert(Math.abs(r4.delta) < _ABS_THRESHOLD,        'setup: |delta| < ABS_THRESHOLD');
assert(r4.significant === false, 'tiny baseline + sub-abs delta → significant=false (relative skipped)');

// 5. Both thresholds exceeded
const ts5 = makeSyntheticTs(_BASELINE_MIN + 100, 0);  // 600 → 0, delta=600, rel=100%
const r5 = economyDeltaAroundDeath(ts5, 0);
// delta=600 < 1000 ABS, but 600/600=100% REL triggers
assert(r5.significant === true, 'rel threshold alone sufficient (both conditions hold)');

console.log('\n── digest integration: context.economy present on all deaths ────────');

const DEATH_OD = {
  id: 1, game_time: 300, type: 'hero_death', severity: 'danger', message: 'OD死亡',
  snapshot: { source: 'opendota_import', killer: 'Axe', deathNumber: 1 },
};

// Without timeseries → economy.available=false
const digestNoTs = buildDeathDigest([DEATH_OD]);
assert(Array.isArray(digestNoTs) && digestNoTs.length === 1, 'digest with no timeseries: 1 entry');
assert('economy' in digestNoTs[0].context,                   'context.economy present even without timeseries');
assert(digestNoTs[0].context.economy.available === false,    'no timeseries → economy.available=false');
assert(digestNoTs[0].context.economy.delta     === null,     'no timeseries → economy.delta=null');
assert(digestNoTs[0].context.economy.significant === false,  'no timeseries → economy.significant=false');

// With unavailable timeseries (null radiant_gold_adv)
const tsUnavail = buildEconomyTimeseries(RAW_NO_ADV, 0);
const digestUnavail = buildDeathDigest([DEATH_OD], tsUnavail);
assert(digestUnavail[0].context.economy.available === false, 'unavailable timeseries → economy.available=false');

// With valid timeseries
const digestTs = buildDeathDigest([DEATH_OD], tsRadiant);
const eco = digestTs[0].context.economy;
assert(eco.available === true,        'valid timeseries → economy.available=true');
assert(eco.minuteAtDeath === 5,       'death at t=300 → minute 5');
assert(eco.advBefore === 2000,        'advBefore = 2000');
assert(eco.advAfter  === 1800,        'advAfter = 1800');
assert(eco.delta     === -200,        'delta = -200');
assert(typeof eco.significant === 'boolean', 'significant is boolean');

// Existing context fields are unaffected by timeseries parameter
assert(Array.isArray(digestTs[0].context.chainDeaths),      'chainDeaths still present');
assert(Array.isArray(digestTs[0].context.killsNearby),      'killsNearby still present');
assert(Array.isArray(digestTs[0].context.objectivesLost),   'objectivesLost still present');
assert(Array.isArray(digestTs[0].context.objectivesGained), 'objectivesGained still present');
assert('diedWithBuyback'    in digestTs[0].context, 'diedWithBuyback still present');
assert('majorObjectiveLost' in digestTs[0].context, 'majorObjectiveLost still present');
assert('windowStart'        in digestTs[0].context, 'windowStart still present');
assert('windowEnd'          in digestTs[0].context, 'windowEnd still present');

console.log('\n── digest integration: economy degradation when death out of range ──');

// Death very late in the game, beyond the 10-minute adv array
const LATE_DEATH = {
  id: 2, game_time: 9999, type: 'hero_death', severity: 'danger', message: '超时死亡',
  snapshot: { source: 'opendota_import', killer: 'Pudge', deathNumber: 2 },
};
const digestLate = buildDeathDigest([LATE_DEATH], tsRadiant);
assert(digestLate[0].context.economy.available === false, 'out-of-range death → economy.available=false');
assert(digestLate[0].context.economy.delta === null,      'out-of-range death → delta=null');

// ── Summary ────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(60)}`);
console.log(`openDotaEconomyTimeseries: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
