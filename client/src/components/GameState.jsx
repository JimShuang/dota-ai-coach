import React from 'react';

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

const grid = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: '12px',
};

const stat = {
  background: '#0d1117',
  borderRadius: '8px',
  padding: '12px',
  textAlign: 'center',
};

const statValue = {
  fontSize: '22px',
  fontWeight: '700',
  color: '#e6edf3',
};

const statLabel = {
  fontSize: '11px',
  color: '#8b949e',
  marginTop: '4px',
};

const heroBox = {
  background: '#0d1117',
  borderRadius: '8px',
  padding: '12px 16px',
  marginBottom: '16px',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
};

function formatTime(seconds) {
  if (seconds == null) return '--:--';
  const m = Math.floor(Math.abs(seconds) / 60);
  const s = Math.abs(seconds) % 60;
  const prefix = seconds < 0 ? '-' : '';
  return `${prefix}${m}:${String(s).padStart(2, '0')}`;
}

function formatHeroName(name) {
  if (!name || name === 'unknown') return '等待英雄选择';
  return name.replace('npc_dota_hero_', '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function GameState({ state }) {
  if (!state) {
    return (
      <div style={card}>
        <div style={title}>当前对局状态</div>
        <div style={{ textAlign: 'center', color: '#8b949e', padding: '40px 0' }}>
          等待游戏数据...
          <br />
          <span style={{ fontSize: '12px' }}>请确认 GSI 配置已生效</span>
        </div>
      </div>
    );
  }

  return (
    <div style={card}>
      <div style={title}>当前对局状态</div>

      <div style={heroBox}>
        <div>
          <div style={{ fontSize: '16px', fontWeight: '700', color: '#f0883e' }}>
            {formatHeroName(state.hero)}
          </div>
          <div style={{ fontSize: '12px', color: '#8b949e' }}>
            等级 {state.level} · {state.game_state?.replace('DOTA_GAMERULES_STATE_', '') || ''}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '20px', fontWeight: '700', color: '#79c0ff' }}>
            {formatTime(state.clock_time)}
          </div>
          <div style={{ fontSize: '11px', color: '#8b949e' }}>比赛时间</div>
        </div>
      </div>

      <div style={grid}>
        {[
          { label: '金币', value: state.gold?.toLocaleString() || 0, color: '#e3b341' },
          { label: '净值', value: state.net_worth?.toLocaleString() || 0, color: '#56d364' },
          { label: 'K / D / A', value: `${state.kills}/${state.deaths}/${state.assists}`, color: '#e6edf3' },
          { label: '补刀 / 反补', value: `${state.last_hits}/${state.denies}`, color: '#79c0ff' },
          { label: 'GPM', value: Math.round(state.gpm || 0), color: '#e3b341' },
          { label: 'XPM', value: Math.round(state.xpm || 0), color: '#bc8cff' },
        ].map(({ label, value, color }) => (
          <div key={label} style={stat}>
            <div style={{ ...statValue, color }}>{value}</div>
            <div style={statLabel}>{label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
