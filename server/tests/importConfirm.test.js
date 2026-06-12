// Run: node server/tests/importConfirm.test.js
//
// Tests normalizeForMatch (pure) and syntheticMatchId.
// confirmImport needs the raw cache, so it's tested via real DB + mock service injection.

const { normalizeForMatch, syntheticMatchId } = require('../importConfirmService');
const { getHeroInternalName } = require('../data/dotaHeroNames');
const { saveRawOpendotaMatch, getRawOpendotaMatch, getMatchById } = require('../db');
const service = require('../openDotaRawService');

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

// ── Mock raw match ─────────────────────────────────────────────────────────

const RAW_MATCH = {
  match_id:    88001001,
  radiant_win: true,
  duration:    2400,
  start_time:  1700000000,
  players: [
    // Centaur (profile hero, slot 2 = radiant)
    { player_slot: 2, hero_id: 96, account_id: 55501,
      kills: 5, deaths: 2, assists: 8,
      gold_per_min: 450, xp_per_min: 520, last_hits: 120, denies: 5,
      net_worth: 18000, purchase_log: [{ time: 540, key: 'vanguard' }] },
    // Axe (non-profile hero, slot 130 = dire)
    { player_slot: 130, hero_id: 2, account_id: 55502,
      kills: 8, deaths: 5, assists: 4,
      gold_per_min: 520, xp_per_min: 600, last_hits: 200, denies: 12,
      net_worth: 24000, purchase_log: null },
    // Unknown hero, slot 0 (radiant)
    { player_slot: 0, hero_id: 999, account_id: null,
      kills: 1, deaths: 10, assists: 2,
      gold_per_min: 180, xp_per_min: 200, last_hits: 20, denies: 0,
      net_worth: 5000, purchase_log: [] },
  ],
};

const RAW_NULL_RADIANT = {
  match_id:    88001002,
  radiant_win: null,
  duration:    1800,
  start_time:  1700001000,
  players: [
    { player_slot: 1, hero_id: 29, account_id: 55503,
      kills: 2, deaths: 3, assists: 7,
      gold_per_min: 320, xp_per_min: 380, last_hits: 90, denies: 2,
      net_worth: 11000, purchase_log: null },
  ],
};

// ── syntheticMatchId ───────────────────────────────────────────────────────

console.log('\n── syntheticMatchId ─────────────────────────────────────────────────');

assert(syntheticMatchId('88001001', 2)   === '88001001_od2',   'radiant slot 2 → _od2');
assert(syntheticMatchId('88001001', 130) === '88001001_od130', 'dire slot 130 → _od130');
assert(syntheticMatchId('88001001', 0)   === '88001001_od0',   'slot 0 → _od0');

// ── getHeroInternalName: key heroes ──────────────────────────────────────

console.log('\n── getHeroInternalName (used by normalizeForMatch) ──────────────────');

assert(getHeroInternalName(96)  === 'npc_dota_hero_centaur',       '96 → centaur');
assert(getHeroInternalName(29)  === 'npc_dota_hero_tidehunter',    '29 → tidehunter');
assert(getHeroInternalName(36)  === 'npc_dota_hero_necrolyte',     '36 → necrolyte (Necrophos)');
assert(getHeroInternalName(2)   === 'npc_dota_hero_axe',           '2 → axe');
assert(getHeroInternalName(999) === null,                           'unknown hero → null');
assert(getHeroInternalName(null) === null,                          'null → null');

// ── normalizeForMatch: profile hero ──────────────────────────────────────

console.log('\n── normalizeForMatch: profile hero (Centaur, slot 2, radiant) ──────');

const row1 = normalizeForMatch('88001001', 2, RAW_MATCH);

