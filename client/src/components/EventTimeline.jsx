import React, { useState } from 'react';

const card = {
  background: '#161b22',
  border: '1px solid #30363d',
  borderRadius: '12px',
  padding: '20px',
};

const sectionTitle = {
  fontSize: '13px',
  fontWeight: '600',
  color: '#8b949e',
  textTransform: 'uppercase',
  letterSpacing: '1px',
  marginBottom: '16px',
};

const EVENT_CONFIG = {
  hero_death:     { icon: '💀', label: '阵亡',   color: '#f85149', bg: '#3d1a1a' },
  hero_respawn:   { icon: '✨', label: '复活',   color: '#79c0ff', bg: '#0d2137' },
  item_purchased: { icon: '🛒', label: '购入',   color: '#56d364', bg: '#0d2b0d' },
  tp_missing:     { icon: '⚠️', label: 'TP缺失', color: '#e3b341', bg: '#2d2008' },
  gpm_drop:       { icon: '📉', label: 'GPM下滑', color: '#e3b341', bg: '#2d2008' },
  game_end:       { icon: '🏁', label: '结束',   color: '#bc8cff', bg: '#1e1535' },
  success:        { icon: '🏆', label: '胜利',   color: '#56d364', bg: '#0d2b0d' },
};

const FILTER_OPTIONS = [
  { value: 'all',           label: '全部' },
  { value: 'hero_death',    label: '阵亡' },
  { value: 'item_purchased', label: '购入' },
  { value: 'tp_missing',    label: 'TP缺失' },
  { value: 'gpm_drop',      label: 'GPM' },
];

function formatTime(seconds) {
  if (seconds == null) return '';
  const abs = Math.abs(seconds);
  const m = Math.floor(abs / 60);
  const s = abs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function StatRow({ label, value, color }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
      <span style={{ color: '#8b949e', fontSize: '13px' }}>{label}</span>
      <span style={{ color: color || '#e6edf3', fontSize: '13px', fontWeight: '600' }}>{value}</span>
    </div>
  );
}

