import { Fragment, useMemo, useState } from 'react';
import { api } from '../api';

const HEAT_STOPS = [
  [44, 123, 182],
  [67, 162, 202],
  [171, 217, 233],
  [255, 255, 191],
  [253, 174, 97],
  [244, 109, 67],
  [215, 48, 39],
];

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function heatColor(weight, min, max) {
  if (!Number.isFinite(weight)) return 'rgb(120, 120, 120)';
  if (max <= min) return 'rgb(171, 217, 233)';

  const normalized = Math.min(1, Math.max(0, (weight - min) / (max - min)));
  const scaled = normalized * (HEAT_STOPS.length - 1);
  const lowIdx = Math.floor(scaled);
  const highIdx = Math.min(HEAT_STOPS.length - 1, lowIdx + 1);
  const t = scaled - lowIdx;
  const low = HEAT_STOPS[lowIdx];
  const high = HEAT_STOPS[highIdx];

  const r = Math.round(lerp(low[0], high[0], t));
  const g = Math.round(lerp(low[1], high[1], t));
  const b = Math.round(lerp(low[2], high[2], t));
  return `rgb(${r}, ${g}, ${b})`;
}

export default function AttentionPage() {
  const [text, setText] = useState('The engineer who repaired the drone replaced the battery, and the drone flew again.');
  const [tokens, setTokens] = useState([]);
  const [matrix, setMatrix] = useState([]);
  const [vizMode, setVizMode] = useState('sink-adjusted');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const displayMatrix = useMemo(() => {
    if (vizMode !== 'sink-adjusted') return matrix;
    return matrix.map((row, i) => {
      if (!Array.isArray(row)) return row;
      const fullRow = row.map((value) => Number(value) || 0);
      if (i === 0) {
        return fullRow.map((value, j) => (j === 0 ? 0 : value));
      }
      const validPrefix = fullRow.slice(0, i + 1);
      const noSink = validPrefix.slice(1);
      const sumNoSink = noSink.reduce((acc, v) => acc + (Number(v) || 0), 0);
      if (sumNoSink <= 0) {
        return fullRow.map((_v, j) => (j <= i ? 0 : fullRow[j]));
      }
      return fullRow.map((v, j) => {
        if (j === 0 && j <= i) return 0;
        if (j > i) return v;
        return (Number(v) || 0) / sumNoSink;
      });
    });
  }, [matrix, vizMode]);

  const rowStats = useMemo(() => {
    return displayMatrix.map((row, i) => {
      const allowed = row.slice(0, i + 1).filter((value) => typeof value === 'number');
      let min = Number.POSITIVE_INFINITY;
      let max = Number.NEGATIVE_INFINITY;
      for (const value of allowed) {
        min = Math.min(min, value);
        max = Math.max(max, value);
      }
      return {
        min: Number.isFinite(min) ? min : 0,
        max: Number.isFinite(max) ? max : 1,
      };
    });
  }, [displayMatrix]);

  const tokenAttentionScores = useMemo(() => {
    const scores = tokens.map((token, idx) => ({ token: token.token || '(space)', index: idx, score: 0 }));
    for (let query = 0; query < displayMatrix.length; query += 1) {
      const row = displayMatrix[query] || [];
      for (let key = 0; key <= query && key < row.length; key += 1) {
        if (vizMode === 'sink-adjusted' && key === 0) continue;
        scores[key].score += Number(row[key]) || 0;
      }
    }
    return scores;
  }, [displayMatrix, tokens, vizMode]);

  const topAttentionTokens = useMemo(() => {
    return [...tokenAttentionScores]
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
  }, [tokenAttentionScores]);

  const topConnections = useMemo(() => {
    const connections = [];
    for (let i = 0; i < displayMatrix.length; i += 1) {
      const row = displayMatrix[i] || [];
      for (let j = 0; j <= i && j < row.length; j += 1) {
        if (vizMode === 'sink-adjusted' && j === 0) continue;
        const fromToken = (tokens[i]?.token || '').trim().toLowerCase();
        const toToken = (tokens[j]?.token || '').trim().toLowerCase();
        if (fromToken && toToken && fromToken === toToken) continue;
        connections.push({
          from_index: i,
          to_index: j,
          from_token: tokens[i]?.token || '',
          to_token: tokens[j]?.token || '',
          weight: Number(row[j]) || 0,
        });
      }
    }
    return connections.sort((a, b) => b.weight - a.weight).slice(0, 12);
  }, [displayMatrix, tokens, vizMode]);

  const scoreRange = useMemo(() => {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const item of tokenAttentionScores) {
      min = Math.min(min, item.score);
      max = Math.max(max, item.score);
    }
    return {
      min: Number.isFinite(min) ? min : 0,
      max: Number.isFinite(max) ? max : 1,
    };
  }, [tokenAttentionScores]);

  async function runAttention() {
    setLoading(true);
    setError('');
    try {
      const res = await api.post('/api/nlp/attention', { text });
      setTokens(res.data.tokens || []);
      setMatrix(res.data.matrix || []);
    } catch (err) {
      const detail = err.response?.data?.detail;
      setError(detail ? `Attention visualization failed: ${detail}` : 'Attention visualization failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="panel">
      <h2>Attention Visualization</h2>
      <p className="muted">Darker cells mean higher average attention in the model&apos;s last layer.</p>
      <div className="micro-explainer">
        <h4>What is attention?</h4>
        <p>
          Attention shows which earlier words the model focuses on when it processes the current word.
          Think of it like highlighting important context, so the model can connect ideas across the sentence.
        </p>
      </div>
      <label>
        Prompt
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} />
      </label>
      <button onClick={runAttention} disabled={loading}>
        {loading ? 'Computing...' : 'Visualize Attention'}
      </button>
      <div className="button-row" style={{ marginTop: '0.7rem' }}>
        <button
          onClick={() => setVizMode((mode) => (mode === 'raw' ? 'sink-adjusted' : 'raw'))}
          className="ghost"
          type="button"
        >
          {vizMode === 'raw' ? 'Mode: Raw Attention' : 'Mode: Sink-Adjusted'}
        </button>
      </div>
      {error && <p className="error">{error}</p>}

      {tokens.length > 0 && (
        <div className="panel soft">
          <h3>Heatmap</h3>
          <p className="muted">
            Attention shown as query token (rows) to key token (columns), averaged over heads and layers.
            {vizMode === 'sink-adjusted' ? ' Sink-adjusted mode suppresses the first-token attention sink.' : ''}
          </p>
          <div className="heat-legend">
            <span>Low</span>
            <div className="heat-gradient" />
            <span>High</span>
          </div>
          <div className="heatmap" style={{ gridTemplateColumns: `repeat(${tokens.length + 1}, minmax(40px, 1fr))` }}>
            <div className="axis-cell" />
            {tokens.map((t) => (
              <div className="axis-cell" key={`x-${t.index}`}>{t.token}</div>
            ))}
            {tokens.map((rowTok, i) => (
              <Fragment key={`row-${rowTok.index}`}>
                <div className="axis-cell" key={`y-${rowTok.index}`}>{rowTok.token}</div>
                {tokens.map((_colTok, j) => {
                  const value = Number(displayMatrix[i]?.[j]) || 0;
                  return (
                    <div
                      className="heat-cell"
                      key={`m-${i}-${j}`}
                      style={{
                        backgroundColor: j > i ? '#edf2f7' : heatColor(value, rowStats[i]?.min ?? 0, rowStats[i]?.max ?? 1),
                        color: j > i ? '#94a3b8' : undefined,
                      }}
                      title={j > i
                        ? `${tokens[i]?.token} cannot attend to future token ${tokens[j]?.token} in a causal LM`
                        : `${tokens[i]?.token} -> ${tokens[j]?.token}: ${value.toFixed(4)}`}
                    >
                      {j > i ? '·' : value.toFixed(2)}
                    </div>
                  );
                })}
              </Fragment>
            ))}
          </div>

          <h3>Attention Token Cloud</h3>
          <p className="muted">Bigger words receive more total attention across the sequence.</p>
          <div className="attention-cloud">
            {tokenAttentionScores.map((item) => {
              const normalized = scoreRange.max <= scoreRange.min
                ? 0.5
                : (item.score - scoreRange.min) / (scoreRange.max - scoreRange.min);
              const fontSize = 14 + normalized * 28;
              return (
                <span
                  key={`cloud-${item.index}`}
                  className="cloud-word"
                  style={{ fontSize: `${fontSize}px`, color: heatColor(normalized, 0, 1) }}
                  title={`Total attention score: ${item.score.toFixed(4)}`}
                >
                  {item.token}
                </span>
              );
            })}
          </div>

          <h3>Top Attended Tokens</h3>
          <div className="attention-bars">
            {topAttentionTokens.map((item) => {
              const width = scoreRange.max <= 0 ? 0 : (item.score / scoreRange.max) * 100;
              return (
                <div key={`bar-${item.index}`} className="attn-bar-row">
                  <span className="attn-label">{item.token}</span>
                  <div className="attn-bar-track">
                    <div className="attn-bar-fill" style={{ width: `${width}%` }} />
                  </div>
                  <span className="attn-score">{item.score.toFixed(3)}</span>
                </div>
              );
            })}
          </div>

          <h3>{vizMode === 'sink-adjusted' ? 'Sink-Adjusted Top Connections' : 'Top Connections'}</h3>
          <ul className="link-list">
            {topConnections.map((link, idx) => (
              <li key={`${link.from_index}-${link.to_index}-${idx}`}>
                {link.from_token} {'->'} {link.to_token}: {link.weight.toFixed(4)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
