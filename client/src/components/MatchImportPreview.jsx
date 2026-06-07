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
};

const TEAM_CONFIG = {
  radiant: { label: '天辉',  color: '#56d364', bg: '#0d2b0d' },
  dire:    { label: '夜魇',  color: '#f85149', bg: '#3d1a1a' },
};

function formatDuration(seconds) {
  if (!seconds) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function PlayerRow({ player }) {
  const teamCfg = TEAM_CONFIG[player.team] || TEAM_CONFIG.dire;
  const kda = player.deaths === 0
    ? (player.kills + player.assists).toFixed(1)
    : ((player.kills + player.assists) / player.deaths).toFixed(1);

  return (
    <div style={{
      padding: '8px 10px',
      borderRadius: '6px',
      background: '#0d1117',
      border: `1px solid ${teamCfg.color}22`,
      marginBottom: '4px',
    }}>
      {/* Hero name row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
        <div style={{
          width: '6px', height: '6px', borderRadius: '50%',
          background: teamCfg.color, flexShrink: 0,
        }} />
        <span style={{ fontSize: '13px', fontWeight: '600', color: '#e6edf3', flex: 1 }}>
          {player.heroName}
        </span>
        <span style={{
          fontSize: '10px', color: teamCfg.color,
          background: teamCfg.color + '22', padding: '1px 6px', borderRadius: '4px',
        }}>
          KDA {kda}
        </span>
      </div>

      {/* Stats row */}
      <div style={{ display: 'flex', gap: '12px', fontSize: '11px', color: '#8b949e' }}>
        <span>
          <span style={{ color: '#56d364' }}>{player.kills}</span>
          /
          <span style={{ color: '#f85149' }}>{player.deaths}</span>
          /
          <span style={{ color: '#79c0ff' }}>{player.assists}</span>
        </span>
        <span style={{ color: '#e3b341' }}>{player.gpm} GPM</span>
        <span style={{ color: '#bc8cff' }}>{player.xpm} XPM</span>
        <span>{player.lastHits}/{player.denies} LH/DN</span>
      </div>
    </div>
  );
}

function TeamColumn({ players, team }) {
  const cfg = TEAM_CONFIG[team];
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{
        fontSize: '12px', fontWeight: '700', color: cfg.color,
        marginBottom: '8px', padding: '4px 8px',
        background: cfg.bg, borderRadius: '4px', display: 'inline-block',
      }}>
        {cfg.label} ({players.length})
      </div>
      {players.map((p) => <PlayerRow key={p.playerSlot} player={p} />)}
    </div>
  );
}

export default function MatchImportPreview() {
  const [expanded, setExpanded]   = useState(false);
  const [matchId, setMatchId]     = useState('');
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');
  const [preview, setPreview]     = useState(null);

  async function handleFetch() {
    if (!matchId.trim()) return;
    setLoading(true);
    setError('');
    setPreview(null);
    try {
      const r = await fetch('/history/import/preview', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ matchId: matchId.trim() }),
      });
      const data = await r.json();
      if (!r.ok) { setError(data.error || '获取失败'); }
      else        { setPreview(data); }
    } catch {
      setError('网络错误，请重试');
    } finally {
      setLoading(false);
    }
  }

  const radiantPlayers = preview?.players.filter((p) => p.team === 'radiant') ?? [];
  const direPlayers    = preview?.players.filter((p) => p.team === 'dire')    ?? [];
  const winLabel = preview?.radiantWin === true  ? '天辉胜利'
                 : preview?.radiantWin === false ? '夜魇胜利'
                 : '结果未知';
  const winColor = preview?.radiantWin === true  ? '#56d364'
                 : preview?.radiantWin === false ? '#f85149'
                 : '#8b949e';

  return (
    <div style={card}>
      {/* Header — always visible */}
      <div
        style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', userSelect: 'none' }}
        onClick={() => setExpanded((v) => !v)}
      >
        <span style={sectionTitle}>比赛预览</span>
        <span style={{ fontSize: '11px', color: '#8b949e' }}>
          通过比赛 ID 预览全部玩家
        </span>
        <span style={{ marginLeft: 'auto', color: '#8b949e', fontSize: '14px' }}>
          {expanded ? '▲' : '▼'}
        </span>
      </div>

      {/* Expandable body */}
      {expanded && (
        <div style={{ marginTop: '16px' }}>
          {/* Input row */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
            <input
              value={matchId}
              onChange={(e) => setMatchId(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !loading && handleFetch()}
              placeholder="输入 Dota 2 比赛 ID"
              style={{
                flex: 1, background: '#0d1117',
                border: '1px solid #30363d', borderRadius: '6px',
                padding: '7px 12px', color: '#e6edf3', fontSize: '13px',
              }}
            />
            <button
              onClick={handleFetch}
              disabled={!matchId.trim() || loading}
              style={{
                background: '#1f3b5a', border: '1px solid #79c0ff44',
                borderRadius: '6px', padding: '7px 18px',
                color: '#79c0ff', fontSize: '12px', fontWeight: '600',
                cursor: 'pointer', flexShrink: 0,
                opacity: (!matchId.trim() || loading) ? 0.5 : 1,
              }}
            >
              {loading ? '获取中...' : '预览'}
            </button>
          </div>

          {/* Error */}
          {error && (
            <div style={{
              background: '#3d1a1a', border: '1px solid #f8514944',
              borderRadius: '6px', padding: '10px 14px',
              fontSize: '12px', color: '#f85149', marginBottom: '14px',
            }}>
              {error}
            </div>
          )}

          {/* Preview result */}
          {preview && (
            <>
              {/* Match metadata */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: '12px',
                marginBottom: '12px', padding: '10px 14px',
                background: '#0d1117', borderRadius: '8px',
              }}>
                <span style={{ fontSize: '12px', color: '#8b949e' }}>
                  比赛 <span style={{ color: '#f0883e', fontWeight: '600' }}>{preview.matchId}</span>
                </span>
                <span style={{ fontSize: '12px', color: '#8b949e' }}>
                  时长 <span style={{ color: '#e6edf3' }}>{formatDuration(preview.duration)}</span>
                </span>
                <span style={{ fontSize: '12px', fontWeight: '600', color: winColor }}>
                  {winLabel}
                </span>
                {!preview.isParsed && (
                  <span style={{
                    fontSize: '10px', padding: '2px 7px', borderRadius: '4px',
                    background: '#e3b34122', color: '#e3b341', border: '1px solid #e3b34144',
                  }}>
                    未解析
                  </span>
                )}
              </div>

              {/* Warnings */}
              {preview.warnings?.length > 0 && (
                <div style={{
                  background: '#2d2008', border: '1px solid #e3b34144',
                  borderRadius: '6px', padding: '8px 14px', marginBottom: '12px',
                }}>
                  {preview.warnings.map((w, i) => (
                    <div key={i} style={{ fontSize: '11px', color: '#e3b341' }}>⚠ {w}</div>
                  ))}
                </div>
              )}

              {/* Two-column player grid */}
              <div style={{ display: 'flex', gap: '16px' }}>
                <TeamColumn players={radiantPlayers} team="radiant" />
                <TeamColumn players={direPlayers}    team="dire" />
              </div>

              <div style={{ marginTop: '12px', fontSize: '11px', color: '#8b949e44', textAlign: 'center' }}>
                选择英雄后可继续导入（功能即将上线）
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
