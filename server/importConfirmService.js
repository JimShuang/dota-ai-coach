'use strict';

// Confirms an OpenDota match import: normalises a selected player's data
// into a matches-table row and persists it.
//
// Does NOT generate match_events or key_item_timings — those are a future step.
// Does NOT hit the network — raw data must already be in raw_opendota_matches.

const { getCached } = require('./openDotaRawService');
const { matchExists, saveMatch } = require('./db');
const { getProfileByDotaName } = require('./data/offlaneHeroProfiles');
const { getHeroInternalName } = require('./data/dotaHeroNames');
const { computeGrade, computeOneThingToImprove } = require('./matchImporter');

// ── Synthetic match_id ─────────────────────────────────────────────────────

// Unique per (dota_match_id, player_slot) so multiple slots can be imported
// from the same match without colliding on the matches.match_id UNIQUE index.
function syntheticMatchId(matchId, playerSlot) {
  return `${matchId}_od${playerSlot}`;
}

// ── Pure normaliser (exported for tests) ──────────────────────────────────

/**
 * Build the matches-table row from a raw OpenDota match + selected player slot.
 *
 * @param {string|number} matchId     - Dota match ID
 * @param {number}        playerSlot  - player_slot value (0-4 radiant, 128-132 dire)
 * @param {object}        rawMatchData - parsed raw_json from raw_opendota_matches
 * @returns {object} Row ready for saveMatch()
 */
function normalizeForMatch(matchId, playerSlot, rawMatchData) {
  if (!rawMatchData || typeof rawMatchData !== 'object') {
    throw new Error('rawMatchData must be a non-null object');
  }
  if (!Array.isArray(rawMatchData.players)) {
    throw new Error('rawMatchData.players is missing or not an array');
  }

  const player = rawMatchData.players.find((p) => p.player_slot === playerSlot);
  if (!player) {
    throw new Error(`Player slot ${playerSlot} not found in match ${matchId}`);
  }

  const isRadiant = playerSlot < 128;
  const radiantWinBool = rawMatchData.radiant_win;
  const win = radiantWinBool == null ? null : isRadiant ? radiantWinBool : !radiantWinBool;
  const result = win == null ? '未知' : win ? '胜利' : '失败';

  const heroInternalName = getHeroInternalName(player.hero_id);
  const profile = heroInternalName ? getProfileByDotaName(heroInternalName) : null;

  const duration = rawMatchData.duration || 0;
  const kills    = player.kills        || 0;
  const deaths   = player.deaths       || 0;
  const assists  = player.assists      || 0;
  const gpm      = player.gold_per_min || 0;

  const grade             = computeGrade(deaths, gpm, kills, assists);
  const oneThingToImprove = computeOneThingToImprove(deaths, gpm, kills, assists, [], duration);

  return {
    match_id:               syntheticMatchId(matchId, playerSlot),
    hero:                   heroInternalName || null,
    role:                   'offlane',
    archetype:              profile?.archetype              || null,
    playstyle:              profile?.preferredPlaystyle     || null,
    result,
    start_time:             rawMatchData.start_time         || null,
    end_time:               rawMatchData.start_time ? rawMatchData.start_time + duration : null,
    duration,
    kills,
    deaths,
    assists,
    gpm,
    xpm:                    player.xp_per_min  || 0,
    last_hits:              player.last_hits   || 0,
    denies:                 player.denies      || 0,
    final_gold:             player.net_worth   || 0,
    suggested_key_item:     null,
    user_override_key_item: null,
    overall_grade:          grade,
    one_thing_to_improve:   oneThingToImprove,
    pre_key_item_deaths:    0,
    spike_unused_count:     0,
    low_farm_windows:       0,
    // New provenance fields
    source:                 'opendota_import',
    imported_at:            new Date().toISOString(),
    import_match_id:        String(matchId),
    player_slot:            playerSlot,
    account_id:             player.account_id || null,
    radiant_win:            radiantWinBool == null ? null : (radiantWinBool ? 1 : 0),
    team:                   isRadiant ? 'radiant' : 'dire',
  };
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Confirm import: persist the selected player as a matches row.
 * Returns the stored match_id on success.
 * Throws if already imported or raw cache is missing.
 */
function confirmImport(matchId, playerSlot) {
  const sid = syntheticMatchId(matchId, Number(playerSlot));

  if (matchExists(sid)) {
    throw Object.assign(
      new Error('该玩家位置已经导入过了'),
      { code: 'DUPLICATE' }
    );
  }

  const cached = getCached(String(matchId));
  if (!cached) {
    throw Object.assign(
      new Error('找不到该比赛的缓存数据，请先执行预览'),
      { code: 'CACHE_MISS' }
    );
  }

  const row = normalizeForMatch(matchId, Number(playerSlot), cached.raw_json);
  saveMatch(row);

  return {
    match_id:        sid,
    import_match_id: String(matchId),
    player_slot:     Number(playerSlot),
    hero:            row.hero,
    result:          row.result,
    grade:           row.overall_grade,
  };
}

module.exports = { confirmImport, normalizeForMatch, syntheticMatchId };
