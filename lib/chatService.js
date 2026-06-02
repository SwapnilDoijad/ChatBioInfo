const OpenAI = require("openai");

function getConfig() {
  return {
    openaiApiKey: process.env.OPENAI_API_KEY,
    openaiModel: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    bioServerUrl: process.env.BIO_SERVER_URL,
    bioServerApiKey: process.env.BIO_SERVER_API_KEY
  };
}

function getOpenAIClient(openaiApiKey) {
  if (!openaiApiKey) {
    return null;
  }

  return new OpenAI({ apiKey: openaiApiKey });
}

async function runBioAnalysis({ bioServerUrl, bioServerApiKey, message, sampleData }) {
  if (!bioServerUrl) {
    throw new Error("BIO_SERVER_URL is not configured.");
  }

  const headers = {
    "Content-Type": "application/json"
  };

  if (bioServerApiKey) {
    headers.Authorization = `Bearer ${bioServerApiKey}`;
  }

  const response = await fetch(`${bioServerUrl.replace(/\/$/, "")}/analyze`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      query: message,
      sampleData: sampleData || null,
      requestedAt: new Date().toISOString()
    })
  });

  const responseText = await response.text();
  let body;

  try {
    body = JSON.parse(responseText);
  } catch {
    body = { raw: responseText };
  }

  if (!response.ok) {
    throw new Error(`Bio server error ${response.status}: ${responseText}`);
  }

  return body;
}

async function processChatRequest({ message, shouldRunBioAnalysis, sampleData }) {
  const config = getConfig();
  const openai = getOpenAIClient(config.openaiApiKey);

  if (!openai) {
    return {
      status: 500,
      body: {
        error: "OpenAI is not configured. Set OPENAI_API_KEY in environment variables."
      }
    };
  }

  let bioResult = null;
  let bioError = null;

  if (shouldRunBioAnalysis) {
    try {
      bioResult = await runBioAnalysis({
        bioServerUrl: config.bioServerUrl,
        bioServerApiKey: config.bioServerApiKey,
        message,
        sampleData
      });
    } catch (error) {
      bioError = error.message;
    }
  }

  const systemPrompt = [
    "You are ChatBioInfo, a helpful assistant for general and bioinformatics questions.",
    "Explain technical details clearly and include caveats for uncertain analyses.",
    "If bioanalysis data is provided, ground your answer in that result first."
  ].join(" ");

  const userContent = [
    `User message: ${message}`,
    shouldRunBioAnalysis
      ? `Bio server result: ${JSON.stringify(bioResult || { error: bioError })}`
      : "Bio server result: Not requested for this turn."
  ].join("\n\n");

  const completion = await openai.responses.create({
    model: config.openaiModel,
    input: [
      {
        role: "system",
        content: systemPrompt
      },
      {
        role: "user",
        content: userContent
      }
    ]
  });

  const assistantReply = completion.output_text || "I could not generate a response.";

  return {
    status: 200,
    body: {
      reply: assistantReply,
      bio: {
        requested: Boolean(shouldRunBioAnalysis),
        result: bioResult,
        error: bioError
      }
    }
  };
}

function getHealth() {
  const config = getConfig();

  return {
    ok: true,
    openaiConfigured: Boolean(config.openaiApiKey),
    bioServerConfigured: Boolean(config.bioServerUrl)
  };
}

module.exports = {
  getHealth,
  processChatRequest
};
