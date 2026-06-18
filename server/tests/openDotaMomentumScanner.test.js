// Run: node server/tests/openDotaMomentumScanner.test.js

'use strict';

// ── Decoupling verification ─────────────────────────────────────────────────
// Must run BEFORE requiring the module so any import-time side-effects surface.
const fs   = require('fs');
const path = require('path');
const src  = fs.readFileSync(
  path.resolve(__dirname, '../openDotaMomentumScanner.js'),
  'utf8'
);

const {
  scanMomentumShifts,
  _MIN_SLOPE_CHANGE,
  _MIN_TREND_MINUTES,
  _FLAT_BAND,
} = require('../openDotaMomentumScanner');

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

// Check for actual require() calls, not just string mentions in comments.
// Pattern: require(  then any quote style  then the module name
function hasRequire(source, moduleName) {
  return new RegExp(`require\\(['"][^'"]*${moduleName}[^'"]*['"]\\)`).test(source);
}

assert(!hasRequire(src, 'openDotaDeathDigest'),    'module does not require openDotaDeathDigest');
assert(!hasRequire(src, 'openDotaEventBuilder'),   'module does not require openDotaEventBuilder');
assert(!hasRequire(src, 'openDotaKillDeath'),      'module does not require openDotaKillDeathExtractor');
assert(!hasRequire(src, 'eventLogger'),            'module does not require eventLogger');
assert(!hasRequire(src, 'matchHistory'),           'module does not require matchHistory');
assert(!hasRequire(src, 'openDotaEconomyTimeseries'), 'module does not require openDotaEconomyTimeseries (standalone)');

// ── Helpers ────────────────────────────────────────────────────────────────

// Build a minimal timeseries object from a flat adv array (minute = index).
function makeTs(advArr) {
  return {
    available: true,
    gold: advArr.map((adv, minute) => ({ minute, adv })),
    xp: [],
  };
}

// ── Unavailable / degenerate inputs ───────────────────────────────────────

console.log('\n── degenerate inputs → [] ───────────────────────────────────────────');

assert(Array.isArray(scanMomentumShifts(null)),                            'null → array');
assert(scanMomentumShifts(null).length === 0,                              'null → []');
assert(scanMomentumShifts({ available: false, gold: [] }).length === 0,    'available=false → []');
assert(scanMomentumShifts({ available: true, gold: [] }).length === 0,     'empty gold → []');
assert(scanMomentumShifts(undefined).length === 0,                         'undefined → []');

// Too short: need >= MIN_TREND_MINUTES*2+1 points
const minLen = _MIN_TREND_MINUTES * 2 + 1;   // default: 5
assert(scanMomentumShifts(makeTs([0])).length === 0,           '1 point → []');
assert(scanMomentumShifts(makeTs([0, 500])).length === 0,      '2 points → []');
assert(scanMomentumShifts(makeTs(new Array(minLen - 1).fill(0))).length === 0,
  `${minLen - 1} points (< minLen) → []`);

// ── Flat plateau (all slopes within FLAT_BAND) ────────────────────────────

console.log('\n── flat plateau → [] ────────────────────────────────────────────────');

const flatAdv = [1000, 1000, 1000, 1000, 1000, 1000, 1000];
assert(scanMomentumShifts(makeTs(flatAdv)).length === 0, 'perfectly flat → []');

// Slopes within FLAT_BAND (±100)
const nearFlat = [0, 50, 80, 60, 30, 50, 70];
assert(scanMomentumShifts(makeTs(nearFlat)).length === 0, 'all slopes ≤ FLAT_BAND → []');

// ── Clear V-shape (momentum_loss) ─────────────────────────────────────────

console.log('\n── V-shape (rising then falling) → momentum_loss ───────────────────');

// slopes: [600,600,600,600,600,-600,-600,-600,-600,-600]
// Reversal at index 5 in slopes → gold[5] = minute 5
const vAdv = [0, 600, 1200, 1800, 2400, 3000, 2400, 1800, 1200, 600, 0];
const vResult = scanMomentumShifts(makeTs(vAdv));

assert(vResult.length === 1,                       'V-shape: exactly 1 anchor');
assert(vResult[0].type === 'momentum_loss',        'V-shape: type=momentum_loss');
assert(vResult[0].minute === 5,                    'V-shape: minute=5');
assert(vResult[0].slopeBefore > 0,                 'V-shape: slopeBefore > 0');
assert(vResult[0].slopeAfter < 0,                  'V-shape: slopeAfter < 0');
assert(vResult[0].magnitude > _MIN_SLOPE_CHANGE,   'V-shape: magnitude > MIN_SLOPE_CHANGE');
assert(vResult[0].advAtShift === 3000,             'V-shape: advAtShift = gold[5].adv = 3000');
assert(typeof vResult[0].minute === 'number',      'V-shape: minute is number');
assert(typeof vResult[0].magnitude === 'number',   'V-shape: magnitude is number');

