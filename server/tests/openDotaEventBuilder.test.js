// Run: node server/tests/openDotaEventBuilder.test.js

const { buildEventsFromOpenDota, buildKillDeathEvents, isConsumable, CONSUMABLE_ITEMS } = require('../openDotaEventBuilder');
const { analyzeKeyItemTimings } = require('../openDotaKeyItemAnalyzer');
const { PROFILES } = require('../data/offlaneHeroProfiles');

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

const CENTAUR_PROFILE = PROFILES['centaur'];

const CENTAUR_PLAYER = {
  player_slot: 2,
  purchase_log: [
    { time: -90,  key: 'tango' },
    { time: -60,  key: 'clarity' },
    { time:  300, key: 'vanguard' },
    { time:  700, key: 'blink' },
    { time: 1100, key: 'pipe' },
    { time: 1400, key: 'tpscroll' },
    { time: 1600, key: 'tango' },
  ],
};

const MATCH_INFO_RADIANT_WIN = { duration: 2400, radiantWin: true,  team: 'radiant' };
const MATCH_INFO_RADIANT_LOSS = { duration: 2400, radiantWin: false, team: 'radiant' };
const MATCH_INFO_DIRE_WIN     = { duration: 2400, radiantWin: false, team: 'dire'    };
const MATCH_INFO_DIRE_LOSS    = { duration: 2400, radiantWin: true,  team: 'dire'    };
const MATCH_INFO_NULL_WIN     = { duration: 2400, radiantWin: null,  team: 'radiant' };

// ── isConsumable ───────────────────────────────────────────────────────────

console.log('\n── isConsumable ─────────────────────────────────────────────────────');

assert(isConsumable('item_tango'),           'tango is consumable');
assert(isConsumable('item_clarity'),         'clarity is consumable');
assert(isConsumable('item_flask'),           'flask is consumable');
assert(isConsumable('item_enchanted_mango'), 'enchanted_mango is consumable');
assert(isConsumable('item_faerie_fire'),     'faerie_fire is consumable');
assert(isConsumable('item_tpscroll'),        'tpscroll is consumable');
assert(isConsumable('item_smoke_of_deceit'), 'smoke_of_deceit is consumable');
assert(isConsumable('item_infused_raindrop'),'infused_raindrop is consumable');
assert(isConsumable('item_ward_observer'),   'ward_observer is consumable');
assert(isConsumable('item_ward_sentry'),     'ward_sentry is consumable');
assert(isConsumable('item_ward_dispenser'),  'ward_dispenser is consumable');
assert(isConsumable('item_dust'),            'dust is consumable');

assert(!isConsumable('item_blink'),          'blink NOT consumable');
assert(!isConsumable('item_vanguard'),       'vanguard NOT consumable');
assert(!isConsumable('item_bottle'),         'bottle NOT consumable');
assert(!isConsumable('item_aghanims_scepter'), 'aghanims_scepter NOT consumable');
assert(!isConsumable(null),                  'null → false');
assert(!isConsumable(''),                    'empty string → false');

// ── Normal purchase_log: event counts and structure ────────────────────────

console.log('\n── Normal purchase_log (Centaur, radiant win) ───────────────────────');

const eventsNormal = buildEventsFromOpenDota(CENTAUR_PLAYER, CENTAUR_PROFILE, MATCH_INFO_RADIANT_WIN);

// 7 purchases + key_item_completed (vanguard, blink, pipe) + power_spike (blink) + game_end
// vanguard is NOT a power spike; blink IS; pipe is NOT
const keyItemCompleted = eventsNormal.filter(e => e.type === 'key_item_completed');
const powerSpikeStarted = eventsNormal.filter(e => e.type === 'power_spike_started');
const itemPurchased = eventsNormal.filter(e => e.type === 'item_purchased');
const gameEnd = eventsNormal.find(e => e.type === 'game_end');

