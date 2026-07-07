// Run: node server/tests/anchorLinker.test.js

'use strict';

// ── Decoupling verification ─────────────────────────────────────────────────
const fs   = require('fs');
const path = require('path');
const src  = fs.readFileSync(
  path.resolve(__dirname, '../anchorLinker.js'),
  'utf8'
);

const {
  isLethalDeath, scoreA1, ruleA1, GAP_THRESHOLD,
  scoreA2, ruleA2, A2_MAX_GAP,
  scoreA3, ruleA3, A3_MAX_GAP, A3_QUICK_GAP,
  scoreA4, ruleA4, A4_MAX_GAP, A4_NEAR_GAP,
  linkAllAnchors,
} = require('../anchorLinker');

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

function makeDeathAnchor({ severity = 'danger', context = null, gameTime = 1000, snapshot = null } = {}) {
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
      snapshot:  snapshot ?? { source: 'opendota_import', deathNumber: 1 },
      context,
    },
  };
}

function makeContext({ chainDeaths = [], economy = null, diedWithBuyback = null, killsNearby = [] } = {}) {
  return {
    windowStart:       995,
    windowEnd:         1060,
    chainDeaths,
    killsNearby,
    objectivesLost:    [],
    objectivesGained:  [],
    diedWithBuyback,
    majorObjectiveLost: false,
    economy: economy !== undefined ? economy : { available: false, minuteAtDeath: null,
      advBefore: null, advAfter: null, delta: null, significant: false },
  };
}

