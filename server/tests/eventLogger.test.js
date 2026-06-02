// Run: node server/tests/eventLogger.test.js

const { logEvents, getEvents, resetForMatch } = require('../eventLogger');

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

// Shared ctx with Centaur profile (next key item: Blink at 2250g)
const CTX = {
  heroProfile: {
    keyItems: ['item_vanguard', 'item_blink', 'item_pipe', 'item_crimson_guard'],
    powerSpikeItems: ['item_blink'],
  },
  suggested: {
    suggestedKeyItem: 'item_blink',
    displayName: '闪烁匕首（Blink Dagger）',
    cost: 2250,
  },
  getPowerSpikeState: () => ({ active: false }),
};

function makeMap(matchId, clock) {
  return {
    matchid: matchId,
    clock_time: clock,
    game_state: 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS',
  };
}

// ── Test 1: latestAliveSnapshot used for death gold ────────────────────────
console.log('\n── death snapshot: goldBeforeDeathPenalty ───────────────────────────');

const MATCH_A = 'evt_test_001';
resetForMatch(MATCH_A);

const aliveTick = {
  map: makeMap(MATCH_A, 600),
  player: { gold: 1800, kills: 0, deaths: 0, assists: 0, gpm: 380, xpm: 420, net_worth: 4200, last_hits: 55 },
  hero: { alive: true, level: 9 },
  items: {
    slot: {
      slot0: { name: 'item_vanguard' },
      slot1: { name: 'item_tpscroll' },
      slot2: { name: 'item_magic_stick' },
    },
    stash: {},
  },
};

// GSI tick when hero is dead: gold already deducted, hero.alive = false
const deadTick = {
  map: makeMap(MATCH_A, 601),
  player: { gold: 1350, kills: 0, deaths: 1, assists: 0, gpm: 380, xpm: 420, net_worth: 3800 },
  hero: { alive: false, level: 9 },
  items: {
    slot: {
      slot0: { name: 'item_vanguard' },
      slot1: { name: 'item_tpscroll' },
      slot2: { name: 'item_magic_stick' },
    },
    stash: {},
  },
};

logEvents(aliveTick, CTX);
logEvents(deadTick, CTX);

const evtsA = getEvents();
const deathEvt = evtsA.find((e) => e.type === 'hero_death');

assert(deathEvt !== undefined, 'death event recorded');
assert(deathEvt.snapshot.goldBeforeDeathPenalty === 1800, 'goldBeforeDeathPenalty from alive tick (1800)');
assert(deathEvt.snapshot.currentGoldAfterDeathIfAvailable === 1350, 'post-death gold from dead tick (1350)');
assert(deathEvt.snapshot.itemsAtDeath.includes('item_vanguard'), 'itemsAtDeath includes item_vanguard from alive tick');
assert(deathEvt.snapshot.itemsAtDeath.includes('item_tpscroll'), 'itemsAtDeath includes tpscroll from alive tick');
assert(deathEvt.snapshot.hadTpAtDeath === true, 'hadTpAtDeath true (TP in alive snapshot)');

// ── Test 2: goldToKeyItemAtDeath computed from alive gold ──────────────────
console.log('\ngoldToKeyItemAtDeath:');

// gold 1800, blink costs 2250 → gap = 450
assert(deathEvt.snapshot.goldToKeyItemAtDeath === 450, 'goldToKeyItemAtDeath = 2250 - 1800 = 450');
assert(deathEvt.snapshot.wasNearKeyItem === true, 'wasNearKeyItem true (450 < 600)');
assert(deathEvt.snapshot.keyItemAtDeath === 'item_blink', 'keyItemAtDeath is item_blink');

// ── Test 3: death without TP ───────────────────────────────────────────────
console.log('\ndeath without TP:');

const MATCH_B = 'evt_test_002';
resetForMatch(MATCH_B);

const aliveNoTp = {
  map: makeMap(MATCH_B, 800),
  player: { gold: 1200, kills: 1, deaths: 0, assists: 2, gpm: 450, xpm: 500, net_worth: 4500 },
  hero: { alive: true, level: 11 },
  items: {
    slot: {
      slot0: { name: 'item_vanguard' },
      slot1: { name: 'item_boots' },
    },
    stash: {},
  },
};

// Suggested: viper has hood as next item (override ctx)
const ctxNoTp = {
  heroProfile: CTX.heroProfile,
  suggested: { suggestedKeyItem: 'item_blink', displayName: '闪烁匕首（Blink Dagger）', cost: 2250 },
  getPowerSpikeState: () => ({ active: false }),
};

