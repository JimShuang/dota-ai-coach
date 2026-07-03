// Run: node server/tests/anchorLinker.test.js

'use strict';

// ── Decoupling verification ─────────────────────────────────────────────────
const fs   = require('fs');
const path = require('path');
const src  = fs.readFileSync(
  path.resolve(__dirname, '../anchorLinker.js'),
  'utf8'
);

const { isLethalDeath, scoreA1, ruleA1, GAP_THRESHOLD, scoreA2, ruleA2, A2_MAX_GAP } = require('../anchorLinker');

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

console.log('\n── decoupling: anchorLinker.js does not import scanners ─────────────');

function hasRequire(source, moduleName) {
  return new RegExp(`require\\(['"][^'"]*${moduleName}[^'"]*['"]\\)`).test(source);
}

assert(!hasRequire(src, 'openDotaDeathDigest'),        'no require openDotaDeathDigest');
assert(!hasRequire(src, 'openDotaMomentumScanner'),    'no require openDotaMomentumScanner');
assert(!hasRequire(src, 'openDotaSpikeWindowScanner'), 'no require openDotaSpikeWindowScanner');
assert(!hasRequire(src, 'openDotaEventBuilder'),       'no require openDotaEventBuilder');
assert(!hasRequire(src, 'openDotaEconomyTimeseries'),  'no require openDotaEconomyTimeseries');
assert(!hasRequire(src, 'anchorChain'),                'no require anchorChain');

// ── Test data factories ────────────────────────────────────────────────────

function makeDeathAnchor({ severity = 'danger', context = null, gameTime = 1000 } = {}) {
  return {
    gameTime,
    minute:   Math.floor(gameTime / 60),
    kind:     'death',
    type:     'hero_death',
    severity,
    summary:  'xx:xx 阵亡',
    detail:   {
      game_time: gameTime,
      type:      'hero_death',
      severity,
      snapshot:  { source: 'opendota_import', deathNumber: 1 },
      context,
    },
  };
}

function makeContext({ chainDeaths = [], economy = null, diedWithBuyback = null } = {}) {
  return {
    windowStart:       995,
    windowEnd:         1060,
    chainDeaths,
    killsNearby:       [],
    objectivesLost:    [],
    objectivesGained:  [],
    diedWithBuyback,
    majorObjectiveLost: false,
    economy: economy !== undefined ? economy : { available: false, minuteAtDeath: null,
      advBefore: null, advAfter: null, delta: null, significant: false },
  };
}

function makeSpikeAnchor({
  gameTime = 1100, type = 'spike_deficit', bucket = 'survivability',
  myItem = 'black_king_bar', enemyItem = 'black_king_bar', enemyHero = '半人马战行者（Centaur Warrunner）',
  enemyTime = 900, delta = 200, significant = true,
} = {}) {
  return {
    gameTime,
    minute:   Math.floor(gameTime / 60),
    kind:     'spike',
    type,
    severity: type === 'spike_deficit' ? 'warning' : 'success',
    summary:  'xx:xx 生存 强势期落后敌方 xx:xx',
    detail:   { bucket, myItem, myTime: gameTime, enemyHero, enemyItem, enemyTime, delta, type, significant },
  };
}

function makeMomentumAnchor({ gameTime = 1020, type = 'momentum_loss', slopeAfter = -500, magnitude = 1100 } = {}) {
  return {
    gameTime,
    minute:   Math.floor(gameTime / 60),
    kind:     'momentum',
    type,
    severity: type === 'momentum_loss' ? 'warning' : 'success',
    summary:  'xx:xx 经济差由涨转跌',
    detail:   { minute: Math.floor(gameTime / 60), type, slopeBefore: 500, slopeAfter, magnitude, advAtShift: 2000 },
  };
}

// ── isLethalDeath ──────────────────────────────────────────────────────────

console.log('\n── isLethalDeath: chainDeaths signal ────────────────────────────────');

const anchorChainDeath = makeDeathAnchor({
  context: makeContext({ chainDeaths: [{ game_time: 1005, message: '队友死亡', snapshot: null }] }),
});
assert(isLethalDeath(anchorChainDeath) === true,
  'chainDeaths non-empty → lethal');

const anchorEmptyChain = makeDeathAnchor({
  context: makeContext({ chainDeaths: [] }),
});
assert(isLethalDeath(anchorEmptyChain) === false,
  'chainDeaths empty, no other signal → not lethal');

