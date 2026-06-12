// Run: node server/tests/openDotaKeyItemAnalyzer.test.js

const { analyzeKeyItemTimings, buildPurchaseMap } = require('../openDotaKeyItemAnalyzer');

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

// ── Hero profiles used in tests ────────────────────────────────────────────

const CENTAUR_PROFILE = {
  keyItems:        ['item_vanguard', 'item_blink', 'item_pipe', 'item_crimson_guard'],
  powerSpikeItems: ['item_blink'],
};

const VIPER_PROFILE = {
  keyItems:        ['item_hood_of_defiance', 'item_aghanims_scepter', 'item_pipe', 'item_rod_of_atos'],
  powerSpikeItems: ['item_aghanims_scepter'],
};

const EMPTY_PROFILE = { keyItems: [], powerSpikeItems: [] };

// ── Purchase logs ──────────────────────────────────────────────────────────

const PURCHASE_LOG_CENTAUR = [
  { time: 100, key: 'magic_stick' },
  { time: 540, key: 'vanguard' },
  { time: 900, key: 'blink' },
  { time: 900, key: 'blink' },     // duplicate — only first counts
  { time: 1800, key: 'tpscroll' },
  // pipe and crimson_guard NOT bought
];

const PURCHASE_LOG_VIPER_FULL = [
  { time: 480, key: 'hood_of_defiance' },
  { time: 1200, key: 'ultimate_scepter' }, // → item_aghanims_scepter
  { time: 2000, key: 'pipe' },
  { time: 2800, key: 'rod_of_atos' },
];

// ── buildPurchaseMap ───────────────────────────────────────────────────────

console.log('\n── buildPurchaseMap ──────────────────────────────────────────────────');

const map1 = buildPurchaseMap(PURCHASE_LOG_CENTAUR);
assert(map1.get('item_vanguard') === 540, 'vanguard purchase time = 540');
assert(map1.get('item_blink')    === 900, 'blink first purchase time = 900 (duplicate ignored)');
assert(map1.get('item_tpscroll') === 1800,'tpscroll time = 1800');
assert(!map1.has('item_pipe'),            'pipe not in map (not purchased)');

const mapEmpty = buildPurchaseMap([]);
assert(mapEmpty.size === 0, 'empty purchase_log → empty map');

const mapNull = buildPurchaseMap(null);
assert(mapNull.size === 0, 'null purchase_log → empty map');

// ultimate_scepter key remapped correctly
const mapViper = buildPurchaseMap(PURCHASE_LOG_VIPER_FULL);
assert(mapViper.get('item_aghanims_scepter') === 1200, 'ultimate_scepter → item_aghanims_scepter');
assert(mapViper.get('item_pipe')             === 2000, 'pipe time = 2000');
assert(mapViper.get('item_rod_of_atos')      === 2800, 'rod_of_atos time = 2800');

// ── analyzeKeyItemTimings: no profile ─────────────────────────────────────

console.log('\n── analyzeKeyItemTimings: no profile / no key items ─────────────────');

const r0 = analyzeKeyItemTimings('test_od0', { purchase_log: PURCHASE_LOG_CENTAUR }, null);
assert(r0.available       === true,  'null profile → available = true (nothing to analyze)');
assert(r0.timings.length  === 0,     'null profile → 0 timings');

const r0b = analyzeKeyItemTimings('test_od0b', { purchase_log: PURCHASE_LOG_CENTAUR }, EMPTY_PROFILE);
assert(r0b.available      === true,  'empty keyItems → available = true');
assert(r0b.timings.length === 0,     'empty keyItems → 0 timings');

// ── analyzeKeyItemTimings: missing purchase_log → unavailable ─────────────

console.log('\n── analyzeKeyItemTimings: missing / empty purchase_log ──────────────');

