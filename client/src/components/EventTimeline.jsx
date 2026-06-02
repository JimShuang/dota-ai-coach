import React, { useState } from 'react';
import { itemDisplayName } from '../heroItemNames';

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
};

const EVENT_CONFIG = {
  hero_death:              { icon: '💀', label: '阵亡',     color: '#f85149', bg: '#3d1a1a' },
  hero_respawn:            { icon: '✨', label: '复活',     color: '#79c0ff', bg: '#0d2137' },
  item_purchased:          { icon: '🛒', label: '购入',     color: '#56d364', bg: '#0d2b0d' },
  key_item_completed:      { icon: '⭐', label: '关键装备', color: '#e3b341', bg: '#2d2008' },
  key_item_near_completion:{ icon: '🔔', label: '装备快好', color: '#e3b341', bg: '#2d2008' },
  power_spike_started:     { icon: '⚡', label: '强势期',   color: '#bc8cff', bg: '#1e1535' },
  power_spike_unused:      { icon: '⏳', label: '强势浪费', color: '#f85149', bg: '#3d1a1a' },
  no_tp_warning:           { icon: '⚠️', label: 'TP缺失',  color: '#e3b341', bg: '#2d2008' },
  low_farm_window:         { icon: '📉', label: '经济停滞', color: '#e3b341', bg: '#2d2008' },
  gpm_drop:                { icon: '📉', label: 'GPM下滑',  color: '#e3b341', bg: '#2d2008' },
  game_end:                { icon: '🏁', label: '结束',     color: '#bc8cff', bg: '#1e1535' },
  game_end_win:            { icon: '🏆', label: '胜利',     color: '#56d364', bg: '#0d2b0d' },
};

const SEVERITY_OVERRIDE = {
  critical: { border: '#f85149', glow: '#f8514944' },
  danger:   { border: '#f85149', glow: null },
  warning:  { border: '#e3b341', glow: null },
  success:  { border: '#56d364', glow: null },
  info:     { border: null,      glow: null },
};

const FILTER_OPTIONS = [
  { value: 'all',                label: '全部' },
  { value: 'hero_death',         label: '阵亡' },
  { value: 'key_item_completed', label: '关键装备' },
  { value: 'power_spike_started',label: '强势期' },
  { value: 'no_tp_warning',      label: 'TP' },
  { value: 'low_farm_window',    label: '经济' },
];

