const $ = (id) => document.getElementById(id);
const messagesEl = $("messages");
const input = $("userInput");
const form = $("chatForm");
const sendBtn = $("sendBtn");
const micBtn = $("micBtn");
const audio = new Audio();
let history = [];
let practiceLine = "";
let recording = false;
let recorder = null;
let chunks = [];
let recStream = null;

function apiBase() {
  return ($("apiBase").value || localStorage.getItem("speakup-api") || "").replace(/\/$/, "");
}

function settings() {
  return {
    scenario: $("scenario").value,
    level: $("level").value,
    style: $("style").value,
    corrections: $("corrections").value,
    speed: $("speed").value,
    readAloud: $("readAloud").checked,
    referenceText: practiceLine
  };
}

function kindLabel(kind) {
  return {
    grammar: "语法",
    word: "用词",
    collocation: "搭配",
    order: "语序",
    usage: "美式说法"
  }[kind] || "表达";
}

function addMessage(role, content) {
  const row = document.createElement("div");
  row.className = `message ${role}`;
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = content;
  row.appendChild(bubble);
  messagesEl.appendChild(row);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return bubble;
}

function renderTutor(data) {
  const bubble = addMessage("assistant", data.reply);
  if (data.ok) {
    const note = document.createElement("p");
    note.className = "fix-note";
    note.textContent = "这句没抓到要改的地方。";
    bubble.appendChild(note);
  }
  (data.corrections || []).forEach((item) => {
    const card = document.createElement("div");
    card.className = "fix";
    const title = document.createElement("p");
    title.className = "fix-kind";
    title.textContent = kindLabel(item.kind);
    const line = document.createElement("p");
    if (item.heard) {
      const old = document.createElement("s");
      old.textContent = item.heard;
      line.appendChild(old);
      line.appendChild(document.createTextNode(" → "));
    }
    line.appendChild(document.createTextNode(item.better || ""));
    card.appendChild(title);
    card.appendChild(line);
    if (item.why) {
      const why = document.createElement("p");
      why.className = "fix-why";
      why.textContent = item.why;
      card.appendChild(why);
    }
    if (item.natural) {
      const natural = document.createElement("p");
      natural.textContent = "更自然：" + item.natural;
      card.appendChild(natural);
    }
    bubble.appendChild(card);
  });
  if (data.pronunciation) {
    const pron = document.createElement("p");
    pron.className = "fix-note";
    if (data.pronunciation.available) {
      pron.textContent = `发音（对照原句）准确 ${data.pronunciation.accuracy} · 流利 ${data.pronunciation.fluency} · 完整 ${data.pronunciation.completeness}`;
    } else {
      pron.textContent = data.pronunciation.reason;
    }
    bubble.appendChild(pron);
  }
  if (data.retry) {
    const again = document.createElement("button");
    again.type = "button";
    again.className = "chip";
    again.textContent = "再读这句";
    again.addEventListener("click", () => {
      const target = (data.corrections && data.corrections[0] && (data.corrections[0].natural || data.corrections[0].better)) || "";
      practiceLine = target;
      $("practiceTarget").hidden = !target;
      $("practiceTarget").textContent = target ? "对着读：" + target : "";
    });
    bubble.appendChild(again);
  }
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function stopPlayback() {
  audio.pause();
  audio.currentTime = 0;
}

function playReply(data) {
  if (!data.audioBase64) {
    if (!$("readAloud").checked || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(data.reply);
    utterance.lang = "en-US";
    utterance.rate = $("speed").value === "慢速" ? 0.86 : $("speed").value === "快速" ? 1.12 : 1;
    window.speechSynthesis.speak(utterance);
    return;
  }
  stopPlayback();
  audio.src = "data:audio/mpeg;base64," + data.audioBase64;
  audio.play().catch(() => {
    addMessage("assistant", "声音没播出来。你可以看上面的文字。");
  });
}

async function post(path, body) {
  const base = apiBase();
  if (location.hostname.endsWith("github.io") && !base) {
    throw new Error("GitHub Pages 只有网页。在「后端地址」填上 Node 服务器网址后再练。");
  }
  localStorage.setItem("speakup-api", base);
  localStorage.setItem("speakup-code", $("accessCode").value || "");
  const headers = { "Content-Type": "application/json" };
  if ($("accessCode").value) headers["X-Access-Code"] = $("accessCode").value;
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "请求失败");
  return data;
}

async function sendMessage(text) {
  const content = (text || "").trim();
  if (!content || sendBtn.disabled) return;
  addMessage("user", content);
  history.push({ role: "user", content });
  input.value = "";
  input.style.height = "auto";
  sendBtn.disabled = true;
  const typing = document.createElement("div");
  typing.className = "typing";
  typing.textContent = "老师在接话…";
  messagesEl.appendChild(typing);
  try {
    const data = await post("/api/chat", { messages: history, ...settings(), referenceText: "" });
    history.push({ role: "assistant", content: data.reply });
    renderTutor(data);
    if ($("readAloud").checked || $("voiceMode").checked) playReply(data);
  } catch (error) {
    addMessage("assistant", error.message);
    history.pop();
  } finally {
    typing.remove();
    sendBtn.disabled = false;
    input.focus();
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(new Error("录音读失败"));
    reader.readAsDataURL(blob);
  });
}