function PostGameSummary({ summary }) {
  if (!summary) return null;

  const resultColor = summary.result === '胜利' ? '#56d364' : summary.result === '失败' ? '#f85149' : '#8b949e';
  const ratingColor = { '优秀': '#56d364', '良好': '#79c0ff', '一般': '#e3b341', '需改进': '#f85149' }[summary.rating] || '#8b949e';

  return (
    <div
      style={{
        marginTop: '24px',
        background: '#0d1117',
        border: '1px solid #30363d',
        borderRadius: '10px',
        padding: '20px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
        <span style={{ fontSize: '20px' }}>📋</span>
        <span style={{ fontSize: '14px', fontWeight: '700', color: '#e6edf3' }}>赛后总结</span>
        <span style={{ marginLeft: 'auto', fontSize: '13px', fontWeight: '700', color: resultColor }}>
          {summary.result}
        </span>
        <span
          style={{
            padding: '2px 10px',
            borderRadius: '10px',
            fontSize: '12px',
            fontWeight: '600',
            background: ratingColor + '22',
            color: ratingColor,
            border: `1px solid ${ratingColor}44`,
          }}
        >
          {summary.rating}
        </span>
      </div>

      {/* Stats */}
      {summary.stats && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: '8px',
            marginBottom: '16px',
          }}
        >
          {[
            { label: 'K/D/A', value: `${summary.stats.kills}/${summary.stats.deaths}/${summary.stats.assists}`, color: '#e6edf3' },
            { label: 'GPM', value: Math.round(summary.stats.gpm || 0), color: '#e3b341' },
            { label: 'XPM', value: Math.round(summary.stats.xpm || 0), color: '#bc8cff' },
            { label: '净值', value: (summary.stats.net_worth || 0).toLocaleString(), color: '#56d364' },
          ].map(({ label, value, color }) => (
            <div
              key={label}
              style={{ background: '#161b22', borderRadius: '8px', padding: '10px', textAlign: 'center' }}
            >
              <div style={{ fontSize: '16px', fontWeight: '700', color }}>{value}</div>
              <div style={{ fontSize: '11px', color: '#8b949e', marginTop: '2px' }}>{label}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
        {/* Positives */}
        <div>
          <div style={{ fontSize: '12px', color: '#56d364', fontWeight: '600', marginBottom: '8px' }}>优势</div>
          {summary.positives.length === 0 ? (
            <div style={{ fontSize: '12px', color: '#8b949e' }}>暂无</div>
          ) : (
            summary.positives.map((p, i) => (
              <div key={i} style={{ display: 'flex', gap: '6px', marginBottom: '6px' }}>
                <span style={{ color: '#56d364', fontSize: '12px', flexShrink: 0 }}>✓</span>
                <span style={{ color: '#c9d1d9', fontSize: '12px', lineHeight: '1.5' }}>{p}</span>
              </div>
            ))
          )}
        </div>

        {/* Negatives */}
        <div>
          <div style={{ fontSize: '12px', color: '#f85149', fontWeight: '600', marginBottom: '8px' }}>待改进</div>
          {summary.negatives.length === 0 ? (
            <div style={{ fontSize: '12px', color: '#8b949e' }}>暂无</div>
          ) : (
            summary.negatives.map((n, i) => (
              <div key={i} style={{ display: 'flex', gap: '6px', marginBottom: '6px' }}>
                <span style={{ color: '#f85149', fontSize: '12px', flexShrink: 0 }}>✗</span>
                <span style={{ color: '#c9d1d9', fontSize: '12px', lineHeight: '1.5' }}>{n}</span>
              </div>
            ))
          )}
        </div>
      </div>

      <div
        style={{
          marginTop: '12px',
          paddingTop: '12px',
          borderTop: '1px solid #30363d',
          display: 'flex',
          gap: '20px',
        }}
      >
        <StatRow label="死亡次数" value={summary.event_counts.deaths} />
        <StatRow label="TP缺失事件" value={summary.event_counts.tp_missing} />
        <StatRow label="GPM下滑事件" value={summary.event_counts.gpm_drops} />
      </div>
    </div>
  );
}

export default function EventTimeline({ events, summary }) {
  const [filter, setFilter] = useState('all');

  const filtered = (events || []).filter(
    (e) => filter === 'all' || e.type === filter
  );

  const isEmpty = !events || events.length === 0;

  return (
    <div style={card}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
        <div style={sectionTitle}>事件时间线</div>
        {!isEmpty && (
          <span style={{ fontSize: '12px', color: '#f0883e', marginTop: '-14px' }}>
            ({events.length} 条)
          </span>
        )}
        {/* Filter tabs */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px' }}>
          {FILTER_OPTIONS.map(({ value, label }) => {
            const active = filter === value;
            return (
              <button
                key={value}
                onClick={() => setFilter(value)}
                style={{
                  padding: '3px 10px',
                  borderRadius: '10px',
                  border: `1px solid ${active ? '#f0883e' : '#30363d'}`,
                  background: active ? '#f0883e22' : 'transparent',
                  color: active ? '#f0883e' : '#8b949e',
                  fontSize: '11px',
                  cursor: 'pointer',
                  fontWeight: active ? '600' : '400',
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Timeline */}
      {isEmpty ? (
        <div style={{ textAlign: 'center', color: '#8b949e', padding: '30px 0' }}>
          暂无事件记录
          <br />
          <span style={{ fontSize: '12px' }}>游戏进行中将自动记录关键事件</span>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#8b949e', padding: '20px 0', fontSize: '13px' }}>
          该类型暂无事件
        </div>
      ) : (
        <div style={{ position: 'relative', overflowY: 'auto', maxHeight: '360px' }}>
          {/* Vertical line */}
          <div
            style={{
              position: 'absolute',
              left: '19px',
              top: '0',
              bottom: '0',
              width: '2px',
              background: '#30363d',
            }}
          />

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {filtered.map((event, idx) => {
              const cfg =
                event.type === 'game_end' && event.severity === 'success'
                  ? EVENT_CONFIG.success
                  : EVENT_CONFIG[event.type] || EVENT_CONFIG.item_purchased;

              return (
                <div
                  key={idx}
                  style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '6px 0' }}
                >
                  {/* Icon bubble */}
                  <div
                    style={{
                      width: '38px',
                      height: '38px',
                      borderRadius: '50%',
                      background: cfg.bg,
                      border: `2px solid ${cfg.color}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '16px',
                      flexShrink: 0,
                      zIndex: 1,
                    }}
                  >
                    {cfg.icon}
                  </div>

                  {/* Content */}
                  <div
                    style={{
                      flex: 1,
                      background: cfg.bg,
                      border: `1px solid ${cfg.color}33`,
                      borderRadius: '8px',
                      padding: '8px 12px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span
                        style={{
                          fontSize: '11px',
                          fontWeight: '600',
                          color: cfg.color,
                          background: cfg.color + '22',
                          padding: '1px 7px',
                          borderRadius: '6px',
                        }}
                      >
                        {cfg.label}
                      </span>
                      <span style={{ fontSize: '13px', color: '#e6edf3', flex: 1 }}>
                        {event.message}
                      </span>
                      <span style={{ fontSize: '12px', color: '#8b949e', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                        {formatTime(event.game_time)}
                      </span>
                    </div>
                    {/* Key snapshot stats inline */}
                    {event.snapshot && (
                      <div style={{ marginTop: '4px', fontSize: '11px', color: '#8b949e' }}>
                        {[
                          event.snapshot.gold != null && `金币 ${event.snapshot.gold}`,
                          event.snapshot.net_worth != null && `净值 ${event.snapshot.net_worth?.toLocaleString()}`,
                          event.snapshot.gpm != null && `GPM ${Math.round(event.snapshot.gpm)}`,
                          event.snapshot.level != null && `Lv.${event.snapshot.level}`,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Post-game summary */}
      <PostGameSummary summary={summary} />
    </div>
  );
}
