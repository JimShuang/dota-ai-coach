const express = require('express');
const cors = require('cors');
const { saveGameState, saveAlert, getRecentStates, getRecentAlerts, getLatestState, getStatesByMatch } = require('./db');
const { evaluate } = require('./rules');
const { logEvents, getEvents, getPowerSpikeState, getSummary, getOfflanieSummary } = require('./eventLogger');
const { getConfig, setConfig } = require('./matchConfig');
const { PROFILES, getProfileByDotaName, getProfileKey } = require('./data/offlaneHeroProfiles');
const { suggestKeyItem } = require('./suggestKeyItem');

const app = express();
const PORT = 3001;
const GSI_PORT = 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ── Shared helpers ─────────────────────────────────────────────────────────

function extractItemNames(data) {
  const items = data.items || {};
  return [
    ...Object.values(items.slot || {}),
    ...Object.values(items.stash || {}),
  ]
    .filter((i) => i && i.name && !i.name.includes('empty'))
    .map((i) => i.name);
}

function buildCtx(data) {
  const config = getConfig();
  const dotaHeroName = data.hero?.name;
  const heroProfile = getProfileByDotaName(dotaHeroName);
  const heroKey = config.heroKey || getProfileKey(dotaHeroName);

  // Auto-sync hero into config when GSI detects a supported hero
  if (heroKey && heroKey !== config.heroKey) {
    setConfig({ hero: dotaHeroName, heroKey });
  }

  const currentItems = extractItemNames(data);
  const suggested = heroKey
    ? suggestKeyItem(heroKey, currentItems, data.map?.clock_time || 0, config.keyItemOverride)
    : null;

  return {
    config,
    heroProfile,
    heroKey,
    suggested,
    getPowerSpikeState,
  };
}

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

  res.sendStatus(200);
});

// ── Dashboard API ──────────────────────────────────────────────────────────

app.get('/api/state', (req, res) => {
  res.json(getLatestState() || null);
});

app.get('/api/states', (req, res) => {
  const limit = parseInt(req.query.limit) || 60;
  res.json(getRecentStates(limit));
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
