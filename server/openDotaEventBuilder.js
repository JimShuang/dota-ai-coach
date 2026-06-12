'use strict';

// Builds match_events from an OpenDota raw player object.
//
// Pure functions — no DB reads, no network. Designed to be called from
// importConfirmService after the matches row has been written.
//
// Field names match the GSI-originated event schema exactly:
//   game_time (integer seconds), type, severity, message, snapshot (object).

const { opendotaKeyToItemName } = require('./matchImporter');
const { buildPurchaseMap }      = require('./openDotaKeyItemAnalyzer');
const { getDisplayName }        = require('./data/itemLocalization');

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

module.exports = { buildEventsFromOpenDota, isConsumable, CONSUMABLE_ITEMS };
