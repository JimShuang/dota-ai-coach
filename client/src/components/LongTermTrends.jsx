import React, { useState, useEffect } from 'react';
import { heroDisplayName } from '../heroItemNames';

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


function StatBar({ label, value, maxValue, color, unit = '' }) {
  const pct = maxValue > 0 ? Math.min((value / maxValue) * 100, 100) : 0;
  return (
    <div style={{ marginBottom: '12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
        <span style={{ fontSize: '12px', color: '#8b949e' }}>{label}</span>
        <span style={{ fontSize: '12px', fontWeight: '700', color }}>{value != null ? Number(value).toFixed(1) : '—'}{unit}</span>
      </div>
      <div style={{ height: '4px', background: '#30363d', borderRadius: '2px', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: '2px', transition: 'width 0.4s' }} />
      </div>
    </div>
  );
}

function MetricCard({ label, value, unit, color, note }) {
  return (
    <div style={{ background: '#0d1117', borderRadius: '8px', padding: '14px', textAlign: 'center' }}>
      <div style={{ fontSize: '22px', fontWeight: '700', color: color || '#e6edf3' }}>
        {value != null ? Number(value).toFixed(1) : '—'}{unit || ''}
      </div>
      <div style={{ fontSize: '11px', color: '#8b949e', marginTop: '4px' }}>{label}</div>
      {note && <div style={{ fontSize: '10px', color: color || '#8b949e', marginTop: '2px' }}>{note}</div>}
    </div>
  );
}

export default function LongTermTrends() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/history/stats?recent=10')
      .then((r) => r.json())
      .then(setStats)
      .catch(() => setStats(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div style={card}>
      <div style={sectionTitle}>长期趋势</div>
      <div style={{ textAlign: 'center', color: '#8b949e', padding: '40px 0' }}>加载中...</div>
    </div>
  );

  if (!stats || stats.total_matches === 0) return (
    <div style={card}>
      <div style={sectionTitle}>长期趋势</div>
      <div style={{ textAlign: 'center', color: '#8b949e', padding: '40px 0' }}>
        暂无历史数据
        <br />
        <span style={{ fontSize: '12px' }}>完成至少一局比赛后显示</span>
      </div>
    </div>
  );

  const r = stats.recent || {};
  const heroUsage = stats.hero_usage || [];

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
        <div style={sectionTitle}>长期趋势</div>
        <span style={{ fontSize: '12px', color: '#8b949e', marginTop: '-14px' }}>
          最近 {stats.recent_count} 局 · 共 {stats.total_matches} 局
        </span>
      </div>

      {/* Key metrics grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginBottom: '24px' }}>
        <MetricCard label="平均死亡" value={r.avg_deaths} color={r.avg_deaths > 6 ? '#f85149' : r.avg_deaths > 3 ? '#e3b341' : '#56d364'} />
        <MetricCard label="平均 GPM" value={r.avg_gpm} unit="" color="#e3b341" />
        <MetricCard label="平均 XPM" value={r.avg_xpm} unit="" color="#bc8cff" />
      </div>

      {/* Offlane-specific metrics */}
      <div style={{ marginBottom: '24px' }}>
        <div style={{ fontSize: '12px', color: '#f0883e', fontWeight: '600', marginBottom: '12px' }}>
          Offlane 专项（最近 {stats.recent_count} 局均值）
        </div>
        <StatBar
          label="关键装备前死亡次数"
          value={r.avg_pre_key_item_deaths}
          maxValue={5}
          color={r.avg_pre_key_item_deaths > 2 ? '#f85149' : r.avg_pre_key_item_deaths > 1 ? '#e3b341' : '#56d364'}
        />
        <StatBar
          label="强势期未转化次数"
          value={r.avg_spike_unused}
          maxValue={3}
          color={r.avg_spike_unused > 1 ? '#f85149' : r.avg_spike_unused > 0 ? '#e3b341' : '#56d364'}
        />
        <StatBar
          label="低收益窗口次数"
          value={r.avg_low_farm_windows}
          maxValue={4}
          color={r.avg_low_farm_windows > 2 ? '#f85149' : r.avg_low_farm_windows > 1 ? '#e3b341' : '#56d364'}
        />
      </div>

      {/* Hero usage */}
      {heroUsage.length > 0 && (
        <div style={{ marginBottom: '24px' }}>
          <div style={{ fontSize: '12px', color: '#8b949e', fontWeight: '600', marginBottom: '10px' }}>英雄使用频率</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {heroUsage.map((h) => (
              <div key={h.hero} style={{
                background: '#0d1117', border: '1px solid #30363d',
                borderRadius: '8px', padding: '6px 12px',
                display: 'flex', alignItems: 'center', gap: '8px',
              }}>
                <span style={{ fontSize: '13px', color: '#f0883e', fontWeight: '600' }}>
                  {heroDisplayName(h.hero)}
                </span>
                <span style={{
                  fontSize: '11px', color: '#8b949e',
                  background: '#30363d', borderRadius: '10px', padding: '1px 7px',
                }}>
                  {h.count} 局
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top improvement */}
      {stats.top_improvement && (
        <div style={{
          background: '#1e1535', border: '1px solid #bc8cff44',
          borderRadius: '8px', padding: '14px',
        }}>
          <div style={{ fontSize: '11px', color: '#bc8cff', fontWeight: '600', marginBottom: '6px' }}>
            最常见改进点（基于 {stats.total_matches} 局数据）
          </div>
          <div style={{ fontSize: '13px', color: '#e6edf3', lineHeight: '1.6' }}>
            {stats.top_improvement}
          </div>
        </div>
      )}
    </div>
  );
}
