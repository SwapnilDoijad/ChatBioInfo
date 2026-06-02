const messagesEl = document.getElementById("messages");
const formEl = document.getElementById("chatForm");
const sendButtonEl = document.getElementById("sendButton");
const messageInputEl = document.getElementById("messageInput");
const sampleDataInputEl = document.getElementById("sampleDataInput");
const bioToggleEl = document.getElementById("bioToggle");
const statusPillEl = document.getElementById("statusPill");
const integrationHintEl = document.getElementById("integrationHint");
const uploadFileInputEl = document.getElementById("uploadFileInput");
const uploadSubdirInputEl = document.getElementById("uploadSubdirInput");
const uploadButtonEl = document.getElementById("uploadButton");

let isBioConfigured = false;

function addMessage(role, text) {
  const div = document.createElement("div");
  div.className = `message ${role}`;
  div.textContent = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function updateUploadControls(isEnabled) {
  uploadFileInputEl.disabled = !isEnabled;
  uploadSubdirInputEl.disabled = !isEnabled;
  uploadButtonEl.disabled = !isEnabled;
}

uploadButtonEl.addEventListener("click", async () => {
  const file = uploadFileInputEl.files?.[0];

  if (!file) {
    addMessage("meta", "Select a file first, then click Upload To HPC.");
    return;
  }

  uploadButtonEl.disabled = true;

  try {
    const formData = new FormData();
    formData.append("file", file);

    const targetSubdir = uploadSubdirInputEl.value.trim();
    if (targetSubdir) {
      formData.append("targetSubdir", targetSubdir);
    }

    const response = await fetch("/api/upload", {
      method: "POST",
      body: formData
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || data.details || "Upload failed");
    }

    const currentSampleData = parseSampleData(sampleDataInputEl.value);
    const nextSampleData =
      currentSampleData && typeof currentSampleData === "object" && !Array.isArray(currentSampleData)
        ? currentSampleData
        : {};

    nextSampleData.fastqPath = data.remotePath;
    nextSampleData.originalFileName = data.fileName;

    sampleDataInputEl.value = JSON.stringify(nextSampleData, null, 2);
    addMessage("meta", `Uploaded to HPC: ${data.remotePath}`);
  } catch (error) {
    addMessage("meta", `Upload failed: ${error.message}`);
  } finally {
    uploadButtonEl.disabled = !isBioConfigured;
  }
});
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
      updateUploadControls(false);
      integrationHintEl.textContent =
        "Chat mode is active. Add BIO_SERVER_URL later to unlock bioanalysis.";
    } else {
      bioToggleEl.disabled = false;
      sampleDataInputEl.disabled = false;
      updateUploadControls(true);
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
    updateUploadControls(false);
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