const rMissing = analyzeKeyItemTimings('test_od1', { purchase_log: null }, CENTAUR_PROFILE);
assert(rMissing.available       === false, 'null purchase_log → available = false');
assert(rMissing.timings.length  === 0,     'null purchase_log → empty timings');

const rEmpty = analyzeKeyItemTimings('test_od1e', { purchase_log: [] }, CENTAUR_PROFILE);
assert(rEmpty.available         === false, 'empty purchase_log → available = false');

// ── analyzeKeyItemTimings: partial completion (Centaur) ───────────────────

console.log('\n── analyzeKeyItemTimings: partial completion (Centaur) ──────────────');

const rC = analyzeKeyItemTimings('test_od2', { purchase_log: PURCHASE_LOG_CENTAUR }, CENTAUR_PROFILE);
assert(rC.available       === true,   'purchase_log present → available = true');
assert(rC.timings.length  === 4,      '4 key items → 4 timing rows');

const vanguard = rC.timings.find(t => t.item_name === 'item_vanguard');
assert(vanguard.completed       === 1,   'vanguard completed = 1');
assert(vanguard.completed_time  === 540, 'vanguard completed_time = 540');
assert(vanguard.deaths_before_completion === 0, 'deaths_before_completion = 0 (not available)');
assert(vanguard.power_spike_used === 0,  'vanguard not a spike item → power_spike_used = 0');
assert(vanguard.match_id         === 'test_od2', 'match_id stored in timing row');

const blink = rC.timings.find(t => t.item_name === 'item_blink');
assert(blink.completed        === 1,    'blink completed = 1');
assert(blink.completed_time   === 900,  'blink completed_time = 900');
assert(blink.power_spike_used === null, 'blink is spike item + completed → power_spike_used = null (unavailable)');

const pipe = rC.timings.find(t => t.item_name === 'item_pipe');
assert(pipe.completed         === 0,    'pipe not completed = 0');
assert(pipe.completed_time    === null, 'pipe completed_time = null');
assert(pipe.power_spike_used  === 0,    'pipe not completed → power_spike_used = 0');

const crimson = rC.timings.find(t => t.item_name === 'item_crimson_guard');
assert(crimson.completed      === 0,    'crimson_guard not completed');
assert(crimson.power_spike_used === 0,  'non-spike + not completed → 0');

// ── analyzeKeyItemTimings: full completion (Viper) ────────────────────────

console.log('\n── analyzeKeyItemTimings: full completion (Viper) ───────────────────');

const rV = analyzeKeyItemTimings('test_od3', { purchase_log: PURCHASE_LOG_VIPER_FULL }, VIPER_PROFILE);
assert(rV.available      === true, 'viper with full purchase_log → available');
assert(rV.timings.length === 4,    '4 timings');

const hood = rV.timings.find(t => t.item_name === 'item_hood_of_defiance');
assert(hood.completed        === 1,   'hood completed');
assert(hood.completed_time   === 480, 'hood at 480s');
assert(hood.power_spike_used === 0,   'hood not a spike item → 0');

const ags = rV.timings.find(t => t.item_name === 'item_aghanims_scepter');
assert(ags.completed        === 1,    'aghs completed');
assert(ags.completed_time   === 1200, 'aghs at 1200s (via ultimate_scepter key)');
assert(ags.power_spike_used === null, 'aghs is spike item + completed → null');

// ── timing row shape completeness ─────────────────────────────────────────

console.log('\n── timing row field completeness ────────────────────────────────────');

const anyRow = rC.timings[0];
assert('match_id'                 in anyRow, 'row has match_id');
assert('item_name'                in anyRow, 'row has item_name');
assert('completed'                in anyRow, 'row has completed');
assert('completed_time'           in anyRow, 'row has completed_time');
assert('deaths_before_completion' in anyRow, 'row has deaths_before_completion');
assert('power_spike_used'         in anyRow, 'row has power_spike_used');

// ── Summary ────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(55)}`);
console.log(`Results: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