console.log('\n── isLethalDeath: economy signal ─────────────────────────────────────');

const anchorEconSignificant = makeDeathAnchor({
  context: makeContext({
    economy: { available: true, minuteAtDeath: 16, advBefore: 1500, advAfter: 200, delta: -1300, significant: true },
  }),
});
assert(isLethalDeath(anchorEconSignificant) === true,
  'economy.available && economy.significant → lethal');

// available=false even if significant truthy → does NOT trigger
const anchorEconNotAvail = makeDeathAnchor({
  context: makeContext({
    economy: { available: false, minuteAtDeath: null, advBefore: null, advAfter: null, delta: null, significant: true },
  }),
});
assert(isLethalDeath(anchorEconNotAvail) === false,
  'economy.available=false, significant=true → not lethal (available gate must pass)');

// available=true but significant=false → does NOT trigger
const anchorEconNotSig = makeDeathAnchor({
  context: makeContext({
    economy: { available: true, minuteAtDeath: 10, advBefore: 500, advAfter: 450, delta: -50, significant: false },
  }),
});
assert(isLethalDeath(anchorEconNotSig) === false,
  'economy.available=true, significant=false → not lethal');

console.log('\n── isLethalDeath: no context / null context ─────────────────────────');

const anchorNoContext = makeDeathAnchor({ context: null });
assert(isLethalDeath(anchorNoContext) === false,
  'context=null → not lethal');

const anchorNoDetail = { kind: 'death', severity: 'danger', detail: null };
assert(isLethalDeath(anchorNoDetail) === false,
  'detail=null → not lethal');

const anchorMissingCtx = makeDeathAnchor({ context: undefined });
// context: undefined collapses to null in makeDeathAnchor
assert(isLethalDeath(anchorMissingCtx) === false,
  'context omitted → not lethal');

console.log('\n── isLethalDeath: GSI critical severity ─────────────────────────────');

const anchorCritical = makeDeathAnchor({ severity: 'critical', context: makeContext() });
assert(isLethalDeath(anchorCritical) === true,
  'severity=critical (GSI) → lethal regardless of context signals');

// critical severity but no context at all — still true
const anchorCriticalNoCtx = makeDeathAnchor({ severity: 'critical', context: null });
assert(isLethalDeath(anchorCriticalNoCtx) === false,
  'severity=critical but context=null → false (ctx guard fires first)');

// Plain danger with no signals → not lethal
const anchorPlainDanger = makeDeathAnchor({ severity: 'danger', context: makeContext() });
assert(isLethalDeath(anchorPlainDanger) === false,
  'danger + empty context → not lethal');

// ── scoreA1 ───────────────────────────────────────────────────────────────

console.log('\n── scoreA1: OD import deaths can now reach strong ───────────────────');

// KEY: danger (OD import) + near gap + chainDeaths → STRONG
// This is the core value of the refactor: OD imports can now reach 'strong'.
const anchorChainNear = makeDeathAnchor({
  context: makeContext({ chainDeaths: [{ game_time: 1005, message: 'x', snapshot: null }] }),
});
assert(scoreA1(anchorChainNear, 30) === 'strong',
  'danger + near (30s) + chainDeaths non-empty → strong');

assert(scoreA1(anchorChainNear, 45) === 'strong',
  'danger + near (45s, boundary) + chainDeaths → strong');

console.log('\n── scoreA1: near but not lethal → medium ─────────────────────────────');

const anchorNearNoLethal = makeDeathAnchor({ context: makeContext() });
assert(scoreA1(anchorNearNoLethal, 20) === 'medium',
  'danger + near (20s) + no lethal signals → medium');

assert(scoreA1(anchorNearNoLethal, 45) === 'medium',
  'danger + near (45s, boundary) + no lethal signals → medium');

// Just past near boundary → weak (if not lethal)
assert(scoreA1(anchorNearNoLethal, 46) === 'weak',
  'danger + gap=46 (just past near) + no lethal signals → weak');

console.log('\n── scoreA1: lethal but not near → medium ─────────────────────────────');

const anchorLethalNotNear = makeDeathAnchor({
  context: makeContext({
    economy: { available: true, minuteAtDeath: 20, advBefore: 2000, advAfter: 500, delta: -1500, significant: true },
  }),
});
assert(scoreA1(anchorLethalNotNear, 120) === 'medium',
  'danger + gap=120 (not near) + economy.significant → medium (lethal alone gives medium)');

