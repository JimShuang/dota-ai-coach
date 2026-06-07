'use strict';

// Raw OpenDota cache layer.
//
// Fetches a match from api.opendota.com and stores the full response in
// raw_opendota_matches. Subsequent calls for the same matchId return the
// cached row without hitting the network.
//
// Does NOT write to matches / match_events / key_item_timings.
// Normalisation and import happen in matchImporter.js (separate step).

const https = require('https');
const {
  saveRawOpendotaMatch,
  getRawOpendotaMatch,
} = require('./db');

// ── Network (swappable for tests) ─────────────────────────────────────────

function _defaultFetch(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'dota-ai-coach/1.0' } }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        if (res.statusCode === 404) {
          const e = new Error('OpenDota: 比赛不存在（404）');
          e.code = 'NOT_FOUND';
          return reject(e);
        }
        if (res.statusCode === 429) {
          const e = new Error('OpenDota: 请求过于频繁，请稍后重试（429）');
          e.code = 'RATE_LIMITED';
          return reject(e);
        }
        if (res.statusCode !== 200) {
          const e = new Error(`OpenDota: HTTP ${res.statusCode}`);
          e.code = 'HTTP_ERROR';
          return reject(e);
        }
        try { resolve(JSON.parse(raw)); }
        catch {
          const e = new Error('OpenDota: 返回数据格式异常');
          e.code = 'PARSE_ERROR';
          reject(e);
        }
      });
    });
    req.on('error', (err) => {
      const e = new Error(`网络请求失败: ${err.message}`);
      e.code = 'NETWORK_ERROR';
      reject(e);
    });
    req.setTimeout(12000, () => {
      req.destroy();
      const e = new Error('OpenDota: 请求超时，请稍后重试');
      e.code = 'TIMEOUT';
      reject(e);
    });
  });
}

let _fetchImpl = _defaultFetch;

// ── Pure helpers (exported for tests) ─────────────────────────────────────

/**
 * Inspect the match object and return a parsed_status string.
 *   'ok'          — has players + purchase_log data
 *   'unparsed'    — OpenDota has basic stats but no replay parse (no purchase_log)
 *   'no_players'  — players array missing or empty
 */
function detectParsedStatus(matchData) {
  if (!Array.isArray(matchData.players) || matchData.players.length === 0) {
    return 'no_players';
  }
  const hasParsedData = matchData.players.some(
    (p) => Array.isArray(p.purchase_log) && p.purchase_log.length > 0
  );
  return hasParsedData ? 'ok' : 'unparsed';
}

/**
 * Return an array of warning strings for fields that are present but suspicious.
 * These are stored in warnings_json and surfaced to API callers.
 */
function buildWarnings(matchData) {
  const warnings = [];
  if (matchData.radiant_win == null) {
    warnings.push('radiant_win is null — win/loss cannot be determined');
  }
  if (!matchData.duration) {
    warnings.push('duration is missing or zero');
  }
  const players = matchData.players || [];
  if (players.length > 0 && players.every((p) => p.gold_per_min == null)) {
    warnings.push('gold_per_min missing for all players — match data may be incomplete');
  }
  return warnings;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Fetch a match from OpenDota and cache it locally.
 * Returns cache metadata (no raw JSON — use getCached() to read the full payload).
 *
 * @param {string|number} matchId
 * @param {{ force?: boolean }} opts  force=true bypasses cache and re-fetches
 * @returns {{ match_id, parsed_status, warnings, fetched_at, cached }}
 * @throws  Error with .code: NOT_FOUND | RATE_LIMITED | HTTP_ERROR | NETWORK_ERROR | TIMEOUT
 */
async function fetchAndCache(matchId, { force = false } = {}) {
  const strId = String(matchId);

  if (!force) {
    const existing = getRawOpendotaMatch(strId);
    if (existing) {
      return {
        match_id:      strId,
        parsed_status: existing.parsed_status,
        warnings:      existing.warnings_json ? JSON.parse(existing.warnings_json) : [],
        fetched_at:    existing.fetched_at,
        cached:        true,
      };
    }
  }

  const matchData = await _fetchImpl(`https://api.opendota.com/api/matches/${strId}`);

  const parsed_status = detectParsedStatus(matchData);
  const warnings      = buildWarnings(matchData);

  saveRawOpendotaMatch(strId, JSON.stringify(matchData), parsed_status, JSON.stringify(warnings));

  return {
    match_id:      strId,
    parsed_status,
    warnings,
    fetched_at:    new Date().toISOString(),
    cached:        false,
  };
}

/**
 * Return the cached raw match object from SQLite, or null if not cached.
 * raw_json is returned as a parsed object (not a string).
 */
function getCached(matchId) {
  const row = getRawOpendotaMatch(String(matchId));
  if (!row) return null;
  return {
    match_id:      row.match_id,
    raw_json:      JSON.parse(row.raw_json),
    parsed_status: row.parsed_status,
    fetched_at:    row.fetched_at,
    warnings:      row.warnings_json ? JSON.parse(row.warnings_json) : [],
  };
}

module.exports = {
  fetchAndCache,
  getCached,
  detectParsedStatus,
  buildWarnings,
  // Test injection
  _setFetchFn:   (fn) => { _fetchImpl = fn; },
  _resetFetchFn: ()   => { _fetchImpl = _defaultFetch; },
};
