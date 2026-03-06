import { useMemo, useState } from 'react';
import Plot from 'react-plotly.js';
import { PCA } from 'ml-pca';
import { api } from '../api';

const DEFAULT_WORDS = 'dog, cat, wolf, lion, car, truck, banana, apple, king, prince, queen, man, woman';
const MAX_WORDS = 20;

function parseWords(input) {
  const parts = input
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  const unique = [];
  const seen = new Set();
  for (const word of parts) {
    const key = word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(word);
  }
  return unique;
}

function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

function pairwiseSimilarities(words, vectors) {
  const rows = [];
  for (let i = 0; i < words.length; i += 1) {
    for (let j = i + 1; j < words.length; j += 1) {
      rows.push({
        a: words[i],
        b: words[j],
        similarity: cosineSimilarity(vectors[i], vectors[j]),
      });
    }
  }
  return rows.sort((x, y) => y.similarity - x.similarity);
}

function nearestNeighbors(words, vectors, selectedWord) {
  const idx = words.findIndex((word) => word === selectedWord);
  if (idx < 0) return [];

  const rows = [];
  for (let i = 0; i < words.length; i += 1) {
    if (i === idx) continue;
    rows.push({ word: words[i], similarity: cosineSimilarity(vectors[idx], vectors[i]) });
  }
  return rows.sort((x, y) => y.similarity - x.similarity);
}

function similarityClass(value) {
  if (value >= 0.7) return 'sim-high';
  if (value >= 0.45) return 'sim-mid';
  return 'sim-low';
}

