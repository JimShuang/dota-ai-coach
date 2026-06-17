// Run: node server/tests/openDotaDeathDigest.test.js

'use strict';

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

// Base death at t=300 (window: 295–360)
const DEATH_GSI = {
  id: 1, game_time: 300, type: 'hero_death', severity: 'critical', message: '死亡',
  snapshot: { goldBeforeDeathPenalty: 800, source: 'gsi' },
};

const DEATH_GSI_POOR = {
  id: 2, game_time: 500, type: 'hero_death', severity: 'danger', message: '贫穷死亡',
  snapshot: { goldBeforeDeathPenalty: 50, source: 'gsi' },
};

const DEATH_OD = {
  id: 3, game_time: 700, type: 'hero_death', severity: 'danger', message: 'OD死亡',
  snapshot: { source: 'opendota_import', killer: 'Axe', deathNumber: 1 },
};

// ── Basic structure ────────────────────────────────────────────────────────

console.log('\n── basic structure ──────────────────────────────────────────────────');

assert(Array.isArray(buildDeathDigest([])), 'empty events → array');
assert(buildDeathDigest([]).length === 0,   'empty events → length 0');
assert(buildDeathDigest(null) === undefined || Array.isArray(buildDeathDigest([])), 'null guard via empty');

// No hero_death events → empty
const noDeathEvents = [
  { id: 10, game_time: 100, type: 'hero_kill',  severity: 'success', message: 'kill', snapshot: {} },
  { id: 11, game_time: 200, type: 'item_purchased', severity: 'info', message: 'item', snapshot: {} },
];
assert(buildDeathDigest(noDeathEvents).length === 0, 'no hero_death events → []');

// One death → one result
const oneDeath = [DEATH_GSI];
const oneResult = buildDeathDigest(oneDeath);
assert(oneResult.length === 1, 'one death → one result');
assert(oneResult[0].id === 1, 'result preserves event id');
assert(oneResult[0].game_time === 300, 'result preserves game_time');
assert(oneResult[0].type === 'hero_death', 'result preserves type');
assert(typeof oneResult[0].context === 'object', 'result has context object');
assert('windowStart' in oneResult[0].context, 'context has windowStart');
assert('windowEnd' in oneResult[0].context, 'context has windowEnd');
assert(oneResult[0].context.windowStart === 295, 'windowStart = game_time - 5');
assert(oneResult[0].context.windowEnd   === 360, 'windowEnd = game_time + 60');
assert(Array.isArray(oneResult[0].context.chainDeaths),     'context.chainDeaths is array');
assert(Array.isArray(oneResult[0].context.killsNearby),     'context.killsNearby is array');
assert(Array.isArray(oneResult[0].context.objectivesLost),  'context.objectivesLost is array');
assert(Array.isArray(oneResult[0].context.objectivesGained),'context.objectivesGained is array');
assert('diedWithBuyback'    in oneResult[0].context, 'context has diedWithBuyback');
assert('majorObjectiveLost' in oneResult[0].context, 'context has majorObjectiveLost');

// ── Window boundaries ──────────────────────────────────────────────────────

console.log('\n── window boundaries ────────────────────────────────────────────────');

const KILL_AT_MINUS5  = { id: 20, game_time: 295, type: 'hero_kill', severity: 'success', message: 'k-5',  snapshot: {} };
const KILL_AT_MINUS6  = { id: 21, game_time: 294, type: 'hero_kill', severity: 'success', message: 'k-6',  snapshot: {} };
const KILL_AT_PLUS60  = { id: 22, game_time: 360, type: 'hero_kill', severity: 'success', message: 'k+60', snapshot: {} };
const KILL_AT_PLUS61  = { id: 23, game_time: 361, type: 'hero_kill', severity: 'success', message: 'k+61', snapshot: {} };

const boundaryResult = buildDeathDigest([
  KILL_AT_MINUS6, KILL_AT_MINUS5, DEATH_GSI, KILL_AT_PLUS60, KILL_AT_PLUS61,
]);
const bCtx = boundaryResult[0].context;
assert(bCtx.killsNearby.some((k) => k.game_time === 295), 'kill at t-5 (inclusive) is in window');
assert(!bCtx.killsNearby.some((k) => k.game_time === 294), 'kill at t-6 is outside window');
assert(bCtx.killsNearby.some((k) => k.game_time === 360),  'kill at t+60 (inclusive) is in window');
assert(!bCtx.killsNearby.some((k) => k.game_time === 361), 'kill at t+61 is outside window');

// ── chainDeaths ────────────────────────────────────────────────────────────

console.log('\n── chainDeaths ──────────────────────────────────────────────────────');

const DEATH_IN_WINDOW  = { id: 30, game_time: 320, type: 'hero_death', severity: 'danger', message: 'chain', snapshot: {} };
const DEATH_OUT_WINDOW = { id: 31, game_time: 370, type: 'hero_death', severity: 'danger', message: 'outside', snapshot: {} };

