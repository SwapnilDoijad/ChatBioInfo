# ChatBioInfo HPC Bridge (SSH + SLURM)

This service exposes an HTTP API that submits and monitors SLURM jobs over SSH.

Use this bridge as your `BIO_SERVER_URL` target from the ChatBioInfo app.

## 1) Install and configure

```bash
cd bridge-server
npm install
cp .env.example .env
```

Edit `.env`:

- `HPC_SSH_TARGET`: your SSH target (for example `xa73pav@login2.draco.uni-jena.de`)
- `HPC_ANALYSIS_COMMAND`: analysis command run in the SLURM job
- Optional SLURM parameters (`SLURM_TIME`, `SLURM_CPUS`, etc.)
- Optional `BIO_BRIDGE_API_KEY` to require bearer auth

## FastQC ready template

A ready runner script is included at `templates/fastqc_runner.py`.

1. Copy this script to your HPC shared location, for example:

```bash
scp templates/fastqc_runner.py xa73pav@login2.draco.uni-jena.de:~/chatbioinfo-bridge/fastqc_runner.py
```

2. On the HPC side, ensure FastQC is available (module or binary path).

3. In bridge `.env`, set command (already pre-filled in `.env.example`, update path):

```dotenv
HPC_ANALYSIS_COMMAND=python3 ~/chatbioinfo-bridge/fastqc_runner.py --input {input} --output {output} --job-dir {jobDir}
```

4. Submit a FastQC job using `sampleData.fastqPath`:

```bash
curl -X POST http://localhost:8787/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "query": "Run FastQC",
    "sampleData": {
      "fastqPath": "/shared/data/sample_R1.fastq.gz",
      "threads": 4
    },
    "waitForCompletion": true,
    "maxWaitSeconds": 30
  }'
```

Output JSON contains `htmlReport` and `zipReport` paths when generated.

## 2) Verify SSH from this machine

The bridge machine must log in without interactive prompts:

```bash
ssh xa73pav@login2.draco.uni-jena.de "hostname && squeue -u $USER"
```

## 3) Start the bridge

```bash
npm run dev
```

Server starts on `http://localhost:8787` by default.

## 4) Test endpoints

Health:

```bash
curl http://localhost:8787/health
```

Upload a file to HPC shared storage:

```bash
curl -X POST http://localhost:8787/upload \
  -F "file=@/local/path/sample_R1.fastq.gz" \
  -F "targetSubdir=fastqc-runs"
```

The response includes `remotePath`, which you can place into `sampleData.fastqPath`.

Submit analysis (non-blocking):

```bash
curl -X POST http://localhost:8787/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "query": "run test analysis",
    "sampleData": {"sequence": "ATGC"},
    "waitForCompletion": false
  }'
```

Check status:

```bash
curl http://localhost:8787/job/<slurmJobId>
```

## 5) Connect ChatBioInfo app to bridge

In the main app `.env`:

```dotenv
BIO_SERVER_URL=http://<bridge-host>:8787
BIO_SERVER_API_KEY=<same token as BIO_BRIDGE_API_KEY if enabled>
```

Then restart the main app server.

## Request/response notes

### `POST /analyze`

Request body fields:

- `query` (required string)
- `sampleData` (optional object/string)
- `waitForCompletion` (optional boolean)
- `maxWaitSeconds` (optional number)

Returns:

- `202 submitted` when not waiting
- `202 running` if waiting timed out
- `200 completed` with `result` if job completed
- `500 failed` if terminal failure state

### `GET /job/:slurmJobId`

Returns current SLURM state. Optionally include query params:

- `outputPath` to read parsed output when terminal
- `stderrPath` to read stderr when terminal

### `POST /upload`

Multipart form-data fields:

- `file` (required)
- `targetSubdir` (optional)

Returns uploaded path on HPC shared storage:

- `remotePath`
- `targetDir`
- `bytes`

## Security guidance

- Keep private SSH keys only on the bridge machine.
- Use `BIO_BRIDGE_API_KEY` so random clients cannot submit jobs.
- Expose bridge publicly only behind HTTPS and access control.
