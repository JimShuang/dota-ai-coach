// Run: node server/tests/anchorChain.test.js

'use strict';

// ── Decoupling verification ─────────────────────────────────────────────────
const fs   = require('fs');
const path = require('path');
const src  = fs.readFileSync(
  path.resolve(__dirname, '../anchorChain.js'),
  'utf8'
);

const {
  buildAnchorChain,
  deathToAnchor,
  momentumToAnchor,
  spikeToAnchor,
} = require('../anchorChain');

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

console.log('\n── decoupling: anchorChain.js does not import scanners ─────────────');

function hasRequire(source, moduleName) {
  return new RegExp(`require\\(['"][^'"]*${moduleName}[^'"]*['"]\\)`).test(source);
}

assert(!hasRequire(src, 'openDotaDeathDigest'),       'no require openDotaDeathDigest');
assert(!hasRequire(src, 'openDotaMomentumScanner'),   'no require openDotaMomentumScanner');
assert(!hasRequire(src, 'openDotaSpikeWindowScanner'), 'no require openDotaSpikeWindowScanner');
assert(!hasRequire(src, 'openDotaEventBuilder'),      'no require openDotaEventBuilder');
assert(!hasRequire(src, 'openDotaEconomyTimeseries'), 'no require openDotaEconomyTimeseries');

// ── Test data factories ────────────────────────────────────────────────────

function makeDeathEntry(gameTime, severity, snapOverrides) {
  return {
    id:         1,
    match_id:   'test',
    game_time:  gameTime,
    type:       'hero_death',
    severity:   severity || 'danger',
    message:    '死亡',
    snapshot:   snapOverrides || null,
    context:    { chainDeaths: [], killsNearby: [] },
  };
}

function makeMomentumShift(minute, type) {
  return {
    minute,
    type,        // 'momentum_loss' | 'momentum_gain'
    slopeBefore: type === 'momentum_loss' ? 600 : -600,
    slopeAfter:  type === 'momentum_loss' ? -600 : 600,
    magnitude:   1200,
    advAtShift:  2000,
  };
}

function makeSpikeDelta(myTime, type, bucket, delta, significant) {
  return {
    bucket,
    myItem:    'blink',
    myTime,
    enemyHero: 'Axe',
    enemyItem: 'blink',
    enemyTime: type === 'spike_deficit' ? myTime - delta : myTime + delta,
    delta:     type === 'spike_deficit' ? delta : -delta,
    type,
    significant: significant !== false,
  };
}

// ── deathToAnchor ──────────────────────────────────────────────────────────

console.log('\n── deathToAnchor: field mapping ─────────────────────────────────────');

const deathOD = makeDeathEntry(1500, 'danger', {
  source:      'opendota_import',
  killer:      '斧王（Axe）',
  deathNumber: 2,
});
const anchorDeathOD = deathToAnchor(deathOD);

assert(anchorDeathOD.gameTime === 1500,          'death OD: gameTime = 1500');
assert(anchorDeathOD.minute   === 25,            'death OD: minute = floor(1500/60) = 25');
assert(anchorDeathOD.kind     === 'death',       'death OD: kind = death');
assert(anchorDeathOD.type     === 'hero_death',  'death OD: type = hero_death');
assert(anchorDeathOD.severity === 'danger',      'death OD: severity = danger');
assert(typeof anchorDeathOD.summary === 'string', 'death OD: summary is string');
assert(anchorDeathOD.summary.includes('阵亡'),   'death OD: summary contains 阵亡');
assert(anchorDeathOD.summary.includes('斧王（Axe）'), 'death OD: summary contains killer');
assert(anchorDeathOD.summary.includes('2'),      'death OD: summary contains deathNumber');
assert(anchorDeathOD.detail === deathOD,         'death OD: detail is the original entry');

console.log('\n── deathToAnchor: summary templates ─────────────────────────────────');

// Full template: killer + deathNumber
const deathFull = makeDeathEntry(900, 'critical', { killer: '冥毒蛇（Viper）', deathNumber: 1 });
const anchorFull = deathToAnchor(deathFull);
assert(anchorFull.summary === '15:00 阵亡（冥毒蛇（Viper），第 1 次）',
  'death full template: killer + deathNumber');

