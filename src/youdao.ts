import axios from 'axios';

const BASE_URL = process.env.YOUDAO_BASE_URL || 'https://multimedia-trans-business.youdao.com/openapi/v1';
const API_KEY  = process.env.YOUDAO_API_KEY || '';

const client = axios.create({
  baseURL: BASE_URL,
  headers: {
    Authorization: `Bearer ${API_KEY}`,
    'Content-Type': 'application/json',
  },
  timeout: 30_000,
});

export async function submitTranscription(videoUrl: string): Promise<string> {
  const res = await client.post('/subtitle/extract', {
    tasks: [{ url: videoUrl, fromLang: 'zh-CHS' }],
  });

  if (!res.data?.success) {
    throw new Error(`Youdao submit failed: ${JSON.stringify(res.data)}`);
  }

  const mediaId: string = res.data.data.mediaIds[0];
  return mediaId;
}

export type TaskStatus = 'processing' | 'done' | 'failed';

export interface TaskResult {
  status: TaskStatus;
  originSrtUrl?: string;
  failReason?: string;
}

export async function queryTask(mediaId: string): Promise<TaskResult> {
  const res = await client.get(`/translate/task/${mediaId}`);

  if (!res.data?.success) {
    throw new Error(`Youdao query failed: ${JSON.stringify(res.data)}`);
  }

  const data = res.data.data;

  if (data.status === 1) {
    return { status: 'done', originSrtUrl: data.originSrtUrl ?? undefined };
  } else if (data.status === 2) {
    return { status: 'failed', failReason: data.failReason ?? 'unknown' };
  } else {
    return { status: 'processing' };
  }
}

// Fetch the .srt file and extract plain text lines (no timestamps)
export async function fetchTranscriptText(srtUrl: string): Promise<string> {
  const res = await axios.get<string>(srtUrl, { timeout: 30_000 });
  return parseSrt(res.data);
}

function parseSrt(srt: string): string {
  // SRT format: index \n timestamp --> timestamp \n text \n\n
  const lines = srt.split(/\r?\n/);
  const textLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^\d+$/.test(trimmed)) continue;                   // sequence number
    if (/-->/.test(trimmed)) continue;                      // timestamp
    textLines.push(trimmed);
  }

  return textLines.join(' ');
}
