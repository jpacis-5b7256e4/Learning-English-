const express = require("express");
const path = require("path");
const OpenAI = require("openai");

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "3mb" }));

const PORT = Number(process.env.PORT || 3000);
const WINDOW_MS = 10 * 60 * 1000;
const LIMITS = { chat: 20, voice: 8 };
const DAILY_CAP = Number(process.env.DAILY_REQUEST_CAP || 150);
const MAX_AUDIO_BYTES = 1_600_000;

const ALLOWED = (process.env.ALLOWED_ORIGINS ||
  "http://localhost:3000,http://127.0.0.1:3000,https://jpacis-5b7256e4.github.io")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Access-Code");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  }
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

const hits = new Map();
const daily = new Map();

function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded) return forwarded.split(",")[0].trim();
  return req.socket.remoteAddress || "unknown";
}

function clip(value, max) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function takeQuota(ip, kind) {
  const now = Date.now();
  const dayKey = `${ip}:${new Date().toISOString().slice(0, 10)}`;
  const usedToday = daily.get(dayKey) || 0;
  if (usedToday >= DAILY_CAP) {
    return "今天的练习次数已经到上限。这是费用保护，请明天再练，或让家长调高 DAILY_REQUEST_CAP。";
  }
  const key = `${ip}:${kind}`;
  const recent = (hits.get(key) || []).filter((stamp) => now - stamp < WINDOW_MS);
  if (recent.length >= (LIMITS[kind] || 10)) {
    return "请求太密了。等几分钟再试，避免把 API 费用打上去。";
  }
  recent.push(now);
  hits.set(key, recent);
  daily.set(dayKey, usedToday + 1);
  if (daily.size > 5000) daily.clear();
  return "";
}

function hasKey() {
  return Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== "put_your_key_here");
}

function denyKey(res) {
  res.status(503).json({
    error: "服务器还没有 OPENAI_API_KEY。请让家长在托管平台的环境变量里配置，不要把密钥写进网页或 GitHub。"
  });
}

function allowAccess(req, res) {
  const expected = process.env.APP_ACCESS_CODE;
  if (!expected) return true;
  if ((req.get("x-access-code") || "") !== expected) {
    res.status(401).json({ error: "访问口令不对。口令只放在服务器环境变量 APP_ACCESS_CODE 里。" });
    return false;
  }
  return true;
}

function openai() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 30000, maxRetries: 0 });
}

function levelNote(level) {
  const notes = {
    "初级": "Learner level: beginner. Use common words. Keep your own sentences under 12 words.",
    "Beginner": "Learner level: beginner. Use common words. Keep your own sentences under 12 words.",
    "日常": "Learner level: everyday conversation. Sound like a normal American, not a textbook.",
    "Everyday": "Learner level: everyday conversation. Sound like a normal American, not a textbook.",
    "中级": "Learner level: intermediate. Natural pace is fine. Flag translated or stiff phrasing.",
    "Intermediate": "Learner level: intermediate. Natural pace is fine. Flag translated or stiff phrasing.",
    "进阶": "Learner level: advanced. Push on collocation, register, and American usage.",
    "Advanced": "Learner level: advanced. Push on collocation, register, and American usage."
  };
  return notes[clip(level, 40)] || notes["日常"];
}

function styleNote(style) {
  const notes = {
    "幽默": "Personality: a funny American friend. One light tease at a bad sentence is enough. Never mean, never a personal attack, and do not compliment every turn.",
    "Witty and encouraging": "Personality: witty, but do not compliment every turn. Correct real mistakes plainly.",
    "直接": "Personality: direct. Name the mistake in one line and move the conversation on. No fake praise.",
    "Direct and challenging": "Personality: direct. Name the mistake and move on. No fake praise.",
    "鼓励": "Personality: steady and kind, but never pretend a wrong sentence is right. Encourage the retry, not the error.",
    "Calm and supportive": "Personality: calm. Still correct real mistakes. Do not praise every line.",
    "严格": "Personality: strict teacher. Do not let mistakes slide. Still no insults about intelligence, accent, or the person.",
    "Lightly sarcastic, never mean": "Personality: one dry joke about the sentence only. Never insult the person."
  };
  return notes[clip(style, 60)] || notes["幽默"];
}

function correctionNote(degree) {
  const notes = {
    "关闭": "Correction mode OFF. Only correct if they explicitly ask you to check their English. Otherwise keep talking.",
    "轻度": "Correction intensity: light. Only clear grammar, word, or meaning errors. If the sentence is acceptable spoken English, leave corrections empty.",
    "标准": "Correction intensity: standard. Correct real grammar, word choice, collocation, word order, and un-American usage. Do not nitpick a sentence a native speaker would actually say.",
    "严格": "Correction intensity: strict. Also flag stiff, translated, or unnatural lines even when the grammar is legal. Still do not invent a problem.",
    "false": "Correction mode OFF. Only correct if they explicitly ask.",
    "true": "Correction intensity: standard. Correct real errors only."
  };
  return notes[clip(degree, 20)] || notes["标准"];
}

