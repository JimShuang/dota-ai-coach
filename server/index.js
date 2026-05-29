const express = require('express');
const cors = require('cors');
const { saveGameState, saveAlert, getRecentStates, getRecentAlerts, getLatestState, getStatesByMatch } = require('./db');
const { evaluate } = require('./rules');
const { logEvents, getEvents, getSummary } = require('./eventLogger');

const app = express();
const PORT = 3001;
const GSI_PORT = 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ── GSI endpoint (Dota 2 posts here) ──────────────────────────────────────
const gsiApp = express();
gsiApp.use(express.json({ limit: '10mb' }));

let latestGSI = null;

gsiApp.post('/', (req, res) => {
  const data = req.body;

  // Only process in-game states
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

  try {
    const alerts = evaluate(data);
    for (const alert of alerts) {
      saveAlert(alert);
      console.log(`[ALERT][${alert.severity.toUpperCase()}] ${alert.message}`);
    }
  } catch (err) {
    console.error('Rule eval error:', err.message);
  }

  try {
    logEvents(data);
  } catch (err) {
    console.error('Event logger error:', err.message);
  }

  res.sendStatus(200);
});

// ── Dashboard API ──────────────────────────────────────────────────────────
app.get('/api/state', (req, res) => {
  const state = getLatestState();
  res.json(state || null);
});

app.get('/api/states', (req, res) => {
  const limit = parseInt(req.query.limit) || 60;
  res.json(getRecentStates(limit));
});

app.get('/api/alerts', (req, res) => {
  const limit = parseInt(req.query.limit) || 30;
  res.json(getRecentAlerts(limit));
});

app.get('/api/live', (req, res) => {
  res.json(latestGSI || null);
});

app.get('/api/states/:matchId', (req, res) => {
  const from = parseInt(req.query.from) || 0;
  const to   = parseInt(req.query.to)   || 99999;
  res.json(getStatesByMatch(req.params.matchId, from, to));
});

app.get('/api/events', (req, res) => {
  res.json(getEvents());
});

app.get('/api/summary', (req, res) => {
  res.json(getSummary() || null);
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