export default function EmbeddingsPage() {
  const [input, setInput] = useState(DEFAULT_WORDS);
  const [selectedWord, setSelectedWord] = useState('dog');
  const [addWordA, setAddWordA] = useState('crown');
  const [addWordB, setAddWordB] = useState('woman');
  const [words, setWords] = useState([]);
  const [vectors, setVectors] = useState([]);
  const [extraPoints, setExtraPoints] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const similarityRows = useMemo(() => pairwiseSimilarities(words, vectors), [words, vectors]);
  const neighbors = useMemo(() => nearestNeighbors(words, vectors, selectedWord), [words, vectors, selectedWord]);

  async function generateEmbeddings() {
    setLoading(true);
    setError('');

    try {
      const parsedWords = parseWords(input);
      if (parsedWords.length < 2) {
        setError('Please enter at least 2 words or short phrases.');
        setLoading(false);
        return;
      }
      if (parsedWords.length > MAX_WORDS) {
        setError(`Please limit input to ${MAX_WORDS} words/phrases.`);
        setLoading(false);
        return;
      }

      const response = await api.post('/api/nlp/embeddings', { texts: parsedWords });
      const embeddingVectors = response.data.vectors;

      setWords(parsedWords);
      setVectors(embeddingVectors);
      setExtraPoints([]);
      setSelectedWord(parsedWords[0]);
    } catch (err) {
      const message = err?.response?.data?.detail || String(err?.message || err);
      setError(message || 'Embedding generation failed.');
    } finally {
      setLoading(false);
    }
  }

  async function addComposedPoint() {
    if (!addWordA.trim() || !addWordB.trim()) return;
    if (vectors.length === 0) {
      setError('Generate embeddings first, then add a composed point.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const lowerMap = new Map(words.map((word, idx) => [word.toLowerCase(), vectors[idx]]));
      const aKey = addWordA.trim().toLowerCase();
      const bKey = addWordB.trim().toLowerCase();

      let vecA = lowerMap.get(aKey);
      let vecB = lowerMap.get(bKey);

      const missing = [];
      if (!vecA) missing.push(addWordA.trim());
      if (!vecB) missing.push(addWordB.trim());

      if (missing.length > 0) {
        const response = await api.post('/api/nlp/embeddings', { texts: missing });
        const foundVectors = response.data.vectors || [];
        let cursor = 0;
        if (!vecA) {
          vecA = foundVectors[cursor];
          cursor += 1;
        }
        if (!vecB) {
          vecB = foundVectors[cursor];
        }
      }

      if (!vecA || !vecB) {
        setError('Could not compute composed embedding for those words.');
        return;
      }

      const composed = vecA.map((value, idx) => value + vecB[idx]);
      const norm = Math.sqrt(composed.reduce((acc, value) => acc + value * value, 0)) || 1;
      const normalized = composed.map((value) => value / norm);
      const label = `${addWordA.trim()} + ${addWordB.trim()}`;

      setExtraPoints((current) => [...current, { label, vector: normalized }]);
    } catch (err) {
      const message = err?.response?.data?.detail || String(err?.message || err);
      setError(message || 'Could not add composed point.');
    } finally {
      setLoading(false);
    }
  }

  const plotSeries = useMemo(() => {
    if (vectors.length === 0) return { base: [], extra: [] };
    const combinedVectors = [...vectors, ...extraPoints.map((item) => item.vector)];
    const pca = new PCA(combinedVectors, { center: true, scale: false });
    const projected = pca.predict(combinedVectors, { nComponents: 2 }).to2DArray();

    const base = projected.slice(0, words.length).map((point, idx) => ({
      x: point[0],
      y: point[1],
      label: words[idx],
    }));
    const extra = projected.slice(words.length).map((point, idx) => ({
      x: point[0],
      y: point[1],
      label: extraPoints[idx].label,
    }));
    return { base, extra };
  }, [vectors, words, extraPoints]);

  return (
    <section className="panel embeddings-page">
      <h2>Embeddings</h2>
      <p className="muted">Explore how semantically related words appear close together in vector space.</p>

      <div className="panel soft embeddings-dark">
        <label>
          Enter words or short phrases (comma separated)
          <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={3} />
        </label>
        <div className="button-row">
          <button onClick={generateEmbeddings} disabled={loading}>
            {loading ? 'Generating...' : 'Generate Embeddings'}
          </button>
        </div>
        <p className="muted">Up to {MAX_WORDS} words or short phrases.</p>
        {error && <p className="error">{error}</p>}
      </div>

      <div className="panel soft embeddings-dark">
        <h3>Vector Addition Explorer</h3>
        <p className="muted">Add two words and plot their summed embedding (for example, king + woman).</p>
        <div className="add-words-grid">
          <label>
            Word A
            <input value={addWordA} onChange={(e) => setAddWordA(e.target.value)} />
          </label>
          <label>
            Word B
            <input value={addWordB} onChange={(e) => setAddWordB(e.target.value)} />
          </label>
        </div>
        <div className="button-row">
          <button onClick={addComposedPoint} disabled={loading}>
            {loading ? 'Adding...' : 'Add A + B to Plot'}
          </button>
        </div>
      </div>

      {words.length > 0 && (
        <>
          <div className="panel soft embeddings-dark">
            <h3>2D Embedding Visualization (PCA)</h3>
            <Plot
              data={[
                {
                  x: plotSeries.base.map((point) => point.x),
                  y: plotSeries.base.map((point) => point.y),
                  mode: 'markers+text',
                  type: 'scatter',
                  text: plotSeries.base.map((point) => point.label),
                  textposition: 'top center',
                  marker: {
                    size: 12,
                    color: '#60a5fa',
                    line: { color: '#f59e0b', width: 1.5 },
                  },
                  hovertemplate: '<b>%{text}</b><br>x=%{x:.3f}<br>y=%{y:.3f}<extra></extra>',
                },
                {
                  x: plotSeries.extra.map((point) => point.x),
                  y: plotSeries.extra.map((point) => point.y),
                  mode: 'markers+text',
                  type: 'scatter',
                  text: plotSeries.extra.map((point) => point.label),
                  textposition: 'top center',
                  marker: {
                    size: 14,
                    color: '#f97316',
                    symbol: 'diamond',
                    line: { color: '#1e293b', width: 1.5 },
                  },
                  hovertemplate: '<b>%{text}</b><br>x=%{x:.3f}<br>y=%{y:.3f}<extra></extra>',
                },
              ]}
              layout={{
                autosize: true,
                paper_bgcolor: '#f4f8ff',
                plot_bgcolor: '#ffffff',
                font: { color: '#0b1a2b' },
                margin: { l: 40, r: 20, t: 20, b: 40 },
                xaxis: { zeroline: false, gridcolor: '#dbeafe' },
                yaxis: { zeroline: false, gridcolor: '#dbeafe' },
                showlegend: false,
                transition: { duration: 450, easing: 'cubic-in-out' },
              }}
              config={{ responsive: true, displayModeBar: false }}
              style={{ width: '100%', height: '420px' }}
              useResizeHandler
            />
          </div>

          <div className="split">
            <div className="panel soft embeddings-dark">
              <h3>Nearest Neighbor Explorer</h3>
              <label>
                Select a word
                <select value={selectedWord} onChange={(e) => setSelectedWord(e.target.value)}>
                  {words.map((word) => (
                    <option key={word} value={word}>{word}</option>
                  ))}
                </select>
              </label>
              <h4>Most similar words</h4>
              <ol className="neighbor-list">
                {neighbors.slice(0, 5).map((row) => (
                  <li key={`${selectedWord}-${row.word}`}>
                    {row.word} ({row.similarity.toFixed(3)})
                  </li>
                ))}
              </ol>
            </div>

            <div className="panel soft embeddings-dark">
              <h3>What Is An Embedding?</h3>
              <p>
                LLMs convert words into vectors of numbers called embeddings. Words that appear in similar
                contexts end up near each other in vector space.
              </p>
              <p>
                The model measures semantic similarity using cosine similarity between these vectors.
              </p>
              <p className="pipeline"><strong>text {'->'} tokens {'->'} embeddings {'->'} attention {'->'} next token prediction</strong></p>
            </div>
          </div>

          <div className="panel soft embeddings-dark">
            <h3>Similarity Table</h3>
            <div className="sim-table-wrap">
              <table className="sim-table">
                <thead>
                  <tr>
                    <th>Word A</th>
                    <th>Word B</th>
                    <th>Similarity</th>
                  </tr>
                </thead>
                <tbody>
                  {similarityRows.map((row) => (
                    <tr key={`${row.a}-${row.b}`}>
                      <td>{row.a}</td>
                      <td>{row.b}</td>
                      <td className={similarityClass(row.similarity)}>{row.similarity.toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