function formatTime(seconds) {
  if (seconds == null) return '';
  const m = Math.floor(Math.abs(seconds) / 60);
  const s = Math.abs(seconds) % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ── Death detail panel ─────────────────────────────────────────────────────

function SlotCell({ name }) {
  return (
    <div style={{
      padding: '2px 5px', borderRadius: '4px', fontSize: '10px', textAlign: 'center',
      background: name ? '#21262d' : '#0d1117',
      color: name ? '#c9d1d9' : '#30363d',
      border: `1px solid ${name ? '#30363d' : '#21262d'}`,
      minHeight: '18px', overflow: 'hidden', whiteSpace: 'nowrap',
      textOverflow: 'ellipsis',
    }}>
      {name ? itemDisplayName(name) : '—'}
    </div>
  );
}

function DeathDetail({ snapshot: s }) {
  if (!s) return null;

  const inv     = s.inventoryAtDeath || {};
  const bp      = s.backpackAtDeath  || {};
  const stash   = s.stashAtDeath     || {};
  const neutral = s.neutralItemAtDeath;
  const hasStash = Object.values(stash).some(Boolean);

  const rows = [
    ['死亡前金币',   s.goldBeforeDeathPenalty != null ? `${s.goldBeforeDeathPenalty} g` : 'N/A'],
    ['死亡后金币',   s.currentGoldAfterDeathIfAvailable != null ? `${s.currentGoldAfterDeathIfAvailable} g` : 'N/A'],
    ['目标关键装备', s.keyItemAtDeath ? itemDisplayName(s.keyItemAtDeath) : 'N/A'],
    ['距关键装备',   s.goldToKeyItemAtDeath != null ? `${s.goldToKeyItemAtDeath} g` : 'N/A'],
    ['接近关键装备', s.wasNearKeyItem != null ? (s.wasNearKeyItem ? '是（差 <600g）' : '否') : 'N/A'],
    ['处于强势期',   s.wasInPowerSpikeWindow != null ? (s.wasInPowerSpikeWindow ? '是 ⚡' : '否') : 'N/A'],
    ['有传送卷轴',   s.hadTpAtDeath != null ? (s.hadTpAtDeath ? '有' : '无') : 'N/A'],
  ];

  const labelStyle = { fontSize: '10px', color: '#8b949e88', marginBottom: '3px' };

  return (
    <div style={{ marginTop: '8px', borderTop: '1px solid #30363d44', paddingTop: '8px' }}>
      {/* Inventory — 2 rows of 3 */}
      <div style={{ marginBottom: '5px' }}>
        <div style={labelStyle}>主背包</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '3px' }}>
          {[0, 1, 2, 3, 4, 5].map((i) => <SlotCell key={i} name={inv[`slot${i}`]} />)}
        </div>
      </div>

      {/* Backpack — 3 slots in one row */}
      <div style={{ marginBottom: '5px' }}>
        <div style={labelStyle}>背包</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '3px' }}>
          {[6, 7, 8].map((i) => <SlotCell key={i} name={bp[`slot${i}`]} />)}
        </div>
      </div>

      {/* Neutral + Stash */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '8px' }}>
        <div style={{ width: '90px' }}>
          <div style={labelStyle}>中立物品</div>
          <SlotCell name={neutral} />
        </div>
        {hasStash && (
          <div style={{ flex: 1 }}>
            <div style={labelStyle}>藏物处</div>
            <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
              {Object.entries(stash).filter(([, v]) => v).map(([k, name]) => (
                <SlotCell key={k} name={name} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 12px' }}>
        {rows.map(([label, value]) => (
          <div key={label} style={{ display: 'flex', gap: '4px', fontSize: '11px' }}>
            <span style={{ color: '#8b949e88', flexShrink: 0 }}>{label}:</span>
            <span style={{ color: '#c9d1d9' }}>{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Post-game summary ──────────────────────────────────────────────────────

function GradeBadge({ grade }) {
  const colors = { '优秀': '#56d364', '良好': '#79c0ff', '一般': '#e3b341', '需改进': '#f85149' };
  const color = colors[grade] || '#8b949e';
  return (
    <span style={{
      padding: '3px 12px', borderRadius: '10px', fontSize: '13px', fontWeight: '700',
      background: color + '22', color, border: `1px solid ${color}44`,
    }}>
      {grade}
    </span>
  );
}

function StatBox({ label, value, color }) {
  return (
    <div style={{ background: '#161b22', borderRadius: '8px', padding: '10px', textAlign: 'center' }}>
      <div style={{ fontSize: '16px', fontWeight: '700', color: color || '#e6edf3' }}>{value}</div>
      <div style={{ fontSize: '11px', color: '#8b949e', marginTop: '2px' }}>{label}</div>
    </div>
  );
}

function PostGameSummary({ summary }) {
  if (!summary) return null;

  const resultColor = summary.result === '胜利' ? '#56d364' : summary.result === '失败' ? '#f85149' : '#8b949e';
  const s = summary.stats || {};
  const d = summary.death_analysis || {};
  const t = summary.tempo_analysis || {};

  return (
    <div style={{
      marginTop: '24px', background: '#0d1117',
      border: '1px solid #30363d', borderRadius: '10px', padding: '20px',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
        <span style={{ fontSize: '18px' }}>📋</span>
        <span style={{ fontSize: '14px', fontWeight: '700', color: '#e6edf3' }}>Offlane 赛后复盘</span>
        <span style={{ marginLeft: 'auto', fontSize: '14px', fontWeight: '700', color: resultColor }}>
          {summary.result}
        </span>
        <GradeBadge grade={summary.grade} />
      </div>

      {/* Final stats */}
      {s.kills != null && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginBottom: '16px' }}>
          <StatBox label="K/D/A" value={`${s.kills}/${s.deaths}/${s.assists}`} color="#e6edf3" />
          <StatBox label="GPM" value={Math.round(s.gpm || 0)} color="#e3b341" />
          <StatBox label="XPM" value={Math.round(s.xpm || 0)} color="#bc8cff" />
          <StatBox label="净值" value={(s.net_worth || 0).toLocaleString()} color="#56d364" />
        </div>
      )}

      {/* Death + Tempo analysis */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: (d.death_details?.length > 0) ? '12px' : '16px' }}>
        <div style={{ background: '#161b22', borderRadius: '8px', padding: '12px' }}>
          <div style={{ fontSize: '12px', color: '#f85149', fontWeight: '600', marginBottom: '8px' }}>死亡分析</div>
          {[
            { label: '总死亡',       value: d.total },
            { label: '关键装备前',   value: d.pre_key_item,       warn: d.pre_key_item > 1 },
            { label: '差钱 <600 时', value: d.close_to_key_item,  warn: d.close_to_key_item > 0 },
            { label: '强势期内',     value: d.in_power_spike,     warn: d.in_power_spike > 0 },
            { label: '无 TP 时',     value: d.without_tp,         warn: d.without_tp > 1 },
          ].map(({ label, value, warn }) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
              <span style={{ fontSize: '12px', color: '#8b949e' }}>{label}</span>
              <span style={{ fontSize: '12px', fontWeight: '600', color: warn ? '#f85149' : '#e6edf3' }}>{value ?? 0}</span>
            </div>
          ))}
        </div>
        <div style={{ background: '#161b22', borderRadius: '8px', padding: '12px' }}>
          <div style={{ fontSize: '12px', color: '#bc8cff', fontWeight: '600', marginBottom: '8px' }}>节奏分析</div>
          {[
            { label: '强势期未转化', value: t.spike_unused_count, warn: t.spike_unused_count > 0 },
            { label: '低收益窗口',   value: t.low_farm_windows,   warn: t.low_farm_windows > 1 },
            { label: 'GPM 下滑事件', value: t.gpm_drops,          warn: t.gpm_drops > 1 },
          ].map(({ label, value, warn }) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
              <span style={{ fontSize: '12px', color: '#8b949e' }}>{label}</span>
              <span style={{ fontSize: '12px', fontWeight: '600', color: warn ? '#e3b341' : '#e6edf3' }}>{value ?? 0}</span>
            </div>
          ))}
          {/* Key items */}
          {(summary.key_item_analysis || []).map((ki) => (
            <div key={ki.item} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
              <span style={{ fontSize: '12px', color: '#8b949e' }}>{ki.displayName}</span>
              <span style={{ fontSize: '12px', color: '#e3b341' }}>{formatTime(ki.completedAt)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Per-death details */}
      {(d.death_details || []).length > 0 && (
        <div style={{ background: '#161b22', borderRadius: '8px', padding: '12px', marginBottom: '16px' }}>
          <div style={{ fontSize: '12px', color: '#f85149', fontWeight: '600', marginBottom: '8px' }}>死亡详情</div>
          {d.death_details.map((detail, i) => (
            <div key={i} style={{
              fontSize: '12px', color: '#c9d1d9', padding: '4px 0', lineHeight: '1.7',
              whiteSpace: 'pre-line',
              borderBottom: i < d.death_details.length - 1 ? '1px solid #30363d44' : 'none',
            }}>
              {detail}
            </div>
          ))}
        </div>
      )}

      {/* Positives / Negatives */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
        <div>
          <div style={{ fontSize: '12px', color: '#56d364', fontWeight: '600', marginBottom: '8px' }}>优势</div>
          {(summary.positives || []).map((p, i) => (
            <div key={i} style={{ display: 'flex', gap: '6px', marginBottom: '6px' }}>
              <span style={{ color: '#56d364', fontSize: '12px', flexShrink: 0 }}>✓</span>
              <span style={{ color: '#c9d1d9', fontSize: '12px', lineHeight: '1.5' }}>{p}</span>
            </div>
          ))}
        </div>
        <div>
          <div style={{ fontSize: '12px', color: '#f85149', fontWeight: '600', marginBottom: '8px' }}>待改进</div>
          {(summary.negatives || []).map((n, i) => (
            <div key={i} style={{ display: 'flex', gap: '6px', marginBottom: '6px' }}>
              <span style={{ color: '#f85149', fontSize: '12px', flexShrink: 0 }}>✗</span>
              <span style={{ color: '#c9d1d9', fontSize: '12px', lineHeight: '1.5' }}>{n}</span>
            </div>
          ))}
        </div>
      </div>

      {/* One thing to improve */}
      {summary.one_thing_to_improve && (
        <div style={{
          background: '#1e1535', border: '1px solid #bc8cff44',
          borderRadius: '8px', padding: '12px 16px',
        }}>
          <div style={{ fontSize: '11px', color: '#bc8cff', fontWeight: '600', marginBottom: '6px' }}>
            下一局最重要的改进点
          </div>
          <div style={{ fontSize: '13px', color: '#e6edf3', lineHeight: '1.6' }}>
            {summary.one_thing_to_improve}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export default function EventTimeline({ events, summary }) {
  const [filter, setFilter] = useState('all');
  const [expandedDeaths, setExpandedDeaths] = useState(new Set());

  function toggleDeath(idx) {
    setExpandedDeaths((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  }

  const filtered = (events || []).filter(
    (e) => filter === 'all' || e.type === filter
  );
  const isEmpty = !events || events.length === 0;

  return (
    <div style={card}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <div style={sectionTitle}>事件时间线</div>
        {!isEmpty && (
          <span style={{ fontSize: '12px', color: '#f0883e' }}>({events.length})</span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
          {FILTER_OPTIONS.map(({ value, label }) => {
            const active = filter === value;
            return (
              <button
                key={value}
                onClick={() => setFilter(value)}
                style={{
                  padding: '3px 10px', borderRadius: '10px', fontSize: '11px', cursor: 'pointer',
                  border: `1px solid ${active ? '#f0883e' : '#30363d'}`,
                  background: active ? '#f0883e22' : 'transparent',
                  color: active ? '#f0883e' : '#8b949e',
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
        <div style={{ position: 'relative', overflowY: 'auto', maxHeight: '400px' }}>
          <div style={{
            position: 'absolute', left: '19px', top: 0, bottom: 0,
            width: '2px', background: '#30363d',
          }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {filtered.map((event, idx) => {
              const isWin = event.type === 'game_end' && event.severity === 'success';
              const cfg = EVENT_CONFIG[isWin ? 'game_end_win' : event.type] || EVENT_CONFIG.item_purchased;
              const sevOverride = SEVERITY_OVERRIDE[event.severity] || {};
              const borderColor = sevOverride.border || cfg.color;

              return (
                <div key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '6px 0' }}>
                  {/* Icon bubble */}
                  <div style={{
                    width: '38px', height: '38px', borderRadius: '50%', flexShrink: 0, zIndex: 1,
                    background: cfg.bg, border: `2px solid ${borderColor}`,
                    boxShadow: sevOverride.glow ? `0 0 8px ${sevOverride.glow}` : 'none',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px',
                  }}>
                    {cfg.icon}
                  </div>

                  {/* Content card */}
                  <div style={{
                    flex: 1, background: cfg.bg,
                    border: `1px solid ${borderColor}44`,
                    borderRadius: '8px', padding: '8px 12px',
                    cursor: event.type === 'hero_death' ? 'pointer' : 'default',
                  }}
                    onClick={() => event.type === 'hero_death' && toggleDeath(idx)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{
                        fontSize: '11px', fontWeight: '600', color: cfg.color,
                        background: cfg.color + '22', padding: '1px 7px', borderRadius: '6px',
                      }}>
                        {cfg.label}
                      </span>
                      <span style={{ fontSize: '13px', color: '#e6edf3', flex: 1, lineHeight: '1.4' }}>
                        {event.message}
                      </span>
                      <span style={{ fontSize: '12px', color: '#8b949e', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                        {formatTime(event.game_time)}
                      </span>
                      {event.type === 'hero_death' && (
                        <span style={{ fontSize: '10px', color: '#8b949e66', flexShrink: 0 }}>
                          {expandedDeaths.has(idx) ? '收起 ▲' : '详情 ▼'}
                        </span>
                      )}
                    </div>
                    {event.type !== 'hero_death' && event.snapshot && (
                      <div style={{ marginTop: '4px', fontSize: '11px', color: '#8b949e' }}>
                        {[
                          event.snapshot.gold != null && `金币 ${event.snapshot.gold}`,
                          event.snapshot.gpm != null && `GPM ${Math.round(event.snapshot.gpm)}`,
                          event.snapshot.level != null && `Lv.${event.snapshot.level}`,
                          event.snapshot.in_power_spike && '⚡强势期',
                        ].filter(Boolean).join(' · ')}
                      </div>
                    )}
                    {event.type === 'hero_death' && expandedDeaths.has(idx) && (
                      <DeathDetail snapshot={event.snapshot} />
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