assert(scoreA1(anchorLethalNotNear, 299) === 'medium',
  'danger + gap=299 (not near) + lethal → medium');

console.log('\n── scoreA1: neither near nor lethal → weak ───────────────────────────');

assert(scoreA1(anchorNearNoLethal, 60) === 'weak',
  'danger + gap=60 + no lethal signals → weak');

assert(scoreA1(anchorNearNoLethal, 300) === 'weak',
  'danger + gap=300 + no lethal signals → weak');

console.log('\n── scoreA1: critical (GSI) + near → strong ──────────────────────────');

// GSI compat: critical + near still gives strong (via isLethalDeath returning true)
const anchorCriticalCtx = makeDeathAnchor({ severity: 'critical', context: makeContext() });
assert(scoreA1(anchorCriticalCtx, 10) === 'strong',
  'critical (GSI) + near (10s) → strong');

// critical but not near → medium
assert(scoreA1(anchorCriticalCtx, 100) === 'medium',
  'critical (GSI) + gap=100 (not near) → medium');

// ── ruleA1: gate checks ────────────────────────────────────────────────────

console.log('\n── ruleA1: gate 1 — anchorA must be a death ─────────────────────────');

const notDeath = { kind: 'momentum', type: 'momentum_loss', gameTime: 900, detail: { slopeAfter: -400, magnitude: 900 } };
const momentumB = makeMomentumAnchor({ gameTime: 1020 });
assert(ruleA1(notDeath, momentumB) === null,
  'gate 1: anchorA.kind !== death → null');

console.log('\n── ruleA1: gate 2 — anchorB must be a momentum_loss ─────────────────');

const deathA = makeDeathAnchor({ gameTime: 1000, context: makeContext() });
const momentumGain = makeMomentumAnchor({ gameTime: 1020, type: 'momentum_gain' });
assert(ruleA1(deathA, momentumGain) === null,
  'gate 2: anchorB.type = momentum_gain → null');

const notMomentum = makeDeathAnchor({ gameTime: 1020, context: makeContext() });
assert(ruleA1(deathA, notMomentum) === null,
  'gate 2: anchorB.kind = death (not momentum) → null');

console.log('\n── ruleA1: gate 3 — gap must be in [0, GAP_THRESHOLD] ───────────────');

// B before A (negative gap)
const momentumBefore = makeMomentumAnchor({ gameTime: 900 }); // before deathA at 1000
assert(ruleA1(deathA, momentumBefore) === null,
  'gate 3: B before A (negative gap) → null');

// Gap exactly at threshold → valid
const momentumAtLimit = makeMomentumAnchor({ gameTime: 1000 + GAP_THRESHOLD });
const linkAtLimit = ruleA1(deathA, momentumAtLimit);
assert(linkAtLimit !== null,
  `gate 3: gap = GAP_THRESHOLD (${GAP_THRESHOLD}s) → valid link`);

// Gap one second over → invalid
const momentumOver = makeMomentumAnchor({ gameTime: 1000 + GAP_THRESHOLD + 1 });
assert(ruleA1(deathA, momentumOver) === null,
  'gate 3: gap > GAP_THRESHOLD → null');

// ── ruleA1: returned link shape ────────────────────────────────────────────

console.log('\n── ruleA1: link shape and basic fields ──────────────────────────────');

const linkBasic = ruleA1(deathA, momentumB);
assert(linkBasic !== null,                    'basic link: not null');
assert(linkBasic.rule === 'A1',               'basic link: rule = A1');
assert(Array.isArray(linkBasic.anchors),      'basic link: anchors is array');
assert(linkBasic.anchors[0] === deathA,       'basic link: anchors[0] is deathA');
assert(linkBasic.anchors[1] === momentumB,    'basic link: anchors[1] is momentumB');
assert(typeof linkBasic.score === 'string',   'basic link: score is string');
assert(['strong', 'medium', 'weak'].includes(linkBasic.score),
  'basic link: score is one of strong/medium/weak');

console.log('\n── ruleA1: evidence fields ───────────────────────────────────────────');