assert(row1.match_id         === '88001001_od2',            'synthetic match_id');
assert(row1.import_match_id  === '88001001',                'import_match_id = dota match id');
assert(row1.hero             === 'npc_dota_hero_centaur',   'hero resolved to internal name');
assert(row1.archetype        === 'teamfight_initiator',     'archetype from profile');
assert(row1.result           === '胜利',                    'radiant player + radiant_win → 胜利');
assert(row1.team             === 'radiant',                 'team = radiant (slot < 128)');
assert(row1.player_slot      === 2,                         'player_slot stored');
assert(row1.account_id       === 55501,                     'account_id stored');
assert(row1.radiant_win      === 1,                         'radiant_win stored as 1');
assert(row1.source           === 'opendota_import',         'source = opendota_import');
assert(typeof row1.imported_at === 'string',                'imported_at is a string');
assert(row1.kills            === 5,                         'kills preserved');
assert(row1.deaths           === 2,                         'deaths preserved');
assert(row1.assists          === 8,                         'assists preserved');
assert(row1.gpm              === 450,                       'gpm preserved');
assert(row1.xpm              === 520,                       'xpm preserved');
assert(row1.last_hits        === 120,                       'last_hits preserved');
assert(row1.denies           === 5,                         'denies preserved');
assert(row1.final_gold       === 18000,                     'final_gold = net_worth');
assert(row1.start_time       === 1700000000,                'start_time preserved');
assert(row1.end_time         === 1700000000 + 2400,         'end_time = start + duration');
assert(row1.role             === 'offlane',                 'role always offlane');
assert(typeof row1.overall_grade === 'string',              'overall_grade computed');
assert(typeof row1.one_thing_to_improve === 'string',       'one_thing_to_improve computed');
assert(row1.pre_key_item_deaths === 0,                      'pre_key_item_deaths = 0');

// ── normalizeForMatch: non-profile hero (Axe, dire) ──────────────────────

console.log('\n── normalizeForMatch: non-profile hero (Axe, slot 130, dire) ───────');

const row2 = normalizeForMatch('88001001', 130, RAW_MATCH);

assert(row2.hero      === 'npc_dota_hero_axe',  'Axe internal name resolved');
assert(row2.archetype === null,                  'no profile → archetype null');
assert(row2.result    === '失败',                'dire player + radiant_win → 失败');
assert(row2.team      === 'dire',                'team = dire (slot >= 128)');
assert(row2.radiant_win === 1,                   'radiant_win reflects MATCH (not player) outcome');

// ── normalizeForMatch: unknown hero (slot 0) ─────────────────────────────

console.log('\n── normalizeForMatch: unknown hero (slot 0) ─────────────────────────');

const row3 = normalizeForMatch('88001001', 0, RAW_MATCH);
assert(row3.hero      === null,    'unknown hero_id → hero null');
assert(row3.account_id === null,   'null account_id preserved');
assert(row3.result    === '胜利',  'radiant slot 0 → 胜利');

// ── normalizeForMatch: null radiantWin ───────────────────────────────────

console.log('\n── normalizeForMatch: null radiantWin ───────────────────────────────');

const row4 = normalizeForMatch('88001002', 1, RAW_NULL_RADIANT);
assert(row4.result     === '未知', 'null radiantWin → result 未知');
assert(row4.radiant_win === null,  'null radiantWin stored as null');

// ── normalizeForMatch: error cases ───────────────────────────────────────

console.log('\n── normalizeForMatch: error cases ───────────────────────────────────');

let threw = false;
try { normalizeForMatch('88001001', 999, RAW_MATCH); } catch { threw = true; }
assert(threw, 'throws on missing player slot');

threw = false;
try { normalizeForMatch('88001001', 2, null); } catch { threw = true; }
assert(threw, 'throws on null rawMatchData');

threw = false;
try { normalizeForMatch('88001001', 2, { match_id: 1 }); } catch { threw = true; }
assert(threw, 'throws on missing players array');

// ── confirmImport: uses DB + cache ────────────────────────────────────────

console.log('\n── confirmImport (via real DB + cache) ──────────────────────────────');

const RUN = Date.now().toString().slice(-7);
const CI_MATCH_ID = `ic_t${RUN}`;

// Manually insert raw cache row (simulates prior fetchAndCache)
saveRawOpendotaMatch(
  CI_MATCH_ID,
  JSON.stringify({ ...RAW_MATCH, match_id: CI_MATCH_ID }),
  'ok',
  JSON.stringify([])
);

const { confirmImport } = require('../importConfirmService');

const result = confirmImport(CI_MATCH_ID, 2);
assert(result.match_id        === `${CI_MATCH_ID}_od2`, 'confirmImport returns synthetic match_id');
assert(result.import_match_id === CI_MATCH_ID,          'confirmImport returns import_match_id');
assert(result.player_slot     === 2,                    'confirmImport returns player_slot');
assert(typeof result.result   === 'string',             'confirmImport returns result');
assert(typeof result.grade    === 'string',             'confirmImport returns grade');
assert(typeof result.events_count === 'number',         'confirmImport returns events_count');
assert(result.events_count >= 1,                        'at least 1 event (game_end)');
assert(typeof result.deathStats === 'object',           'confirmImport returns deathStats');
assert(result.deathStats.total === 2,                   'deathStats.total = 2 (Centaur deaths in RAW_MATCH)');
assert(result.deathStats.reconstructed === 0,           'deathStats.reconstructed = 0 (no kills_log)');
assert(result.deathStats.missing === 2,                 'deathStats.missing = 2 (no kills_log)');

