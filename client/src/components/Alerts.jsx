import React from 'react';

const card = {
  background: '#161b22',
  border: '1px solid #30363d',
  borderRadius: '12px',
  padding: '20px',
  display: 'flex',
  flexDirection: 'column',
};

const title = {
  fontSize: '13px',
  fontWeight: '600',
  color: '#8b949e',
  textTransform: 'uppercase',
  letterSpacing: '1px',
  marginBottom: '16px',
};

const SEVERITY_CONFIG = {
  danger:  { bg: '#3d1a1a', border: '#f85149', icon: '🔴', text: '#f85149' },
  warning: { bg: '#2d2008', border: '#e3b341', icon: '🟡', text: '#e3b341' },
  info:    { bg: '#0d2137', border: '#388bfd', icon: '🔵', text: '#79c0ff' },
};

function formatTime(seconds) {
  if (seconds == null) return '';
  const m = Math.floor(Math.abs(seconds) / 60);
  const s = Math.abs(seconds) % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function Alerts({ alerts }) {
  const empty = !alerts || alerts.length === 0;

  return (
    <div style={card}>
      <div style={title}>实时提醒 {!empty && <span style={{ color: '#f0883e' }}>({alerts.length})</span>}</div>

      {empty ? (
        <div style={{ textAlign: 'center', color: '#8b949e', padding: '40px 0', flex: 1 }}>
          暂无提醒<br />
          <span style={{ fontSize: '12px' }}>规则引擎监控中...</span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto', maxHeight: '320px' }}>
          {alerts.map((alert) => {
            const cfg = SEVERITY_CONFIG[alert.severity] || SEVERITY_CONFIG.info;
            return (
              <div
                key={alert.id}
                style={{
                  background: cfg.bg,
                  border: `1px solid ${cfg.border}`,
                  borderRadius: '8px',
                  padding: '10px 14px',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '10px',
                }}
              >
                <span style={{ fontSize: '14px', flexShrink: 0 }}>{cfg.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '13px', color: '#e6edf3', lineHeight: '1.4' }}>
                    {alert.message}
                  </div>
                  <div style={{ fontSize: '11px', color: '#8b949e', marginTop: '4px' }}>
                    {formatTime(alert.clock_time)} · {alert.rule_id}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