function makePaceDeficitAnchor({
  gameTime = 1000, significant = true, gap = 2, enemyHero = '斧王（Axe）', recoveredAt = null,
} = {}) {
  return {
    gameTime,
    minute:   Math.floor(gameTime / 60),
    kind:     'pace',
    type:     'pace_deficit',
    severity: significant ? 'warning' : 'info',
    summary:  'xx:xx 敌方已 N 件关键装，我方 M 件（落后 N）',
    detail:   {
      gameTime, type: 'pace_deficit', myCount: 1, enemyCount: 1 + gap, gap,
      enemyHero, triggerItem: 'blink', significant, recoveredAt,
    },
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

console.log('\n── ruleA2: pace anchors (kind=pace) are never linked as anchorB ─────');

// pace_deficit anchors have kind='pace', not kind='spike', even though the
// type string is unrelated to 'spike_deficit' — gate 2 must reject them so a
// 4th anchor class introduced without touching anchorLinker.js can't be
// silently misrouted through an existing rule.
const paceDeficitAnchor = {
  gameTime: 1100,
  minute:   Math.floor(1100 / 60),
  kind:     'pace',
  type:     'pace_deficit',
  severity: 'warning',
  summary:  'xx:xx 敌方已 4 件关键装，我方 2 件（落后 2）',
  detail:   { gameTime: 1100, type: 'pace_deficit', myCount: 2, enemyCount: 4, gap: 2, enemyHero: 'Axe', triggerItem: 'blink', significant: true },
};
assert(ruleA2(deathA2, paceDeficitAnchor) === null,
  'ruleA2 rejects a pace anchor as anchorB (kind !== spike)');

// ── A3_MAX_GAP / A3_QUICK_GAP constants ──────────────────────────────────────

console.log('\n── A3_MAX_GAP / A3_QUICK_GAP export ─────────────────────────────────');

assert(typeof A3_MAX_GAP === 'number',   'A3_MAX_GAP is a number');
assert(A3_MAX_GAP > 0,                   'A3_MAX_GAP is positive');
assert(typeof A3_QUICK_GAP === 'number', 'A3_QUICK_GAP is a number');
assert(A3_QUICK_GAP > 0 && A3_QUICK_GAP <= A3_MAX_GAP,
  'A3_QUICK_GAP is positive and <= A3_MAX_GAP');

// ── scoreA3 ──────────────────────────────────────────────────────────────────

console.log('\n── scoreA3: three-tier scoring ───────────────────────────────────────');

const lethalFirstDeath = makeDeathAnchor({
  context: makeContext({ chainDeaths: [{ game_time: 1005, message: 'x', snapshot: null }] }),
});
const notLethalFirstDeath = makeDeathAnchor({ context: makeContext() });

assert(scoreA3(lethalFirstDeath, 30) === 'strong',
  'quick (30s <= 90) + lethal first death → strong');

assert(scoreA3(lethalFirstDeath, A3_QUICK_GAP) === 'strong',
  'quick (boundary = A3_QUICK_GAP) + lethal → strong');

assert(scoreA3(lethalFirstDeath, 120) === 'medium',
  'not quick (120 > 90) + lethal → medium');

assert(scoreA3(notLethalFirstDeath, 30) === 'medium',
  'quick (30s) + not lethal → medium');

assert(scoreA3(notLethalFirstDeath, 120) === 'weak',
  'not quick (120) + not lethal → weak');

assert(scoreA3(notLethalFirstDeath, A3_QUICK_GAP + 1) === 'weak',
  'just past quick boundary + not lethal → weak');

// OD-import reachability: economy.significant (lethal via isLethalDeath) + quick → strong
const econLethalFirstDeath = makeDeathAnchor({
  context: makeContext({
    economy: { available: true, minuteAtDeath: 16, advBefore: 1500, advAfter: 200, delta: -1300, significant: true },
  }),
});
assert(scoreA3(econLethalFirstDeath, 40) === 'strong',
  'OD-import reachability: economy.significant (no chainDeaths, no critical) + quick → strong');

// ── ruleA3: gate checks ───────────────────────────────────────────────────────

console.log('\n── ruleA3: gate 1 — anchorA must be a death ─────────────────────────');

const deathA3First  = makeDeathAnchor({ gameTime: 1000, context: makeContext(), snapshot: { source: 'opendota_import', deathNumber: 3 } });
const deathA3Second = makeDeathAnchor({ gameTime: 1050, context: makeContext(), snapshot: { source: 'opendota_import', deathNumber: 4 } });

assert(ruleA3(notDeath, deathA3Second) === null,
  'gate 1: anchorA.kind !== death → null');

console.log('\n── ruleA3: gate 2 — anchorB must be a death ─────────────────────────');

assert(ruleA3(deathA3First, momentumB) === null,
  'gate 2: anchorB.kind = momentum (not death) → null');

assert(ruleA3(deathA3First, spikeDeficitB) === null,
  'gate 2: anchorB.kind = spike (not death) → null');

console.log('\n── ruleA3: gate 3 — gap must be in (0, A3_MAX_GAP] ──────────────────');

const deathAtSameTime = makeDeathAnchor({ gameTime: 1000, context: makeContext() });
assert(ruleA3(deathA3First, deathAtSameTime) === null,
  'gate 3: gap = 0 (same gameTime) → null');

const deathBefore = makeDeathAnchor({ gameTime: 900, context: makeContext() });
assert(ruleA3(deathA3First, deathBefore) === null,
  'gate 3: b before a (negative gap) → null');

const deathAtLimit = makeDeathAnchor({ gameTime: 1000 + A3_MAX_GAP, context: makeContext() });
assert(ruleA3(deathA3First, deathAtLimit) !== null,
  `gate 3: gap = A3_MAX_GAP (${A3_MAX_GAP}s) → valid link`);

const deathOverLimit = makeDeathAnchor({ gameTime: 1000 + A3_MAX_GAP + 1, context: makeContext() });
assert(ruleA3(deathA3First, deathOverLimit) === null,
  'gate 3: gap > A3_MAX_GAP → null');

console.log('\n── ruleA3: returned link shape ───────────────────────────────────────');

const linkA3 = ruleA3(deathA3First, deathA3Second);
assert(linkA3 !== null,                        'full-pass link: not null');
assert(linkA3.rule === 'A3',                    'link: rule = A3');
assert(Array.isArray(linkA3.anchors),           'link: anchors is array');
assert(linkA3.anchors[0] === deathA3First,      'link: anchors[0] is deathA3First');
assert(linkA3.anchors[1] === deathA3Second,     'link: anchors[1] is deathA3Second');
assert(['strong', 'medium', 'weak'].includes(linkA3.score),
  'link: score is one of strong/medium/weak');

console.log('\n── ruleA3: evidence fields ───────────────────────────────────────────');

const evidA3 = linkA3.evidence;
assert(evidA3.gap_seconds === 50,               'evidence: gap_seconds = 1050 - 1000 = 50');
assert(evidA3.first_death_lethal === false,     'evidence: first_death_lethal = false (plain context)');
assert(evidA3.first_death_number === 3,         'evidence: first_death_number = 3 (from snapshot.deathNumber)');
assert(evidA3.second_death_number === 4,        'evidence: second_death_number = 4 (from snapshot.deathNumber)');

// GSI-style snapshot uses deathsAtDeath instead of deathNumber
const deathGsiFirst  = makeDeathAnchor({ gameTime: 1000, context: makeContext(), snapshot: { deathsAtDeath: 2 } });
const deathGsiSecond = makeDeathAnchor({ gameTime: 1040, context: makeContext(), snapshot: { deathsAtDeath: 3 } });
const linkA3Gsi = ruleA3(deathGsiFirst, deathGsiSecond);
assert(linkA3Gsi.evidence.first_death_number === 2,
  'evidence: first_death_number falls back to snapshot.deathsAtDeath for GSI deaths');
assert(linkA3Gsi.evidence.second_death_number === 3,
  'evidence: second_death_number falls back to snapshot.deathsAtDeath for GSI deaths');

// Missing snapshot entirely → null, not a thrown error
const deathNoSnapshot = { ...deathA3First, detail: { ...deathA3First.detail, snapshot: null } };
const linkA3NoSnapshot = ruleA3(deathNoSnapshot, deathA3Second);
assert(linkA3NoSnapshot.evidence.first_death_number === null,
  'evidence: first_death_number = null when snapshot missing');

console.log('\n── ruleA3: evidence with lethal first death ─────────────────────────');

const linkA3Lethal = ruleA3(lethalFirstDeath, makeDeathAnchor({ gameTime: 1000 + 40 }));
assert(linkA3Lethal.evidence.first_death_lethal === true,
  'evidence: first_death_lethal = true when first death has chainDeaths');
assert(linkA3Lethal.score === 'strong',
  'quick + lethal first death → score = strong');

console.log('\n── ruleA3: scoreA3 consistency ───────────────────────────────────────');

const linkA3Far = ruleA3(notLethalFirstDeath, makeDeathAnchor({ gameTime: 1000 + 120 }));
assert(linkA3Far.score === 'weak',
  'not quick, not lethal → weak (matches scoreA3)');

// ── Multi-death chain ──────────────────────────────────────────────────────

console.log('\n── ruleA3: multi-death chain (d1, d2, d3) ────────────────────────────');

const d1 = makeDeathAnchor({ gameTime: 1000, context: makeContext() });
const d2 = makeDeathAnchor({ gameTime: 1080, context: makeContext() }); // gap from d1: 80
const d3 = makeDeathAnchor({ gameTime: 1180, context: makeContext() }); // gap from d2: 100, from d1: 180

assert(ruleA3(d1, d2) !== null, 'd1→d2 (gap=80, within A3_MAX_GAP) → link');
assert(ruleA3(d2, d3) !== null, 'd2→d3 (gap=100, within A3_MAX_GAP) → link');
assert(ruleA3(d1, d3) === null, 'd1→d3 (gap=180, exceeds A3_MAX_GAP) → no link (documented: not every pair chains)');

const d4 = makeDeathAnchor({ gameTime: 1050, context: makeContext() }); // gap from d1: 50, from d2 -30 (before)
// A three-death cluster all within A3_MAX_GAP of each other produces multiple pairs.
const tightD1 = makeDeathAnchor({ gameTime: 2000, context: makeContext() });
const tightD2 = makeDeathAnchor({ gameTime: 2060, context: makeContext() }); // +60
const tightD3 = makeDeathAnchor({ gameTime: 2140, context: makeContext() }); // +80 from d2, +140 from d1
assert(ruleA3(tightD1, tightD2) !== null, 'tight cluster: d1→d2 links');
assert(ruleA3(tightD2, tightD3) !== null, 'tight cluster: d2→d3 links');
assert(ruleA3(tightD1, tightD3) !== null, 'tight cluster: d1→d3 also links (gap=140 <= 150) — intentional per multi-death chain doc');

// ── A4_MAX_GAP / A4_NEAR_GAP constants ───────────────────────────────────────

console.log('\n── A4_MAX_GAP / A4_NEAR_GAP export ──────────────────────────────────');

assert(typeof A4_MAX_GAP === 'number',  'A4_MAX_GAP is a number');
assert(A4_MAX_GAP > 0,                  'A4_MAX_GAP is positive');
assert(typeof A4_NEAR_GAP === 'number', 'A4_NEAR_GAP is a number');
assert(A4_NEAR_GAP > 0 && A4_NEAR_GAP <= A4_MAX_GAP,
  'A4_NEAR_GAP is positive and <= A4_MAX_GAP');

// ── scoreA4 ───────────────────────────────────────────────────────────────────

console.log('\n── scoreA4: three-tier scoring ───────────────────────────────────────');

assert(scoreA4({ gap: 60,  deficitGap: 3, noTrade: false }) === 'strong',
  'near && deep → strong');
assert(scoreA4({ gap: 60,  deficitGap: 1, noTrade: true })  === 'strong',
  'near && noTrade → strong');
assert(scoreA4({ gap: 60,  deficitGap: 1, noTrade: false }) === 'medium',
  'near only (not deep, no trade happened) → medium');
assert(scoreA4({ gap: 200, deficitGap: 3, noTrade: false }) === 'medium',
  'deep only (not near, trade happened) → medium');
assert(scoreA4({ gap: 200, deficitGap: 1, noTrade: true })  === 'medium',
  'noTrade only (not near, not deep) → medium');
assert(scoreA4({ gap: 200, deficitGap: 2, noTrade: false }) === 'weak',
  'none of the three signals (gap=200>120, deficitGap=2<3, trade happened) → weak');

// ── ruleA4: gate checks ────────────────────────────────────────────────────

console.log('\n── ruleA4: gate 1 — anchorA must be a significant pace_deficit ──────');

const paceDeficitBase = makePaceDeficitAnchor({ gameTime: 1000, significant: true, gap: 2 });
const deathForA4      = makeDeathAnchor({ gameTime: 1100, context: makeContext() });

assert(ruleA4(notDeath, deathForA4) === null,
  'gate 1: anchorA.kind = momentum (not pace) → null');
assert(ruleA4(deathA, deathForA4) === null,
  'gate 1: anchorA.kind = death (not pace) → null');

const paceRecoveredAnchor = { ...paceDeficitBase, type: 'pace_recovered',
  detail: { ...paceDeficitBase.detail, type: 'pace_recovered' } };
assert(ruleA4(paceRecoveredAnchor, deathForA4) === null,
  'gate 1: anchorA.type = pace_recovered (not pace_deficit) → null');

const paceNotSignificant = makePaceDeficitAnchor({ gameTime: 1000, significant: false, gap: 1 });
assert(ruleA4(paceNotSignificant, deathForA4) === null,
  'gate 1: anchorA.detail.significant = false → null (only significant deficits force-link to a death)');

console.log('\n── ruleA4: gate 2 — anchorB must be a death ─────────────────────────');

assert(ruleA4(paceDeficitBase, momentumB) === null,
  'gate 2: anchorB.kind = momentum (not death) → null');
assert(ruleA4(paceDeficitBase, spikeDeficitB) === null,
  'gate 2: anchorB.kind = spike (not death) → null');

console.log('\n── ruleA4: gate 3 — gap must be in (0, A4_MAX_GAP] ──────────────────');

const deathBeforePace = makeDeathAnchor({ gameTime: 900, context: makeContext() }); // before paceDeficitBase at 1000
assert(ruleA4(paceDeficitBase, deathBeforePace) === null,
  'gate 3: death before deficit (negative gap) → null');

const deathAtSameTimeA4 = makeDeathAnchor({ gameTime: 1000, context: makeContext() });
assert(ruleA4(paceDeficitBase, deathAtSameTimeA4) === null,
  'gate 3: gap = 0 (same gameTime) → null');

const deathAtA4Limit = makeDeathAnchor({ gameTime: 1000 + A4_MAX_GAP, context: makeContext() });
assert(ruleA4(paceDeficitBase, deathAtA4Limit) !== null,
  `gate 3: gap = A4_MAX_GAP (${A4_MAX_GAP}s) → valid link`);

const deathOverA4Limit = makeDeathAnchor({ gameTime: 1000 + A4_MAX_GAP + 1, context: makeContext() });
assert(ruleA4(paceDeficitBase, deathOverA4Limit) === null,
  'gate 3: gap > A4_MAX_GAP → null');

console.log('\n── ruleA4: domain check ★ — deficit must still be open at death ─────');

// recoveredAt before the death → the deficit was already resolved, no link.
const paceRecoveredBeforeDeath = makePaceDeficitAnchor({ gameTime: 1000, gap: 2, recoveredAt: 1050 });
assert(ruleA4(paceRecoveredBeforeDeath, deathForA4) === null,
  'recoveredAt <= death gameTime → null (deficit already closed, false causality)');

// recoveredAt exactly at the death gameTime → still counts as "already closed."
const paceRecoveredAtDeath = makePaceDeficitAnchor({ gameTime: 1000, gap: 2, recoveredAt: 1100 });
assert(ruleA4(paceRecoveredAtDeath, deathForA4) === null,
  'recoveredAt === death gameTime → null (closed at-or-before death)');

// recoveredAt = null (never recovered for the rest of the match) → link holds.
assert(ruleA4(paceDeficitBase, deathForA4) !== null,
  'recoveredAt = null (never recovered) → link holds');

// recoveredAt after the death → deficit was still open at the moment of death → link holds.
const paceRecoveredAfterDeath = makePaceDeficitAnchor({ gameTime: 1000, gap: 2, recoveredAt: 1500 });
assert(ruleA4(paceRecoveredAfterDeath, deathForA4) !== null,
  'recoveredAt > death gameTime → link holds (deficit still open when the player died)');

console.log('\n── ruleA4: returned link shape ───────────────────────────────────────');

const linkA4 = ruleA4(paceDeficitBase, deathForA4);
assert(linkA4 !== null,                     'full-pass link: not null');
assert(linkA4.rule === 'A4',                 'link: rule = A4');
assert(Array.isArray(linkA4.anchors),        'link: anchors is array');
assert(linkA4.anchors[0] === paceDeficitBase, 'link: anchors[0] is paceDeficitBase');
assert(linkA4.anchors[1] === deathForA4,      'link: anchors[1] is deathForA4');
assert(['strong', 'medium', 'weak'].includes(linkA4.score),
  'link: score is one of strong/medium/weak');

console.log('\n── ruleA4: evidence fields ───────────────────────────────────────────');

const evidA4 = linkA4.evidence;
assert(evidA4.gap_seconds === 100,              'evidence: gap_seconds = 1100 - 1000 = 100');
assert(evidA4.deficit_gap === 2,                'evidence: deficit_gap = paceDeficitBase.detail.gap = 2');
assert(evidA4.enemy_hero === '斧王（Axe）',      'evidence: enemy_hero = paceDeficitBase.detail.enemyHero');
assert(evidA4.no_trade === true,                'evidence: no_trade = true (deathForA4 context has empty killsNearby)');
assert(evidA4.recovered_at === null,            'evidence: recovered_at = null (paceDeficitBase never recovered)');

const linkA4Recovered = ruleA4(paceRecoveredAfterDeath, deathForA4);
assert(linkA4Recovered.evidence.recovered_at === 1500,
  'evidence: recovered_at = 1500 when the deficit eventually recovers after the death');

console.log('\n── ruleA4: no_trade signal from context.killsNearby ─────────────────');

const deathWithTrade = makeDeathAnchor({ gameTime: 1100, context: makeContext({ killsNearby: [{ game_time: 1102, message: 'x', snapshot: null }] }) });
const linkA4Trade = ruleA4(paceDeficitBase, deathWithTrade);
assert(linkA4Trade.evidence.no_trade === false,
  'evidence: no_trade = false when context.killsNearby is non-empty (a kill was traded)');

console.log('\n── ruleA4: defensive read when context is missing ───────────────────');

const deathNoContext = makeDeathAnchor({ gameTime: 1100, context: null });
const linkA4NoCtx = ruleA4(paceDeficitBase, deathNoContext);
assert(linkA4NoCtx !== null,                     'missing context: link still produced (no_trade just defaults false)');
assert(linkA4NoCtx.evidence.no_trade === false,  'missing context: no_trade = false (defensive read, no crash)');

console.log('\n── ruleA4: multi-death (one deficit, two later deaths) ─────────────');

// Same open deficit episode, two separate deaths both within window and both
// still-open at their own moment (recoveredAt=null) → two independent A4 links.
const deathMulti1 = makeDeathAnchor({ gameTime: 1100, context: makeContext() });
const deathMulti2 = makeDeathAnchor({ gameTime: 1250, context: makeContext() });
assert(ruleA4(paceDeficitBase, deathMulti1) !== null, 'multi-death: first death links (gap=100)');
assert(ruleA4(paceDeficitBase, deathMulti2) !== null, 'multi-death: second death also links independently (gap=250)');

console.log('\n── ruleA4: does not interfere with ruleA1/A2/A3 ─────────────────────');

// A pace anchor as anchorA fails A1/A2/A3's gate 1 (all require kind='death').
assert(ruleA1(paceDeficitBase, momentumB) === null, 'ruleA1 rejects a pace anchorA');
assert(ruleA2(paceDeficitBase, spikeDeficitB) === null, 'ruleA2 rejects a pace anchorA');
assert(ruleA3(paceDeficitBase, deathForA4) === null, 'ruleA3 rejects a pace anchorA');
// A death anchor as anchorA fails A4's gate 1 (requires kind='pace').
assert(ruleA4(deathA, momentumB) === null, 'ruleA4 rejects a death anchorA');
// Existing A1 link between a death and momentum is untouched by A4's existence.
assert(ruleA1(deathA, momentumB) !== null, 'ruleA1 still links death→momentum_loss independently of ruleA4');

// ── linkAllAnchors: dispatcher ────────────────────────────────────────────

console.log('\n── linkAllAnchors: degenerate inputs ─────────────────────────────────');

assert(Array.isArray(linkAllAnchors([])), 'empty anchors → array');
assert(linkAllAnchors([]).length === 0,   'empty anchors → []');
assert(linkAllAnchors([deathA2]).length === 0, 'single anchor → [] (no pairs)');

console.log('\n── linkAllAnchors: all three rules fire independently, no cross-talk ─');

// Build a mixed chain: death(1000, buyback+lethal-econ) → momentum_loss(1020) → spike_deficit(1100) → death(1060)
const mixedDeath = makeDeathAnchor({
  gameTime: 1000,
  context: makeContext({
    diedWithBuyback: true,
    economy: { available: true, minuteAtDeath: 16, advBefore: 1500, advAfter: 200, delta: -1300, significant: true },
  }),
});
const mixedMomentum = makeMomentumAnchor({ gameTime: 1020 });
const mixedSpike     = makeSpikeAnchor({ gameTime: 1100 });
const mixedSecondDeath = makeDeathAnchor({ gameTime: 1060, context: makeContext() });

const mixedAnchors = [mixedDeath, mixedMomentum, mixedSecondDeath, mixedSpike]
  .sort((a, b) => a.gameTime - b.gameTime);

const mixedLinks = linkAllAnchors(mixedAnchors);

const a1Links = mixedLinks.filter((l) => l.rule === 'A1');
const a2Links = mixedLinks.filter((l) => l.rule === 'A2');
const a3Links = mixedLinks.filter((l) => l.rule === 'A3');

assert(a1Links.length === 1, 'exactly one A1 link (death→momentum_loss) produced');
assert(a1Links[0].relation === 'death_triggered_collapse', 'A1 link relation = death_triggered_collapse');
assert(a1Links[0].from === 1000 && a1Links[0].to === 1020, 'A1 link from/to correct');

assert(a2Links.length === 1, 'exactly one A2 link (death→spike_deficit) produced');
assert(a2Links[0].relation === 'death_delayed_spike', 'A2 link relation = death_delayed_spike');
assert(a2Links[0].from === 1000 && a2Links[0].to === 1100, 'A2 link from/to correct');

assert(a3Links.length === 1, 'exactly one A3 link (death→death) produced');
assert(a3Links[0].relation === 'death_chain', 'A3 link relation = death_chain');
assert(a3Links[0].from === 1000 && a3Links[0].to === 1060, 'A3 link from/to correct');

// Every link must carry the endpoint-facing shape
for (const l of mixedLinks) {
  assert(typeof l.from === 'number' && typeof l.to === 'number', `link ${l.rule}: from/to are numbers`);
  assert(typeof l.relation === 'string', `link ${l.rule}: relation is a string`);
  assert(['strong', 'medium', 'weak'].includes(l.confidence), `link ${l.rule}: confidence is valid`);
  assert(typeof l.evidence === 'object' && l.evidence !== null, `link ${l.rule}: evidence is an object`);
}

console.log('\n── linkAllAnchors: A3 does not interfere with A1/A2 rule identification ─');

// mixedSecondDeath at 1060 is itself a valid anchorA for further rules — confirm
// it does not spuriously produce an A1/A2 link against the same spike/momentum
// anchors (kind gates should prevent any cross type confusion).
const fromSecondDeath = mixedLinks.filter((l) => l.from === 1060);
assert(fromSecondDeath.every((l) => l.rule === 'A3' || l.to > 1060),
  'links originating from the second death are well-formed (no malformed cross-rule entries)');

console.log('\n── linkAllAnchors: A4 fires via the shared dispatcher ───────────────');

// A4 is the first rule whose anchorA is not kind='death' — confirm the
// dispatcher's outer loop (which now admits both 'death' and 'pace' kinds)
// actually surfaces it end-to-end, not just via the standalone ruleA4() calls above.
const a4PaceAnchor = makePaceDeficitAnchor({ gameTime: 800, significant: true, gap: 2, recoveredAt: null });
const a4Death       = makeDeathAnchor({ gameTime: 900, context: makeContext() }); // gap=100

const a4Anchors = [a4PaceAnchor, a4Death].sort((a, b) => a.gameTime - b.gameTime);
const a4Links = linkAllAnchors(a4Anchors);

assert(a4Links.length === 1, 'linkAllAnchors: exactly one A4 link produced from a pace_deficit + death pair');
assert(a4Links[0].rule === 'A4', 'linkAllAnchors: rule = A4');
assert(a4Links[0].relation === 'deficit_forced_death', 'linkAllAnchors: relation = deficit_forced_death');
assert(a4Links[0].from === 800 && a4Links[0].to === 900, 'linkAllAnchors: from/to correct');
assert(['strong', 'medium', 'weak'].includes(a4Links[0].confidence), 'linkAllAnchors: confidence valid');
assert(typeof a4Links[0].evidence === 'object' && a4Links[0].evidence !== null, 'linkAllAnchors: evidence is an object');

// A deficit already recovered before the death → dispatcher must not surface a link.
const a4RecoveredPace = makePaceDeficitAnchor({ gameTime: 800, significant: true, gap: 2, recoveredAt: 850 });
const a4AnchorsRecovered = [a4RecoveredPace, a4Death].sort((a, b) => a.gameTime - b.gameTime);
assert(linkAllAnchors(a4AnchorsRecovered).length === 0,
  'linkAllAnchors: recovered-before-death deficit produces no A4 link');

// ── Summary ────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(60)}`);
console.log(`  ${passed + failed} assertions: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
