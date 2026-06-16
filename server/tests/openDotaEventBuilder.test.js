// Run: node server/tests/openDotaEventBuilder.test.js

const { buildEventsFromOpenDota, buildKillDeathEvents, buildObjectiveEvents, isConsumable, CONSUMABLE_ITEMS } = require('../openDotaEventBuilder');
const { analyzeKeyItemTimings } = require('../openDotaKeyItemAnalyzer');
const { PROFILES } = require('../data/offlaneHeroProfiles');
const { heroDisplayNameFromInternal } = require('../openDotaKillDeathExtractor');

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

// ── buildObjectiveEvents ─────────────────────────────────────────────────

console.log('\n── buildObjectiveEvents ──────────────────────────────────────────────');

// Fixture mirrors real objectives[] shapes seen in cached match 8849623934
// (parsed_status='ok') — tower1 (with lane), tower4 (no lane), barracks,
// roshan, plus irrelevant chat-message types and an uncredited creep kill.
const OBJECTIVES_FIXTURE = [
  { time: 61,   type: 'CHAT_MESSAGE_FIRSTBLOOD', key: '0', slot: 6, player_slot: 129 },
  { time: 828,  type: 'building_kill', unit: 'npc_dota_hero_razor',       key: 'npc_dota_goodguys_tower1_bot', slot: 7, player_slot: 130 },
  { time: 966,  type: 'building_kill', unit: 'npc_dota_hero_drow_ranger', key: 'npc_dota_badguys_tower1_mid',  slot: 3, player_slot: 3 },
  { time: 1164, type: 'building_kill', unit: 'npc_dota_creep_goodguys_ranged', key: 'npc_dota_badguys_tower1_bot' }, // no player credit
  { time: 1570, type: 'CHAT_MESSAGE_COURIER_LOST', team: 3, value: 100, killer: 1 },
  { time: 1677, type: 'CHAT_MESSAGE_ROSHAN_KILL', team: 2 },
  { time: 1677, type: 'CHAT_MESSAGE_AEGIS', slot: 3, player_slot: 3 },
  { time: 1775, type: 'building_kill', unit: 'npc_dota_hero_drow_ranger', key: 'npc_dota_badguys_range_rax_mid',  slot: 3, player_slot: 3 },
  { time: 1927, type: 'building_kill', unit: 'npc_dota_hero_void_spirit', key: 'npc_dota_badguys_melee_rax_mid', slot: 1, player_slot: 1 },
  { time: 2427, type: 'building_kill', unit: 'npc_dota_hero_drow_ranger', key: 'npc_dota_badguys_tower4',        slot: 3, player_slot: 3 },
  { time: 2458, type: 'building_kill', unit: 'npc_dota_hero_drow_ranger', key: 'npc_dota_badguys_fort',          slot: 3, player_slot: 3 }, // ancient — not a recognized key
];

// Imported player is Razor at player_slot 130 (dire) — same as the real match.
const objEvents = buildObjectiveEvents(OBJECTIVES_FIXTURE, 130);

assert(objEvents.every(e => e.type === 'objective'), 'every event has type objective');
assert(objEvents.every(e => e.snapshot.source === 'opendota_import'), 'every snapshot.source = opendota_import');

// Imported player (Razor, slot 130) is on dire. tower1 destroys a *radiant* (goodguys)
// tower — an enemy structure from our dire player's perspective → 'success'.
const tower1 = objEvents.find(e => e.game_time === 828);
assert(tower1 !== undefined,                          'tower1 (radiant, bot) event built');
assert(tower1.snapshot.objectiveType === 'tower',      'tower1 objectiveType = tower');
assert(tower1.snapshot.team === 'radiant',             'tower1 team = radiant (structure destroyed belonged to radiant)');
assert(tower1.snapshot.lane === 'bot',                 'tower1 lane = bot');
assert(tower1.snapshot.tier === 1,                     'tower1 tier = 1');
assert(tower1.snapshot.barrackType === null,           'tower1 barrackType = null');
assert(tower1.snapshot.executedBy === heroDisplayNameFromInternal('npc_dota_hero_razor'), 'tower1 executedBy resolved from unit');
assert(tower1.severity === 'success',                  'tower1 severity = success (enemy/radiant structure destroyed)');

// tower1Dire destroys a *dire* (badguys) tower — our own (dire) structure → 'danger'.
const tower1Dire = objEvents.find(e => e.game_time === 966);
assert(tower1Dire.snapshot.team === 'dire',            'tower1Dire team = dire');
assert(tower1Dire.snapshot.lane === 'mid',             'tower1Dire lane = mid');
assert(tower1Dire.snapshot.tier === 1,                 'tower1Dire tier = 1');
assert(tower1Dire.severity === 'danger',               'tower1Dire severity = danger (own/dire structure destroyed)');

// tower4 — no lane suffix in key
const tower4 = objEvents.find(e => e.game_time === 2427);
assert(tower4 !== undefined,                'tower4 (no-lane ancient tower) event built');
assert(tower4.snapshot.objectiveType === 'tower', 'tower4 objectiveType = tower');
assert(tower4.snapshot.lane === null,       'tower4 lane = null (no lane in key)');
assert(tower4.snapshot.tier === 4,          'tower4 tier = 4');

// barracks — ranged
const raxRanged = objEvents.find(e => e.game_time === 1775);
assert(raxRanged !== undefined,                       'range_rax event built');
assert(raxRanged.snapshot.objectiveType === 'barracks', 'range_rax objectiveType = barracks');
assert(raxRanged.snapshot.barrackType === 'ranged',    'range_rax barrackType = ranged');
assert(raxRanged.snapshot.lane === 'mid',              'range_rax lane = mid');
assert(raxRanged.snapshot.tier === null,               'range_rax tier = null');

