# SpeakUp English Practice — Version 2

A conversational English practice app with a Node.js backend and an OpenAI-powered tutor.

## Features
- Continuous tutor conversation with short conversation history
- American English default
- Scenario, learner level, and tutor personality settings
- Optional correction mode
- Browser speech recognition (where supported)
- American English text-to-speech
- API key is read only from the server environment

## Run locally
1. Install Node.js 18 or newer.
2. In this folder, run `npm install`.
3. Copy `.env.example` to `.env`.
4. Put your API key in `.env` as `OPENAI_API_KEY=...`.
5. Run `npm start`.
6. Open `http://localhost:3000`.

## Deploy
Deploy this project to a Node.js hosting service (for example, Render or Railway).
Set these environment variables in the hosting dashboard:
- `OPENAI_API_KEY` — your private API key
- `OPENAI_MODEL` — optional; defaults to `gpt-4o-mini`
- `PORT` — usually supplied by the host

Do not deploy this backend as a GitHub Pages site. GitHub Pages only hosts static files and cannot run the `/api/chat` server endpoint.

## Security
- Never commit `.env`.
- Never put an API key in `public/` or browser JavaScript.
- Keep the repository public only if it contains no secrets.
- API access may incur charges. Have a parent or guardian help review account and billing requirements before using a paid API.
