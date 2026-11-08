# SpeakUp English Practice

Conversational American English practice. Text and microphone share one conversation. The tutor corrects real grammar, wording, collocation, word order, and un-American usage. It does not invent a pronunciation score from the transcript.

## What is in this repo

- `public/` is the website. GitHub Pages can show these files, but it cannot run the AI.
- `server.js` is the Node.js backend. Deploy this to a host that runs Node, such as Render or Railway.
- Root `index.html` is the GitHub Pages entry. It loads `public/style.css` and `public/app.js`.
- `public/index.html` is what `npm start` serves locally, with root-absolute asset paths.

## Run locally

1. Install Node.js 18 or newer.
2. In this folder, run `npm install`.
3. Copy `.env.example` to `.env`.
4. Ask a parent to put the OpenAI key in `.env` as `OPENAI_API_KEY=...`.
5. Run `npm start`.
6. Open `http://localhost:3000`.
7. Leave 后端地址 empty when you use this local server.

Text: type a sentence and press Send.
Voice: press the microphone, speak, press it again. The server transcribes the audio, replies, and returns speech.
Pause, continue, and stop control the spoken reply.

## Deploy the backend

GitHub Pages only serves the static site. Set the Pages source to the `main` branch, folder `/ (root)`, if you want the page online.

Deploy the same repository to Render or Railway as a Node web service:

- Build command: `npm install`
- Start command: `npm start`

Set environment variables in that host's dashboard, not in GitHub:

- `OPENAI_API_KEY` — required for chat, transcription, and speech
- `OPENAI_MODEL` — optional, default `gpt-4o-mini`
- `OPENAI_TRANSCRIBE_MODEL` — optional, default `gpt-4o-mini-transcribe`
- `OPENAI_TTS_MODEL` — optional, default `gpt-4o-mini-tts`
- `OPENAI_TTS_VOICE` — optional, default `nova`
- `APP_ACCESS_CODE` — optional passphrase required on every AI request
- `DAILY_REQUEST_CAP` — optional, default 150 AI requests per IP per day
- `ALLOWED_ORIGINS` — include `https://jpacis-5b7256e4.github.io`
- `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION` — optional, only for real pronunciation scores
- `PORT` — usually supplied by the host

Then open the GitHub Pages site and paste the backend URL into 后端地址. That value stays in your browser. It is not a secret, but the API key must never be pasted there.

## Pronunciation

Grammar corrections come from the words you said or typed. Pronunciation numbers appear only when Azure Speech is configured and you press 再读这句, so the recording can be compared with a known sentence. If Azure is not configured, the site says so and does not show a made-up score.

## Cost

OpenAI charges for each chat, transcription, and voice reply. Azure charges separately if pronunciation assessment is turned on. The server limits how often one address can call it. A parent should own the API account and the billing settings.

## Security

- Never commit `.env`.
- Never put an API key in `public/` or browser JavaScript.
- Keep the repository public only if it contains no secrets.
- `.env.example` has empty placeholders only.