// Verify match_events were written to DB
const synId   = `${CI_MATCH_ID}_od2`;
const detail  = getMatchById(synId);
assert(detail !== null,                        'getMatchById returns result after confirmImport');
assert(Array.isArray(detail.events),           'events array present in detail');
assert(detail.events.length > 0,              'events array non-empty');
assert(detail.events.length === result.events_count, 'DB event count matches returned events_count');

// All events share the synthetic match_id
assert(detail.events.every(e => e.match_id === synId), 'all events have synthetic match_id');

// game_end always present
const gameEnd = detail.events.find(e => e.type === 'game_end');
assert(gameEnd != null, 'game_end event present in DB');
assert(gameEnd.severity === 'success', 'Centaur radiant slot + radiant_win=true → success');

// item_purchased for vanguard (purchase_log has { time: 540, key: 'vanguard' })
const purchasedEvent = detail.events.find(e => e.type === 'item_purchased');
assert(purchasedEvent != null, 'item_purchased event present in DB');
assert(purchasedEvent.snapshot?.item === 'item_vanguard', 'vanguard purchase snapshot.item correct');
assert(purchasedEvent.snapshot?.source === 'opendota_import', 'purchase snapshot.source = opendota_import');

// key_item_completed for vanguard (it is the first key item in centaur profile)
const keyItemEvent = detail.events.find(e => e.type === 'key_item_completed');
assert(keyItemEvent != null, 'key_item_completed event present in DB');

// Duplicate import → DUPLICATE error
let dupErr = null;
try { confirmImport(CI_MATCH_ID, 2); } catch (e) { dupErr = e; }
assert(dupErr !== null,             'second import throws');
assert(dupErr.code === 'DUPLICATE', 'duplicate error code = DUPLICATE');

// Missing cache → CACHE_MISS error
let cacheErr = null;
try { confirmImport(`missing_${RUN}`, 0); } catch (e) { cacheErr = e; }
assert(cacheErr !== null,              'missing cache throws');
assert(cacheErr.code === 'CACHE_MISS', 'missing cache error code = CACHE_MISS');

// ── confirmImport: kill/death events + tower-death deathStats ─────────────

console.log('\n── confirmImport with kills_log (hero_kill / hero_death events) ───────');

// Centaur (slot 2) kills Axe at t=600; dies to Axe at t=400 and Pudge at t=700.
// Player.deaths = 3 — the third death is a tower kill not in any kills_log.
const RAW_MATCH_KILLS = {
  match_id:    88001010,
  radiant_win: true,
  duration:    2400,
  start_time:  1700002000,
  players: [
    {
      player_slot: 2, hero_id: 96, account_id: 55520,
      kills: 1, deaths: 3, assists: 2,
      gold_per_min: 400, xp_per_min: 460, last_hits: 95, denies: 3,
      net_worth: 14000,
      kills_log: [{ time: 600, key: 'npc_dota_hero_axe' }],
      purchase_log: [{ time: 540, key: 'vanguard' }],
    },
    {
      player_slot: 130, hero_id: 2, account_id: 55521,  // Axe
      kills: 1, deaths: 1, assists: 0,
      gold_per_min: 460, xp_per_min: 530, last_hits: 170, denies: 7,
      net_worth: 19000,
      kills_log: [{ time: 400, key: 'npc_dota_hero_centaur' }],
      purchase_log: null,
    },
    {
      player_slot: 1, hero_id: 14, account_id: 55522,   // Pudge
      kills: 2, deaths: 1, assists: 1,
      gold_per_min: 350, xp_per_min: 390, last_hits: 75, denies: 2,
      net_worth: 12000,
      kills_log: [{ time: 700, key: 'npc_dota_hero_centaur' }],
      purchase_log: null,
    },
  ],
};

const RUN2 = (Date.now() + 1).toString().slice(-7);
const CI_MATCH_ID_2 = `ic_kd${RUN2}`;

saveRawOpendotaMatch(
  CI_MATCH_ID_2,
  JSON.stringify({ ...RAW_MATCH_KILLS, match_id: CI_MATCH_ID_2 }),
  'ok',
  JSON.stringify([])
);

