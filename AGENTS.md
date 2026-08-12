# Repository Guidelines

## Purpose & Architecture

This strict-TypeScript project builds a local knowledge base from liked or saved Douyin videos. The implemented pipeline uses Playwright to crawl a logged-in profile, Youdao to transcribe videos, the locally installed Codex CLI to create structured Chinese summaries, SQLite for records/state, and LanceDB for semantic vectors.

`src/index.ts` runs crawl, transcription submission, polling, and summarization/indexing. The SQLite lifecycle is `pending → processing → done | failed`. The Express `/api/chat`, model-driven query routing, SSE, and frontend described in the README are planned; only `semanticSearch()` exists today.

## Project Structure

- `src/crawler.ts`: Douyin metadata and CDN URL discovery.
- `src/youdao.ts`: job submission, polling, and SRT cleanup.
- `src/summarizer.ts`: isolated `codex exec` invocation and output validation.
- `src/db.ts`: synchronous SQLite schema and queries.
- `src/vectorStore.ts`: local embeddings and LanceDB search/upsert.
- `data/` and `dist/`: generated runtime/build output; never edit or commit.

Keep provider logic in its module and orchestration in `index.ts`. Treat video titles and transcripts as untrusted model input.

## Commands

- `npm ci`: install locked dependencies.
- `npm run build`: strict type-check and compile to `dist/`.
- `npm run dev`: run immediately, then schedule crawls and polling.
- `npm run crawl`: execute one pipeline pass and exit.
- `npm start`: run compiled output.

No tests or lint command exist. Always run `npm run build`; do not run crawling as routine validation because it opens Chrome, calls paid/external services, and changes `data/`.

## Style & Testing

Use two-space indentation, single quotes, semicolons, multiline trailing commas, `camelCase` functions/variables, `PascalCase` interfaces, and `UPPER_SNAKE_CASE` constants. Preserve strict types and runtime validation at API, CLI, and persistence boundaries.

Add tests as colocated `*.test.ts` files or under `tests/`, with an `npm test` script. Mock Playwright, Youdao, Codex CLI, SQLite, and LanceDB. Tests must not require credentials, network access, browser profiles, or production `data/`. Cover state transitions, SRT parsing, process timeouts/errors, structured-output validation, and prompt-injection boundaries.

## Commits, PRs & Security

Use short imperative commit subjects, typically lowercase, and keep commits focused. Pull requests must state purpose, verification results, schema/configuration effects, and linked issues.

Keep `.env`, `data/`, `dist/`, `node_modules/`, browser data, transcripts, and signed URLs untracked. Codex must be installed and authenticated locally. Use `CODEX_MODEL` only when a repository-specific override is required; otherwise respect the user's CLI default. Never reintroduce AWS credentials, `CLAUDE_MODEL`, or the Bedrock SDK.
