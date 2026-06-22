import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_PATH = process.env.DB_PATH || './data/knowledge.db';

// Ensure data directory exists
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

export const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS videos (
    id          TEXT PRIMARY KEY,       -- Douyin video ID
    platform    TEXT NOT NULL,          -- 'douyin'
    source_tab  TEXT NOT NULL,          -- 'like' or 'favorite'
    title       TEXT,
    url         TEXT NOT NULL,
    likes       INTEGER DEFAULT 0,
    duration    INTEGER,                -- seconds
    transcript  TEXT,                   -- raw transcript from Youdao
    summary     TEXT,                   -- Claude summary
    tags        TEXT,                   -- JSON array string
    key_points  TEXT,                   -- JSON array string
    content_type TEXT,                  -- e.g. 教程/观点/案例
    youdao_media_id TEXT,               -- Youdao job mediaId
    youdao_status   TEXT DEFAULT 'pending', -- pending/processing/done/failed
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_videos_youdao_status ON videos(youdao_status);
  CREATE INDEX IF NOT EXISTS idx_videos_source_tab    ON videos(source_tab);
  CREATE INDEX IF NOT EXISTS idx_videos_created_at    ON videos(created_at);
`);

export interface VideoRow {
  id: string;
  platform: string;
  source_tab: string;
  title: string | null;
  url: string;
  likes: number;
  duration: number | null;
  transcript: string | null;
  summary: string | null;
  tags: string | null;
  key_points: string | null;
  content_type: string | null;
  youdao_media_id: string | null;
  youdao_status: string;
  created_at: number;
  updated_at: number;
}

const stmts = {
  upsertVideo: db.prepare(`
    INSERT INTO videos (id, platform, source_tab, title, url, likes, created_at, updated_at)
    VALUES (@id, @platform, @source_tab, @title, @url, @likes, @created_at, @updated_at)
    ON CONFLICT(id) DO UPDATE SET
      title      = excluded.title,
      likes      = excluded.likes,
      updated_at = excluded.updated_at
  `),

  setYoudaoJob: db.prepare(`
    UPDATE videos SET youdao_media_id = @mediaId, youdao_status = 'processing', updated_at = @updated_at
    WHERE id = @id
  `),

  setTranscript: db.prepare(`
    UPDATE videos SET transcript = @transcript, youdao_status = 'done', updated_at = @updated_at
    WHERE id = @id
  `),

  setYoudaoFailed: db.prepare(`
    UPDATE videos SET youdao_status = 'failed', updated_at = @updated_at WHERE id = @id
  `),

  setSummary: db.prepare(`
    UPDATE videos SET summary = @summary, tags = @tags, key_points = @key_points, content_type = @content_type, updated_at = @updated_at
    WHERE id = @id
  `),

  getById: db.prepare(`SELECT * FROM videos WHERE id = ?`),

  getPendingTranscription: db.prepare(`
    SELECT * FROM videos WHERE youdao_status = 'pending' AND url IS NOT NULL
  `),

  getProcessingTranscription: db.prepare(`
    SELECT * FROM videos WHERE youdao_status = 'processing' AND youdao_media_id IS NOT NULL
  `),

  getPendingSummary: db.prepare(`
    SELECT * FROM videos WHERE youdao_status = 'done' AND summary IS NULL AND transcript IS NOT NULL
  `),
};

export function upsertVideo(video: {
  id: string; platform: string; source_tab: string;
  title: string | null; url: string; likes: number;
}) {
  const now = Date.now();
  stmts.upsertVideo.run({ ...video, created_at: now, updated_at: now });
}

export function setYoudaoJob(id: string, mediaId: string) {
  stmts.setYoudaoJob.run({ id, mediaId, updated_at: Date.now() });
}

export function setTranscript(id: string, transcript: string) {
  stmts.setTranscript.run({ id, transcript, updated_at: Date.now() });
}

export function setYoudaoFailed(id: string) {
  stmts.setYoudaoFailed.run({ id, updated_at: Date.now() });
}

export function setSummary(id: string, summary: string, tags: string[], keyPoints: string[], contentType: string) {
  stmts.setSummary.run({
    id,
    summary,
    tags: JSON.stringify(tags),
    key_points: JSON.stringify(keyPoints),
    content_type: contentType,
    updated_at: Date.now(),
  });
}

export function getPendingTranscription(): VideoRow[] {
  return stmts.getPendingTranscription.all() as VideoRow[];
}

export function getProcessingTranscription(): VideoRow[] {
  return stmts.getProcessingTranscription.all() as VideoRow[];
}

export function getPendingSummary(): VideoRow[] {
  return stmts.getPendingSummary.all() as VideoRow[];
}

export function videoExists(id: string): boolean {
  return !!stmts.getById.get(id);
}
