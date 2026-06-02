import React, { useState, useEffect } from 'react';
import { heroDisplayName, itemDisplayName } from '../heroItemNames';

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

const GRADE_COLORS = {
  '优秀': '#56d364', '良好': '#79c0ff', '一般': '#e3b341', '需改进': '#f85149',
};

const RESULT_CONFIG = {
  '胜利': { color: '#56d364', bg: '#0d2b0d' },
  '失败': { color: '#f85149', bg: '#3d1a1a' },
};


function formatTime(seconds) {
  if (!seconds) return '';
  const m = Math.floor(Math.abs(seconds) / 60);
  const s = Math.abs(seconds) % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatDate(unixSeconds) {
  if (!unixSeconds) return '—';
  return new Date(unixSeconds * 1000).toLocaleString('zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function Badge({ text, color, bg }) {
  return (
    <span style={{
      padding: '2px 9px', borderRadius: '10px', fontSize: '11px', fontWeight: '600',
      background: bg || (color + '22'), color, border: `1px solid ${color}44`,
    }}>{text}</span>
  );
}

function StatCell({ label, value, color }) {
  return (
    <div style={{ background: '#0d1117', borderRadius: '8px', padding: '10px', textAlign: 'center' }}>
      <div style={{ fontSize: '15px', fontWeight: '700', color: color || '#e6edf3' }}>{value ?? '—'}</div>
      <div style={{ fontSize: '11px', color: '#8b949e', marginTop: '2px' }}>{label}</div>
    </div>
  );
}

// ── Match detail view ──────────────────────────────────────────────────────

function MatchDetail({ matchId, onBack }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/history/matches/${matchId}`)
      .then((r) => r.json())
      .then(setDetail)
      .catch(() => setDetail(null))
      .finally(() => setLoading(false));
  }, [matchId]);

  if (loading) return <div style={{ color: '#8b949e', padding: '40px', textAlign: 'center' }}>加载中...</div>;
  if (!detail) return <div style={{ color: '#f85149', padding: '40px', textAlign: 'center' }}>加载失败</div>;

  const { match: m, events, keyItemTimings } = detail;
  const resultCfg = RESULT_CONFIG[m.result] || { color: '#8b949e', bg: '#161b22' };
  const gradeColor = GRADE_COLORS[m.overall_grade] || '#8b949e';

  return (
    <div>
      {/* Back + header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
        <button onClick={onBack} style={{
          background: 'transparent', border: '1px solid #30363d', color: '#8b949e',
          borderRadius: '6px', padding: '4px 12px', cursor: 'pointer', fontSize: '12px',
        }}>← 返回列表</button>
        <span style={{ fontSize: '16px', fontWeight: '700', color: '#f0883e' }}>
          {heroDisplayName(m.hero)}
        </span>
        <Badge text={m.result || '未知'} color={resultCfg.color} bg={resultCfg.bg} />
        {m.overall_grade && <Badge text={m.overall_grade} color={gradeColor} />}
        <span style={{ marginLeft: 'auto', fontSize: '12px', color: '#8b949e' }}>
          {formatDate(m.end_time)}
          {m.duration ? ` · ${Math.round(m.duration / 60)} 分钟` : ''}
        </span>
      </div>

      {/* Final stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '8px', marginBottom: '20px' }}>
        <StatCell label="K/D/A" value={`${m.kills}/${m.deaths}/${m.assists}`} color="#e6edf3" />
        <StatCell label="GPM" value={Math.round(m.gpm)} color="#e3b341" />
        <StatCell label="XPM" value={Math.round(m.xpm)} color="#bc8cff" />
        <StatCell label="补刀" value={m.last_hits} color="#79c0ff" />
        <StatCell label="最终金币" value={(m.final_gold || 0).toLocaleString()} color="#56d364" />
      </div>

      {/* Analysis grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px' }}>
        {/* Death analysis */}
        <div style={{ background: '#0d1117', borderRadius: '8px', padding: '14px' }}>
          <div style={{ fontSize: '12px', color: '#f85149', fontWeight: '600', marginBottom: '10px' }}>死亡分析</div>
          {[
            { label: '总死亡',       value: m.deaths,              warn: m.deaths > 5 },
            { label: '关键装备前死亡', value: m.pre_key_item_deaths,  warn: m.pre_key_item_deaths > 1 },
          ].map(({ label, value, warn }) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
              <span style={{ fontSize: '12px', color: '#8b949e' }}>{label}</span>
              <span style={{ fontSize: '12px', fontWeight: '600', color: warn ? '#f85149' : '#e6edf3' }}>{value ?? 0}</span>
            </div>
          ))}
        </div>

        {/* Tempo analysis */}
        <div style={{ background: '#0d1117', borderRadius: '8px', padding: '14px' }}>
          <div style={{ fontSize: '12px', color: '#bc8cff', fontWeight: '600', marginBottom: '10px' }}>节奏分析</div>
          {[
            { label: '强势期未转化', value: m.spike_unused_count, warn: m.spike_unused_count > 0 },
            { label: '低收益窗口',   value: m.low_farm_windows,   warn: m.low_farm_windows > 1 },
          ].map(({ label, value, warn }) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
              <span style={{ fontSize: '12px', color: '#8b949e' }}>{label}</span>
              <span style={{ fontSize: '12px', fontWeight: '600', color: warn ? '#e3b341' : '#e6edf3' }}>{value ?? 0}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Key item timings */}
      {keyItemTimings.length > 0 && (
        <div style={{ background: '#0d1117', borderRadius: '8px', padding: '14px', marginBottom: '20px' }}>
          <div style={{ fontSize: '12px', color: '#e3b341', fontWeight: '600', marginBottom: '10px' }}>关键装备时间线</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['装备', '完成', '完成时间', '完成前死亡', '强势期利用'].map((h) => (
                  <th key={h} style={{ fontSize: '11px', color: '#8b949e', textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid #30363d' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {keyItemTimings.map((t) => (
                <tr key={t.item_name}>
                  <td style={{ padding: '6px 8px', fontSize: '12px', color: '#e6edf3' }}>
                    {itemDisplayName(t.item_name)}
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    <Badge
                      text={t.completed ? '✓' : '✗'}
                      color={t.completed ? '#56d364' : '#f85149'}
                    />
                  </td>
                  <td style={{ padding: '6px 8px', fontSize: '12px', color: '#79c0ff' }}>
                    {t.completed_time ? formatTime(t.completed_time) : '—'}
                  </td>
                  <td style={{ padding: '6px 8px', fontSize: '12px', color: t.deaths_before_completion > 0 ? '#f85149' : '#56d364' }}>
                    {t.deaths_before_completion}
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    {t.completed
                      ? <Badge text={t.power_spike_used ? '已转化' : '未转化'} color={t.power_spike_used ? '#56d364' : '#e3b341'} />
                      : <span style={{ color: '#8b949e', fontSize: '11px' }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* One thing to improve */}
      {m.one_thing_to_improve && (
        <div style={{
          background: '#1e1535', border: '1px solid #bc8cff44',
          borderRadius: '8px', padding: '14px', marginBottom: '20px',
        }}>
          <div style={{ fontSize: '11px', color: '#bc8cff', fontWeight: '600', marginBottom: '6px' }}>
            本局最重要改进点
          </div>
          <div style={{ fontSize: '13px', color: '#e6edf3', lineHeight: '1.6' }}>
            {m.one_thing_to_improve}
          </div>
        </div>
      )}

      {/* Event list */}
      {events.length > 0 && (
        <div style={{ background: '#0d1117', borderRadius: '8px', padding: '14px' }}>
          <div style={{ fontSize: '12px', color: '#8b949e', fontWeight: '600', marginBottom: '10px' }}>
            事件时间线 ({events.length} 条)
          </div>
          <div style={{ maxHeight: '400px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {events.map((e) => {
              const severityColor = {
                critical: '#f85149', danger: '#f85149',
                warning: '#e3b341', success: '#56d364', info: '#79c0ff',
              }[e.severity] || '#8b949e';
              const snap = e.type === 'hero_death' ? (e.snapshot || null) : null;

              // Build flat item list from snapshot (prefer itemsAtDeath, fall back to inventoryAtDeath)
              let deathItems = [];
              if (snap) {
                if (Array.isArray(snap.itemsAtDeath) && snap.itemsAtDeath.length > 0) {
                  deathItems = snap.itemsAtDeath.filter((n) => n !== 'item_tpscroll');
                } else if (snap.inventoryAtDeath) {
                  deathItems = Object.values(snap.inventoryAtDeath).filter((n) => n && n !== 'item_tpscroll');
                }
              }

              return (
                <div key={e.id} style={{ padding: '5px 0', borderBottom: '1px solid #30363d22' }}>
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                    <span style={{ fontSize: '11px', color: '#8b949e', flexShrink: 0, width: '36px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {formatTime(e.game_time)}
                    </span>
                    <span style={{
                      fontSize: '10px', fontWeight: '600', color: severityColor,
                      background: severityColor + '22', padding: '1px 6px', borderRadius: '4px',
                      flexShrink: 0, alignSelf: 'center',
                    }}>
                      {e.type.replace(/_/g, ' ')}
                    </span>
                    <span style={{ fontSize: '12px', color: '#c9d1d9', lineHeight: '1.4' }}>{e.message}</span>
                  </div>
                  {snap && (
                    <div style={{ marginLeft: '46px', marginTop: '3px', fontSize: '11px', color: '#8b949e66', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                      {snap.goldBeforeDeathPenalty != null && (
                        <span>死前金币 <span style={{ color: '#e3b341' }}>{snap.goldBeforeDeathPenalty}g</span></span>
                      )}
                      {deathItems.length > 0 && (
                        <span>道具：<span style={{ color: '#8b949e' }}>{deathItems.map(itemDisplayName).join('、')}</span></span>
                      )}
                      {snap.hadTpAtDeath === false && (
                        <span style={{ color: '#e3b341' }}>无TP</span>
                      )}
                      {snap.wasNearKeyItem && (
                        <span style={{ color: '#f85149' }}>差钱 &lt;600</span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Match list ─────────────────────────────────────────────────────────────

export default function MatchHistory() {
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);

  useEffect(() => {
    fetch('/api/history/matches?limit=50')
      .then((r) => r.json())
      .then(setMatches)
      .catch(() => setMatches([]))
      .finally(() => setLoading(false));
  }, []);

  if (selectedId) {
    return (
      <div style={card}>
        <MatchDetail matchId={selectedId} onBack={() => setSelectedId(null)} />
      </div>
    );
  }

  return (
    <div style={card}>
      <div style={sectionTitle}>
        历史比赛记录
        {matches.length > 0 && <span style={{ color: '#f0883e', marginLeft: '8px' }}>({matches.length} 局)</span>}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', color: '#8b949e', padding: '40px 0' }}>加载中...</div>
      ) : matches.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#8b949e', padding: '40px 0' }}>
          暂无历史记录
          <br />
          <span style={{ fontSize: '12px' }}>比赛结束后自动保存</span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {matches.map((m) => {
            const resultCfg = RESULT_CONFIG[m.result] || { color: '#8b949e', bg: '#161b22' };
            const gradeColor = GRADE_COLORS[m.overall_grade] || '#8b949e';
            return (
              <div
                key={m.id}
                onClick={() => setSelectedId(m.match_id)}
                style={{
                  background: '#0d1117', border: '1px solid #30363d',
                  borderRadius: '8px', padding: '12px 16px',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '12px',
                  transition: 'border-color 0.15s',
                }}
                onMouseEnter={(e) => e.currentTarget.style.borderColor = '#f0883e'}
                onMouseLeave={(e) => e.currentTarget.style.borderColor = '#30363d'}
              >
                {/* Result indicator */}
                <div style={{
                  width: '4px', alignSelf: 'stretch', borderRadius: '2px',
                  background: resultCfg.color, flexShrink: 0,
                }} />

                {/* Hero */}
                <div style={{ minWidth: '120px' }}>
                  <div style={{ fontSize: '13px', fontWeight: '700', color: '#f0883e' }}>
                    {heroDisplayName(m.hero)}
                  </div>
                  <div style={{ fontSize: '11px', color: '#8b949e', marginTop: '2px' }}>
                    {m.archetype?.replace(/_/g, ' ') || 'offlane'}
                  </div>
                </div>

                {/* Result + grade */}
                <div style={{ display: 'flex', gap: '6px' }}>
                  <Badge text={m.result || '—'} color={resultCfg.color} bg={resultCfg.bg} />
                  {m.overall_grade && <Badge text={m.overall_grade} color={gradeColor} />}
                </div>

                {/* K/D/A */}
                <div style={{ fontSize: '13px', color: '#e6edf3', minWidth: '80px' }}>
                  {m.kills}/{m.deaths}/{m.assists}
                </div>

                {/* GPM / XPM */}
                <div style={{ fontSize: '12px', color: '#e3b341', minWidth: '80px' }}>
                  {Math.round(m.gpm)} GPM
                </div>

                {/* Improvement hint */}
                <div style={{
                  flex: 1, fontSize: '11px', color: '#8b949e',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {m.one_thing_to_improve || ''}
                </div>

                {/* Date */}
                <div style={{ fontSize: '11px', color: '#8b949e', flexShrink: 0 }}>
                  {formatDate(m.end_time)}
                </div>

                <span style={{ color: '#30363d', fontSize: '16px' }}>›</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
