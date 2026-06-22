import 'dotenv/config';
import cron from 'node-cron';
import { crawlDouyin } from './crawler';
import {
  upsertVideo, videoExists, getPendingTranscription, getProcessingTranscription,
  getPendingSummary, setYoudaoJob, setTranscript, setYoudaoFailed, setSummary,
} from './db';
import { submitTranscription, queryTask, fetchTranscriptText } from './youdao';
import { summarizeTranscript } from './summarizer';

const CRON_SCHEDULE = process.env.CRON_SCHEDULE || '0 */6 * * *';
const POLL_INTERVAL_MS = 60_000; // poll Youdao status every 60s

// ─── Step 1: Crawl new videos from Douyin ────────────────────────────────────

async function stepCrawl() {
  console.log('[crawl] Starting Douyin crawl...');
  const videos = await crawlDouyin();
  let newCount = 0;

  for (const v of videos) {
    if (!videoExists(v.id)) {
      upsertVideo({
        id: v.id,
        platform: 'douyin',
        source_tab: v.sourceTab,
        title: v.title,
        url: v.url,
        likes: v.likes,
      });
      newCount++;
    } else {
      // Always update likes count
      upsertVideo({
        id: v.id,
        platform: 'douyin',
        source_tab: v.sourceTab,
        title: v.title,
        url: v.url,
        likes: v.likes,
      });
    }
  }

  console.log(`[crawl] Done. ${videos.length} total, ${newCount} new.`);
}

// ─── Step 2: Submit pending videos to Youdao ─────────────────────────────────

async function stepSubmitTranscription() {
  const pending = getPendingTranscription();
  if (pending.length === 0) return;

  console.log(`[youdao] Submitting ${pending.length} videos for transcription...`);

  // Youdao allows up to 10 tasks per request, but we submit one-by-one to map mediaId back
  for (const video of pending) {
    try {
      const mediaId = await submitTranscription(video.url);
      setYoudaoJob(video.id, mediaId);
      console.log(`[youdao] Submitted ${video.id} → mediaId: ${mediaId}`);
    } catch (err) {
      console.error(`[youdao] Failed to submit ${video.id}:`, err);
      setYoudaoFailed(video.id);
    }

    // Small delay to avoid rate limiting
    await sleep(500);
  }
}

// ─── Step 3: Poll processing jobs and fetch completed transcripts ─────────────

async function stepPollTranscription() {
  const processing = getProcessingTranscription();
  if (processing.length === 0) return;

  console.log(`[youdao] Polling ${processing.length} in-progress jobs...`);

  for (const video of processing) {
    try {
      const result = await queryTask(video.youdao_media_id!);

      if (result.status === 'done' && result.originSrtUrl) {
        const transcript = await fetchTranscriptText(result.originSrtUrl);
        setTranscript(video.id, transcript);
        console.log(`[youdao] Transcript ready for ${video.id} (${transcript.length} chars)`);
      } else if (result.status === 'failed') {
        console.warn(`[youdao] Transcription failed for ${video.id}: ${result.failReason}`);
        setYoudaoFailed(video.id);
      } else {
        console.log(`[youdao] Still processing: ${video.id}`);
      }
    } catch (err) {
      console.error(`[youdao] Poll error for ${video.id}:`, err);
    }

    await sleep(300);
  }
}

// ─── Step 4: Summarize transcribed videos with Claude ────────────────────────

async function stepSummarize() {
  const ready = getPendingSummary();
  if (ready.length === 0) return;

  console.log(`[claude] Summarizing ${ready.length} videos...`);

  for (const video of ready) {
    try {
      const result = await summarizeTranscript(video.title, video.transcript!);
      setSummary(video.id, result.summary, result.tags, result.keyPoints, result.contentType);
      console.log(`[claude] Summarized ${video.id}: ${result.tags.join(', ')}`);
    } catch (err) {
      console.error(`[claude] Summarization failed for ${video.id}:`, err);
    }

    await sleep(300);
  }
}

// ─── Full pipeline run ────────────────────────────────────────────────────────

async function runPipeline() {
  console.log('\n=== Pipeline run started ===');
  try {
    await stepCrawl();
    await stepSubmitTranscription();
    await stepPollTranscription();
    await stepSummarize();
  } catch (err) {
    console.error('[pipeline] Unexpected error:', err);
  }
  console.log('=== Pipeline run complete ===\n');
}

// ─── Entry point ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const runOnce = args.includes('--once');

if (runOnce) {
  // Run immediately and exit
  runPipeline().then(() => process.exit(0));
} else {
  // Run once on startup, then on schedule
  runPipeline();

  // Poll Youdao status more frequently than the full crawl
  setInterval(stepPollTranscription, POLL_INTERVAL_MS);
  setInterval(stepSummarize, POLL_INTERVAL_MS);

  cron.schedule(CRON_SCHEDULE, runPipeline);
  console.log(`[scheduler] Running on schedule: ${CRON_SCHEDULE}`);
  console.log('[scheduler] Press Ctrl+C to stop.');
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