// Death with no lethal signals — plain danger
const evidBasic = linkBasic.evidence;
assert(typeof evidBasic.gap_seconds === 'number',      'evidence: gap_seconds is number');
assert(evidBasic.gap_seconds === 20,                   'evidence: gap_seconds = 1020 - 1000 = 20');
assert(evidBasic.death_severity === 'danger',          'evidence: death_severity = danger');
assert(evidBasic.chain_deaths === 0,                   'evidence: chain_deaths = 0 (empty context)');
assert(evidBasic.economy_significant === false,        'evidence: economy_significant = false');
assert(evidBasic.lethal === false,                     'evidence: lethal = false (no signals)');
assert(evidBasic.slope_after === momentumB.detail.slopeAfter, 'evidence: slope_after from momentumB.detail');
assert(evidBasic.magnitude   === momentumB.detail.magnitude,  'evidence: magnitude from momentumB.detail');

console.log('\n── ruleA1: evidence with chainDeaths signal ─────────────────────────');

const deathChain = makeDeathAnchor({
  gameTime: 1000,
  context:  makeContext({ chainDeaths: [
    { game_time: 1003, message: 'x', snapshot: null },
    { game_time: 1008, message: 'y', snapshot: null },
  ]}),
});
const linkChain = ruleA1(deathChain, momentumB);
assert(linkChain !== null,                               'chain link: not null');
assert(linkChain.evidence.chain_deaths === 2,            'evidence: chain_deaths = 2');
assert(linkChain.evidence.economy_significant === false, 'evidence: economy_significant = false');
assert(linkChain.evidence.lethal === true,               'evidence: lethal = true (chainDeaths)');
assert(linkChain.score === 'strong',                     'chain + near → score = strong');

console.log('\n── ruleA1: evidence with economy signal ─────────────────────────────');

const deathEcon = makeDeathAnchor({
  gameTime: 1000,
  context:  makeContext({
    economy: { available: true, minuteAtDeath: 16, advBefore: 2000, advAfter: 500, delta: -1500, significant: true },
  }),
});
const linkEcon = ruleA1(deathEcon, momentumB);
assert(linkEcon !== null,                                'econ link: not null');
assert(linkEcon.evidence.chain_deaths === 0,             'evidence: chain_deaths = 0');
assert(linkEcon.evidence.economy_significant === true,   'evidence: economy_significant = true');
assert(linkEcon.evidence.lethal === true,                'evidence: lethal = true (economy)');
assert(linkEcon.score === 'strong',                      'economy + near → score = strong');

console.log('\n── ruleA1: evidence when economy not available ───────────────────────');

const deathEconNA = makeDeathAnchor({
  gameTime: 1000,
  context:  makeContext({
    economy: { available: false, minuteAtDeath: null, advBefore: null, advAfter: null, delta: null, significant: false },
  }),
});
const linkEconNA = ruleA1(deathEconNA, momentumB);
assert(linkEconNA.evidence.economy_significant === false,
  'evidence: economy_significant=false when available=false');
assert(linkEconNA.evidence.lethal === false,
  'evidence: lethal=false when economy not available and no chain');

console.log('\n── ruleA1: score is consistent with scoreA1 ─────────────────────────');

// Not near (gap > 45), lethal via chain → medium
const momentumFar = makeMomentumAnchor({ gameTime: 1100 }); // gap = 100s
const linkFar = ruleA1(deathChain, momentumFar);
assert(linkFar !== null,               'far link: not null');
assert(linkFar.evidence.gap_seconds === 100, 'far link: gap_seconds = 100');
assert(linkFar.score === 'medium',     'near=false, lethal=true → medium');

// Not near, not lethal → weak
const linkFarNoLethal = ruleA1(deathA, momentumFar);
assert(linkFarNoLethal !== null,              'far no-lethal link: not null');
assert(linkFarNoLethal.score === 'weak',      'not near, not lethal → weak');

// ── GAP_THRESHOLD constant ─────────────────────────────────────────────────

console.log('\n── GAP_THRESHOLD export ──────────────────────────────────────────────');

assert(typeof GAP_THRESHOLD === 'number',  'GAP_THRESHOLD is a number');
assert(GAP_THRESHOLD > 0,                  'GAP_THRESHOLD is positive');

// ── A2_MAX_GAP constant ─────────────────────────────────────────────────────

console.log('\n── A2_MAX_GAP export ─────────────────────────────────────────────────');

assert(typeof A2_MAX_GAP === 'number', 'A2_MAX_GAP is a number');
assert(A2_MAX_GAP > 0,                 'A2_MAX_GAP is positive');

// ── scoreA2 ──────────────────────────────────────────────────────────────────

console.log('\n── scoreA2: four-quadrant scoring ───────────────────────────────────');

