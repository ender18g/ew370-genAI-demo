import express from 'express';
import cors from 'cors';
import axios from 'axios';
import http from 'http';
import { Server } from 'socket.io';
import { nanoid } from 'nanoid';

const PORT = Number(process.env.PORT || 8000);
const ML_URL = process.env.ML_URL || 'http://ml-service:8001';
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || '*';

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json({ limit: '1mb' }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CLIENT_ORIGIN, methods: ['GET', 'POST'] },
});

const sessions = new Map();
const WORD_REGEX = /^[A-Za-z][A-Za-z'-]*$/;
const AUTO_APPEND_LIMIT = 20;

function buildSessionPayload(session) {
  return {
    id: session.id,
    prompt: session.prompt,
    candidateCount: session.candidateCount,
    generatedText: session.generatedText,
    round: session.round,
    candidates: session.candidates,
    llmChoice: session.llmChoice,
    votes: session.votes,
    status: session.status,
    winner: session.winner,
    textSegments: session.textSegments,
    acceptedSteps: session.acceptedSteps,
    updatedAt: session.updatedAt,
  };
}

function recalculateVotes(session) {
  const counts = {};
  for (const token of Object.values(session.votesByStudent)) {
    counts[token] = (counts[token] || 0) + 1;
  }
  session.votes = counts;
}

function selectWinner(session, chosenToken = null) {
  const candidateTokens = session.candidates.map((c) => c.token);
  if (chosenToken && candidateTokens.includes(chosenToken)) {
    return chosenToken;
  }
  let winner = candidateTokens[0];
  let maxVotes = -1;

  for (const token of candidateTokens) {
    const voteCount = session.votes[token] || 0;
    if (voteCount > maxVotes) {
      winner = token;
      maxVotes = voteCount;
    }
  }

  if (maxVotes === 0) {
    winner = session.llmChoice;
  }

  return winner;
}

async function fetchNextCandidates(text, k = 5) {
  const response = await axios.post(`${ML_URL}/next-candidates`, { text, k });
  return response.data;
}

function stripSpecialTokenText(token) {
  return token
    .replace(/<\|endoftext\|>/gi, '')
    .replace(/\r?\n/g, '')
    .replace(/\uFFFD/g, '');
}

function buildDisplayToken(token) {
  return stripSpecialTokenText(token).trim();
}

function isWordToken(token) {
  const display = buildDisplayToken(token);
  return WORD_REGEX.test(display);
}

function toCandidateWithDisplay(candidate) {
  return {
    ...candidate,
    display: buildDisplayToken(candidate.token),
  };
}

async function prepareWordVotingRound(initialText, candidateCount = 5) {
  let text = initialText;
  let autoAppended = '';
  const lookupK = Math.min(50, Math.max(12, candidateCount * 4));

  for (let i = 0; i < AUTO_APPEND_LIMIT; i += 1) {
    const lookup = await fetchNextCandidates(text, lookupK);
    const withDisplay = lookup.candidates.map(toCandidateWithDisplay);
    const wordCandidates = withDisplay.filter((candidate) => isWordToken(candidate.token));

    if (wordCandidates.length >= candidateCount) {
      return {
        candidates: wordCandidates.slice(0, candidateCount),
        llmChoice: wordCandidates[0].token,
        autoAppended,
      };
    }

    const fallback = withDisplay.find((candidate) => candidate.display.length > 0) || withDisplay[0];
    if (!fallback) {
      break;
    }
    text += fallback.token;
    autoAppended += fallback.token;
  }

  throw new Error('Could not find enough word candidates for voting');
}

function sessionText(session) {
  return `${session.prompt}${session.generatedText}`;
}

function appendTextSegment(session, text, voted = false) {
  if (!text) return;
  session.textSegments.push({
    text,
    voted,
    order: voted ? Math.max(0, session.acceptedSteps.length - 1) : null,
  });
}

io.on('connection', (socket) => {
  socket.on('class:join', ({ sessionId }) => {
    if (!sessionId || !sessions.has(sessionId)) {
      socket.emit('class:error', { message: 'Session not found.' });
      return;
    }
    socket.join(sessionId);
    socket.emit('class:update', buildSessionPayload(sessions.get(sessionId)));
  });
});

app.get('/health', async (_req, res) => {
  try {
    const ml = await axios.get(`${ML_URL}/health`);
    res.json({ status: 'ok', ml: ml.data });
  } catch {
    res.status(503).json({ status: 'degraded', ml: 'unreachable' });
  }
});

app.post('/api/nlp/tokenize', async (req, res) => {
  try {
    const result = await axios.post(`${ML_URL}/tokenize`, req.body);
    res.json(result.data);
  } catch (error) {
    res.status(500).json({ error: 'Tokenization failed', detail: error.message });
  }
});

app.post('/api/nlp/generate', async (req, res) => {
  try {
    const result = await axios.post(`${ML_URL}/generate`, req.body);
    res.json(result.data);
  } catch (error) {
    res.status(500).json({ error: 'Generation failed', detail: error.message });
  }
});

app.post('/api/nlp/attention', async (req, res) => {
  try {
    const result = await axios.post(`${ML_URL}/attention`, req.body);
    res.json(result.data);
  } catch (error) {
    const detail = error.response?.data?.detail || error.response?.data?.error || error.message;
    res.status(500).json({ error: 'Attention failed', detail });
  }
});

app.post('/api/nlp/next-candidates', async (req, res) => {
  try {
    const result = await axios.post(`${ML_URL}/next-candidates`, req.body);
    res.json(result.data);
  } catch (error) {
    res.status(500).json({ error: 'Candidate lookup failed', detail: error.message });
  }
});

app.post('/api/class/session', async (req, res) => {
  const { prompt, candidateCount } = req.body;
  if (!prompt || !prompt.trim()) {
    res.status(400).json({ error: 'Prompt is required.' });
    return;
  }
  const choices = Number(candidateCount ?? 5);
  if (!Number.isInteger(choices) || choices < 2 || choices > 12) {
    res.status(400).json({ error: 'candidateCount must be an integer between 2 and 12.' });
    return;
  }

  try {
    const starter = await prepareWordVotingRound(prompt.trim(), choices);
    const id = nanoid(8);
    const session = {
      id,
      prompt: prompt.trim(),
      candidateCount: choices,
      generatedText: starter.autoAppended,
      textSegments: [],
      acceptedSteps: [],
      round: 1,
      candidates: starter.candidates,
      llmChoice: starter.llmChoice,
      votesByStudent: {},
      votes: {},
      status: 'active',
      winner: null,
      updatedAt: new Date().toISOString(),
    };
    appendTextSegment(session, starter.autoAppended, false);

    sessions.set(id, session);
    io.to(id).emit('class:update', buildSessionPayload(session));
    res.status(201).json(buildSessionPayload(session));
  } catch (error) {
    res.status(500).json({ error: 'Could not create session', detail: error.message });
  }
});

app.get('/api/class/session/:id', (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  res.json(buildSessionPayload(session));
});

app.post('/api/class/session/:id/vote', (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  if (session.status !== 'active') {
    res.status(400).json({ error: 'Session is not active' });
    return;
  }

  const { studentId, token } = req.body;
  if (!studentId || !token) {
    res.status(400).json({ error: 'studentId and token are required' });
    return;
  }

  const allowedTokens = new Set(session.candidates.map((c) => c.token));
  if (!allowedTokens.has(token)) {
    res.status(400).json({ error: 'Token not in active candidates' });
    return;
  }

  session.votesByStudent[studentId] = token;
  recalculateVotes(session);
  session.updatedAt = new Date().toISOString();

  io.to(session.id).emit('class:update', buildSessionPayload(session));
  res.json(buildSessionPayload(session));
});

app.post('/api/class/session/:id/accept', async (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  if (session.status !== 'active') {
    res.status(400).json({ error: 'Session is not active' });
    return;
  }
  const chosenToken = req.body?.chosenToken;
  if (chosenToken && !session.candidates.some((candidate) => candidate.token === chosenToken)) {
    res.status(400).json({ error: 'chosenToken is not in active candidates' });
    return;
  }

  try {
    const winner = selectWinner(session, chosenToken);
    const winnerVotes = session.votes[winner] || 0;
    session.winner = winner;
    session.generatedText += winner;
    session.acceptedSteps.push({ token: winner, votes: winnerVotes });
    appendTextSegment(session, winner, true);

    const next = await prepareWordVotingRound(sessionText(session), session.candidateCount || 5);
    session.generatedText += next.autoAppended;
    appendTextSegment(session, next.autoAppended, false);
    session.candidates = next.candidates;
    session.llmChoice = next.llmChoice;
    session.round += 1;
    session.votesByStudent = {};
    session.votes = {};
    session.updatedAt = new Date().toISOString();

    io.to(session.id).emit('class:update', buildSessionPayload(session));
    res.json(buildSessionPayload(session));
  } catch (error) {
    res.status(500).json({ error: 'Could not advance round', detail: error.message });
  }
});

app.post('/api/class/session/:id/stop', (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  session.status = 'complete';
  session.updatedAt = new Date().toISOString();
  io.to(session.id).emit('class:update', buildSessionPayload(session));
  res.json(buildSessionPayload(session));
});

app.post('/api/class/session/:id/reset', async (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  try {
    const starter = await prepareWordVotingRound(session.prompt, session.candidateCount || 5);
    session.generatedText = starter.autoAppended;
    session.textSegments = [];
    session.acceptedSteps = [];
    session.round = 1;
    session.candidates = starter.candidates;
    session.llmChoice = starter.llmChoice;
    session.votesByStudent = {};
    session.votes = {};
    session.status = 'active';
    session.winner = null;
    appendTextSegment(session, starter.autoAppended, false);
    session.updatedAt = new Date().toISOString();

    io.to(session.id).emit('class:update', buildSessionPayload(session));
    res.json(buildSessionPayload(session));
  } catch (error) {
    res.status(500).json({ error: 'Could not reset session', detail: error.message });
  }
});

server.listen(PORT, () => {
  console.log(`API listening on ${PORT}`);
});