// Only deathNumber (no killer — GSI deaths have deathsAtDeath)
const deathGSI = makeDeathEntry(660, 'critical', { deathsAtDeath: 3 });
const anchorGSI = deathToAnchor(deathGSI);
assert(anchorGSI.summary === '11:00 阵亡（第 3 次）',
  'death GSI: deathsAtDeath used as N, no killer');

// No snapshot data at all
const deathNoSnap = makeDeathEntry(300, 'danger', null);
const anchorNoSnap = deathToAnchor(deathNoSnap);
assert(anchorNoSnap.summary === '05:00 阵亡',
  'death no snapshot: fallback to plain summary');

// OD import death: only deathNumber, no killer (edge case)
const deathNumOnly = makeDeathEntry(600, 'danger', { deathNumber: 1 });
const anchorNumOnly = deathToAnchor(deathNumOnly);
assert(anchorNumOnly.summary === '10:00 阵亡（第 1 次）',
  'death deathNumber only: no killer fallback');

console.log('\n── deathToAnchor: negative gameTime ─────────────────────────────────');

// Pre-creep spawn: gameTime = -30 → -00:30
const deathNeg = makeDeathEntry(-30, 'danger', null);
const anchorNeg = deathToAnchor(deathNeg);
assert(anchorNeg.gameTime === -30,                'neg death: gameTime preserved');
assert(anchorNeg.minute   === Math.floor(-30/60), 'neg death: minute = floor(-30/60) = -1');
assert(anchorNeg.summary === '-00:30 阵亡',       'neg death: summary starts with -00:30');

// gameTime = -90 → -01:30
const deathNeg90 = makeDeathEntry(-90, 'danger', null);
assert(deathToAnchor(deathNeg90).summary === '-01:30 阵亡',
  'neg death -90s: summary -01:30');

console.log('\n── deathToAnchor: severity passthrough ──────────────────────────────');

const deathCrit = makeDeathEntry(100, 'critical', null);
assert(deathToAnchor(deathCrit).severity === 'critical', 'severity critical passthrough');
const deathInfo = makeDeathEntry(100, 'info', null);
assert(deathToAnchor(deathInfo).severity === 'info',     'severity info passthrough');

// ── momentumToAnchor ───────────────────────────────────────────────────────

console.log('\n── momentumToAnchor: field mapping ──────────────────────────────────');

const lossShift = makeMomentumShift(10, 'momentum_loss');
const anchorLoss = momentumToAnchor(lossShift);

assert(anchorLoss.gameTime === 600,          'momentum: gameTime = minute * 60 = 600');
assert(anchorLoss.minute   === 10,           'momentum: minute = 10');
assert(anchorLoss.kind     === 'momentum',   'momentum: kind = momentum');
assert(anchorLoss.type     === 'momentum_loss', 'momentum: type = momentum_loss');
assert(anchorLoss.severity === 'warning',    'momentum_loss: severity = warning');
assert(anchorLoss.summary  === '10:00 经济差由涨转跌（节奏丢失）',
  'momentum_loss: summary correct');
assert(anchorLoss.detail === lossShift,      'momentum: detail is original shift');

const gainShift = makeMomentumShift(15, 'momentum_gain');
const anchorGain = momentumToAnchor(gainShift);

assert(anchorGain.gameTime === 900,          'momentum_gain: gameTime = 900');
assert(anchorGain.severity === 'success',    'momentum_gain: severity = success');
assert(anchorGain.summary  === '15:00 经济差由跌转涨（夺回节奏）',
  'momentum_gain: summary correct');

// minute=0 → 00:00
const zeroShift = makeMomentumShift(0, 'momentum_gain');
assert(momentumToAnchor(zeroShift).gameTime === 0,        'minute=0: gameTime=0');
assert(momentumToAnchor(zeroShift).summary === '00:00 经济差由跌转涨（夺回节奏）',
  'minute=0: summary starts 00:00');