const chainResult = buildDeathDigest([DEATH_GSI, DEATH_IN_WINDOW, DEATH_OUT_WINDOW]);
const chainCtx = chainResult[0].context;  // context for DEATH_GSI (t=300)

assert(chainCtx.chainDeaths.length === 1, 'one chain death in window');
assert(chainCtx.chainDeaths[0].game_time === 320, 'chain death at t=320 captured');
assert(!chainCtx.chainDeaths.some((d) => d.game_time === 300), 'death itself not in chainDeaths');
assert(!chainCtx.chainDeaths.some((d) => d.game_time === 370), 'death at t=370 outside window not in chainDeaths');

// context entry shape
assert('game_time' in chainCtx.chainDeaths[0], 'chainDeath entry has game_time');
assert('message'   in chainCtx.chainDeaths[0], 'chainDeath entry has message');
assert('snapshot'  in chainCtx.chainDeaths[0], 'chainDeath entry has snapshot');

// ── killsNearby ────────────────────────────────────────────────────────────

console.log('\n── killsNearby ──────────────────────────────────────────────────────');

const KILL_IN_WINDOW  = { id: 40, game_time: 310, type: 'hero_kill', severity: 'success', message: 'kill in', snapshot: { victim: 'Axe' } };
const KILL_OUT_WINDOW = { id: 41, game_time: 380, type: 'hero_kill', severity: 'success', message: 'kill out', snapshot: {} };

const killsResult = buildDeathDigest([DEATH_GSI, KILL_IN_WINDOW, KILL_OUT_WINDOW]);
const killsCtx = killsResult[0].context;

assert(killsCtx.killsNearby.length === 1, 'one kill in window');
assert(killsCtx.killsNearby[0].game_time === 310, 'kill at t=310 captured');
assert(!killsCtx.killsNearby.some((k) => k.game_time === 380), 'kill at t=380 not in window');

// Unrelated event types do not pollute killsNearby
const ITEM_IN_WINDOW = { id: 42, game_time: 305, type: 'item_purchased', severity: 'info', message: 'item', snapshot: {} };
const mixedResult = buildDeathDigest([DEATH_GSI, KILL_IN_WINDOW, ITEM_IN_WINDOW]);
assert(mixedResult[0].context.killsNearby.length === 1, 'item_purchased not counted in killsNearby');

// ── objectivesLost / objectivesGained ─────────────────────────────────────

console.log('\n── objectivesLost / objectivesGained ────────────────────────────────');

const OBJ_TOWER_LOST   = { id: 50, game_time: 315, type: 'objective', severity: 'danger',  message: '防御塔被摧毁', snapshot: { objectiveType: 'tower',    team: 'radiant' } };
const OBJ_BARRACKS_LOST = { id: 51, game_time: 330, type: 'objective', severity: 'danger', message: '兵营被摧毁',   snapshot: { objectiveType: 'barracks', team: 'radiant' } };
const OBJ_TOWER_GAINED  = { id: 52, game_time: 325, type: 'objective', severity: 'success', message: '摧毁敌塔',   snapshot: { objectiveType: 'tower',    team: 'dire'    } };
const OBJ_ROSHAN        = { id: 53, game_time: 340, type: 'objective', severity: 'warning', message: 'Roshan击杀', snapshot: { objectiveType: 'roshan',   team: 'dire'    } };
const OBJ_OUTSIDE       = { id: 54, game_time: 400, type: 'objective', severity: 'danger',  message: '窗外塔',     snapshot: { objectiveType: 'tower',    team: 'radiant' } };

const objResult = buildDeathDigest([
  DEATH_GSI, OBJ_TOWER_LOST, OBJ_BARRACKS_LOST, OBJ_TOWER_GAINED, OBJ_ROSHAN, OBJ_OUTSIDE,
]);
const objCtx = objResult[0].context;

assert(objCtx.objectivesLost.length === 3,   'danger tower + danger barracks + warning roshan → 3 in objectivesLost');
assert(objCtx.objectivesLost.some((o) => o.game_time === 315), 'tower (danger) in objectivesLost');
assert(objCtx.objectivesLost.some((o) => o.game_time === 330), 'barracks (danger) in objectivesLost');
assert(objCtx.objectivesLost.some((o) => o.game_time === 340), 'roshan (warning) in objectivesLost');
assert(objCtx.objectivesGained.length === 1,  'success tower → 1 in objectivesGained');
assert(objCtx.objectivesGained[0].game_time === 325, 'tower (success) in objectivesGained');
assert(!objCtx.objectivesLost.some((o) => o.game_time === 400),  'objective outside window not in lost');
assert(!objCtx.objectivesGained.some((o) => o.game_time === 400), 'objective outside window not in gained');

// snapshot preserved
assert(objCtx.objectivesLost[0].snapshot?.objectiveType === 'tower', 'objectivesLost entry preserves snapshot.objectiveType');

// ── majorObjectiveLost ─────────────────────────────────────────────────────

console.log('\n── majorObjectiveLost ───────────────────────────────────────────────');