assert(scoreA2({ gap: 200, hadBuyback: true,  econSignificant: false, spikeSignificant: true  }) === 'strong',
  'hadBuyback && spikeSignificant → strong');

assert(scoreA2({ gap: 100, hadBuyback: false, econSignificant: true,  spikeSignificant: false }) === 'strong',
  'econSignificant && gap<=120 → strong');

assert(scoreA2({ gap: 100, hadBuyback: true,  econSignificant: false, spikeSignificant: false }) === 'strong',
  'hadBuyback && gap<=120 → strong (even without spikeSignificant)');

assert(scoreA2({ gap: 200, hadBuyback: false, econSignificant: true,  spikeSignificant: false }) === 'medium',
  'econSignificant alone, gap>120, no buyback/spike → medium');

assert(scoreA2({ gap: 200, hadBuyback: false, econSignificant: false, spikeSignificant: true  }) === 'medium',
  'spikeSignificant alone → medium');

assert(scoreA2({ gap: 200, hadBuyback: false, econSignificant: false, spikeSignificant: false }) === 'weak',
  'no signals → weak');

// Importability assertion: OD imports never have hadBuyback (always null/false),
// so econSignificant must be able to reach strong/medium alone — verified above.
assert(scoreA2({ gap: 50, hadBuyback: false, econSignificant: true, spikeSignificant: false }) === 'strong',
  'OD-import reachability: econSignificant + close gap, no buyback → strong');

// ── ruleA2: gate checks ──────────────────────────────────────────────────────

console.log('\n── ruleA2: gate 1 — anchorA must be a death ─────────────────────────');

const spikeDeficitB = makeSpikeAnchor({ gameTime: 1100 });
assert(ruleA2(notDeath, spikeDeficitB) === null,
  'gate 1: anchorA.kind !== death → null');

console.log('\n── ruleA2: gate 2 — anchorB must be spike_deficit ───────────────────');

const deathA2 = makeDeathAnchor({
  gameTime: 1000,
  context:  makeContext({ diedWithBuyback: true }),
});

const spikeLead = makeSpikeAnchor({ gameTime: 1100, type: 'spike_lead' });
assert(ruleA2(deathA2, spikeLead) === null,
  'gate 2: anchorB.type = spike_lead → null');

assert(ruleA2(deathA2, momentumB) === null,
  'gate 2: anchorB.kind = momentum (not spike) → null');

console.log('\n── ruleA2: gate 3 — gap must be in (0, A2_MAX_GAP] ──────────────────');

const spikeBefore = makeSpikeAnchor({ gameTime: 900 }); // before deathA2 at 1000
assert(ruleA2(deathA2, spikeBefore) === null,
  'gate 3: spike before death (negative gap) → null');

const spikeAtSameTime = makeSpikeAnchor({ gameTime: 1000 });
assert(ruleA2(deathA2, spikeAtSameTime) === null,
  'gate 3: gap = 0 → null (must be strictly after, unlike A1)');

const spikeAtLimit = makeSpikeAnchor({ gameTime: 1000 + A2_MAX_GAP });
assert(ruleA2(deathA2, spikeAtLimit) !== null,
  `gate 3: gap = A2_MAX_GAP (${A2_MAX_GAP}s) → valid link`);

const spikeOverLimit = makeSpikeAnchor({ gameTime: 1000 + A2_MAX_GAP + 1 });
assert(ruleA2(deathA2, spikeOverLimit) === null,
  'gate 3: gap > A2_MAX_GAP → null');

console.log('\n── ruleA2: domain check ① — death must be costly enough ────────────');

const deathNoCost = makeDeathAnchor({
  gameTime: 1000,
  context:  makeContext({ diedWithBuyback: false }),
});
assert(ruleA2(deathNoCost, spikeDeficitB) === null,
  'no buyback and no economy signal → null (not costly enough)');

const deathEconSig = makeDeathAnchor({
  gameTime: 1000,
  context:  makeContext({
    diedWithBuyback: false,
    economy: { available: true, minuteAtDeath: 16, advBefore: 1500, advAfter: 200, delta: -1300, significant: true },
  }),
});
assert(ruleA2(deathEconSig, spikeDeficitB) !== null,
  'economy.significant alone (no buyback) → costly enough → link');

console.log('\n── ruleA2: domain check ② — item must complete after the death ★────');

