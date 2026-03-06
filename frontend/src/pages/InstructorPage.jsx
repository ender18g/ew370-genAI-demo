import { useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';
import { QRCodeSVG } from 'qrcode.react';
import { api } from '../api';
import { colorForIndex } from '../candidateColors';

export default function InstructorPage() {
  const [prompt, setPrompt] = useState('Although life at the US Naval Academy is challenging, I enjoy it because');
  const [candidateCount, setCandidateCount] = useState(5);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showProbability, setShowProbability] = useState(false);
  const [error, setError] = useState('');

  const joinUrl = useMemo(() => {
    if (!session) return '';
    return `${window.location.origin}/class/join/${session.id}`;
  }, [session]);

  useEffect(() => {
    if (!session) return undefined;
    const socket = io('/', { transports: ['websocket'] });

    socket.emit('class:join', { sessionId: session.id });
    socket.on('class:update', (payload) => setSession(payload));
    socket.on('class:error', (payload) => setError(payload.message || 'Socket error'));

    return () => socket.disconnect();
  }, [session?.id]);

  async function createSession() {
    setLoading(true);
    setError('');
    try {
      const res = await api.post('/api/class/session', { prompt, candidateCount });
      setSession(res.data);
    } catch (err) {
      const data = err.response?.data;
      const detail = data?.detail ? `: ${data.detail}` : '';
      setError(`${data?.error || 'Could not create session'}${detail}`);
    } finally {
      setLoading(false);
    }
  }

  async function acceptWord(chosenToken = null) {
    if (!session) return;
    setBusy(true);
    try {
      const payload = chosenToken ? { chosenToken } : {};
      const res = await api.post(`/api/class/session/${session.id}/accept`, payload);
      setSession(res.data);
    } catch (err) {
      const data = err.response?.data;
      const detail = data?.detail ? `: ${data.detail}` : '';
      setError(`${data?.error || 'Could not advance round'}${detail}`);
    } finally {
      setBusy(false);
    }
  }

  async function stopSession() {
    if (!session) return;
    setBusy(true);
    try {
      const res = await api.post(`/api/class/session/${session.id}/stop`);
      setSession(res.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not stop session');
    } finally {
      setBusy(false);
    }
  }

  async function resetSession() {
    if (!session) return;
    setBusy(true);
    try {
      const res = await api.post(`/api/class/session/${session.id}/reset`);
      setSession(res.data);
    } catch (err) {
      const data = err.response?.data;
      const detail = data?.detail ? `: ${data.detail}` : '';
      setError(`${data?.error || 'Could not reset session'}${detail}`);
    } finally {
      setBusy(false);
    }
  }

  function renderCurrentText() {
    if (!session) return null;
    const segments = Array.isArray(session.textSegments) ? session.textSegments : [];
    const acceptedSteps = Array.isArray(session.acceptedSteps) ? session.acceptedSteps : [];

    return (
      <div className="class-current-text">
        <span className="class-prompt-text">{session.prompt}</span>
        {segments.map((segment, idx) => {
          if (!segment.voted) {
            return <span key={`seg-${idx}`} className="plain-word-segment">{segment.text}</span>;
          }
          const step = acceptedSteps[segment.order || 0] || { token: segment.text, votes: 0 };
          const displayToken = step.token?.trim() || step.token;
          return (
            <span key={`seg-${idx}`} className="voted-word-segment">
              <span>{displayToken}</span>
              <span className="voted-count">{step.votes}</span>
            </span>
          );
        })}
      </div>
    );
  }

  return (
    <section className="panel">
      <h2>Classroom Collaboration (Instructor)</h2>
      <p className="muted">Start a prompt, project the QR code, and move one word at a time with class voting.</p>

      {!session && (
        <>
          <label>
            Starting prompt
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={4} />
          </label>
          <label>
            Number of word choices
            <input
              type="number"
              min={2}
              max={12}
              value={candidateCount}
              onChange={(e) => setCandidateCount(Number(e.target.value || 5))}
            />
          </label>
          <button disabled={loading} onClick={createSession}>
            {loading ? 'Starting...' : 'Start Session'}
          </button>
        </>
      )}

      {error && <p className="error">{error}</p>}

      {session && (
        <div className="split">
          <div className="panel soft">
            <h3>Session {session.id}</h3>
            <p className="class-prompt-row"><strong>Prompt:</strong></p>
            <div className="class-prompt-box">{session.prompt}</div>
            <p className="class-prompt-row"><strong>Current text:</strong></p>
            {renderCurrentText()}
            <p><strong>Round:</strong> {session.round}</p>
            <p><strong>Choices per round:</strong> {session.candidateCount}</p>
            <p><strong>LLM top choice:</strong> <code>{session.llmChoice}</code></p>
            <p><strong>Last accepted word:</strong> <code>{session.winner || '(none yet)'}</code></p>

            <div className="button-row">
              <button onClick={() => setShowProbability((value) => !value)} className="ghost">
                {showProbability ? 'Hide LLM Probability' : 'Show LLM Probability'}
              </button>
            </div>

            <h4>Candidate words</h4>
            <p className="muted">Instructor override: click any candidate chip to force that word as the next accepted word.</p>
            <div className="candidate-grid">
              {session.candidates.map((c, idx) => (
                <button
                  key={`${c.token_id}-${c.rank}`}
                  className="candidate-chip candidate-button"
                  style={{ '--chip-color': colorForIndex(idx) }}
                  onClick={() => acceptWord(c.token)}
                  disabled={busy || session.status !== 'active'}
                >
                  <div className="candidate-word">{c.display || c.token}</div>
                  <div className="chip-meta">
                    <span className="vote-badge">{session.votes[c.token] || 0} votes</span>
                    {showProbability && <small>p={c.prob.toFixed(3)}</small>}
                  </div>
                </button>
              ))}
            </div>

            <div className="button-row">
              <button onClick={() => acceptWord()} disabled={busy || session.status !== 'active'}>Use Vote Winner + Next</button>
              <button onClick={resetSession} disabled={busy} className="ghost">Reset To Prompt</button>
              <button onClick={stopSession} disabled={busy || session.status !== 'active'} className="ghost">Stop Session</button>
            </div>
          </div>

          <div className="panel soft qr-panel">
            <h3>Student Join QR</h3>
            <QRCodeSVG value={joinUrl} size={220} includeMargin />
            <p className="muted">{joinUrl}</p>
          </div>
        </div>
      )}
    </section>
  );
}
