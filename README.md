# ChatBioInfo

ChatBioInfo is a web chatbot that connects to:

- OpenAI (ChatGPT API) for natural language conversation
- A bioinformatics hack server for analysis tasks

The backend orchestrates both services. The frontend provides a chat UI where you can choose whether to run bioanalysis for each message.

## Architecture

- Frontend: static HTML/CSS/JS in `public/`
- Local backend: Express API in `server.js`
- Vercel backend: serverless functions in `api/`
- Shared backend logic: `lib/chatService.js`
- OpenAI integration: `POST /api/chat` calls OpenAI Responses API
- Bio server integration: optional `POST` to `${BIO_SERVER_URL}/analyze`

## Prerequisites

- Node.js 18+
- An OpenAI API key
- A reachable bioinformatics hack server endpoint

## Setup

1. Install dependencies:

	 ```bash
	 npm install
	 ```

2. Create your env file:

	 ```bash
	 cp .env.example .env
	 ```

3. Edit `.env` and set at least:

	 - `OPENAI_API_KEY`
	 - `BIO_SERVER_URL`

## Run

Start the app:

```bash
npm run dev
```

Then open:

- http://localhost:3000

## Deploy To Vercel

1. Push this repository to GitHub.
2. In Vercel, import the GitHub repository.
3. Set these environment variables in Vercel Project Settings:
	- `OPENAI_API_KEY` (required)
	- `BIO_SERVER_URL` (required for bioanalysis)
	- `BIO_SERVER_API_KEY` (optional)
	- `OPENAI_MODEL` (optional, default: `gpt-4.1-mini`)
4. Deploy.

Vercel uses:

- `api/chat.js`
- `api/health.js`
- `vercel.json` for static + API routing

After deploy, your app works at the Vercel domain with the same frontend and `/api/*` endpoints.

## Connect To HPC (SSH + SLURM)

For HPC integration, run the bridge service in `bridge-server/` on a machine that can SSH to your cluster login node.

Quick start:

1. `cd bridge-server`
2. `npm install`
3. `cp .env.example .env`
4. Set `HPC_SSH_TARGET` and `HPC_ANALYSIS_COMMAND`
5. `npm run dev`
6. Set app `BIO_SERVER_URL` to the bridge URL

Detailed setup is documented in `bridge-server/README.md`.

## API Endpoints

- `GET /api/health`
	- Reports whether OpenAI and bio server are configured.

- `POST /api/chat`
	- Body:

		```json
		{
			"message": "Analyze this sequence for likely issues",
			"runBioAnalysis": true,
			"sampleData": {
				"sequence": "ATGCC..."
			}
		}
		```

	- Response includes:
		- assistant `reply`
		- bio server `result` or `error`

- `POST /api/upload`
	- Uploads a local file from the web UI to your configured bio bridge server.
	- Intended for FASTQ and similar pipeline inputs.

## Notes About Hack Server

The app expects your server to expose:

- `POST /analyze`

If your endpoint path differs, update `runBioAnalysis` in `server.js`.

If your server requires authentication, set `BIO_SERVER_API_KEY` in `.env`.