// ── Inverted V-shape (momentum_gain) ─────────────────────────────────────

console.log('\n── inverted V (falling then rising) → momentum_gain ─────────────────');

// slopes: [-600,-600,-600,-600,-600,600,600,600,600,600]
const invAdv = [3000, 2400, 1800, 1200, 600, 0, 600, 1200, 1800, 2400, 3000];
const invResult = scanMomentumShifts(makeTs(invAdv));

assert(invResult.length === 1,                     'inv-V: exactly 1 anchor');
assert(invResult[0].type === 'momentum_gain',      'inv-V: type=momentum_gain');
assert(invResult[0].minute === 5,                  'inv-V: minute=5');
assert(invResult[0].slopeBefore < 0,               'inv-V: slopeBefore < 0');
assert(invResult[0].slopeAfter > 0,                'inv-V: slopeAfter > 0');
assert(invResult[0].advAtShift === 0,              'inv-V: advAtShift=0');

// ── Single-minute spike → filtered by persistence ─────────────────────────

console.log('\n── single-minute spike → filtered (0 anchors) ───────────────────────');

// Rising then ONE negative minute then continues rising
// slopes: [600,600,600,-600,600,600,600]  (reversal lasts only 1 minute)
const spikeAdv = [0, 600, 1200, 1800, 1200, 1800, 2400, 3000];
const spikeResult = scanMomentumShifts(makeTs(spikeAdv));
assert(spikeResult.length === 0, 'single negative spike in rising trend → filtered → 0 anchors');

// Falling then ONE positive minute then continues falling
const spikeFallAdv = [3000, 2400, 1800, 1200, 1800, 1200, 600, 0];
const spikeFallResult = scanMomentumShifts(makeTs(spikeFallAdv));
assert(spikeFallResult.length === 0, 'single positive spike in falling trend → filtered → 0 anchors');

// ── Magnitude filter ──────────────────────────────────────────────────────

console.log('\n── magnitude filter ──────────────────────────────────────────────────');

// Slopes exactly at threshold (200 up → -200 down): magnitude = 400, NOT > 400 → filtered
const atThreshold = [0, 200, 400, 600, 400, 200, 0];
// slopes: [200,200,200,-200,-200,-200], magnitude=400, check strictly >
const atResult = scanMomentumShifts(makeTs(atThreshold));
assert(atResult.length === 0, `|delta|=400 (= MIN_SLOPE_CHANGE ${_MIN_SLOPE_CHANGE}) not strictly > → filtered`);

// Slopes just over threshold (205 up → -205 down): magnitude = 410 > 400 → anchor
const overThreshold = [0, 205, 410, 615, 410, 205, 0];
const overResult = scanMomentumShifts(makeTs(overThreshold));
assert(overResult.length === 1, '|delta|=410 > MIN_SLOPE_CHANGE → 1 anchor');

// ── Minimum valid length ──────────────────────────────────────────────────

console.log('\n── minimum valid length ──────────────────────────────────────────────');

// Exactly minLen points with a clear V-shape through the middle
// minLen=5: gold needs [0, 600, 1200, 600, 0] → slopes [600,600,-600,-600]
// i ranges from 2 to 2 (inclusive): one candidate
const minVAdv = [0, 600, 1200, 600, 0];
const minVResult = scanMomentumShifts(makeTs(minVAdv));
assert(minVResult.length === 1, 'minLen points with clear V → 1 anchor');
assert(minVResult[0].minute === 2, 'minLen V: minute=2');
assert(minVResult[0].type === 'momentum_loss', 'minLen V: momentum_loss');

// ── Multiple shifts ───────────────────────────────────────────────────────

console.log('\n── multiple shifts in long curve ─────────────────────────────────────');

// Peak-then-valley shape with sustained runs on both sides of each reversal.
// slopes: [600,600,600,600,-600,-600,-600,-600,600,600,600]  (11 slopes, 12 gold points)
// Candidate i=4: before=[600,600], after=[-600,-600] → LOSS at gold[4].minute=4
// Candidate i=8: before=[-600,-600], after=[600,600]  → GAIN at gold[8].minute=8
const multiAdv = [0, 600, 1200, 1800, 2400, 1800, 1200, 600, 0, 600, 1200, 1800];
const multiResult = scanMomentumShifts(makeTs(multiAdv));

