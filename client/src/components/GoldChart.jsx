import React, { useMemo } from 'react';

const card = {
  background: '#161b22',
  border: '1px solid #30363d',
  borderRadius: '12px',
  padding: '20px',
};

const title = {
  fontSize: '13px',
  fontWeight: '600',
  color: '#8b949e',
  textTransform: 'uppercase',
  letterSpacing: '1px',
  marginBottom: '16px',
};

function formatTime(seconds) {
  const m = Math.floor(Math.abs(seconds) / 60);
  const s = Math.abs(seconds) % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function GoldChart({ history }) {
  const W = 800;
  const H = 160;
  const PAD = { top: 10, right: 20, bottom: 30, left: 55 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const data = useMemo(() => {
    if (!history || history.length === 0) return null;
    const maxNW = Math.max(...history.map((d) => d.net_worth || 0), 1000);
    const minTime = history[0].clock_time || 0;
    const maxTime = history[history.length - 1].clock_time || 1;
    const range = maxTime - minTime || 1;

    const toX = (t) => ((t - minTime) / range) * innerW + PAD.left;
    const toY = (v) => H - PAD.bottom - (v / maxNW) * innerH;

    const goldPoints = history.map((d) => [toX(d.clock_time), toY(d.gold || 0)]);
    const nwPoints = history.map((d) => [toX(d.clock_time), toY(d.net_worth || 0)]);

    const toPath = (pts) => pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');

    const xTicks = [];
    const step = Math.ceil((maxTime - minTime) / 60 / 5) * 60;
    for (let t = Math.ceil(minTime / 60) * 60; t <= maxTime; t += step) {
      xTicks.push({ x: toX(t), label: formatTime(t) });
    }

    const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
      y: toY(maxNW * f),
      label: Math.round(maxNW * f).toLocaleString(),
    }));

    return { goldPath: toPath(goldPoints), nwPath: toPath(nwPoints), xTicks, yTicks, maxNW };
  }, [history]);

  if (!data) {
    return (
      <div style={card}>
        <div style={title}>金币 / 净值走势</div>
        <div style={{ textAlign: 'center', color: '#8b949e', padding: '30px 0' }}>
          暂无历史数据
        </div>
      </div>
    );
  }

  return (
    <div style={card}>
      <div style={{ ...title, display: 'flex', alignItems: 'center', gap: '20px' }}>
        金币 / 净值走势
        <span style={{ fontSize: '12px', color: '#e3b341' }}>━ 金币</span>
        <span style={{ fontSize: '12px', color: '#56d364' }}>━ 净值</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }}>
        {/* Grid */}
        {data.yTicks.map(({ y, label }) => (
          <g key={label}>
            <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} stroke="#30363d" strokeWidth="1" />
            <text x={PAD.left - 6} y={y + 4} textAnchor="end" fill="#8b949e" fontSize="10">
              {label}
            </text>
          </g>
        ))}
        {data.xTicks.map(({ x, label }) => (
          <g key={label}>
            <line x1={x} y1={PAD.top} x2={x} y2={H - PAD.bottom} stroke="#30363d" strokeWidth="1" strokeDasharray="3,3" />
            <text x={x} y={H - 8} textAnchor="middle" fill="#8b949e" fontSize="10">
              {label}
            </text>
          </g>
        ))}

        {/* Lines */}
        <path d={data.goldPath} fill="none" stroke="#e3b341" strokeWidth="2" strokeLinejoin="round" />
        <path d={data.nwPath} fill="none" stroke="#56d364" strokeWidth="2" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
