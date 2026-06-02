const fs = require("node:fs/promises");
const path = require("node:path");
const { formidable } = require("formidable");

function parseMaybeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function getFirstValue(value) {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

async function parseMultipart(req) {
  const form = formidable({
    multiples: false,
    maxFileSize: 1024 * 1024 * 200
  });

  return new Promise((resolve, reject) => {
    form.parse(req, (error, fields, files) => {
      if (error) {
        reject(error);
        return;
      }

      resolve({ fields, files });
    });
  });
}

async function handleUploadRequest(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const bioServerUrl = process.env.BIO_SERVER_URL;
  const bioServerApiKey = process.env.BIO_SERVER_API_KEY;

  if (!bioServerUrl) {
    return res.status(500).json({
      error: "BIO_SERVER_URL is not configured."
    });
  }

  let filePath = "";

  try {
    const { fields, files } = await parseMultipart(req);
    const uploaded = getFirstValue(files.file);

    if (!uploaded) {
      return res.status(400).json({ error: "No file was uploaded. Use form field 'file'." });
    }

    filePath = uploaded.filepath;
    const fileBuffer = await fs.readFile(filePath);

    const fileName = uploaded.originalFilename || path.basename(filePath);
    const fileType = uploaded.mimetype || "application/octet-stream";
    const targetSubdir = getFirstValue(fields.targetSubdir);

    const formData = new FormData();
    formData.append("file", new Blob([fileBuffer], { type: fileType }), fileName);

    if (typeof targetSubdir === "string" && targetSubdir.trim()) {
      formData.append("targetSubdir", targetSubdir.trim());
    }

    const headers = {};
    if (bioServerApiKey) {
      headers.Authorization = `Bearer ${bioServerApiKey}`;
    }

    const uploadResponse = await fetch(`${bioServerUrl.replace(/\/$/, "")}/upload`, {
      method: "POST",
      headers,
      body: formData
    });

    const responseText = await uploadResponse.text();
    const parsedBody = parseMaybeJson(responseText);

    return res.status(uploadResponse.status).json(parsedBody);
  } catch (error) {
    return res.status(500).json({
      error: "Upload proxy failed.",
      details: error.message
    });
  } finally {
    if (filePath) {
      await fs.unlink(filePath).catch(() => {});
    }
  }
}

module.exports = {
  handleUploadRequest
};
