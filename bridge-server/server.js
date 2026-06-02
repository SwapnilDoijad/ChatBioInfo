require("dotenv").config();

const express = require("express");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { formidable } = require("formidable");

const execFileAsync = promisify(execFile);
const app = express();

const port = Number(process.env.PORT || 8787);
const sshTarget = process.env.HPC_SSH_TARGET;
const workDir = process.env.HPC_WORKDIR || "~/chatbioinfo-bridge";
const uploadDir = process.env.HPC_UPLOAD_DIR || `${workDir.replace(/\/$/, "")}/uploads`;
const analysisCommandTemplate = process.env.HPC_ANALYSIS_COMMAND;
const bridgeApiKey = process.env.BIO_BRIDGE_API_KEY || process.env.BIO_SERVER_API_KEY || "";

const slurmPartition = process.env.SLURM_PARTITION || "";
const slurmAccount = process.env.SLURM_ACCOUNT || "";
const slurmTime = process.env.SLURM_TIME || "00:10:00";
const slurmCpus = process.env.SLURM_CPUS || "2";
const slurmMem = process.env.SLURM_MEM || "4G";
const slurmExtraDirectives = process.env.SLURM_EXTRA_DIRECTIVES || "";

const defaultWaitForCompletion = (process.env.DEFAULT_WAIT_FOR_COMPLETION || "false").toLowerCase() === "true";
const maxWaitSeconds = Number(process.env.MAX_WAIT_SECONDS || 45);
const pollIntervalSeconds = Number(process.env.POLL_INTERVAL_SECONDS || 4);

app.use(express.json({ limit: "2mb" }));

