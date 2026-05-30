import React, { useState, useEffect, useCallback } from 'react';
import GameState from './components/GameState';
import Alerts from './components/Alerts';
import GoldChart from './components/GoldChart';
import EventTimeline from './components/EventTimeline';
import OfflaneSetup from './components/OfflaneSetup';
import MatchHistory from './components/MatchHistory';
import LongTermTrends from './components/LongTermTrends';

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
    marginBottom: '20px',
    borderBottom: '1px solid #30363d',
    paddingBottom: '16px',
    flexWrap: 'wrap',
  },
  title: {
    fontSize: '22px',
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
    fontSize: '13px',
    color: '#8b949e',
  },
};

const TABS = [
  { id: 'live',    label: '实时对局' },
  { id: 'history', label: '历史记录' },
  { id: 'trends',  label: '长期趋势' },
];

export default function App() {
  const [activeTab, setActiveTab]     = useState('live');
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
      {/* Header */}
      <div style={styles.header}>
        <span style={{ fontSize: '26px' }}>🎮</span>
        <h1 style={styles.title}>DOTA 2 AI COACH · OFFLANE</h1>
        <span style={badgeStyle}>{connected ? '● 已连接' : '○ 未连接'}</span>
        <span style={styles.status}>每 2 秒刷新</span>

        {/* Tab navigation */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '4px' }}>
          {TABS.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  padding: '6px 16px',
                  borderRadius: '8px',
                  border: `1px solid ${active ? '#f0883e' : '#30363d'}`,
                  background: active ? '#f0883e22' : 'transparent',
                  color: active ? '#f0883e' : '#8b949e',
                  fontSize: '13px',
                  fontWeight: active ? '600' : '400',
                  cursor: 'pointer',
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab: 实时对局 */}
      {activeTab === 'live' && (
        <div style={styles.grid}>
          <GameState state={gameState} />
          <Alerts alerts={alerts} />
          <div style={styles.fullWidth}>
            <OfflaneSetup matchConfig={matchConfig} onConfigSaved={fetchData} />
          </div>
          <div style={styles.fullWidth}>
            <GoldChart history={history} />
          </div>
          <div style={styles.fullWidth}>
            <EventTimeline events={events} summary={summary} />
          </div>
        </div>
      )}

      {/* Tab: 历史记录 */}
      {activeTab === 'history' && (
        <MatchHistory />
      )}

      {/* Tab: 长期趋势 */}
      {activeTab === 'trends' && (
        <LongTermTrends />
      )}
    </div>
  );
}
