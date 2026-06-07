'use strict';

// Pure service: transforms raw OpenDota match JSON into a structured preview
// object suitable for the Import Preview UI.
//
// Does NOT read from DB, does NOT hit the network.
// Callers are responsible for providing the raw match data + any warnings.

const { getHeroName } = require('./data/dotaHeroNames');

/**
 * Build a structured preview from a raw OpenDota match object.
 *
 * @param {object}   rawMatchData  - Parsed JSON from raw_opendota_matches.raw_json
 * @param {object}   [opts]
 * @param {string[]} [opts.warnings]  - Warnings from the raw cache layer
 * @returns {object} Preview response shaped for the dashboard
 */
function buildPreview(rawMatchData, { warnings = [] } = {}) {
  if (!rawMatchData || typeof rawMatchData !== 'object') {
    throw new Error('rawMatchData must be a non-null object');
  }

  const rawPlayers = Array.isArray(rawMatchData.players) ? rawMatchData.players : [];

  const isParsed = rawPlayers.some(
    (p) => Array.isArray(p.purchase_log) && p.purchase_log.length > 0
  );

  const players = rawPlayers.map((p) => ({
    playerSlot: p.player_slot   ?? null,
    team:       (p.player_slot ?? 128) < 128 ? 'radiant' : 'dire',
    accountId:  p.account_id    || null,
    heroId:     p.hero_id       ?? null,
    heroName:   getHeroName(p.hero_id),
    kills:      p.kills         || 0,
    deaths:     p.deaths        || 0,
    assists:    p.assists       || 0,
    gpm:        p.gold_per_min  || 0,
    xpm:        p.xp_per_min    || 0,
    lastHits:   p.last_hits     || 0,
    denies:     p.denies        || 0,
  }));

  // Sort: radiant slots 0-4 first, dire slots 128-132 after
  players.sort((a, b) => (a.playerSlot ?? 0) - (b.playerSlot ?? 0));

  return {
    matchId:    String(rawMatchData.match_id ?? ''),
    duration:   rawMatchData.duration    ?? 0,
    radiantWin: rawMatchData.radiant_win ?? null,
    isParsed,
    warnings:   warnings.slice(),        // defensive copy
    players,
  };
}

module.exports = { buildPreview };
