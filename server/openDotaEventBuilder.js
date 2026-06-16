'use strict';

// Builds match_events from an OpenDota raw player object.
//
// Pure functions — no DB reads, no network. Designed to be called from
// importConfirmService after the matches row has been written.
//
// Field names match the GSI-originated event schema exactly:
//   game_time (integer seconds), type, severity, message, snapshot (object).

const { opendotaKeyToItemName }       = require('./matchImporter');
const { buildPurchaseMap }            = require('./openDotaKeyItemAnalyzer');
const { getDisplayName }              = require('./data/itemLocalization');
const { heroDisplayNameFromInternal } = require('./openDotaKillDeathExtractor');

// ── Consumable item set ────────────────────────────────────────────────────

const CONSUMABLE_ITEMS = new Set([
  'item_tango',
  'item_clarity',
  'item_flask',
  'item_enchanted_mango',
  'item_faerie_fire',
  'item_tpscroll',
  'item_smoke_of_deceit',
  'item_infused_raindrop',
  'item_ward_observer',
  'item_ward_sentry',
  'item_ward_dispenser',
  'item_dust',
]);

function isConsumable(itemName) {
  return CONSUMABLE_ITEMS.has(itemName);
}

// ── Builder ────────────────────────────────────────────────────────────────

/**
 * Build timeline events from OpenDota raw player data.
 *
 * @param {object}      player    - OpenDota player object (from raw_opendota_matches)
 * @param {object|null} profile   - hero profile from offlaneHeroProfiles, or null
 * @param {object}      matchInfo - { duration: number, radiantWin: boolean|null, team: string }
 * @returns {object[]}  Array of event objects ready for saveMatchEvents()
 */
function buildEventsFromOpenDota(player, profile, matchInfo) {
  const { duration, radiantWin, team } = matchInfo;
  const events = [];

  const hasPurchaseLog = Array.isArray(player.purchase_log) && player.purchase_log.length > 0;

  if (hasPurchaseLog) {
    // Build earliest-purchase map for key item / spike detection
    const purchased = buildPurchaseMap(player.purchase_log);

    // item_purchased — one per purchase_log entry (includes duplicates / restocks)
    for (const entry of player.purchase_log) {
      if (!entry?.key) continue;
      const itemName    = opendotaKeyToItemName(entry.key);
      const displayName = getDisplayName(itemName);
      events.push({
        game_time: entry.time,
        type:      'item_purchased',
        severity:  'info',
        message:   `购买 ${displayName}`,
        snapshot: {
          item:         itemName,
          source:       'opendota_import',
          isConsumable: isConsumable(itemName),
        },
      });
    }

    // key_item_completed + power_spike_started — only when profile is known
    if (profile) {
      for (const item of (profile.keyItems || [])) {
        const time = purchased.get(item);
        if (time == null) continue;
        const displayName = getDisplayName(item);

        events.push({
          game_time: time,
          type:      'key_item_completed',
          severity:  'info',
          message:   `关键装备完成：${displayName}`,
          snapshot:  { item, source: 'opendota_import' },
        });

        if (profile.powerSpikeItems?.includes(item)) {
          events.push({
            game_time: time,
            type:      'power_spike_started',
            severity:  'info',
            message:   `强势期开始：${displayName} 已完成，现在可以找节奏/逼塔`,
            snapshot:  { item, source: 'opendota_import' },
          });
        }
      }
    }
  }

  // game_end — always generated
  const isRadiant = team === 'radiant';
  const win       = radiantWin == null ? null : (isRadiant ? radiantWin : !radiantWin);
  const severity  = win === true ? 'success' : win === false ? 'danger' : 'info';
  const resultText = win === true ? '胜利' : win === false ? '失败' : '未知';

  events.push({
    game_time: duration,
    type:      'game_end',
    severity,
    message:   `比赛结束 — ${resultText}`,
    snapshot:  { source: 'opendota_import' },
  });

  // Chronological sort (purchase entries may arrive out of order; negative times are valid)
  events.sort((a, b) => a.game_time - b.game_time);
  return events;
}

// ── Kill / Death event builder ─────────────────────────────────────────────

/**
 * Build hero_kill and hero_death events from extractKillDeath output.
 *
 * Severity for hero_death is always 'danger' — GSI-side logic that computes
 * 'critical' depends on gold/items not available in the basic OpenDota API.
 * GSI-rich snapshot fields (gold, items, etc.) are intentionally omitted.
 *
 * @param {{ kills?: {time,victim}[], deaths?: {time,killer}[] }} killDeathResult
 * @returns {object[]} Event objects ready for saveMatchEvents()
 */
function buildKillDeathEvents({ kills = [], deaths = [] } = {}) {
  const events = [];

  kills.forEach((kill, i) => {
    events.push({
      game_time: kill.time,
      type:      'hero_kill',
      severity:  'success',
      message:   `击杀 ${kill.victim}`,
      snapshot: {
        victim:            kill.victim,
        victimDisplayName: kill.victim,
        killNumber:        i + 1,
        source:            'opendota_import',
      },
    });
  });

  deaths.forEach((death, i) => {
    events.push({
      game_time: death.time,
      type:      'hero_death',
      severity:  'danger',
      message:   `被 ${death.killer} 击杀（第 ${i + 1} 次）`,
      snapshot: {
        killer:            death.killer,
        killerDisplayName: death.killer,
        deathNumber:       i + 1,
        source:            'opendota_import',
      },
    });
  });

  return events;
}