function speedOf(label) {
  if (label === "慢速" || label === "slow") return 0.86;
  if (label === "快速" || label === "fast") return 1.12;
  return 1;
}

function safeHistory(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((item) => item && (item.role === "user" || item.role === "assistant") && typeof item.content === "string")
    .slice(-12)
    .map((item) => ({ role: item.role, content: item.content.slice(0, 2000) }));
}

function tutorInstructions(settings) {
  return [
    "You are SpeakUp, an American friend and a precise English teacher in a live conversation.",
    "The learner may be a teenager. Stay age-appropriate. No sexual content, slurs, or personal attacks.",
    "Default to natural General American English.",
    levelNote(settings.level),
    styleNote(settings.style),
    correctionNote(settings.corrections),
    `Scenario: ${clip(settings.scenario, 80) || "自由聊天"}. Stay with it unless they change the subject, then follow them.`,
    "Reply like a person, not a worksheet. Do not start with Great, Awesome, or Perfect. Do not praise every message.",
    "Keep the talk going: respond to what they actually said, then ask one natural follow-up when it helps. Do not lecture.",
    "You only see text. Never invent a pronunciation score.",
    "If the English is genuinely fine for this level, set ok to true and corrections to [].",
    "If there is a real mistake, set ok to false. Point at that mistake only.",
    "why is one short sentence in Simplified Chinese. heard, better, natural, reply, and retry are English.",
    "natural is the whole line the way an American would say it, or an empty string if better already covers it.",
    "retry is one short English line inviting them to say it again, or null.",
    "If they write or speak Chinese, reply in English and add one correction that supplies the English they were reaching for. Do not shame them for using Chinese.",
    'Return ONLY JSON: {"reply":"","ok":true,"corrections":[{"kind":"grammar|word|collocation|order|usage","heard":"","better":"","why":"","natural":""}],"retry":null}'
  ].join("\n");
}

function parseTutor(raw) {
  const text = String(raw || "").trim();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) data = JSON.parse(text.slice(start, end + 1));
    else data = { reply: text, ok: true, corrections: [], retry: null };
  }
  const reply = clip(data.reply, 1200);
  if (!reply) throw new Error("The tutor returned an empty reply.");
  const incoming = data.ok === true || !Array.isArray(data.corrections) ? [] : data.corrections;
  const corrections = incoming.slice(0, 3).map((item) => ({
    kind: clip(item.kind, 20) || "usage",
    heard: clip(item.heard, 240),
    better: clip(item.better, 240),
    why: clip(item.why, 240),
    natural: clip(item.natural, 300)
  })).filter((item) => item.better || item.heard);
  return {
    reply,
    ok: corrections.length === 0,
    corrections,
    retry: data.retry ? clip(data.retry, 240) : null
  };
}

async function completeTutor(history, settings) {
  const completion = await openai().chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    temperature: 0.7,
    max_tokens: 450,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: tutorInstructions(settings) },
      ...history
    ]
  });
  return parseTutor(completion.choices?.[0]?.message?.content || "");
}

async function transcribe(buffer, mime) {
  const preferred = process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe";
  const file = await OpenAI.toFile(buffer, "speech.webm", { type: mime || "audio/webm" });
  try {
    const result = await openai().audio.transcriptions.create({ file, model: preferred });
    return clip(result.text, 2000);
  } catch (error) {
    if (preferred === "whisper-1") throw error;
    const fallback = await OpenAI.toFile(buffer, "speech.webm", { type: mime || "audio/webm" });
    const result = await openai().audio.transcriptions.create({ file: fallback, model: "whisper-1" });
    return clip(result.text, 2000);
  }
}

async function speakOnce(model, text, speed, withInstructions) {
  const payload = {
    model,
    voice: process.env.OPENAI_TTS_VOICE || "nova",
    input: text.slice(0, 700),
    speed
  };
  if (withInstructions) {
    payload.instructions = "Speak in natural General American English, like a friend in the room. Not an announcer.";
  }
  const speech = await openai().audio.speech.create(payload);
  return Buffer.from(await speech.arrayBuffer()).toString("base64");
}

async function synthesize(text, speed) {
  const preferred = process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
  try {
    return await speakOnce(preferred, text, speed, preferred.includes("gpt-4o"));
  } catch (error) {
    console.error("Primary TTS failed:", error.message);
    return speakOnce("tts-1", text, speed, false);
  }
}

