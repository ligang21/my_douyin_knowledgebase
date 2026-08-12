import { chromium } from 'playwright';
import path from 'path';
import os from 'os';

const CHROME_USER_DATA = process.env.CHROME_USER_DATA ||
  path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'DouyinCrawler');

export interface VideoItem {
  id: string;
  title: string | null;
  url: string;       // douyin.com page URL (for display/sharing)
  cdnUrl?: string;   // CDN direct URL (for Youdao transcription)
  likes: number;
  sourceTab: 'like' | 'favorite';
}

const TABS = [
  // {
  //   name: 'like' as const,
  //   url: 'https://www.douyin.com/user/self?from_tab_name=main&showSubTab=video&showTab=like',
  // },
  {
    name: 'favorite' as const,
    url: 'https://www.douyin.com/user/self?from_tab_name=main&showSubTab=video&showTab=favorite_collection',
  },
];

export async function crawlDouyin(): Promise<VideoItem[]> {
  const browser = await chromium.launchPersistentContext(CHROME_USER_DATA, {
    channel: 'chrome',
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const results: VideoItem[] = [];

  try {
    for (const tab of TABS) {
      const items = await crawlTab(browser, tab.url, tab.name);
      results.push(...items);
    }
  } finally {
    await browser.close();
  }

  return results;
}

async function crawlTab(
  context: Awaited<ReturnType<typeof chromium.launchPersistentContext>>,
  tabUrl: string,
  sourceTab: 'like' | 'favorite',
): Promise<VideoItem[]> {
  const page = await context.newPage();
  const items: VideoItem[] = [];

  // Intercept Douyin internal API responses to capture CDN video URLs
  const cdnUrlMap = new Map<string, string>();
  page.on('response', async (response) => {
    const url = response.url();
    if (!url.includes('/aweme/v1/') && !url.includes('/aweme/detail/')) return;
    try {
      const json = await response.json();
      const list: unknown[] =
        json?.aweme_list ?? json?.data?.aweme_list ?? [];
      for (const item of list as Record<string, unknown>[]) {
        const id = item?.aweme_id;
        const urlList = (item?.video as Record<string, unknown>)
          ?.play_addr as Record<string, unknown>;
        const cdnUrl = (urlList?.url_list as string[])?.[0];
        if (id && cdnUrl) {
          cdnUrlMap.set(String(id), cdnUrl);
        }
      }
    } catch {
      // non-JSON response, skip
    }
  });

  try {
    await page.goto(tabUrl, { waitUntil: 'load', timeout: 60_000 });
    await page.waitForSelector('[data-e2e="user-post-item"], .video-card, li[class*="video"]', { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(2000);

    let previousCount = 0;
    let noGrowthRounds = 0;

    while (noGrowthRounds < 3) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1500);

      const cards = await page.$$('[data-e2e="user-post-item"], .video-card, li[class*="video"]');
      if (cards.length === previousCount) {
        noGrowthRounds++;
      } else {
        noGrowthRounds = 0;
        previousCount = cards.length;
      }
    }

    const extracted = await page.evaluate(() => {
      const results: Array<{ id: string; title: string | null; url: string; likes: number }> = [];
      const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/video/"]'));
      const seen = new Set<string>();

      for (const a of anchors) {
        const match = a.href.match(/\/video\/(\d+)/);
        if (!match) continue;
        const id = match[1];
        if (seen.has(id)) continue;
        seen.add(id);

        const card = a.closest('li') ?? a.closest('div[class*="card"]') ?? a.parentElement;
        const titleEl = card?.querySelector('[class*="title"], [class*="desc"], p');
        const title = titleEl?.textContent?.trim() ?? null;

        const likeEl = card?.querySelector('[class*="like"], [class*="digg"]');
        const likesText = likeEl?.textContent?.replace(/[^0-9.万w]/g, '') ?? '0';

        function parseChineseLikeCount(text: string): number {
          if (!text) return 0;
          if (text.includes('万') || text.includes('w')) {
            return Math.round(parseFloat(text) * 10000);
          }
          return parseInt(text, 10) || 0;
        }

        results.push({ id, title, url: `https://www.douyin.com/video/${id}`, likes: parseChineseLikeCount(likesText) });
      }

      return results;
    });

    for (const v of extracted) {
      items.push({ ...v, sourceTab, cdnUrl: cdnUrlMap.get(v.id) });
    }

    console.log(`[crawl] CDN URLs captured: ${cdnUrlMap.size}/${extracted.length}`);
  } finally {
    await page.close();
  }

  return items;
}