// barracks — melee
const raxMelee = objEvents.find(e => e.game_time === 1927);
assert(raxMelee !== undefined,                        'melee_rax event built');
assert(raxMelee.snapshot.barrackType === 'melee',      'melee_rax barrackType = melee');

// roshan
const roshan = objEvents.find(e => e.snapshot.objectiveType === 'roshan');
assert(roshan !== undefined,                  'roshan event built');
assert(roshan.game_time === 1677,             'roshan game_time = 1677');
assert(roshan.snapshot.team === 'radiant',    'roshan team = radiant (OpenDota team:2)');
assert(roshan.snapshot.lane === null,         'roshan lane = null');
assert(roshan.snapshot.tier === null,         'roshan tier = null');
assert(roshan.snapshot.barrackType === null,  'roshan barrackType = null');
assert(roshan.snapshot.executedBy === null,   'roshan executedBy = null (not credited by OpenDota)');
assert(roshan.snapshot.key === null,          'roshan key = null (no raw key on this entry)');
assert(roshan.severity === 'warning',         'roshan severity = warning');

// executedBy null when destroyer is a creep (no player credit)
const creepKill = objEvents.find(e => e.game_time === 1164);
assert(creepKill !== undefined,               'creep-destroyed tower event still built');
assert(creepKill.snapshot.executedBy === null, 'creep kill → executedBy = null');

// fort/Ancient key — not tower/barracks/roshan, silently skipped
assert(objEvents.find(e => e.game_time === 2458) === undefined, 'fort/Ancient key skipped (not a recognized objective)');

// Unknown chat-message types — silently skipped, no thrown errors
assert(objEvents.find(e => e.game_time === 61)   === undefined, 'CHAT_MESSAGE_FIRSTBLOOD skipped');
assert(objEvents.find(e => e.game_time === 1570) === undefined, 'CHAT_MESSAGE_COURIER_LOST skipped');
// CHAT_MESSAGE_AEGIS shares game_time 1677 with the roshan kill — only one event (roshan) should exist there
assert(objEvents.filter(e => e.game_time === 1677).length === 1, 'CHAT_MESSAGE_AEGIS skipped (only the roshan event remains at time 1677)');

// Recognized objective count: tower1 x2 (incl. creep-destroyed) + tower4 + rax x2 + roshan = 7
// (fort + 4 chat-message types excluded from the 11 raw fixture entries)
assert(objEvents.length === 7, `7 recognized objective events out of ${OBJECTIVES_FIXTURE.length} raw entries (got ${objEvents.length})`);

// Sorted by game_time ascending
const objTimes = objEvents.map(e => e.game_time);
const objTimesSorted = [...objTimes].sort((a, b) => a - b);
assert(JSON.stringify(objTimes) === JSON.stringify(objTimesSorted), 'objective events sorted by game_time ascending');

// rawObjectives null/empty → []
assert(buildObjectiveEvents(null, 130).length === 0,  'null rawObjectives → []');
assert(buildObjectiveEvents([], 130).length === 0,    '[] rawObjectives → []');
assert(buildObjectiveEvents(undefined, 130).length === 0, 'undefined rawObjectives → []');

// Unknown type mixed with valid entries → array length matches only recognized entries (no throw)
const unknownTypeFixture = [
  { time: 100, type: 'SOME_UNKNOWN_FUTURE_TYPE', foo: 'bar' },
  { time: 200, type: 'building_kill', unit: 'npc_dota_hero_axe', key: 'npc_dota_badguys_tower1_top', player_slot: 0 },
];
const unknownTypeEvents = buildObjectiveEvents(unknownTypeFixture, 130);
assert(unknownTypeEvents.length === 1, 'unknown type entry skipped, only the recognized one remains');

// ── buildObjectiveEvents merged into the full import event stream ─────────

console.log('\n── buildObjectiveEvents merge into combined event stream ────────────');

const kdForMerge = { kills: [{ time: 500, victim: 'Pudge' }], deaths: [{ time: 1500, killer: 'Axe' }] };
const purchaseForMerge = buildEventsFromOpenDota(CENTAUR_PLAYER, CENTAUR_PROFILE, MATCH_INFO_RADIANT_WIN);
const kdEventsForMerge = buildKillDeathEvents(kdForMerge);
const objEventsForMerge = buildObjectiveEvents(OBJECTIVES_FIXTURE, 130);
const merged = [...purchaseForMerge, ...kdEventsForMerge, ...objEventsForMerge].sort((a, b) => a.game_time - b.game_time);

const mergedTimes = merged.map(e => e.game_time);
const mergedTimesSorted = [...mergedTimes].sort((a, b) => a - b);
assert(JSON.stringify(mergedTimes) === JSON.stringify(mergedTimesSorted), 'merged event stream (purchases + kills/deaths + objectives) sorted by game_time');
assert(merged.some(e => e.type === 'objective'),       'merged stream contains objective events');
assert(merged.some(e => e.type === 'item_purchased'),   'merged stream still contains item_purchased events');
assert(merged.some(e => e.type === 'hero_kill'),        'merged stream still contains hero_kill events');
assert(merged.some(e => e.type === 'hero_death'),       'merged stream still contains hero_death events');
assert(merged.length === purchaseForMerge.length + kdEventsForMerge.length + objEventsForMerge.length, 'merged length = sum of all three sources');

// ── Summary ────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(55)}`);
console.log(`Results: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