assert(itemPurchased.length === 7, `7 item_purchased events (got ${itemPurchased.length})`);
assert(keyItemCompleted.length === 3, `3 key_item_completed (vanguard, blink, pipe) (got ${keyItemCompleted.length})`);
assert(powerSpikeStarted.length === 1, `1 power_spike_started (blink) (got ${powerSpikeStarted.length})`);
assert(gameEnd != null, 'game_end event present');

// Chronological order
for (let i = 1; i < eventsNormal.length; i++) {
  assert(eventsNormal[i].game_time >= eventsNormal[i - 1].game_time, `events in order at index ${i}`);
}

// ── Field shapes ───────────────────────────────────────────────────────────

console.log('\n── Field shapes ─────────────────────────────────────────────────────');

const tangoEvent = itemPurchased.find(e => e.snapshot?.item === 'item_tango');
assert(tangoEvent != null, 'tango purchase event found');
assert(tangoEvent.game_time === -90, 'negative time preserved (-90)');
assert(tangoEvent.type === 'item_purchased', 'type = item_purchased');
assert(tangoEvent.severity === 'info', 'severity = info');
assert(typeof tangoEvent.message === 'string', 'message is string');
assert(tangoEvent.message.includes('购买'), 'message contains 购买');
assert(tangoEvent.snapshot.isConsumable === true, 'tango snapshot.isConsumable = true');
assert(tangoEvent.snapshot.source === 'opendota_import', 'snapshot.source = opendota_import');

const blinkPurchase = itemPurchased.find(e => e.snapshot?.item === 'item_blink');
assert(blinkPurchase != null, 'blink purchase event found');
assert(blinkPurchase.snapshot.isConsumable === false, 'blink snapshot.isConsumable = false');

const blinkCompleted = keyItemCompleted.find(e => e.snapshot?.item === 'item_blink');
assert(blinkCompleted != null, 'blink key_item_completed event found');
assert(blinkCompleted.game_time === 700, 'blink completed at t=700');
assert(blinkCompleted.snapshot.source === 'opendota_import', 'key item snapshot.source = opendota_import');

const blinkSpike = powerSpikeStarted.find(e => e.snapshot?.item === 'item_blink');
assert(blinkSpike != null, 'blink power_spike_started event found');
assert(blinkSpike.game_time === 700, 'power_spike at t=700 (same as key item completion)');

// Duplicate purchases: tango appears at t=-90 and t=1600
const allTangos = itemPurchased.filter(e => e.snapshot?.item === 'item_tango');
assert(allTangos.length === 2, 'both tango purchases recorded (not deduped)');

// ── Key item consistency with analyzeKeyItemTimings ────────────────────────

console.log('\n── Cross-validation with analyzeKeyItemTimings ───────────────────────');

const synId = 'test_match_001_od2';
const timingResult = analyzeKeyItemTimings(synId, CENTAUR_PLAYER, CENTAUR_PROFILE);

assert(timingResult.available === true, 'analyzeKeyItemTimings available=true');

// For each completed key item, both sources should agree on the completed_time
for (const timing of timingResult.timings) {
  if (!timing.completed) continue;
  const builtEvent = keyItemCompleted.find(e => e.snapshot?.item === timing.item_name);
  assert(builtEvent != null, `key_item_completed event found for ${timing.item_name}`);
  assert(builtEvent.game_time === timing.completed_time,
    `${timing.item_name}: event time ${builtEvent.game_time} === timing ${timing.completed_time}`);
}

// ── Missing purchase_log → only game_end ──────────────────────────────────

console.log('\n── Missing purchase_log → only game_end ─────────────────────────────');

const playerNoPurchase = { player_slot: 0, purchase_log: null };
const eventsNoPurchase = buildEventsFromOpenDota(playerNoPurchase, CENTAUR_PROFILE, MATCH_INFO_RADIANT_WIN);

assert(eventsNoPurchase.length === 1, `only 1 event (game_end) when purchase_log=null (got ${eventsNoPurchase.length})`);
assert(eventsNoPurchase[0].type === 'game_end', 'event type is game_end');