function shellEscape(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getBearerToken(req) {
  const auth = req.headers.authorization || "";
  const [scheme, token] = auth.split(" ");

  if (scheme && scheme.toLowerCase() === "bearer" && token) {
    return token.trim();
  }

  return "";
}

function getFirstValue(value) {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function sanitizePathComponent(value, fallback) {
  const cleaned = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/^_+|_+$/g, "");

  return cleaned || fallback;
}

async function parseMultipart(req) {
  const form = formidable({
    multiples: false,
    maxFileSize: 1024 * 1024 * 300
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

function enforceAuth(req, res, next) {
  if (!bridgeApiKey) {
    return next();
  }

  const provided = getBearerToken(req);

  if (provided && provided === bridgeApiKey) {
    return next();
  }

  return res.status(401).json({ error: "Unauthorized" });
}

async function runSSH(script) {
  if (!sshTarget) {
    throw new Error("HPC_SSH_TARGET is not configured.");
  }

  const args = [
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=15",
    sshTarget,
    `bash -lc ${shellEscape(script)}`
  ];

  try {
    const { stdout, stderr } = await execFileAsync("ssh", args, { maxBuffer: 1024 * 1024 * 4 });
    return { stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (error) {
    const details = error.stderr ? String(error.stderr).trim() : error.message;
    throw new Error(`SSH command failed: ${details}`);
  }
}

async function copyLocalFileToHPC(localPath, remotePath) {
  if (!sshTarget) {
    throw new Error("HPC_SSH_TARGET is not configured.");
  }

  const args = [
    "-q",
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=20",
    localPath,
    `${sshTarget}:${remotePath}`
  ];

  try {
    await execFileAsync("scp", args, { maxBuffer: 1024 * 1024 * 4 });
  } catch (error) {
    const details = error.stderr ? String(error.stderr).trim() : error.message;
    throw new Error(`SCP transfer failed: ${details}`);
  }
}

function parseExtraDirectives(input) {
  if (!input.trim()) {
    return [];
  }

  return input
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((directive) => `#SBATCH ${directive}`);
}

function applyTemplate(template, values) {
  return template.replace(/\{(input|output|jobDir)\}/g, (_, key) => values[key]);
}

function parseSlurmJobId(raw) {
  const cleaned = String(raw || "").trim();
  if (!cleaned) {
    return "";
  }

  const [first] = cleaned.split(";");
  return first.trim();
}

function isTerminalSlurmState(state) {
  const normalized = String(state || "").toUpperCase();
  return ["COMPLETED", "FAILED", "CANCELLED", "TIMEOUT", "NODE_FAIL", "OUT_OF_MEMORY", "PREEMPTED"].includes(
    normalized
  );
}

async function getSlurmState(slurmJobId) {
  const script = [
    "set -euo pipefail",
    `JOB_ID=${shellEscape(slurmJobId)}`,
    "STATE=$(sacct -j \"$JOB_ID\" --format=State --noheader 2>/dev/null | head -n 1 | awk '{print $1}')",
    "if [ -z \"${STATE:-}\" ]; then",
    "  STATE=$(squeue -j \"$JOB_ID\" -h -o '%T' 2>/dev/null | head -n 1)",
    "fi",
    "if [ -z \"${STATE:-}\" ]; then",
    "  STATE=UNKNOWN",
    "fi",
    "printf '%s' \"$STATE\""
  ].join("\n");

  const result = await runSSH(script);
  return result.stdout || "UNKNOWN";
}

async function readRemoteFile(remotePath) {
  const script = [
    "set -euo pipefail",
    `FILE=${shellEscape(remotePath)}`,
    "if [ -f \"$FILE\" ]; then",
    "  cat \"$FILE\"",
    "fi"
  ].join("\n");

  const result = await runSSH(script);
  return result.stdout;
}

async function submitAnalysisJob(payload) {
  if (!analysisCommandTemplate) {
    throw new Error("HPC_ANALYSIS_COMMAND is not configured.");
  }

  const bridgeJobId = crypto.randomUUID();
  const remoteJobDir = `${workDir.replace(/\/$/, "")}/jobs/${bridgeJobId}`;
  const inputPath = `${remoteJobDir}/input.json`;
  const outputPath = `${remoteJobDir}/output.json`;
  const stderrPath = `${remoteJobDir}/job.err`;
  const stdoutPath = `${remoteJobDir}/job.out`;

  const templatedCommand = applyTemplate(analysisCommandTemplate, {
    input: shellEscape(inputPath),
    output: shellEscape(outputPath),
    jobDir: shellEscape(remoteJobDir)
  });

  const sbatchLines = [
    "#!/bin/bash",
    "set -euo pipefail",
    `#SBATCH --job-name=chatbio-${bridgeJobId.slice(0, 8)}`,
    `#SBATCH --output=${stdoutPath}`,
    `#SBATCH --error=${stderrPath}`,
    `#SBATCH --time=${slurmTime}`,
    `#SBATCH --cpus-per-task=${slurmCpus}`,
    `#SBATCH --mem=${slurmMem}`
  ];

  if (slurmPartition) {
    sbatchLines.push(`#SBATCH --partition=${slurmPartition}`);
  }

  if (slurmAccount) {
    sbatchLines.push(`#SBATCH --account=${slurmAccount}`);
  }

  sbatchLines.push(...parseExtraDirectives(slurmExtraDirectives));
  sbatchLines.push(templatedCommand);

  const payloadBase64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");

  const submitScript = [
    "set -euo pipefail",
    `REMOTE_JOB_DIR=${shellEscape(remoteJobDir)}`,
    `INPUT_PATH=${shellEscape(inputPath)}`,
    `SBATCH_FILE=${shellEscape(`${remoteJobDir}/job.sbatch`)}`,
    "mkdir -p \"$REMOTE_JOB_DIR\"",
    "cat <<'PAYLOAD_B64' | base64 -d > \"$INPUT_PATH\"",
    payloadBase64,
    "PAYLOAD_B64",
    "cat <<'SBATCH_CONTENT' > \"$SBATCH_FILE\"",
    ...sbatchLines,
    "SBATCH_CONTENT",
    "SBATCH_OUT=$(sbatch --parsable \"$SBATCH_FILE\")",
    "printf '%s' \"$SBATCH_OUT\""
  ].join("\n");

  const submitResult = await runSSH(submitScript);
  const slurmJobId = parseSlurmJobId(submitResult.stdout);

  if (!slurmJobId) {
    throw new Error(`Could not parse SLURM job id from output: ${submitResult.stdout}`);
  }

  return {
    bridgeJobId,
    slurmJobId,
    remoteJobDir,
    inputPath,
    outputPath,
    stdoutPath,
    stderrPath
  };
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    sshTargetConfigured: Boolean(sshTarget),
    analysisCommandConfigured: Boolean(analysisCommandTemplate),
    uploadDir,
    authEnabled: Boolean(bridgeApiKey)
  });
});

app.post("/upload", enforceAuth, async (req, res) => {
  let localFilePath = "";

  try {
    const { fields, files } = await parseMultipart(req);
    const file = getFirstValue(files.file);

    if (!file) {
      return res.status(400).json({ error: "No file was uploaded. Use form field 'file'." });
    }

    localFilePath = file.filepath;

    const originalName = file.originalFilename || path.basename(localFilePath);
    const safeName = sanitizePathComponent(originalName, "upload.dat");
    const requestedSubdir = getFirstValue(fields.targetSubdir);
    const safeSubdir = requestedSubdir ? sanitizePathComponent(requestedSubdir, "default") : "";

    const targetDir = safeSubdir ? `${uploadDir}/${safeSubdir}` : uploadDir;
    const stampedName = `${Date.now()}-${safeName}`;
    const remotePath = `${targetDir}/${stampedName}`;

    await runSSH(["set -euo pipefail", `mkdir -p ${shellEscape(targetDir)}`].join("\n"));
    await copyLocalFileToHPC(localFilePath, remotePath);

    return res.status(200).json({
      status: "uploaded",
      fileName: originalName,
      remotePath,
      targetDir,
      bytes: Number(file.size || 0)
    });
  } catch (error) {
    return res.status(500).json({
      error: "Upload to HPC failed.",
      details: error.message
    });
  } finally {
    if (localFilePath) {
      await fs.unlink(localFilePath).catch(() => {});
    }
  }
});

app.post("/analyze", enforceAuth, async (req, res) => {
  try {
    const { query, sampleData, waitForCompletion, maxWaitSeconds: requestedMaxWait } = req.body || {};

    if (!query || typeof query !== "string") {
      return res.status(400).json({ error: "Field 'query' (string) is required." });
    }

    const submitted = await submitAnalysisJob({
      query,
      sampleData: sampleData || null,
      submittedAt: new Date().toISOString()
    });

    const shouldWait =
      typeof waitForCompletion === "boolean" ? waitForCompletion : defaultWaitForCompletion;

    if (!shouldWait) {
      return res.status(202).json({
        status: "submitted",
        ...submitted
      });
    }

    const effectiveMaxWait = Number.isFinite(Number(requestedMaxWait))
      ? Math.min(Number(requestedMaxWait), maxWaitSeconds)
      : maxWaitSeconds;

    const deadline = Date.now() + Math.max(1, effectiveMaxWait) * 1000;
    let state = "UNKNOWN";

    while (Date.now() < deadline) {
      state = await getSlurmState(submitted.slurmJobId);

      if (isTerminalSlurmState(state)) {
        break;
      }

      await sleep(Math.max(1, pollIntervalSeconds) * 1000);
    }

    if (!isTerminalSlurmState(state)) {
      return res.status(202).json({
        status: "running",
        state,
        ...submitted
      });
    }

    const outputRaw = await readRemoteFile(submitted.outputPath);
    const stderrRaw = await readRemoteFile(submitted.stderrPath);

    let output;
    try {
      output = outputRaw ? JSON.parse(outputRaw) : null;
    } catch {
      output = outputRaw || null;
    }

    return res.status(state === "COMPLETED" ? 200 : 500).json({
      status: state === "COMPLETED" ? "completed" : "failed",
      state,
      result: output,
      stderr: stderrRaw || null,
      ...submitted
    });
  } catch (error) {
    return res.status(500).json({
      error: "Bridge server failure.",
      details: error.message
    });
  }
});

app.get("/job/:slurmJobId", enforceAuth, async (req, res) => {
  try {
    const { slurmJobId } = req.params;
    const { outputPath, stderrPath } = req.query;

    if (!slurmJobId) {
      return res.status(400).json({ error: "slurmJobId is required." });
    }

    const state = await getSlurmState(slurmJobId);
    const body = {
      slurmJobId,
      state,
      terminal: isTerminalSlurmState(state)
    };

    if (body.terminal && outputPath) {
      const outputRaw = await readRemoteFile(String(outputPath));
      try {
        body.result = outputRaw ? JSON.parse(outputRaw) : null;
      } catch {
        body.result = outputRaw || null;
      }
    }

    if (body.terminal && stderrPath) {
      body.stderr = (await readRemoteFile(String(stderrPath))) || null;
    }

    return res.json(body);
  } catch (error) {
    return res.status(500).json({
      error: "Could not fetch job state.",
      details: error.message
    });
  }
});

app.listen(port, () => {
  console.log(`HPC bridge server running on http://localhost:${port}`);
});