assert(multiResult.length === 2,                        'multi-shift: 2 anchors');
assert(multiResult[0].minute < multiResult[1].minute,  'multi-shift: ascending minute order');
assert(multiResult[0].type === 'momentum_loss',        'multi-shift: first=momentum_loss');
assert(multiResult[1].type === 'momentum_gain',        'multi-shift: second=momentum_gain');
assert(multiResult[0].minute === 4,                    'multi-shift: first at minute 4');
assert(multiResult[1].minute === 8,                    'multi-shift: second at minute 8');

// ── Three shifts ──────────────────────────────────────────────────────────

console.log('\n── three shifts ──────────────────────────────────────────────────────');

// slopes: [600,600,600,600,-600,-600,-600,-600,600,600,600,600,-600,-600,-600,-600]
// LOSS at gold[4], GAIN at gold[8], LOSS at gold[12]
const tripleAdv = [
  0, 600, 1200, 1800, 2400,
  1800, 1200, 600, 0,
  600, 1200, 1800, 2400,
  1800, 1200, 600, 0,
];
const tripleResult = scanMomentumShifts(makeTs(tripleAdv));

assert(tripleResult.length === 3, 'triple shifts → 3 anchors');
const types = tripleResult.map((a) => a.type);
assert(types[0] === 'momentum_loss', 'triple[0]=momentum_loss');
assert(types[1] === 'momentum_gain', 'triple[1]=momentum_gain');
assert(types[2] === 'momentum_loss', 'triple[2]=momentum_loss');
assert(tripleResult[0].minute === 4,  'triple[0] at minute 4');
assert(tripleResult[1].minute === 8,  'triple[1] at minute 8');
assert(tripleResult[2].minute === 12, 'triple[2] at minute 12');
assert(tripleResult[0].minute < tripleResult[1].minute && tripleResult[1].minute < tripleResult[2].minute,
  'triple: minutes strictly ascending');

// ── Slopes that only cross zero within FLAT_BAND ──────────────────────────

console.log('\n── flat-band neutral slopes → no anchor ─────────────────────────────');

// Slope goes from +600 to -50 (within FLAT_BAND): after-avg is flat → filtered
// slopes: [600, 600, -50, -50, 600, 600]
const toFlatAdv = [0, 600, 1200, 1150, 1100, 1700, 2300];
const toFlatResult = scanMomentumShifts(makeTs(toFlatAdv));
assert(toFlatResult.length === 0, 'reversal into FLAT_BAND (after avg neutral) → filtered');

// ── Anchor fields completeness ────────────────────────────────────────────

console.log('\n── anchor fields completeness ───────────────────────────────────────');

const anchor = vResult[0];
assert('minute'      in anchor, 'anchor has minute');
assert('type'        in anchor, 'anchor has type');
assert('slopeBefore' in anchor, 'anchor has slopeBefore');
assert('slopeAfter'  in anchor, 'anchor has slopeAfter');
assert('magnitude'   in anchor, 'anchor has magnitude');
assert('advAtShift'  in anchor, 'anchor has advAtShift');
// Exactly these 6 fields — no extra fields
assert(Object.keys(anchor).length === 6, 'anchor has exactly 6 fields');

// ── slopeBefore/slopeAfter are windowed averages ──────────────────────────

console.log('\n── slopeBefore/slopeAfter are windowed averages ─────────────────────');

// For a perfectly uniform V-shape: all before slopes = 600, all after slopes = -600
// So avgBefore = 600, avgAfter = -600 exactly
assert(vResult[0].slopeBefore === 600,  'uniform V: slopeBefore = 600 (avg of [600,600])');
assert(vResult[0].slopeAfter  === -600, 'uniform V: slopeAfter = -600 (avg of [-600,-600])');

// ── advAtShift is gold[i].adv, not gold[i-1] or gold[i+1] ────────────────

console.log('\n── advAtShift is the adv at the first minute of the new trend ───────');

// V-shape peak at minute 5: the reversal anchor is AT minute 5 (slopeAfter starts here)
// gold[5].adv = 3000 (confirmed above)
assert(vResult[0].advAtShift === vAdv[vResult[0].minute],
  'advAtShift matches gold[anchor.minute].adv');

// ── Summary ────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(60)}`);
console.log(`openDotaMomentumScanner: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