const playerEmptyPurchase = { player_slot: 0, purchase_log: [] };
const eventsEmpty = buildEventsFromOpenDota(playerEmptyPurchase, CENTAUR_PROFILE, MATCH_INFO_RADIANT_WIN);
assert(eventsEmpty.length === 1, 'only game_end when purchase_log=[]');

// ── profile = null → no key item events ───────────────────────────────────

console.log('\n── profile = null (non-profile hero) ────────────────────────────────');

const eventsNoProfile = buildEventsFromOpenDota(CENTAUR_PLAYER, null, MATCH_INFO_RADIANT_WIN);
const noProfileKeyItems = eventsNoProfile.filter(e => e.type === 'key_item_completed');
const noProfileSpike    = eventsNoProfile.filter(e => e.type === 'power_spike_started');
const noProfilePurchases = eventsNoProfile.filter(e => e.type === 'item_purchased');

assert(noProfileKeyItems.length === 0, 'no key_item_completed when profile=null');
assert(noProfileSpike.length === 0,    'no power_spike_started when profile=null');
assert(noProfilePurchases.length === 7,'item_purchased events still generated');
assert(eventsNoProfile.some(e => e.type === 'game_end'), 'game_end still generated');

// ── game_end win/loss in all 4 team × radiantWin combinations ─────────────

console.log('\n── game_end win/loss combinations ───────────────────────────────────');

const playerMin = { player_slot: 0, purchase_log: null };

const eRadiantWin  = buildEventsFromOpenDota(playerMin, null, MATCH_INFO_RADIANT_WIN).find(e => e.type === 'game_end');
const eRadiantLoss = buildEventsFromOpenDota(playerMin, null, MATCH_INFO_RADIANT_LOSS).find(e => e.type === 'game_end');
const eDireWin     = buildEventsFromOpenDota(playerMin, null, MATCH_INFO_DIRE_WIN).find(e => e.type === 'game_end');
const eDireLoss    = buildEventsFromOpenDota(playerMin, null, MATCH_INFO_DIRE_LOSS).find(e => e.type === 'game_end');
const eNullWin     = buildEventsFromOpenDota(playerMin, null, MATCH_INFO_NULL_WIN).find(e => e.type === 'game_end');

assert(eRadiantWin.severity  === 'success', 'radiant + radiant_win=true → success');
assert(eRadiantWin.message.includes('胜利'), 'radiant win → 胜利');
assert(eRadiantLoss.severity === 'danger',  'radiant + radiant_win=false → danger');
assert(eRadiantLoss.message.includes('失败'), 'radiant loss → 失败');
assert(eDireWin.severity     === 'success', 'dire + radiant_win=false (dire wins) → success');
assert(eDireWin.message.includes('胜利'),  'dire win → 胜利');
assert(eDireLoss.severity    === 'danger',  'dire + radiant_win=true (radiant wins, dire loses) → danger');
assert(eDireLoss.message.includes('失败'), 'dire loss → 失败');
assert(eNullWin.severity     === 'info',    'null radiant_win → info (unknown)');
assert(eNullWin.message.includes('未知'),  'null radiant_win → 未知');

assert(eRadiantWin.game_time === 2400, 'game_end game_time = duration');

// ── buildKillDeathEvents ──────────────────────────────────────────────────

console.log('\n── buildKillDeathEvents ─────────────────────────────────────────────');

const kd = buildKillDeathEvents({
  kills:  [{ time: 300, victim: 'Axe' }, { time: 650, victim: '电魂（Razor）' }],
  deaths: [{ time: 420, killer: 'Pudge' }],
});

const heroKills  = kd.filter(e => e.type === 'hero_kill');
const heroDeaths = kd.filter(e => e.type === 'hero_death');

assert(heroKills.length  === 2, `2 hero_kill events (got ${heroKills.length})`);
assert(heroDeaths.length === 1, `1 hero_death event (got ${heroDeaths.length})`);