async function startRecording() {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    addMessage("assistant", "这个浏览器开不了麦克风。直接打字也行。");
    return;
  }
  recStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
  recorder = new MediaRecorder(recStream, mime ? { mimeType: mime } : undefined);
  chunks = [];
  recorder.addEventListener("dataavailable", (event) => {
    if (event.data.size) chunks.push(event.data);
  });
  recorder.start();
  recording = true;
  micBtn.classList.add("is-live");
  micBtn.textContent = "停";
}

function finishRecording() {
  return new Promise((resolve) => {
    recorder.addEventListener("stop", async () => {
      const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
      recStream.getTracks().forEach((track) => track.stop());
      resolve({ audioBase64: await blobToBase64(blob), mime: blob.type || "audio/webm" });
    }, { once: true });
    recorder.stop();
  });
}

async function sendVoice() {
  sendBtn.disabled = true;
  micBtn.disabled = true;
  const typing = document.createElement("div");
  typing.className = "typing";
  typing.textContent = "在听，并准备回答…";
  messagesEl.appendChild(typing);
  try {
    const audioBody = await finishRecording();
    const data = await post("/api/voice", {
      ...audioBody,
      messages: history,
      ...settings()
    });
    addMessage("user", data.transcript);
    history.push({ role: "user", content: data.transcript });
    history.push({ role: "assistant", content: data.reply });
    renderTutor(data);
    playReply(data);
    practiceLine = "";
  } catch (error) {
    addMessage("assistant", error.message);
  } finally {
    typing.remove();
    recording = false;
    micBtn.classList.remove("is-live");
    micBtn.textContent = "🎙";
    micBtn.disabled = false;
    sendBtn.disabled = false;
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  sendMessage(input.value);
});

input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
});

micBtn.addEventListener("click", async () => {
  try {
    if (recording) {
      await sendVoice();
      return;
    }
    stopPlayback();
    await startRecording();
  } catch (error) {
    recording = false;
    addMessage("assistant", "麦克风被拦住了。直接打字就能练。");
  }
});

$("pauseBtn").addEventListener("click", () => audio.pause());
$("resumeBtn").addEventListener("click", () => audio.play().catch(() => {}));
$("stopBtn").addEventListener("click", () => {
  stopPlayback();
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
});

$("clearBtn").addEventListener("click", () => {
  history = [];
  practiceLine = "";
  stopPlayback();
  messagesEl.innerHTML = "";
  addMessage("assistant", "重新开始。说一件今天的事，或者说一句你想被改的英文。");
});

$("voiceMode").addEventListener("change", () => {
  $("readAloud").checked = $("voiceMode").checked || $("readAloud").checked;
});

document.querySelectorAll(".chip").forEach((button) => {
  button.addEventListener("click", () => {
    if (button.dataset.prompt) sendMessage(button.dataset.prompt);
  });
});

$("apiBase").value = localStorage.getItem("speakup-api") || "";
$("accessCode").value = localStorage.getItem("speakup-code") || "";
if (location.hostname.endsWith("github.io")) {
  $("pagesNote").hidden = false;
}