async function assessPronunciation(buffer, mime, referenceText) {
  const key = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION;
  if (!referenceText) {
    return {
      available: false,
      reason: "自由说话时不打发音分。点「再读这句」后，才会拿你的录音和那句英文做真实对比。"
    };
  }
  if (!key || !region) {
    return {
      available: false,
      reason: "没有配置 Azure Speech，所以不做发音评分。语法纠错来自你刚说的话，不是伪造的发音分。"
    };
  }
  const header = Buffer.from(JSON.stringify({
    ReferenceText: referenceText.slice(0, 400),
    GradingSystem: "HundredMark",
    Granularity: "Word",
    Dimension: "Comprehensive",
    EnableMiscue: true
  })).toString("base64");
  const response = await fetch(
    `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=en-US&format=detailed`,
    {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": key,
        "Pronunciation-Assessment": header,
        "Content-Type": mime || "audio/wav",
        Accept: "application/json"
      },
      body: buffer
    }
  );
  if (!response.ok) {
    return {
      available: false,
      reason: "发音评估没有接受这段录音，所以没有分数。语法和用词纠错仍然有效。"
    };
  }
  const data = await response.json();
  const score = data.NBest?.[0]?.PronunciationAssessment;
  if (!score) {
    return { available: false, reason: "这段录音没有返回发音评分。" };
  }
  return {
    available: true,
    accuracy: score.AccuracyScore,
    fluency: score.FluencyScore,
    completeness: score.CompletenessScore,
    overall: score.PronScore
  };
}

function readAudio(body) {
  const mime = clip(body.mime, 80) || "audio/webm";
  if (!mime.startsWith("audio/")) {
    return { error: "音频格式不对。" };
  }
  let buffer;
  try {
    buffer = Buffer.from(String(body.audioBase64 || ""), "base64");
  } catch {
    return { error: "音频读不出来。" };
  }
  if (!buffer.length) return { error: "没有收到录音。" };
  if (buffer.length > MAX_AUDIO_BYTES) return { error: "录音太长了。说短一点再发。" };
  return { buffer, mime };
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "SpeakUp API",
    openai: hasKey(),
    pronunciation: Boolean(process.env.AZURE_SPEECH_KEY && process.env.AZURE_SPEECH_REGION),
    accessCode: Boolean(process.env.APP_ACCESS_CODE)
  });
});

app.post("/api/chat", async (req, res) => {
  try {
    if (!hasKey()) return denyKey(res);
    if (!allowAccess(req, res)) return;
    const history = safeHistory(req.body?.messages);
    if (!history.length || history[history.length - 1].role !== "user") {
      return res.status(400).json({ error: "请先说一句再发送。" });
    }
    const limited = takeQuota(clientIp(req), "chat");
    if (limited) return res.status(429).json({ error: limited });
    const settings = req.body || {};
    const result = await completeTutor(history, settings);
    let audioBase64 = null;
    if (settings.readAloud) {
      audioBase64 = await synthesize(result.reply, speedOf(settings.speed));
    }
    res.json({ ...result, audioBase64 });
  } catch (error) {
    console.error("Chat error:", error.message);
    res.status(500).json({ error: "老师这会儿没有接上。等一下再试。密钥和账单不用写在这里。" });
  }
});

app.post("/api/voice", async (req, res) => {
  try {
    if (!hasKey()) return denyKey(res);
    if (!allowAccess(req, res)) return;
    const audio = readAudio(req.body || {});
    if (audio.error) return res.status(400).json({ error: audio.error });
    const limited = takeQuota(clientIp(req), "voice");
    if (limited) return res.status(429).json({ error: limited });

    const transcript = await transcribe(audio.buffer, audio.mime);
    if (!transcript) return res.status(400).json({ error: "没听清。再说一次，或改成打字。" });

    const history = safeHistory(req.body?.messages);
    history.push({ role: "user", content: transcript });
    const settings = req.body || {};
    const result = await completeTutor(history, settings);
    const audioBase64 = await synthesize(result.reply, speedOf(settings.speed));
    const reference = clip(settings.referenceText, 400);
    const pronunciation = reference
      ? await assessPronunciation(audio.buffer, audio.mime, reference)
      : null;
    res.json({ transcript, ...result, audioBase64, pronunciation });
  } catch (error) {
    console.error("Voice error:", error.message);
    res.status(500).json({ error: "语音这轮没走通。可以改用打字，或稍后再说。" });
  }
});

app.use(express.static(path.join(__dirname, "public")));

app.listen(PORT, () => {
  console.log(`SpeakUp listening on ${PORT}`);
});
