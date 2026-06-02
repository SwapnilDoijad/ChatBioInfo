const messagesEl = document.getElementById("messages");
const formEl = document.getElementById("chatForm");
const sendButtonEl = document.getElementById("sendButton");
const messageInputEl = document.getElementById("messageInput");
const sampleDataInputEl = document.getElementById("sampleDataInput");
const bioToggleEl = document.getElementById("bioToggle");
const statusPillEl = document.getElementById("statusPill");
const integrationHintEl = document.getElementById("integrationHint");

let isBioConfigured = false;

function addMessage(role, text) {
  const div = document.createElement("div");
  div.className = `message ${role}`;
  div.textContent = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

async function checkHealth() {
  try {
    const response = await fetch("/api/health");
    const health = await response.json();
    const openaiMark = health.openaiConfigured ? "OpenAI: OK" : "OpenAI: Missing";
    const bioMark = health.bioServerConfigured ? "Bio: OK" : "Bio: Missing";
    statusPillEl.textContent = `${openaiMark} | ${bioMark}`;
    isBioConfigured = Boolean(health.bioServerConfigured);

    if (!isBioConfigured) {
      bioToggleEl.checked = false;
      bioToggleEl.disabled = true;
      sampleDataInputEl.disabled = true;
      integrationHintEl.textContent =
        "Chat mode is active. Add BIO_SERVER_URL later to unlock bioanalysis.";
    } else {
      bioToggleEl.disabled = false;
      sampleDataInputEl.disabled = false;
      integrationHintEl.textContent =
        "Bio mode is enabled. Toggle analysis on any message when needed.";
    }

    if (!health.openaiConfigured) {
      integrationHintEl.textContent =
        "OpenAI API key is missing. Add OPENAI_API_KEY to enable chatting.";
    }
  } catch {
    statusPillEl.textContent = "Server unreachable";
    statusPillEl.classList.add("error");
    integrationHintEl.textContent = "Could not reach server. Start the app and refresh.";
  }
}

function parseSampleData(value) {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

formEl.addEventListener("submit", async (event) => {
  event.preventDefault();

  const message = messageInputEl.value.trim();

  if (!message) {
    return;
  }

  const runBioAnalysis = isBioConfigured && bioToggleEl.checked;
  const sampleData = parseSampleData(sampleDataInputEl.value);

  addMessage("user", message);
  sendButtonEl.disabled = true;

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message,
        runBioAnalysis,
        sampleData
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Unknown error");
    }

    addMessage("bot", data.reply);

    if (data.bio?.requested) {
      if (data.bio.error) {
        addMessage("meta", `Bio server error: ${data.bio.error}`);
      } else {
        addMessage("meta", `Bio server result: ${JSON.stringify(data.bio.result, null, 2)}`);
      }
    }

    messageInputEl.value = "";
  } catch (error) {
    addMessage("meta", `Request failed: ${error.message}`);
  } finally {
    sendButtonEl.disabled = false;
    messageInputEl.focus();
  }
});

checkHealth();
addMessage(
  "meta",
  "Welcome to ChatBioInfo. You can chat now with OpenAI, and add bio server settings later."
);
