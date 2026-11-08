const $ = (id) => document.getElementById(id);
const messagesEl = $("messages");
const input = $("userInput");
const form = $("chatForm");
const sendBtn = $("sendBtn");
let history = [];

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

function speak(text) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-US";
  utterance.rate = 0.96;
  window.speechSynthesis.speak(utterance);
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
  typing.textContent = "Your tutor is thinking…";
  messagesEl.appendChild(typing);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: history,
        scenario: $("scenario").value,
        level: $("level").value,
        style: $("style").value,
        corrections: $("corrections").checked,
        readAloud: $("readAloud").checked
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Request failed");
    const reply = data.reply;
    history.push({ role: "assistant", content: reply });
    addMessage("assistant", reply);
    if ($("readAloud").checked) speak(reply);
  } catch (err) {
    addMessage("assistant", `I couldn't connect just now. ${err.message}`);
    history.pop();
  } finally {
    typing.remove();
    sendBtn.disabled = false;
    input.focus();
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

$("clearBtn").addEventListener("click", () => {
  history = [];
  messagesEl.innerHTML = "";
  addMessage("assistant", "Fresh start! What would you like to talk about today?");
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
});

document.querySelectorAll(".chip").forEach(button => {
  button.addEventListener("click", () => sendMessage(button.dataset.prompt));
});

let recognition;
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.lang = "en-US";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.addEventListener("result", event => {
    input.value = (input.value + " " + event.results[0][0].transcript).trim();
    input.dispatchEvent(new Event("input"));
    input.focus();
  });
  recognition.addEventListener("error", () => {
    addMessage("assistant", "I couldn't hear that clearly. You can type your sentence instead.");
  });
  $("micBtn").addEventListener("click", () => recognition.start());
} else {
  $("micBtn").disabled = true;
  $("micBtn").title = "Speech recognition is not supported in this browser";
  $("micBtn").style.opacity = ".45";
}
