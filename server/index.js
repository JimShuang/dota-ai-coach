const express = require('express');
const cors = require('cors');
const {
  saveGameState, saveAlert,
  getRecentAlerts, getLatestState, getStatesByMatch,
  getMatches, getMatchById, getLongTermStats,
  excludeMatch, includeMatch,
} = require('./db');
const { evaluate } = require('./rules');
const { logEvents, getEvents, getPowerSpikeState, getSummary, getOfflanieSummary } = require('./eventLogger');
const { normalizeItems } = require('./utils/gsiNormalizer');
const { getConfig, setConfig } = require('./matchConfig');
const { PROFILES, getProfileByDotaName, getProfileKey } = require('./data/offlaneHeroProfiles');
const { suggestKeyItem } = require('./suggestKeyItem');
const { persistMatch } = require('./matchHistory');
const { previewMatch, importMatch } = require('./matchImporter');
const { fetchAndCache, getCached } = require('./openDotaRawService');

const app = express();
const PORT = 3001;
const GSI_PORT = 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ── Shared helpers ─────────────────────────────────────────────────────────

function extractItemNames(data) {
  const { slot, stash } = normalizeItems(data.items);
  return [
    ...Object.values(slot),
    ...Object.values(stash),
  ]
    .filter((i) => i && i.name && !i.name.includes('empty'))
    .map((i) => i.name);
}

function buildCtx(data) {
  const config = getConfig();
  const dotaHeroName = data.hero?.name;
  const heroProfile = getProfileByDotaName(dotaHeroName);
  const heroKey = config.heroKey || getProfileKey(dotaHeroName);

  if (heroKey && heroKey !== config.heroKey) {
    setConfig({ hero: dotaHeroName, heroKey });
  }

  const currentItems = extractItemNames(data);
  const suggested = heroKey
    ? suggestKeyItem(heroKey, currentItems, data.map?.clock_time || 0, config.keyItemOverride)
    : null;

  return { config, heroProfile, heroKey, suggested, getPowerSpikeState };
}

// ── Match start time tracking ──────────────────────────────────────────────
// Real-world timestamps keyed by matchId, used to compute duration.
const matchStartTimes = new Map();

// ── GSI endpoint (Dota 2 posts here) ──────────────────────────────────────
const gsiApp = express();
gsiApp.use(express.json({ limit: '10mb' }));

let latestGSI = null;

gsiApp.post('/', (req, res) => {
  const data = req.body;

  const gameState = data?.map?.game_state;
  if (!gameState || gameState === 'DOTA_GAMERULES_STATE_WAIT_FOR_PLAYERS_TO_LOAD') {
    return res.sendStatus(200);
  }

  latestGSI = data;
  const matchId = String(data.map?.matchid || '0');

  // Record match start time on first tick for this match
  if (!matchStartTimes.has(matchId)) {
    matchStartTimes.set(matchId, Date.now());
  }

  try {
    saveGameState(data);
  } catch (err) {
    console.error('DB save error:', err.message);
  }

  const ctx = buildCtx(data);

  try {
    const alerts = evaluate(data, ctx);
    for (const alert of alerts) {
      saveAlert(alert);
      console.log(`[ALERT][${alert.severity.toUpperCase()}] ${alert.message}`);
    }
  } catch (err) {
    console.error('Rule eval error:', err.message);
  }

  try {
    logEvents(data, ctx);
  } catch (err) {
    console.error('Event logger error:', err.message);
  }

  // Persist match summary once when game reaches post-game state
  if (gameState === 'DOTA_GAMERULES_STATE_POST_GAME') {
    try {
      const summary = getOfflanieSummary(ctx.heroProfile);
      if (summary) {
        persistMatch({
          matchId,
          summary,
          allEvents: getEvents(),
          config: { ...ctx.config, keyItemOverride: ctx.config.keyItemOverride },
          heroProfile: ctx.heroProfile,
          startRealTime: matchStartTimes.get(matchId),
        });
      }
    } catch (err) {
      console.error('Match persist error:', err.message);
    }
  }

  res.sendStatus(200);
});

// ── Dashboard API ──────────────────────────────────────────────────────────

app.get('/api/state', (req, res) => {
  res.json(getLatestState() || null);
});

app.get('/api/states/:matchId', (req, res) => {
  const from = parseInt(req.query.from) || 0;
  const to   = parseInt(req.query.to)   || 99999;
  res.json(getStatesByMatch(req.params.matchId, from, to));
});

app.get('/api/alerts', (req, res) => {
  const limit = parseInt(req.query.limit) || 30;
  res.json(getRecentAlerts(limit));
});

app.get('/api/live', (req, res) => {
  res.json(latestGSI || null);
});

// ── Match config ───────────────────────────────────────────────────────────