// barracks in window → true
const majorBarracks = buildDeathDigest([DEATH_GSI, OBJ_BARRACKS_LOST]);
assert(majorBarracks[0].context.majorObjectiveLost === true, 'barracks in objectivesLost → majorObjectiveLost=true');

// tower only → false
const towerOnly = buildDeathDigest([DEATH_GSI, OBJ_TOWER_LOST]);
assert(towerOnly[0].context.majorObjectiveLost === false, 'tower only → majorObjectiveLost=false');

// roshan → true
const roshanOnly = buildDeathDigest([DEATH_GSI, OBJ_ROSHAN]);
assert(roshanOnly[0].context.majorObjectiveLost === true, 'roshan in objectivesLost → majorObjectiveLost=true');

// no objectives → false
assert(buildDeathDigest([DEATH_GSI])[0].context.majorObjectiveLost === false, 'no objectives → majorObjectiveLost=false');

// ── diedWithBuyback ────────────────────────────────────────────────────────

console.log('\n── diedWithBuyback ──────────────────────────────────────────────────');

// GSI death with gold >= 200 → true
assert(buildDeathDigest([DEATH_GSI])[0].context.diedWithBuyback === true,
  'GSI death goldBeforeDeathPenalty=800 → diedWithBuyback=true');

// GSI death with gold < 200 → false
assert(buildDeathDigest([DEATH_GSI_POOR])[0].context.diedWithBuyback === false,
  'GSI death goldBeforeDeathPenalty=50 → diedWithBuyback=false');

// OD import → null
assert(buildDeathDigest([DEATH_OD])[0].context.diedWithBuyback === null,
  'opendota_import death → diedWithBuyback=null');

// GSI death with null gold → null
const DEATH_NULL_GOLD = {
  id: 60, game_time: 900, type: 'hero_death', severity: 'danger', message: 'null gold',
  snapshot: { goldBeforeDeathPenalty: null, source: 'gsi' },
};
assert(buildDeathDigest([DEATH_NULL_GOLD])[0].context.diedWithBuyback === null,
  'GSI death goldBeforeDeathPenalty=null → diedWithBuyback=null');

// No snapshot → null
const DEATH_NO_SNAP = {
  id: 61, game_time: 1000, type: 'hero_death', severity: 'danger', message: 'no snap', snapshot: null,
};
assert(buildDeathDigest([DEATH_NO_SNAP])[0].context.diedWithBuyback === null,
  'GSI death no snapshot → diedWithBuyback=null');

// Exactly 200g → true (minimum buyback threshold is inclusive)
const DEATH_EXACT_200 = {
  id: 62, game_time: 1100, type: 'hero_death', severity: 'danger', message: 'exact',
  snapshot: { goldBeforeDeathPenalty: 200, source: 'gsi' },
};
assert(buildDeathDigest([DEATH_EXACT_200])[0].context.diedWithBuyback === true,
  'goldBeforeDeathPenalty=200 exactly → diedWithBuyback=true (inclusive threshold)');

// ── Multiple deaths — each gets independent windows ────────────────────────

console.log('\n── multiple deaths ──────────────────────────────────────────────────');

// DEATH_GSI at t=300, DEATH_GSI_POOR at t=500
// An event at t=410 is within DEATH_GSI_POOR's window (495–560? no — 500-5=495, so 410 is outside)
// Let's put event at t=520 — inside DEATH_GSI_POOR's window but outside DEATH_GSI's
const KILL_FOR_SECOND = { id: 70, game_time: 520, type: 'hero_kill', severity: 'success', message: 'k2', snapshot: {} };
const multiResult = buildDeathDigest([DEATH_GSI, DEATH_GSI_POOR, KILL_FOR_SECOND]);
assert(multiResult.length === 2, 'two deaths → two results');
assert(multiResult[0].context.killsNearby.length === 0, 'first death has no kills in its window');
assert(multiResult[1].context.killsNearby.length === 1, 'second death has kill at t=520 in its window');

// ── Slim shape — context entries only expose game_time, message, snapshot ──

console.log('\n── context entry shape ──────────────────────────────────────────────');

const KILL_WITH_EXTRAS = {
  id: 80, game_time: 305, type: 'hero_kill', severity: 'success', message: 'slim test',
  snapshot: { victim: 'Pudge' }, created_at: '2024-01-01',
};
const slimResult = buildDeathDigest([DEATH_GSI, KILL_WITH_EXTRAS]);
const slimEntry = slimResult[0].context.killsNearby[0];
assert(slimEntry.game_time === 305,     'slim entry has game_time');
assert(slimEntry.message === 'slim test', 'slim entry has message');
assert(slimEntry.snapshot?.victim === 'Pudge', 'slim entry has snapshot');
assert(!('id' in slimEntry), 'slim entry does not expose event id');
assert(!('type' in slimEntry), 'slim entry does not expose event type');

// ── Summary ────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(60)}`);
console.log(`openDotaDeathDigest: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