const deadNoTp = {
  map: makeMap(MATCH_B, 801),
  player: { gold: 950, kills: 1, deaths: 1, assists: 2, gpm: 450, xpm: 500, net_worth: 4200 },
  hero: { alive: false, level: 11 },
  items: { slot: { slot0: { name: 'item_vanguard' }, slot1: { name: 'item_boots' } }, stash: {} },
};

logEvents(aliveNoTp, ctxNoTp);
logEvents(deadNoTp, ctxNoTp);

const evtsB = getEvents();
const deathEvtB = evtsB.find((e) => e.type === 'hero_death');

assert(deathEvtB !== undefined, 'death event B recorded');
assert(deathEvtB.snapshot.hadTpAtDeath === false, 'hadTpAtDeath false when no TP in alive snapshot');
assert(deathEvtB.snapshot.has_tp === false, 'backward-compat has_tp also false');
assert(deathEvtB.snapshot.goldBeforeDeathPenalty === 1200, 'goldBeforeDeathPenalty from alive snapshot (1200)');
assert(deathEvtB.snapshot.wasNearKeyItem === false, 'wasNearKeyItem false (2250 - 1200 = 1050 > 600)');

// ── Test 4: backward-compat aliases still present ──────────────────────────
console.log('\nbackward-compat aliases:');

assert('pre_key_item' in deathEvt.snapshot, 'pre_key_item alias present');
assert('gold_gap_to_key_item' in deathEvt.snapshot, 'gold_gap_to_key_item alias present');
assert('in_power_spike' in deathEvt.snapshot, 'in_power_spike alias present');
assert('has_tp' in deathEvt.snapshot, 'has_tp alias present');

// ── Test 5: inventory / backpack / stash slot structure ────────────────────
console.log('\ninventoryAtDeath / backpackAtDeath / stashAtDeath:');

assert(typeof deathEvt.snapshot.inventoryAtDeath === 'object', 'inventoryAtDeath is an object');
assert(deathEvt.snapshot.inventoryAtDeath.slot0 === 'item_vanguard', 'inventoryAtDeath.slot0 = item_vanguard');
assert(deathEvt.snapshot.inventoryAtDeath.slot1 === 'item_tpscroll', 'inventoryAtDeath.slot1 = item_tpscroll');
assert(deathEvt.snapshot.inventoryAtDeath.slot2 === 'item_magic_stick', 'inventoryAtDeath.slot2 = item_magic_stick');
assert(deathEvt.snapshot.inventoryAtDeath.slot3 === null, 'inventoryAtDeath.slot3 = null (empty)');
assert(deathEvt.snapshot.inventoryAtDeath.slot4 === null, 'inventoryAtDeath.slot4 = null (empty)');
assert(deathEvt.snapshot.inventoryAtDeath.slot5 === null, 'inventoryAtDeath.slot5 = null (empty)');
assert(typeof deathEvt.snapshot.stashAtDeath === 'object', 'stashAtDeath is an object');

// backpackAtDeath: slot6-slot8 all present, null for empty
assert(typeof deathEvt.snapshot.backpackAtDeath === 'object', 'backpackAtDeath is an object');
assert('slot6' in deathEvt.snapshot.backpackAtDeath, 'backpackAtDeath has slot6');
assert('slot7' in deathEvt.snapshot.backpackAtDeath, 'backpackAtDeath has slot7');
assert('slot8' in deathEvt.snapshot.backpackAtDeath, 'backpackAtDeath has slot8');
assert(deathEvt.snapshot.backpackAtDeath.slot6 === null, 'backpackAtDeath.slot6 = null (empty)');

// ── Test 5b: itemDetailsAtDeath ────────────────────────────────────────────
console.log('\nitemDetailsAtDeath:');

const details = deathEvt.snapshot.itemDetailsAtDeath;
assert(Array.isArray(details), 'itemDetailsAtDeath is an array');
const vanguardDetail = details.find((d) => d.internalName === 'item_vanguard');
assert(vanguardDetail !== undefined, 'itemDetailsAtDeath contains item_vanguard entry');
assert(vanguardDetail.isInventory === true, 'item_vanguard isInventory = true');
assert(vanguardDetail.isBackpack === false, 'item_vanguard isBackpack = false');
assert(vanguardDetail.isStash === false, 'item_vanguard isStash = false');
assert(vanguardDetail.isNeutral === false, 'item_vanguard isNeutral = false');
assert(vanguardDetail.isTeleport === false, 'item_vanguard isTeleport = false');
assert(typeof vanguardDetail.displayName === 'string', 'item_vanguard has displayName string');
assert(vanguardDetail.displayName.includes('先锋盾'), 'item_vanguard displayName contains 先锋盾');

