import { useState } from 'react';
import { api } from '../api';

function temperatureColor(temperature) {
  const t = Math.max(0, Math.min(1, temperature / 2));
  const start = [59, 130, 246];
  const end = [249, 115, 22];
  const r = Math.round(start[0] + (end[0] - start[0]) * t);
  const g = Math.round(start[1] + (end[1] - start[1]) * t);
  const b = Math.round(start[2] + (end[2] - start[2]) * t);
  return `rgba(${r}, ${g}, ${b}, 0.2)`;
}

export default function ContinuationPage() {
  const [prompt, setPrompt] = useState('Although life at the US Naval Academy is challenging, I enjoy it because');
  const [temperature, setTemperature] = useState(0.7);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function generate() {
    setLoading(true);
    setError('');
    try {
      const res = await api.post('/api/nlp/generate', { prompt, max_new_tokens: 30, temperature });
      const completion = res.data.completion || '';
      setHistory((current) => [
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          temperature,
          completion,
        },
        ...current,
      ]);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not generate continuation');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="panel">
      <h2>Prediction</h2>
      <p className="muted">Use this page to test next-text prediction separate from tokenization.</p>
      <p className="warning-note">
        Warning: this can be slow because the model is running locally on a Raspberry Pi CPU.
      </p>
      <div className="micro-explainer">
        <h4>What is prediction?</h4>
        <p>
          Continuation is the model predicting what text most likely comes next after your prompt.
          Higher temperature makes output more creative and surprising, while lower temperature is safer and more predictable.
        </p>
      </div>
      <label>
        Prompt
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={5} />
      </label>
      <label>
        Temperature (randomness): {temperature.toFixed(2)}
        <input
          type="range"
          min={0}
          max={2}
          step={0.05}
          value={temperature}
          onChange={(e) => setTemperature(Number(e.target.value))}
        />
      </label>
      <button onClick={generate} disabled={loading}>
        {loading ? 'Generating...' : 'Generate Continuation'}
      </button>
      {error && <p className="error">{error}</p>}

      <div className="panel soft">
        <h3>Model continuations this session</h3>
        {history.length === 0 && <p className="output">(Run generation to see output.)</p>}
        <div className="continuation-history">
          {history.map((entry, index) => (
            <article
              key={entry.id}
              className={`continuation-entry ${index === 0 ? 'latest' : ''}`}
              style={{ backgroundColor: temperatureColor(entry.temperature) }}
            >
              <p className="continuation-meta">Temperature: {entry.temperature.toFixed(2)}</p>
              <p className="continuation-text">{entry.completion || '(empty completion)'}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
