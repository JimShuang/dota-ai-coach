// Run: node server/tests/matchImporter.test.js

const {
  opendotaKeyToItemName,
  buildKeyItemTimings,
  computeGrade,
  computeOneThingToImprove,
} = require('../matchImporter');

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

// ── opendotaKeyToItemName ─────────────────────────────────────────────────

console.log('\n── opendotaKeyToItemName ────────────────────────────────────────────');

assert(opendotaKeyToItemName('blink')            === 'item_blink',             'blink → item_blink');
assert(opendotaKeyToItemName('vanguard')         === 'item_vanguard',          'vanguard → item_vanguard');
assert(opendotaKeyToItemName('black_king_bar')   === 'item_black_king_bar',    'black_king_bar → item_black_king_bar');
assert(opendotaKeyToItemName('ultimate_scepter') === 'item_aghanims_scepter',  'ultimate_scepter → item_aghanims_scepter (override)');
assert(opendotaKeyToItemName('aghanims_scepter') === 'item_aghanims_scepter',  'aghanims_scepter → item_aghanims_scepter (override)');
assert(opendotaKeyToItemName('pipe')             === 'item_pipe',              'pipe → item_pipe');
assert(opendotaKeyToItemName('guardian_greaves') === 'item_guardian_greaves',  'guardian_greaves → item_guardian_greaves');
assert(opendotaKeyToItemName('force_staff')      === 'item_force_staff',       'force_staff → item_force_staff');
assert(opendotaKeyToItemName('kaya_and_sange')   === 'item_kaya_and_sange',    'kaya_and_sange → item_kaya_and_sange');
assert(opendotaKeyToItemName('tpscroll')         === 'item_tpscroll',          'tpscroll → item_tpscroll (fallback prefix)');

// ── buildKeyItemTimings ───────────────────────────────────────────────────

console.log('\n── buildKeyItemTimings ──────────────────────────────────────────────');

const CENTAUR_PROFILE = {
  keyItems:       ['item_vanguard', 'item_blink', 'item_pipe', 'item_crimson_guard'],
  powerSpikeItems: ['item_blink'],
};

const PURCHASE_LOG = [
  { time: 100, key: 'magic_stick' },
  { time: 540, key: 'vanguard' },
  { time: 900, key: 'blink' },
  { time: 900, key: 'blink' },     // duplicate — should only record first
  { time: 1800, key: 'tpscroll' },
];

const timings = buildKeyItemTimings('test_001', PURCHASE_LOG, CENTAUR_PROFILE);

assert(timings.length === 4,                               '4 timings for 4 key items');
assert(timings[0].item_name === 'item_vanguard',           'first timing is Vanguard');
assert(timings[0].completed === 1,                        'Vanguard completed');
assert(timings[0].completed_time === 540,                  'Vanguard completed at t=540');
assert(timings[0].deaths_before_completion === 0,          'deaths_before_completion = 0 (no death data)');
assert(timings[0].power_spike_used === 0,                  'Vanguard not a power spike item → power_spike_used=0');

assert(timings[1].item_name === 'item_blink',              'second timing is Blink');
assert(timings[1].completed === 1,                        'Blink completed');
assert(timings[1].completed_time === 900,                  'Blink completed at t=900 (first occurrence)');
assert(timings[1].power_spike_used === 1,                  'Blink is power spike item → power_spike_used=1');

assert(timings[2].item_name === 'item_pipe',               'third timing is Pipe');
assert(timings[2].completed === 0,                        'Pipe not completed');
assert(timings[2].completed_time === null,                  'Pipe completed_time is null');
assert(timings[2].power_spike_used === 0,                  'Pipe not completed → power_spike_used=0');

assert(timings[3].item_name === 'item_crimson_guard',      'fourth timing is Crimson Guard');
assert(timings[3].completed === 0,                        'Crimson Guard not completed');

// ── computeGrade ──────────────────────────────────────────────────────────

console.log('\n── computeGrade ─────────────────────────────────────────────────────');

assert(computeGrade(0, 550, 8, 12)  === '优秀', '0 deaths + 550gpm + high KDA → 优秀');
assert(computeGrade(2, 450, 4, 8)   === '优秀', '2 deaths + 450gpm + 4 KDA → 优秀');
assert(computeGrade(3, 410, 2, 5)   === '良好', '3 deaths + 410gpm + moderate KDA → 良好');
assert(computeGrade(5, 380, 1, 4)   === '一般', '5 deaths + 380gpm + low KDA → 一般');
assert(computeGrade(7, 290, 1, 2)   === '需改进', '7 deaths + 290gpm + bad KDA → 需改进');
assert(computeGrade(10, 250, 0, 1)  === '需改进', '10 deaths + 250gpm + terrible KDA → 需改进');
assert(computeGrade(0, 0, 0, 0)     === '一般',  '0/0/0 (laning only, no farm) → 一般');

// ── computeOneThingToImprove ──────────────────────────────────────────────

console.log('\n── computeOneThingToImprove ─────────────────────────────────────────');

const timingsCompleted = [{ completed: 1, completed_time: 500 }];
const timingsLate      = [{ completed: 1, completed_time: 2400 }];  // 40min+ in a 60min game
const timingsNone      = [{ completed: 0, completed_time: null }];

// High deaths
const highDeaths = computeOneThingToImprove(12, 400, 3, 5, timingsCompleted, 2400);
assert(highDeaths.includes('12 次'), 'high deaths mentions death count');

// Medium deaths
const medDeaths = computeOneThingToImprove(7, 380, 2, 4, timingsCompleted, 2400);
assert(medDeaths.includes('死亡偏多'), 'medium deaths → 死亡偏多');

// Low GPM
const lowGpm = computeOneThingToImprove(3, 280, 1, 3, timingsCompleted, 2400);
assert(lowGpm.includes('经济收入偏低'), 'low gpm → 经济收入偏低');

// Late key item (completed at 2400 out of 4000 = 60%)
const lateItem = computeOneThingToImprove(3, 400, 2, 6, timingsLate, 4000);
assert(lateItem.includes('分钟'), 'late key item → mentions minutes');

// Low KDA
const lowKda = computeOneThingToImprove(3, 420, 0, 1, timingsCompleted, 2400);
assert(lowKda.includes('参团'), 'low KDA → 参团 suggestion');

// Good performance
const good = computeOneThingToImprove(2, 450, 5, 8, timingsCompleted, 2400);
assert(good.includes('整体发挥稳定'), 'good performance → 整体发挥稳定');

// ── Summary ────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(55)}`);
console.log(`Results: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
