require("dotenv").config();

const express = require("express");
const { getHealth, processChatRequest } = require("./lib/chatService");
const { handleUploadRequest } = require("./lib/uploadProxy");

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json({ limit: "2mb" }));
app.use(express.static("public"));

app.get("/api/health", (_req, res) => {
  res.json(getHealth());
});

app.post("/api/chat", async (req, res) => {
  try {
    const { message, runBioAnalysis: shouldRunBioAnalysis, sampleData } = req.body || {};

    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "A text message is required." });
    }

    const result = await processChatRequest({
      message,
      shouldRunBioAnalysis: Boolean(shouldRunBioAnalysis),
      sampleData
    });

    return res.status(result.status).json(result.body);
  } catch (error) {
    return res.status(500).json({
      error: "Unexpected server error.",
      details: error.message
    });
  }
});

app.post("/api/upload", async (req, res) => {
  return handleUploadRequest(req, res);
});

app.listen(port, () => {
  console.log(`ChatBioInfo server running on http://localhost:${port}`);
});
