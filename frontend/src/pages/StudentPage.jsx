import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { io } from 'socket.io-client';
import { api, getOrCreateStudentId } from '../api';
import { colorForIndex } from '../candidateColors';

export default function StudentPage() {
  const { sessionId } = useParams();
  const studentId = useMemo(() => getOrCreateStudentId(), []);
  const [session, setSession] = useState(null);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const socket = io('/', { transports: ['websocket'] });

    socket.emit('class:join', { sessionId });
    socket.on('class:update', (payload) => {
      setSession(payload);
      setSelected((current) =>
        payload.candidates?.some((candidate) => candidate.token === current) ? current : '',
      );
    });
    socket.on('class:error', (payload) => setError(payload.message || 'Socket error'));

    async function fetchSession() {
      try {
        const res = await api.get(`/api/class/session/${sessionId}`);
        setSession(res.data);
      } catch {
        setError('Session not found. Ask your instructor for a fresh QR code.');
      }
    }

    fetchSession();
    return () => socket.disconnect();
  }, [sessionId]);

  async function vote(token) {
    setSelected(token);
    try {
      const res = await api.post(`/api/class/session/${sessionId}/vote`, { studentId, token });
      setSession(res.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Vote failed');
    }
  }

  if (error) {
    return (
      <section className="panel">
        <h2>Classroom Voting</h2>
        <p className="error">{error}</p>
      </section>
    );
  }

  if (!session) {
    return (
      <section className="panel">
        <h2>Classroom Voting</h2>
        <p>Connecting...</p>
      </section>
    );
  }

  return (
    <section className="panel student">
      <h2>Vote For Next Word</h2>
      <p><strong>Round {session.round}</strong></p>
      <p><strong>Prompt so far:</strong> {session.prompt}{session.generatedText}</p>
      <p className="muted">Tap one option. You can change your vote before the instructor accepts.</p>

      <div className="candidate-grid">
        {session.candidates.map((c, idx) => (
          <button
            key={`${c.token_id}-${c.rank}`}
            onClick={() => vote(c.token)}
            className={`candidate-chip candidate-button ${selected === c.token ? 'selected' : ''}`}
            style={{ '--chip-color': colorForIndex(idx) }}
            disabled={session.status !== 'active'}
          >
            <div className="candidate-word">{c.display || c.token}</div>
            <div className="chip-meta">
              <span className="vote-badge">{session.votes[c.token] || 0} votes</span>
            </div>
          </button>
        ))}
      </div>

      <p><strong>Model top choice this round:</strong> <code>{session.llmChoice}</code></p>
      {session.status !== 'active' && <p className="muted">Session complete.</p>}
    </section>
  );
}
