'use strict';

// Imports Dota 2 match data from OpenDota API and persists it using the
// existing match history infrastructure.
//
// Only the external API constraint is lifted here (explicitly requested by user).
// No game memory reads, CV, or replay parsing.

const https = require('https');
const { PROFILES } = require('./data/offlaneHeroProfiles');
const { matchExists, saveMatch, saveMatchEvents, saveKeyItemTimings } = require('./db');
const { getDisplayName } = require('./data/itemLocalization');

// ── Constants ──────────────────────────────────────────────────────────────

// OpenDota hero_id for each supported profile key
const HERO_ID_MAP = {
  centaur:        96,
  tidehunter:     29,
  razor:          15,
  viper:          47,
  necrophos:      36,   // internal name is necrolyte
  abaddon:        102,
  vengefulspirit: 20,
};

// OpenDota purchase_log key → our item_ name.
// Most items: prepend "item_". Special cases listed here.
const OPENDOTA_KEY_OVERRIDES = {
  ultimate_scepter: 'item_aghanims_scepter',
  aghanims_scepter: 'item_aghanims_scepter',
};

// ── Pure helpers (exported for tests) ─────────────────────────────────────

function opendotaKeyToItemName(key) {
  return OPENDOTA_KEY_OVERRIDES[key] || `item_${key}`;
}

// Build earliest-purchase map: itemName → game_time
function buildPurchaseMap(purchaseLog) {
  const map = new Map();
  for (const entry of (purchaseLog || [])) {
    const itemName = opendotaKeyToItemName(entry.key);
    if (!map.has(itemName)) map.set(itemName, entry.time);
  }
  return map;
}

function buildKeyItemTimings(matchId, purchaseLog, profile) {
  const purchased = buildPurchaseMap(purchaseLog);
  return (profile.keyItems || []).map((item) => {
    const completedTime = purchased.get(item) ?? null;
    const completed = completedTime !== null ? 1 : 0;
    const isPowerSpike = profile.powerSpikeItems?.includes(item) ?? false;
    return {
      match_id:                 matchId,
      item_name:                item,
      completed,
      completed_time:           completedTime,
      deaths_before_completion: 0,    // not available from OpenDota basic API
      power_spike_used:         isPowerSpike && completed ? 1 : 0,
    };
  });
}

function computeGrade(deaths, gpm, kills, assists) {
  const kda = (kills + assists) / Math.max(1, deaths);
  let score = 0;

  if (deaths === 0)     score += 3;
  else if (deaths <= 3) score += 2;
  else if (deaths <= 5) score += 1;
  else if (deaths > 8)  score -= 2;
  else                  score -= 1;

  if (gpm >= 500)       score += 2;
  else if (gpm >= 400)  score += 1;
  else if (gpm < 300)   score -= 1;

  if (kda >= 3)         score += 1;
  else if (kda < 1)     score -= 1;

  if (score >= 4) return '优秀';
  if (score >= 2) return '良好';
  if (score >= 0) return '一般';
  return '需改进';
}

function computeOneThingToImprove(deaths, gpm, kills, assists, keyItemTimings, duration) {
  const kda = (kills + assists) / Math.max(1, deaths);

  if (deaths > 8)
    return `整场死亡 ${deaths} 次，下一局重点减少不必要的冒进`;
  if (deaths > 5)
    return '死亡偏多，关键装备成型前尽量避免高风险走位';
  if (gpm < 320)
    return '经济收入偏低，尝试选择更安全高效的刷钱路线';

  // Check if first key item came very late (past 60% of match)
  const firstCompleted = (keyItemTimings || []).find((t) => t.completed);
  if (firstCompleted && duration > 0 && firstCompleted.completed_time / duration >= 0.6) {
    const mins = Math.round(firstCompleted.completed_time / 60);
    return `关键装备完成时间偏晚（${mins} 分钟），下一局重点提高前期经济节奏`;
  }

  if (kda < 1.5)
    return '整场参团贡献偏低，下一局多跟进团战';

  return '整体发挥稳定，继续保持关键装备节奏和强势期的主动性';
}

// ── Network ────────────────────────────────────────────────────────────────

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'dota-ai-coach/1.0' } }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        if (res.statusCode === 404) {
          reject(new Error('OpenDota 找不到该比赛，请确认比赛 ID'));
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`OpenDota 返回错误 HTTP ${res.statusCode}`));
          return;
        }
        try { resolve(JSON.parse(raw)); }
        catch { reject(new Error('OpenDota 返回数据格式异常')); }
      });
    });
    req.on('error', (err) => reject(new Error(`网络请求失败：${err.message}`)));
    req.setTimeout(12000, () => { req.destroy(); reject(new Error('OpenDota 请求超时，请稍后重试')); });
  });
}

// ── Core parsing ───────────────────────────────────────────────────────────

function parseWin(player, matchData) {
  const isRadiant = player.player_slot < 128;
  return isRadiant ? matchData.radiant_win : !matchData.radiant_win;
}

