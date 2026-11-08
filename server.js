const express = require("express");
const path = require("path");
const OpenAI = require("openai");

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;

const tutorInstructions = `
You are SpeakUp, a lively, capable American English conversation tutor.
The learner may be a teenager. Keep all topics age-appropriate and respectful.
Default to natural American English. Keep the conversation flowing like a real tutor:
respond to what the learner said, then ask one natural follow-up question when useful.
Correct genuine mistakes in grammar, word choice, word order, collocation, and naturalness.
Do not invent mistakes. If the learner's English is correct, say so briefly and continue.
When there is a mistake, show:
1) "Better: ..." with a corrected natural sentence.
2) A short, plain-language explanation.
3) Invite the learner to try again when that would help.
Be direct, witty, and lightly teasing if the selected style asks for it, but never insult,
humiliate, swear at, or attack the learner personally.
Use concise answers. Do not turn every message into a lecture.
If the learner writes Chinese, you may explain in Chinese while keeping practice examples in English.
`;

app.post("/api/chat", async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(503).json({
        error: "The server is missing OPENAI_API_KEY. Add it in the hosting provider's environment variables."
      });
    }

    const {
      messages = [],
      scenario = "Free conversation",
      level = "Everyday",
      style = "Witty and encouraging",
      corrections = true,
      readAloud = false
    } = req.body || {};

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "Please send a conversation message." });
    }

    const safeMessages = messages
      .filter(m => m && ["user", "assistant"].includes(m.role) && typeof m.content === "string")
      .slice(-24)
      .map(m => ({ role: m.role, content: m.content.slice(0, 4000) }));

    if (!safeMessages.length || safeMessages[safeMessages.length - 1].role !== "user") {
      return res.status(400).json({ error: "The latest message must be from the learner." });
    }

    const settings = `
Session settings:
- Scenario: ${String(scenario).slice(0, 100)}
- Learner level: ${String(level).slice(0, 50)}
- Tutor personality: ${String(style).slice(0, 100)}
- Correction mode: ${corrections ? "ON: correct genuine errors" : "OFF: prioritize natural conversation; correct only if asked"}
- Read-aloud preference: ${readAloud ? "ON" : "OFF"}
`;

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages: [
        { role: "system", content: tutorInstructions + "\n" + settings },
        ...safeMessages
      ],
      temperature: 0.7,
      max_tokens: 500
    });

    const reply = completion.choices?.[0]?.message?.content?.trim();
    if (!reply) throw new Error("The AI returned an empty response.");
    res.json({ reply });
  } catch (error) {
    console.error("Chat error:", error.message);
    res.status(500).json({
      error: "SpeakUp couldn't get a reply right now. Check the server configuration and try again."
    });
  }
});

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "SpeakUp API" }));

app.listen(PORT, () => {
  console.log(`SpeakUp is running on port ${PORT}`);
});
