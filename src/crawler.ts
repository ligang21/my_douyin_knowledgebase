import { chromium } from 'playwright';
import path from 'path';
import os from 'os';

// Chrome user data dir on Windows — reuses your logged-in session
const CHROME_USER_DATA = path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'User Data');

export interface VideoItem {
  id: string;
  title: string | null;
  url: string;
  likes: number;
  sourceTab: 'like' | 'favorite';
}

const TABS = [
  {
    name: 'like' as const,
    url: 'https://www.douyin.com/user/self?from_tab_name=main&showSubTab=video&showTab=like',
  },
  {
    name: 'favorite' as const,
    url: 'https://www.douyin.com/user/self?from_tab_name=main&showSubTab=video&showTab=favorite_collection',
  },
];

export async function crawlDouyin(): Promise<VideoItem[]> {
  const browser = await chromium.launchPersistentContext(CHROME_USER_DATA, {
    channel: 'chrome',
    headless: false,   // must be visible to reuse logged-in session
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

  try {
    await page.goto(tabUrl, { waitUntil: 'networkidle', timeout: 30_000 });
    await page.waitForTimeout(2000);

    // Scroll down to load more videos (Douyin uses virtual scroll)
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

    // Extract video metadata from the loaded cards
    const extracted = await page.evaluate((_src) => {
      const results: Array<{ id: string; title: string | null; url: string; likes: number }> = [];

      // Douyin renders video cards as <li> or <div> with an <a> pointing to /video/{id}
      const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/video/"]'));
      const seen = new Set<string>();

      for (const a of anchors) {
        const href = a.href;
        const match = href.match(/\/video\/(\d+)/);
        if (!match) continue;

        const id = match[1];
        if (seen.has(id)) continue;
        seen.add(id);

        // Try to find title text nearby
        const card = a.closest('li') ?? a.closest('div[class*="card"]') ?? a.parentElement;
        const titleEl = card?.querySelector('[class*="title"], [class*="desc"], p');
        const title = titleEl?.textContent?.trim() ?? null;

        // Try to find like count nearby
        const likeEl = card?.querySelector('[class*="like"], [class*="digg"]');
        const likesText = likeEl?.textContent?.replace(/[^0-9.万w]/g, '') ?? '0';
        const likes = parseChineseLikeCount(likesText);

        results.push({ id, title, url: `https://www.douyin.com/video/${id}`, likes });
      }

      return results;

      function parseChineseLikeCount(text: string): number {
        if (!text) return 0;
        if (text.includes('万') || text.includes('w')) {
          return Math.round(parseFloat(text) * 10000);
        }
        return parseInt(text, 10) || 0;
      }
    });

    for (const v of extracted) {
      items.push({ ...v, sourceTab });
    }
  } finally {
    await page.close();
  }

  return items;
}