// ── Objective event builder ─────────────────────────────────────────────────

const LANE_LABELS = { top: '上路', mid: '中路', bot: '下路' };

// Raw OpenDota objectives[] key formats — verified against a real parsed_status='ok'
// cached match (8849623934), not guessed:
//   npc_dota_goodguys_tower1_bot     → tower, tier 1, lane bot, team radiant (goodguys)
//   npc_dota_badguys_tower4          → tower, tier 4, no lane (ancient guardian towers)
//   npc_dota_badguys_range_rax_mid   → barracks, ranged, lane mid
//   npc_dota_badguys_melee_rax_top   → barracks, melee, lane top
//   npc_dota_badguys_fort            → Ancient/throne — doesn't fit tower/barracks/roshan, skipped
function parseBuildingKey(key) {
  if (typeof key !== 'string') return null;
  const team = key.includes('goodguys') ? 'radiant'
             : key.includes('badguys')  ? 'dire'
             : null;
  if (!team) return null;

  const towerMatch = key.match(/tower(\d)(?:_(top|mid|bot))?/);
  if (towerMatch) {
    return {
      objectiveType: 'tower',
      team,
      lane:        towerMatch[2] || null,
      tier:        Number(towerMatch[1]),
      barrackType: null,
    };
  }

  const raxMatch = key.match(/(melee|range)_rax_(top|mid|bot)/);
  if (raxMatch) {
    return {
      objectiveType: 'barracks',
      team,
      lane:        raxMatch[2],
      tier:        null,
      barrackType: raxMatch[1] === 'range' ? 'ranged' : 'melee',
    };
  }

  return null; // e.g. fort/ancient — not a recognized tower/barracks key
}

// objectives[] entries carry the killer's npc_dota_hero_xxx string directly in
// `unit` when a hero gets credit (verified against real data) — no need to
// cross-reference the players array. `unit` is a creep name (or absent) when
// nothing is credited, which is exactly the "tower deny/suicide → null" case.
function resolveExecutedBy(unit) {
  if (typeof unit !== 'string' || !unit.startsWith('npc_dota_hero_')) return null;
  return heroDisplayNameFromInternal(unit);
}

/**
 * Build `objective` events (tower / barracks destroyed, Roshan killed) from
 * raw OpenDota objectives[].
 *
 * @param {object[]|null} rawObjectives - raw.objectives from OpenDota match data
 * @param {number}        playerSlot    - the imported player's own player_slot;
 *                                         used only to decide severity (own vs enemy structure)
 * @returns {object[]} Event objects ready for saveMatchEvents()
 */
function buildObjectiveEvents(rawObjectives, playerSlot) {
  if (!Array.isArray(rawObjectives) || rawObjectives.length === 0) return [];

  const ownTeam = Number(playerSlot) < 128 ? 'radiant' : 'dire';
  const events = [];

  for (const obj of rawObjectives) {
    if (!obj || typeof obj !== 'object') continue;

    if (obj.type === 'building_kill') {
      const parsed = parseBuildingKey(obj.key);
      if (!parsed) continue; // unrecognized key (e.g. Ancient/fort) — silently skip

      const { objectiveType, team, lane, tier, barrackType } = parsed;
      const executedBy = resolveExecutedBy(obj.unit);
      const teamLabel   = team === 'radiant' ? '天辉' : '夜魇';
      const severity    = team === ownTeam ? 'danger' : 'success';
      const executorTag = executedBy ? `（${executedBy}）` : '';

      const message = objectiveType === 'tower'
        ? `${teamLabel}${lane ? LANE_LABELS[lane] : ''}${tier}塔被摧毁${executorTag}`
        : `${teamLabel}${LANE_LABELS[lane]}${barrackType === 'melee' ? '近战' : '远程'}兵营被摧毁${executorTag}`;

      events.push({
        game_time: obj.time,
        type:      'objective',
        severity,
        message,
        snapshot: {
          objectiveType, team, lane, tier, barrackType,
          executedBy, key: obj.key, source: 'opendota_import',
        },
      });
      continue;
    }

    if (obj.type === 'CHAT_MESSAGE_ROSHAN_KILL') {
      const team = obj.team === 2 ? 'radiant' : obj.team === 3 ? 'dire' : null;
      if (!team) continue; // unrecognized team value — silently skip

      events.push({
        game_time: obj.time,
        type:      'objective',
        severity:  'warning',
        message:   `${team === 'radiant' ? '天辉' : '夜魇'}击杀肉山`,
        snapshot: {
          objectiveType: 'roshan',
          team,
          lane:        null,
          tier:        null,
          barrackType: null,
          executedBy:  null, // OpenDota's basic objectives[] doesn't credit a Roshan killer
          key:         null,
          source:      'opendota_import',
        },
      });
      continue;
    }

    // Unknown/irrelevant type (CHAT_MESSAGE_FIRSTBLOOD, CHAT_MESSAGE_COURIER_LOST,
    // CHAT_MESSAGE_AEGIS, etc.) — silently skipped, not a recognized objective.
  }

  events.sort((a, b) => a.game_time - b.game_time);
  return events;
}

module.exports = {
  buildEventsFromOpenDota, buildKillDeathEvents, buildObjectiveEvents,
  isConsumable, CONSUMABLE_ITEMS,
};
