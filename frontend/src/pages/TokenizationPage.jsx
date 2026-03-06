import { useMemo, useState } from 'react';
import { api } from '../api';
import { colorForIndex } from '../candidateColors';

function buildSegments(text, tokens) {
  if (!tokens.length) return [{ text, type: 'plain' }];

  const segments = [];
  let cursor = 0;

  for (const token of tokens) {
    const start = Number(token.start);
    const end = Number(token.end);
    if (start > cursor) {
      segments.push({ text: text.slice(cursor, start), type: 'plain' });
    }
    segments.push({ text: text.slice(start, end), type: 'token', token });
    cursor = end;
  }

  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), type: 'plain' });
  }

  return segments;
}

export default function TokenizationPage() {
  const [text, setText] = useState(
    'Yesterday the robotics team tested a prototype drone-controller running firmware_v2.3, and it didn’t behave the way we expected. At first the quadrotor’s IMU reported strange values like 9.81m/s² and −0.03rad/s, which made the autopilot over-correct every few milliseconds. Someone joked that the controller had become “self-aware,” but the real problem turned out to be a mis-calibrated accelerometer and a badly formatted JSON log-file. After fixing the bug, recompiling the code, and restarting the flight-control loop, the drone hovered steadily at 1.5 meters above the lab floor for nearly 10 minutes.',
  );
  const [tokens, setTokens] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const segments = useMemo(() => buildSegments(text, tokens), [text, tokens]);

  async function analyze() {
    setLoading(true);
    setError('');
    try {
      const tok = await api.post('/api/nlp/tokenize', { text });
      setTokens(tok.data.tokens || []);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not tokenize text');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="panel">
      <h2>Tokenization</h2>
      <p className="muted">Each tokenized segment is color-highlighted directly in the original text.</p>
      <div className="micro-explainer">
        <h4>What is a token?</h4>
        <p>
          A token is a small text chunk the model reads, like a word, part of a word, or punctuation.
          The model does not read full sentences all at once, it reads tokens and builds meaning step by step.
        </p>
      </div>
      <label>
        Text for tokenization
        <textarea className="token-text-input" value={text} onChange={(e) => setText(e.target.value)} rows={6} />
      </label>
      <button onClick={analyze} disabled={loading}>
        {loading ? 'Tokenizing...' : 'Tokenize Text'}
      </button>
      {error && <p className="error">{error}</p>}

      <div className="panel soft">
        <h3>Original text with token segments</h3>
        <p className="tokenized-text">
          {segments.map((segment, idx) => {
            if (segment.type === 'plain') return <span key={`plain-${idx}`}>{segment.text}</span>;
            const tokenIndex = segment.token.index;
            return (
              <span
                key={`token-seg-${tokenIndex}`}
                className="token-segment"
                style={{ backgroundColor: colorForIndex(tokenIndex) }}
                title={`Token ${tokenIndex} (id ${segment.token.token_id})`}
              >
                {segment.text}
              </span>
            );
          })}
        </p>
      </div>

      <div className="panel soft">
        <h3>Token list ({tokens.length})</h3>
        <div className="token-wrap">
          {tokens.map((token) => (
            <span
              key={`${token.index}-${token.token_id}`}
              className="token-pill"
              style={{ borderColor: colorForIndex(token.index), backgroundColor: `${colorForIndex(token.index)}1a` }}
            >
              <strong>{token.token || '(space)'}</strong>
              <small>id {token.token_id}</small>
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
