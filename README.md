# Social Media Favorites Knowledge Base

## What is it

A locally-running automated knowledge base that automatically crawls, transcribes, and archives content you have liked or saved on social media platforms (Douyin, X, etc.), and lets you query it using natural language.

## What is it for

- No more forgotten bookmarks — all liked/saved content is automatically ingested
- Ask natural language questions when researching content ideas: "find videos about AI monetization", "top 5 by likes"
- Video content is automatically transcribed, summarized, and tagged for easy retrieval

## System Architecture

```
┌─────────────────────────────────────────────────────┐
│           Scheduler (node-cron)                      │
│           Periodically triggers crawl jobs           │
└────────────────────────┬────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────┐
│           Crawler Layer (Playwright)                 │
│           Reuses logged-in browser session           │
│           Extracts: title, URL, likes, platform      │
└────────────────────────┬────────────────────────────┘
                         │ video URLs
┌────────────────────────▼────────────────────────────┐
│           Transcription Layer (Wangyijianwai API)    │
│           Video URL → transcript text                │
└────────────────────────┬────────────────────────────┘
                         │ transcript
┌────────────────────────▼────────────────────────────┐
│           Agent Layer (Anthropic Node.js SDK)        │
│           Claude extracts summary, tags, key points  │
│           Tool Use: understands query → picks tool   │
└──────────────┬──────────────────────┬───────────────┘
               │                      │
    ┌──────────▼──────────┐ ┌──────────▼──────────────┐
    │       SQLite         │ │       ChromaDB           │
    │  Structured metadata │ │  Vector index            │
    │  title/url/platform/ │ │  (summary + tags)        │
    │  likes/raw transcript│ │  semantic search         │
    └──────────┬──────────┘ └──────────┬───────────────┘
               └───────────┬───────────┘
    ┌──────────────────────▼──────────────────────────┐
    │           Express.js Backend (TypeScript)        │
    │           POST /api/chat receives user query     │
    │           1st Claude call: understand intent     │
    │              → decide which tool to invoke       │
    │           Execute tool: query SQLite / ChromaDB  │
    │           2nd Claude call: generate final answer │
    │           Stream response via SSE                │
    └──────────────────────┬──────────────────────────┘
                           │ localhost:3000
    ┌──────────────────────▼──────────────────────────┐
    │           Web Frontend (HTML + TS)               │
    │           Natural language input                 │
    │           Typewriter streaming display           │
    └─────────────────────────────────────────────────┘
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Crawler | Playwright (Node.js) |
| Transcription | Wangyijianwai API |
| Agent | Anthropic Node.js SDK (Claude) |
| Metadata store | SQLite (better-sqlite3) |
| Vector store | ChromaDB (JS client) |
| Backend | Express.js + TypeScript |
| Frontend | HTML + CSS + TypeScript (SSE) |
| Scheduler | node-cron |

## Query Flow

When the user submits a natural language question:

1. Frontend `POST /api/chat`
2. **1st Claude API call** — Claude reads the question and decides which tool to invoke (semantic search / exact filter / combined)
3. Execute tool — query SQLite or ChromaDB
4. **2nd Claude API call** — Claude receives query results and generates the final answer
5. SSE streams the response back; frontend renders with typewriter effect

## Getting Started

(to be added)