app.get('/api/match/config', (req, res) => {
  const config = getConfig();
  const heroProfile = config.hero ? getProfileByDotaName(config.hero) : null;
  const currentItems = latestGSI ? extractItemNames(latestGSI) : [];
  const suggested = config.heroKey
    ? suggestKeyItem(config.heroKey, currentItems, latestGSI?.map?.clock_time || 0, config.keyItemOverride)
    : null;
  res.json({ ...config, heroProfile, suggested });
});

app.post('/api/match/config', (req, res) => {
  const { playstyle, keyItemOverride, heroKey } = req.body;
  const updates = {};
  if (playstyle !== undefined) updates.playstyle = playstyle;
  if (keyItemOverride !== undefined) updates.keyItemOverride = keyItemOverride || null;
  if (heroKey !== undefined) {
    const profile = PROFILES[heroKey];
    if (profile) {
      updates.heroKey = heroKey;
      updates.hero = profile.dotaHeroName;
    }
  }
  res.json(setConfig(updates));
});

// ── Hero profiles ──────────────────────────────────────────────────────────

app.get('/api/hero-profiles', (req, res) => {
  res.json(PROFILES);
});

// ── Events & summaries ─────────────────────────────────────────────────────

app.get('/api/events', (req, res) => {
  res.json(getEvents());
});

app.get('/api/summary', (req, res) => {
  res.json(getSummary() || null);
});

app.get('/api/postgame-summary', (req, res) => {
  const config = getConfig();
  const heroProfile = config.hero ? getProfileByDotaName(config.hero) : null;
  res.json(getOfflanieSummary(heroProfile) || null);
});

// ── Match history ──────────────────────────────────────────────────────────

app.get('/api/history/matches', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const includeExcluded = req.query.includeExcluded === 'true';
  res.json(getMatches(limit, includeExcluded));
});

app.post('/api/history/matches/:matchId/exclude', (req, res) => {
  const { reason } = req.body;
  const result = excludeMatch(req.params.matchId, reason || null);
  if (result.changes === 0) return res.status(404).json({ error: 'Match not found' });
  res.json({ ok: true });
});

app.post('/api/history/matches/:matchId/include', (req, res) => {
  const result = includeMatch(req.params.matchId);
  if (result.changes === 0) return res.status(404).json({ error: 'Match not found' });
  res.json({ ok: true });
});

app.get('/api/history/matches/:matchId', (req, res) => {
  const detail = getMatchById(req.params.matchId);
  if (!detail) return res.status(404).json({ error: 'Match not found' });
  res.json(detail);
});

app.get('/api/history/stats', (req, res) => {
  const recentCount = parseInt(req.query.recent) || 10;
  res.json(getLongTermStats(recentCount));
});

// ── OpenDota raw cache ─────────────────────────────────────────────────────

app.post('/opendota/fetch', async (req, res) => {
  const { matchId, force = false } = req.body || {};
  if (!matchId) return res.status(400).json({ error: '缺少 matchId' });
  try {
    const result = await fetchAndCache(matchId, { force: !!force });
    res.json(result);
  } catch (err) {
    const status = err.code === 'NOT_FOUND' ? 404
                 : err.code === 'RATE_LIMITED' ? 429
                 : 400;
    res.status(status).json({ error: err.message, code: err.code || 'UNKNOWN' });
  }
});

app.get('/opendota/raw/:matchId', (req, res) => {
  const result = getCached(req.params.matchId);
  if (!result) return res.status(404).json({ error: '缓存中没有该比赛，请先调用 POST /opendota/fetch' });
  res.json(result);
});

// ── Match import (OpenDota) ────────────────────────────────────────────────

app.post('/api/history/import/preview', async (req, res) => {
  const { matchId, heroKey } = req.body || {};
  if (!matchId || !heroKey) {
    return res.status(400).json({ error: '缺少 matchId 或 heroKey' });
  }
  try {
    const preview = await previewMatch(matchId, heroKey);
    res.json(preview);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/history/import', async (req, res) => {
  const { matchId, heroKey } = req.body || {};
  if (!matchId || !heroKey) {
    return res.status(400).json({ error: '缺少 matchId 或 heroKey' });
  }
  try {
    const result = await importMatch(matchId, heroKey);
    res.json({ ok: true, ...result });
  } catch (err) {
    const status = err.message.includes('已存在') ? 409 : 400;
    res.status(status).json({ error: err.message });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ── Start servers ──────────────────────────────────────────────────────────

gsiApp.listen(GSI_PORT, () => {
  console.log(`[GSI]  Listening for Dota 2 on http://localhost:${GSI_PORT}`);
});

app.listen(PORT, () => {
  console.log(`[API]  Dashboard API on http://localhost:${PORT}`);
});