const spikeCompletedBeforeDeath = makeSpikeAnchor({ gameTime: 1000 + 50 });
// Manually desync detail.myTime from anchor gameTime to isolate check ② from gate 3.
const spikeDesynced = { ...spikeCompletedBeforeDeath, detail: { ...spikeCompletedBeforeDeath.detail, myTime: 900 } };
assert(ruleA2(deathA2, spikeDesynced) === null,
  'myTime <= death gameTime (item completed before death) → null ★');

const spikeNullMyTime = { ...spikeDeficitB, detail: { ...spikeDeficitB.detail, myTime: null } };
assert(ruleA2(deathA2, spikeNullMyTime) === null,
  'myTime == null → null (cannot verify)');

console.log('\n── ruleA2: returned link shape ───────────────────────────────────────');

const linkA2 = ruleA2(deathA2, spikeDeficitB);
assert(linkA2 !== null,                          'full-pass link: not null');
assert(linkA2.rule === 'A2',                      'link: rule = A2');
assert(Array.isArray(linkA2.anchors),              'link: anchors is array');
assert(linkA2.anchors[0] === deathA2,              'link: anchors[0] is deathA2');
assert(linkA2.anchors[1] === spikeDeficitB,        'link: anchors[1] is spikeDeficitB');
assert(['strong', 'medium', 'weak'].includes(linkA2.score),
  'link: score is one of strong/medium/weak');

console.log('\n── ruleA2: evidence fields ───────────────────────────────────────────');

const evidA2 = linkA2.evidence;
assert(evidA2.gap_seconds === 100,                 'evidence: gap_seconds = 1100 - 1000 = 100');
assert(evidA2.economy_delta === null,              'evidence: economy_delta = null (deathA2 has no economy data)');
assert(evidA2.economy_significant === false,       'evidence: economy_significant = false');
assert(evidA2.had_buyback === true,                'evidence: had_buyback = true (deathA2 diedWithBuyback=true)');
assert(evidA2.my_item === 'black_king_bar',        'evidence: my_item = black_king_bar');
assert(evidA2.my_item_time === 1100,               'evidence: my_item_time = 1100');
assert(evidA2.enemy_item === 'black_king_bar',     'evidence: enemy_item = black_king_bar');
assert(evidA2.enemy_item_time === 900,             'evidence: enemy_item_time = 900');

const linkA2Econ = ruleA2(deathEconSig, spikeDeficitB);
assert(linkA2Econ.evidence.economy_delta === -1300, 'evidence: economy_delta = -1300 when economy data present');
assert(linkA2Econ.evidence.economy_significant === true, 'evidence: economy_significant = true');
assert(linkA2Econ.evidence.had_buyback === false,   'evidence: had_buyback = false when diedWithBuyback=false');

console.log('\n── ruleA2: scoreA2 consistency ────────────────────────────────────────');

// hadBuyback + spikeSignificant(true, from spikeDeficitB) + close gap → strong
assert(linkA2.score === 'strong',
  'hadBuyback + spikeSignificant + gap=100 (<=120) → strong');

// Not significant spike, no buyback, only econSignificant, gap > 120 → medium
const spikeNotSignificant = makeSpikeAnchor({ gameTime: 1000 + 200, significant: false });
const linkA2Medium = ruleA2(deathEconSig, spikeNotSignificant);
assert(linkA2Medium.score === 'medium',
  'econSignificant only, gap=200 (>120), spike not significant → medium');

// Neither costly signal barely passes gate (econSignificant true) but weak scoring path
const deathBarelyCostly = makeDeathAnchor({
  gameTime: 1000,
  context: makeContext({
    diedWithBuyback: false,
    economy: { available: true, minuteAtDeath: 16, advBefore: 1500, advAfter: 1450, delta: -50, significant: false },
  }),
});
// This death fails costlyEnough (economy not significant, no buyback) — should be null, not weak
assert(ruleA2(deathBarelyCostly, spikeDeficitB) === null,
  'costlyEnough gate: economy present but not significant, no buyback → null (gate ①, not a weak score)');

console.log('\n── ruleA2: does not interfere with ruleA1 (death→momentum untouched) ─');

assert(ruleA1(deathA2, momentumB) !== null,
  'ruleA1 still links death→momentum_loss independently of ruleA2');
assert(ruleA2(deathA2, momentumB) === null,
  'ruleA2 correctly rejects a momentum anchor as anchorB');

// ── Summary ────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(60)}`);
console.log(`  ${passed + failed} assertions: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