// hero_kill shape
const k1 = heroKills[0];
assert(k1.game_time === 300,               'kill 1 game_time = 300');
assert(k1.type      === 'hero_kill',       'kill type = hero_kill');
assert(k1.severity  === 'success',         'kill severity = success');
assert(k1.message   === '击杀 Axe',       'kill 1 message');
assert(k1.snapshot.victim            === 'Axe',             'kill 1 snapshot.victim');
assert(k1.snapshot.victimDisplayName === 'Axe',             'kill 1 snapshot.victimDisplayName');
assert(k1.snapshot.killNumber        === 1,                  'kill 1 snapshot.killNumber = 1');
assert(k1.snapshot.source            === 'opendota_import', 'kill 1 snapshot.source');
assert(!('goldBeforeDeathPenalty' in k1.snapshot), 'no GSI gold field in kill snapshot');
assert(!('itemsAtDeath'           in k1.snapshot), 'no itemsAtDeath in kill snapshot');

const k2 = heroKills[1];
assert(k2.game_time === 650,                       'kill 2 game_time = 650');
assert(k2.snapshot.killNumber === 2,               'kill 2 snapshot.killNumber = 2');
assert(k2.message === '击杀 电魂（Razor）',        'kill 2 message with Chinese name');
assert(k2.snapshot.victim === '电魂（Razor）',     'kill 2 snapshot.victim = Chinese name');

// hero_death shape
const d1 = heroDeaths[0];
assert(d1.game_time === 420,                        'death game_time = 420');
assert(d1.type      === 'hero_death',               'death type = hero_death');
assert(d1.severity  === 'danger',                   'death severity = danger');
assert(d1.message   === '被 Pudge 击杀（第 1 次）', 'death 1 message');
assert(d1.snapshot.killer            === 'Pudge',             'death 1 snapshot.killer');
assert(d1.snapshot.killerDisplayName === 'Pudge',             'death 1 snapshot.killerDisplayName');
assert(d1.snapshot.deathNumber       === 1,                    'death 1 snapshot.deathNumber = 1');
assert(d1.snapshot.source            === 'opendota_import',   'death 1 snapshot.source');
assert(!('goldBeforeDeathPenalty' in d1.snapshot), 'no goldBeforeDeathPenalty in death snapshot');
assert(!('itemsAtDeath'           in d1.snapshot), 'no itemsAtDeath in death snapshot');
assert(!('inventoryAtDeath'       in d1.snapshot), 'no inventoryAtDeath in death snapshot');
assert(!('gpmAtDeath'             in d1.snapshot), 'no gpmAtDeath in death snapshot');

// Multiple deaths — deathNumber increments
const kdMulti = buildKillDeathEvents({
  kills:  [],
  deaths: [
    { time: 100, killer: 'Axe'   },
    { time: 300, killer: 'Pudge' },
    { time: 500, killer: 'Axe'   },
  ],
});
const multiDeaths = kdMulti.filter(e => e.type === 'hero_death');
assert(multiDeaths.length === 3,              '3 hero_death events');
assert(multiDeaths[0].snapshot.deathNumber === 1, 'first death deathNumber = 1');
assert(multiDeaths[1].snapshot.deathNumber === 2, 'second death deathNumber = 2');
assert(multiDeaths[2].snapshot.deathNumber === 3, 'third death deathNumber = 3');
assert(multiDeaths[1].message === '被 Pudge 击杀（第 2 次）', 'second death message');

// Empty input → empty array
const kdEmpty   = buildKillDeathEvents({ kills: [], deaths: [] });
assert(kdEmpty.length === 0, 'empty kills/deaths → empty array');

// Missing fields default to empty arrays
const kdDefault = buildKillDeathEvents({});
assert(kdDefault.length === 0, 'missing kills/deaths properties → empty array');

// No-arg call → empty array
const kdNoArg   = buildKillDeathEvents();
assert(kdNoArg.length === 0, 'no-arg call → empty array');

// ── Summary ────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(55)}`);
console.log(`Results: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
