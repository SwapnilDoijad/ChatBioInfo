const { processChatRequest } = require("../lib/chatService");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const { message, runBioAnalysis, sampleData } = body;

    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "A text message is required." });
    }

    const result = await processChatRequest({
      message,
      shouldRunBioAnalysis: Boolean(runBioAnalysis),
      sampleData
    });

    return res.status(result.status).json(result.body);
  } catch (error) {
    return res.status(500).json({
      error: "Unexpected server error.",
      details: error.message
    });
  }
};