const result2 = confirmImport(CI_MATCH_ID_2, 2);

// deathStats: 2 reconstructed (Axe + Pudge kills), 1 missing (tower), total 3
assert(typeof result2.deathStats === 'object',        'result2 has deathStats');
assert(result2.deathStats.total         === 3,        'deathStats.total = 3');
assert(result2.deathStats.reconstructed === 2,        'deathStats.reconstructed = 2');
assert(result2.deathStats.missing       === 1,        'deathStats.missing = 1 (tower kill)');

const synId2   = `${CI_MATCH_ID_2}_od2`;
const detail2  = getMatchById(synId2);
assert(detail2 !== null,                              'getMatchById returns result');

const kills2  = detail2.events.filter(e => e.type === 'hero_kill');
const deaths2 = detail2.events.filter(e => e.type === 'hero_death');

assert(kills2.length  === 1, `1 hero_kill event (got ${kills2.length})`);
assert(deaths2.length === 2, `2 hero_death events — tower death absent (got ${deaths2.length})`);

// hero_kill shape in DB
const k1 = kills2[0];
assert(k1.game_time === 600,              'hero_kill at t=600');
assert(k1.severity  === 'success',        'hero_kill severity = success');
assert(k1.message   === '击杀 Axe',      'hero_kill message');
assert(k1.snapshot.killNumber   === 1,    'hero_kill snapshot.killNumber = 1');
assert(k1.snapshot.source === 'opendota_import', 'hero_kill snapshot.source');

// hero_death shapes in DB
const d1 = deaths2[0];
const d2 = deaths2[1];
assert(d1.game_time === 400,                          'first hero_death at t=400');
assert(d1.severity  === 'danger',                     'hero_death severity = danger');
assert(d1.message   === '被 Axe 击杀（第 1 次）',    'first hero_death message (Axe)');
assert(d1.snapshot.deathNumber === 1,                 'first hero_death deathNumber = 1');
assert(!('goldBeforeDeathPenalty' in d1.snapshot),    'no GSI gold field in hero_death snapshot');
assert(!('itemsAtDeath'           in d1.snapshot),    'no itemsAtDeath in hero_death snapshot');

assert(d2.game_time === 700,                          'second hero_death at t=700');
assert(d2.message   === '被 Pudge 击杀（第 2 次）',  'second hero_death message (Pudge)');
assert(d2.snapshot.deathNumber === 2,                 'second hero_death deathNumber = 2');

// All events (excluding game_end) must be in chronological order
const timedEvents = detail2.events.filter(e => e.type !== 'game_end');
for (let i = 1; i < timedEvents.length; i++) {
  assert(
    timedEvents[i].game_time >= timedEvents[i - 1].game_time,
    `events sorted at index ${i}: t=${timedEvents[i - 1].game_time} → t=${timedEvents[i].game_time}`
  );
}

// pre_key_item_deaths in the matches row:
//   Reconstructed deaths at t=400 (Axe) and t=700 (Pudge); vanguard at t=540
//   t=400: vanguard at 540 > 400 → pre-key-item ✓
//   t=700: vanguard done, blink not purchased → pre-key-item ✓
//   → pre_key_item_deaths = 2 (both reconstructed deaths are pre-key-item)
assert(detail2.match.pre_key_item_deaths === 2,
  'pre_key_item_deaths = 2 (both reconstructed deaths are pre-key-item)');

// deaths_before_completion in key_item_timings:
//   vanguard completed at t=540 → deaths < 540 = [400].length = 1
//   blink not completed → all reconstructed deaths = 2
const vgTiming = detail2.keyItemTimings.find(t => t.item_name === 'item_vanguard');
assert(vgTiming != null,                           'vanguard timing row present in DB');
assert(vgTiming.deaths_before_completion === 1,
  'vanguard deaths_before_completion = 1 (death at t=400 < t=540)');

const blTiming = detail2.keyItemTimings.find(t => t.item_name === 'item_blink');
assert(blTiming != null,                           'blink timing row present in DB');
assert(blTiming.deaths_before_completion === 2,
  'blink deaths_before_completion = 2 (not completed → all 2 reconstructed deaths)');

// confirmImport return value includes pre_key_item_deaths
assert(result2.pre_key_item_deaths === 2, 'result2.pre_key_item_deaths = 2');

// ── Summary ────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(55)}`);
console.log(`Results: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