// ── spikeToAnchor ─────────────────────────────────────────────────────────

console.log('\n── spikeToAnchor: field mapping ─────────────────────────────────────');

const defSig = makeSpikeDelta(1800, 'spike_deficit', 'survivability', 300, true);
const anchorDefSig = spikeToAnchor(defSig);

assert(anchorDefSig.gameTime === 1800,            'spike: gameTime = myTime');
assert(anchorDefSig.minute   === 30,              'spike: minute = floor(1800/60)');
assert(anchorDefSig.kind     === 'spike',         'spike: kind = spike');
assert(anchorDefSig.type     === 'spike_deficit', 'spike: type = spike_deficit');
assert(anchorDefSig.severity === 'warning',       'spike deficit+significant: severity=warning');
assert(anchorDefSig.summary.includes('生存'),     'spike survivability: bucket 中文=生存');
assert(anchorDefSig.summary.includes('落后'),     'spike deficit: summary contains 落后');
assert(anchorDefSig.summary.includes('05:00'),    'spike deficit: |300s|=05:00 in summary');
assert(anchorDefSig.detail === defSig,            'spike: detail is original delta');

// spike_deficit not significant → info
const defNotSig = makeSpikeDelta(1200, 'spike_deficit', 'damage', 60, false);
const anchorDefNotSig = spikeToAnchor(defNotSig);
assert(anchorDefNotSig.severity === 'info',
  'spike deficit not-significant: severity=info');
assert(anchorDefNotSig.summary.includes('爆发'),  'spike damage: bucket 中文=爆发');

// spike_lead → success
const leadDelta = makeSpikeDelta(900, 'spike_lead', 'initiation', 180, true);
const anchorLead = spikeToAnchor(leadDelta);
assert(anchorLead.severity === 'success',         'spike_lead: severity=success');
assert(anchorLead.summary.includes('先手'),       'spike initiation: bucket 中文=先手');
assert(anchorLead.summary.includes('领先'),       'spike lead: summary contains 领先');
assert(anchorLead.summary.includes('03:00'),      'spike lead: |180s|=03:00 in summary');

console.log('\n── spikeToAnchor: all bucket Chinese names ──────────────────────────');

const bucketMap = {
  survivability: '生存',
  initiation:    '先手',
  farming:       '刷钱',
  damage:        '爆发',
  control:       '控制',
  support:       '团队',
};

for (const [bucket, zh] of Object.entries(bucketMap)) {
  const d = makeSpikeDelta(600, 'spike_lead', bucket, 60, false);
  const a = spikeToAnchor(d);
  assert(a.summary.includes(zh), `bucket ${bucket} → summary contains ${zh}`);
}

// ── buildAnchorChain: sorting and merge ───────────────────────────────────

console.log('\n── buildAnchorChain: gameTime ascending ─────────────────────────────');

const deaths  = [makeDeathEntry(600, 'danger', null), makeDeathEntry(1200, 'danger', null)];
const shifts  = [makeMomentumShift(10, 'momentum_loss')];   // gameTime=600
const deltas  = [makeSpikeDelta(900, 'spike_lead', 'initiation', 60, false)]; // gameTime=900

const chain = buildAnchorChain({ deaths, momentumShifts: shifts, spikeDeltas: deltas });

assert(chain.length === 4, 'merge: 4 anchors total');

const gameTimes = chain.map((a) => a.gameTime);
for (let i = 1; i < gameTimes.length; i++) {
  assert(gameTimes[i] >= gameTimes[i - 1], `sort: gameTimes[${i}] >= gameTimes[${i - 1}]`);
}

console.log('\n── buildAnchorChain: tie-break death > spike > momentum ─────────────');

// Construct entries all at the same gameTime (600 s = minute 10).
const tieDeaths   = [makeDeathEntry(600, 'danger', null)];
const tieShifts   = [makeMomentumShift(10, 'momentum_loss')];        // gameTime = 10*60 = 600
const tieDeltas   = [makeSpikeDelta(600, 'spike_deficit', 'control', 50, false)]; // gameTime=600

