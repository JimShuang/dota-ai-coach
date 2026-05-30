import React, { useState, useEffect, useCallback } from 'react';
import GameState from './components/GameState';
import Alerts from './components/Alerts';
import GoldChart from './components/GoldChart';
import EventTimeline from './components/EventTimeline';
import OfflaneSetup from './components/OfflaneSetup';

const styles = {
  app: {
    minHeight: '100vh',
    padding: '20px',
    background: 'linear-gradient(135deg, #0d1117 0%, #161b22 100%)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '24px',
    borderBottom: '1px solid #30363d',
    paddingBottom: '16px',
  },
  title: {
    fontSize: '24px',
    fontWeight: '700',
    color: '#f0883e',
    letterSpacing: '1px',
  },
  badge: {
    padding: '4px 10px',
    borderRadius: '12px',
    fontSize: '12px',
    fontWeight: '600',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '20px',
    marginBottom: '20px',
  },
  fullWidth: {
    gridColumn: '1 / -1',
  },
  status: {
    marginLeft: 'auto',
    fontSize: '13px',
    color: '#8b949e',
  },
};

export default function App() {
  const [gameState, setGameState]     = useState(null);
  const [alerts, setAlerts]           = useState([]);
  const [history, setHistory]         = useState([]);
  const [events, setEvents]           = useState([]);
  const [summary, setSummary]         = useState(null);
  const [matchConfig, setMatchConfig] = useState(null);
  const [connected, setConnected]     = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [stateRes, alertsRes, historyRes, eventsRes, summaryRes, configRes] = await Promise.all([
        fetch('/api/state'),
        fetch('/api/alerts?limit=15'),
        fetch('/api/states?limit=30'),
        fetch('/api/events'),
        fetch('/api/postgame-summary'),
        fetch('/api/match/config'),
      ]);
      const [stateData, alertsData, historyData, eventsData, summaryData, configData] = await Promise.all([
        stateRes.json(),
        alertsRes.json(),
        historyRes.json(),
        eventsRes.json(),
        summaryRes.json(),
        configRes.json(),
      ]);
      setGameState(stateData);
      setAlerts(alertsData);
      setHistory(historyData.reverse());
      setEvents(eventsData);
      setSummary(summaryData);
      setMatchConfig(configData);
      setConnected(true);
    } catch {
      setConnected(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 2000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const badgeStyle = {
    ...styles.badge,
    background: connected ? '#1a4731' : '#3d1a1a',
    color: connected ? '#3fb950' : '#f85149',
  };

  return (
    <div style={styles.app}>
      <div style={styles.header}>
        <span style={{ fontSize: '28px' }}>🎮</span>
        <h1 style={styles.title}>DOTA 2 AI COACH · OFFLANE</h1>
        <span style={badgeStyle}>{connected ? '● 已连接' : '○ 未连接'}</span>
        <span style={styles.status}>每 2 秒刷新</span>
      </div>

      <div style={styles.grid}>
        {/* Row 1: game state + alerts */}
        <GameState state={gameState} />
        <Alerts alerts={alerts} />

        {/* Row 2: offlane setup (full width) */}
        <div style={styles.fullWidth}>
          <OfflaneSetup matchConfig={matchConfig} onConfigSaved={fetchData} />
        </div>

        {/* Row 3: gold chart (full width) */}
        <div style={styles.fullWidth}>
          <GoldChart history={history} />
        </div>

        {/* Row 4: event timeline + post-game summary (full width) */}
        <div style={styles.fullWidth}>
          <EventTimeline events={events} summary={summary} />
        </div>
      </div>
    </div>
  );
}