async function fetchAndParse(matchId, heroKey) {
  const profile = PROFILES[heroKey];
  if (!profile) throw new Error(`不支持的英雄：${heroKey}`);

  const heroId = HERO_ID_MAP[heroKey];
  if (!heroId) throw new Error(`找不到英雄 ID 映射：${heroKey}`);

  const matchData = await fetchJson(`https://api.opendota.com/api/matches/${matchId}`);

  if (!matchData || !Array.isArray(matchData.players)) {
    throw new Error('OpenDota 数据格式异常，请确认比赛 ID 是否正确');
  }

  const player = matchData.players.find((p) => p.hero_id === heroId);
  if (!player) {
    throw new Error(`该比赛中未找到 ${profile.heroNameZh} 的游戏记录`);
  }

  const win = parseWin(player, matchData);
  const result = win ? '胜利' : '失败';

  return { matchData, player, profile, result };
}

// ── Build events from purchase_log ────────────────────────────────────────

function buildEvents(purchaseLog, profile, duration, gameResult, playerStats) {
  const purchased = buildPurchaseMap(purchaseLog);
  const events = [];

  for (const item of (profile.keyItems || [])) {
    const time = purchased.get(item);
    if (time == null) continue;
    const displayName = getDisplayName(item);

    events.push({
      game_time: time,
      type:      'key_item_completed',
      severity:  'info',
      message:   `关键装备完成：${displayName}`,
      snapshot:  { item },
    });

    if (profile.powerSpikeItems?.includes(item)) {
      events.push({
        game_time: time,
        type:      'power_spike_started',
        severity:  'info',
        message:   `强势期开始：${displayName} 已完成，现在可以找节奏/逼塔`,
        snapshot:  { item },
      });
    }
  }

  events.push({
    game_time: duration,
    type:      'game_end',
    severity:  gameResult === '胜利' ? 'success' : 'danger',
    message:   `比赛结束 — ${gameResult}`,
    snapshot:  {
      kills:     playerStats.kills,
      deaths:    playerStats.deaths,
      assists:   playerStats.assists,
      gpm:       playerStats.gpm,
      xpm:       playerStats.xpm,
      net_worth: playerStats.net_worth,
    },
  });

  // Sort chronologically
  events.sort((a, b) => a.game_time - b.game_time);
  return events;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Fetch and return a preview without writing to DB.
 */
async function previewMatch(matchId, heroKey) {
  const { matchData, player, profile, result } = await fetchAndParse(String(matchId), heroKey);

  const purchased = buildPurchaseMap(player.purchase_log);
  const keyItemTimings = (profile.keyItems || []).map((item) => ({
    item_name:      item,
    completed:      purchased.has(item) ? 1 : 0,
    completed_time: purchased.get(item) ?? null,
  }));

  return {
    match_id:       String(matchId),
    hero:           heroKey,
    heroNameZh:     profile.heroNameZh,
    result,
    duration:       matchData.duration || 0,
    start_time:     matchData.start_time || null,
    kills:          player.kills          || 0,
    deaths:         player.deaths         || 0,
    assists:        player.assists        || 0,
    gpm:            player.gold_per_min   || 0,
    xpm:            player.xp_per_min     || 0,
    last_hits:      player.last_hits      || 0,
    denies:         player.denies         || 0,
    net_worth:      player.net_worth      || 0,
    keyItemTimings,
  };
}

/**
 * Fetch, reconstruct, and persist a match imported from OpenDota.
 */
async function importMatch(matchId, heroKey) {
  const strMatchId = String(matchId);

  if (matchExists(strMatchId)) {
    throw new Error('该比赛已存在于历史记录中');
  }

  const { matchData, player, profile, result } = await fetchAndParse(strMatchId, heroKey);

  const duration   = matchData.duration || 0;
  const startTime  = matchData.start_time || null;
  const gpm        = player.gold_per_min || 0;
  const xpm        = player.xp_per_min   || 0;
  const kills      = player.kills        || 0;
  const deaths     = player.deaths       || 0;
  const assists    = player.assists      || 0;
  const lastHits   = player.last_hits    || 0;
  const denies     = player.denies       || 0;
  const netWorth   = player.net_worth    || 0;

  const keyItemTimings = buildKeyItemTimings(strMatchId, player.purchase_log, profile);
  const events = buildEvents(player.purchase_log, profile, duration, result, { kills, deaths, assists, gpm, xpm, net_worth: netWorth });
  const grade = computeGrade(deaths, gpm, kills, assists);
  const oneThingToImprove = computeOneThingToImprove(deaths, gpm, kills, assists, keyItemTimings, duration);

  saveMatch({
    match_id:               strMatchId,
    hero:                   profile.dotaHeroName,
    role:                   'offlane',
    archetype:              profile.archetype,
    playstyle:              profile.preferredPlaystyle || null,
    result,
    start_time:             startTime,
    end_time:               startTime ? startTime + duration : null,
    duration,
    kills,
    deaths,
    assists,
    gpm,
    xpm,
    last_hits:              lastHits,
    denies,
    final_gold:             netWorth,
    suggested_key_item:     null,
    user_override_key_item: null,
    overall_grade:          grade,
    one_thing_to_improve:   oneThingToImprove,
    pre_key_item_deaths:    0,
    spike_unused_count:     0,
    low_farm_windows:       0,
    import_source:          'opendota',
  });

  saveMatchEvents(strMatchId, events);
  saveKeyItemTimings(strMatchId, keyItemTimings);

  return { match_id: strMatchId, result, grade };
}

module.exports = {
  previewMatch,
  importMatch,
  // Pure helpers exported for tests
  opendotaKeyToItemName,
  buildKeyItemTimings,
  computeGrade,
  computeOneThingToImprove,
};
