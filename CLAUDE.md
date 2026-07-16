# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # run pipeline in daemon mode (cron scheduler, every 6h by default)
npm run crawl     # run one full pipeline pass and exit (--once flag)
npm run build     # compile TypeScript → dist/
npm start         # run compiled dist/index.js
```

There is no test suite yet.

## Architecture

An automated ingestion pipeline for Douyin (TikTok China) liked/favorited videos. The pipeline crawls videos, transcribes them via the Youdao API, summarizes them with Claude (AWS Bedrock), and stores results in SQLite + LanceDB for future semantic search.

**Entry point:** `src/index.ts` — orchestrates all four steps. In `--once` mode (via `npm run crawl`) it runs all steps sequentially and exits. In daemon mode it runs immediately on startup, then re-runs the full pipeline on the cron schedule, while a separate 60-second interval independently polls Youdao and runs summarization.

### Pipeline Steps

1. **Crawl** (`src/crawler.ts`) — Playwright opens Chrome using your actual local Chrome user data directory (`~/AppData/Local/Google/Chrome/User Data`), reusing the logged-in Douyin session. Navigates to `favorite_collection`, scrolls to lazy-load all cards, extracts video IDs, titles, URLs, and like counts (handles Chinese "万" notation).

2. **Submit to Youdao** (`src/youdao.ts`) — POSTs each `pending` video URL to the Youdao multimedia transcription API, stores the returned `mediaId`, and advances `youdao_status → processing`.

3. **Poll Youdao** (`src/youdao.ts`) — Polls all `processing` rows. On completion, fetches the SRT file, strips sequence/timestamp lines, stores plain-text transcript, and advances status to `done`.

4. **Summarize** (`src/summarizer.ts`) — Sends transcript (first 8,000 chars) + title to Claude Haiku via AWS Bedrock. Expects JSON back: `{ summary, tags[], keyPoints[], contentType }`. `contentType` is one of: `教程 / 观点 / 案例 / 资讯 / 娱乐`. Writes to SQLite, then upserts into LanceDB.

### Data Stores

- **SQLite** (`./data/knowledge.db`) — single `videos` table. `youdao_status` is the pipeline state machine: `pending → processing → done | failed`. All DB calls use `better-sqlite3` (synchronous).
- **LanceDB** (`./data/lancedb`) — vector store. The embedded `text` field is `summary + ' ' + tags.join(' ')`. Uses `Xenova/bge-small-zh-v1.5` (512-dim, ~95MB download on first run) via `@xenova/transformers` running locally. LanceDB has no native upsert — `vectorStore.ts` implements it as `delete(id) → add()`.

### Planned (Not Yet Implemented)

The README describes an Express.js backend + web frontend with a Claude agent that routes natural language queries to either semantic search (LanceDB) or exact SQL filters. `vectorStore.ts`'s `semanticSearch()` is already built for this; nothing calls it yet.

## Configuration

All config is via `.env` (gitignored). Required variables:

| Variable | Default | Notes |
|---|---|---|
| `YOUDAO_API_KEY` | — | Required |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | — | Required for Bedrock |
| `CRON_SCHEDULE` | `'0 */6 * * *'` | node-cron expression |
| `CLAUDE_MODEL` | `'us.anthropic.claude-haiku-4-5-20251001-v1:0'` | Bedrock cross-region inference profile |
| `AWS_REGION` | `'us-west-2'` | |
| `DB_PATH` | `'./data/knowledge.db'` | |
| `LANCE_PATH` | `'./data/lancedb'` | |
| `YOUDAO_BASE_URL` | `'https://multimedia-trans-business.youdao.com/openapi/v1'` | |