const tpDetail = details.find((d) => d.internalName === 'item_tpscroll');
assert(tpDetail !== undefined, 'itemDetailsAtDeath contains item_tpscroll entry');
assert(tpDetail.isTeleport === true, 'item_tpscroll isTeleport = true');
assert(tpDetail.isInventory === true, 'item_tpscroll isInventory = true');
assert(tpDetail.slot === 'slot1', 'item_tpscroll slot = slot1');

// ── Test 6: extractItemStateForProgression ────────────────────────────────
console.log('\nextractItemStateForProgression:');

const { extractItemStateForProgression } = require('../utils/itemProgression');

const progState = extractItemStateForProgression(deathEvt.snapshot);
assert(Array.isArray(progState.inventoryNames), 'inventoryNames is an array');
assert(progState.inventoryNames.includes('item_vanguard'), 'inventoryNames includes item_vanguard');
assert(Array.isArray(progState.backpackNames), 'backpackNames is an array');
assert(Array.isArray(progState.stashNames), 'stashNames is an array');
assert(progState.neutralName === null, 'neutralName is null (no neutral in alive tick)');
assert(progState.allNames.includes('item_vanguard'), 'allNames includes item_vanguard');

const emptyProg = extractItemStateForProgression(null);
assert(emptyProg.inventoryNames.length === 0, 'null snapshot → empty inventoryNames');
assert(emptyProg.allNames.length === 0, 'null snapshot → empty allNames');

// ── Test 7: no latestAliveSnapshot fallback ────────────────────────────────
console.log('\nno death event when alive never true→false:');

const MATCH_C = 'evt_test_003';
resetForMatch(MATCH_C);

// Send dead tick directly (no prior alive tick)
const directDeadTick = {
  map: makeMap(MATCH_C, 400),
  player: { gold: 800, kills: 0, deaths: 1, assists: 0, gpm: 300, xpm: 350, net_worth: 2000 },
  hero: { alive: false, level: 6 },
  items: { slot: { slot0: { name: 'item_magic_stick' } }, stash: {} },
};

// Inject prevData manually by sending a first tick with same matchId but alive=false
// to set prevData, then a second with alive=false to trigger nothing.
// Instead, use a trick: set prevData via one event, then death
const firstTick = { ...directDeadTick, hero: { alive: true, level: 6 } };
// logEvents with alive=true first sets prevData but no latestAliveSnapshot since gold differs
// Actually resetForMatch already set latestAliveSnapshot=null, and hero.alive=false won't set it
// So: logEvents(firstTick) sets prevData=firstTick, latestAliveSnapshot=firstTick (alive=true)
// Then logEvents(directDeadTick) will find latestAliveSnapshot set

// Let's verify a different edge: immediately after reset, if we only get a dead tick
// (i.e. latestAliveSnapshot is null), it falls back to `data`
const MATCH_D = 'evt_test_004';
resetForMatch(MATCH_D);
// Inject prevData by calling logEvents once with alive=false (edge case: consecutive dead ticks)
// First call: no prevData → won't trigger death detection
const firstDeadTick = {
  map: makeMap(MATCH_D, 100),
  player: { gold: 500, kills: 0, deaths: 1, assists: 0, gpm: 200, xpm: 220 },
  hero: { alive: false, level: 3 },
  items: { slot: {}, stash: {} },
};
const secondDeadTick = {
  map: makeMap(MATCH_D, 101),
  player: { gold: 480, kills: 0, deaths: 1, assists: 0, gpm: 200, xpm: 220 },
  hero: { alive: false, level: 3 },
  items: { slot: {}, stash: {} },
};

logEvents(firstDeadTick, CTX);
logEvents(secondDeadTick, CTX);

const evtsD = getEvents();
// No death event should fire (alive never transitioned from true→false)
assert(evtsD.filter(e => e.type === 'hero_death').length === 0, 'no death event when alive never went true→false');

// ── Summary ────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(55)}`);
console.log(`Results: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
