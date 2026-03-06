# EW370 LLM Classroom Demo (Raspberry Pi Friendly)

This project is a three-part web app for in-class demos:

1. `Tokenization` page: enter text and inspect color-highlighted token segments in the original text.
2. `Continuation` page: enter a prompt and view generated continuation.
3. `Attention` page: enter prompt text and view an attention heatmap.
4. `Classroom` page: instructor runs a live session where students vote on the next word.

## Stack

- `frontend` (React + Vite + Socket.IO client)
- `api` (Node.js + Express + Socket.IO)
- `ml-service` (FastAPI + Hugging Face `distilgpt2`)
- `docker-compose` for one-command startup

## Run on Raspberry Pi 4

1. Install Docker + Docker Compose plugin.
2. Copy this repo to the Pi.
3. Create env file:

```bash
cp .env.example .env
```

4. Build and start:

```bash
docker compose up --build
```

5. Open in browser:

```text
http://<pi-local-ip>:8080
```

Frontend runs in Vite dev mode in Docker, so source edits under `frontend/src` hot-reload automatically.

The first startup downloads model weights and can take several minutes.

## Student Flow

1. Instructor opens `Classroom` page and clicks `Start Session`.
2. Instructor projects QR code.
3. Students scan and vote from phones.
4. Instructor clicks `Accept Winner + Next` each round.
5. The page shows:
   - student vote totals,
   - class-selected token,
   - model top token for comparison.

## Notes for a Pi Deployment

- Default model is `distilgpt2` (small and CPU-friendly).
- For slower hardware, reduce generation length and keep prompts short.
- Attention visualization is capped by `MAX_SEQ_LEN` to avoid heavy compute.

## Dev Mode (optional)

Run each service locally:

```bash
# terminal 1
cd ml-service && pip install -r requirements.txt && uvicorn app.main:app --reload --port 8001

# terminal 2
cd api && npm install && npm start

# terminal 3
cd frontend && npm install && npm run dev
```

Then open `http://localhost:5173`.