const tieChain = buildAnchorChain({ deaths: tieDeaths, momentumShifts: tieShifts, spikeDeltas: tieDeltas });

assert(tieChain.length === 3,              'tie-break: 3 anchors');
assert(tieChain[0].kind === 'death',       'tie-break: death first');
assert(tieChain[1].kind === 'spike',       'tie-break: spike second');
assert(tieChain[2].kind === 'momentum',    'tie-break: momentum last');
assert(tieChain.every((a) => a.gameTime === 600), 'tie-break: all gameTime=600');

console.log('\n── buildAnchorChain: partial / empty inputs ─────────────────────────');

// All empty
assert(buildAnchorChain({}).length === 0,                              'empty inputs → []');
assert(buildAnchorChain({ deaths: [] }).length === 0,                  'only deaths=[] → []');
assert(buildAnchorChain({ momentumShifts: [] }).length === 0,          'only shifts=[] → []');
assert(buildAnchorChain({ spikeDeltas: [] }).length === 0,             'only deltas=[] → []');

// Called with no argument at all (default parameter)
assert(buildAnchorChain().length === 0,                                'no argument → []');

// Only deaths
const onlyDeaths = buildAnchorChain({ deaths: [makeDeathEntry(300, 'danger', null)] });
assert(onlyDeaths.length === 1,                'only deaths: 1 anchor');
assert(onlyDeaths[0].kind === 'death',         'only deaths: kind=death');

// Only momentum
const onlyMom = buildAnchorChain({ momentumShifts: [makeMomentumShift(5, 'momentum_gain')] });
assert(onlyMom.length === 1,                   'only momentum: 1 anchor');
assert(onlyMom[0].kind === 'momentum',         'only momentum: kind=momentum');

// Only spikes
const onlySpikes = buildAnchorChain({ spikeDeltas: [makeSpikeDelta(700, 'spike_lead', 'farming', 100, false)] });
assert(onlySpikes.length === 1,                'only spikes: 1 anchor');
assert(onlySpikes[0].kind === 'spike',         'only spikes: kind=spike');

console.log('\n── buildAnchorChain: anchor shape (7 fields) ────────────────────────');

const sampleChain = buildAnchorChain({
  deaths: [makeDeathEntry(400, 'danger', { killer: 'Axe', deathNumber: 1 })],
});
const a = sampleChain[0];
assert('gameTime'  in a, 'shape: gameTime');
assert('minute'    in a, 'shape: minute');
assert('kind'      in a, 'shape: kind');
assert('type'      in a, 'shape: type');
assert('severity'  in a, 'shape: severity');
assert('summary'   in a, 'shape: summary');
assert('detail'    in a, 'shape: detail');
assert(Object.keys(a).length === 7, 'shape: exactly 7 fields');

console.log('\n── buildAnchorChain: multi-type ascending with no ties ──────────────');

// Verify precise ordering with non-tied gameTime values.
const mixedDeaths  = [makeDeathEntry(1800, 'danger', null)];
const mixedShifts  = [makeMomentumShift(20, 'momentum_loss')];  // gameTime=1200
const mixedDeltas  = [makeSpikeDelta(600, 'spike_deficit', 'support', 90, false)]; // gameTime=600

const mixedChain = buildAnchorChain({ deaths: mixedDeaths, momentumShifts: mixedShifts, spikeDeltas: mixedDeltas });

assert(mixedChain.length === 3,                       'mixed: 3 anchors');
assert(mixedChain[0].gameTime === 600,                'mixed: first at 600');
assert(mixedChain[0].kind     === 'spike',            'mixed: first is spike');
assert(mixedChain[1].gameTime === 1200,               'mixed: second at 1200');
assert(mixedChain[1].kind     === 'momentum',         'mixed: second is momentum');
assert(mixedChain[2].gameTime === 1800,               'mixed: third at 1800');
assert(mixedChain[2].kind     === 'death',            'mixed: third is death');

// ── Summary ────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(60)}`);
console.log(`anchorChain: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
