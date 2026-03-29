const { test, expect, chromium } = require('@playwright/test');
const path = require('path');

const extensionPath = path.resolve(__dirname, '../../');

test.describe('qbrow bookmark palette', () => {
  let context;
  let page;
  let sw;

  test.beforeAll(async () => {
    context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });

    const swPromise = context.waitForEvent('serviceworker', {
      predicate: (worker) => worker.url().includes('background.js'),
      timeout: 10000,
    }).catch(() => null);
    sw =
      context.serviceWorkers().find((w) => w.url().includes('background.js')) ??
      (await swPromise);

    await sw.evaluate(async () => {
      const existing = await chrome.bookmarks.search('__qbrow_test__');
      for (const b of existing) await chrome.bookmarks.remove(b.id);
      await chrome.bookmarks.create({ title: '__qbrow_test__ Playwright Docs', url: 'https://playwright.dev' });
      await chrome.bookmarks.create({ title: '__qbrow_test__ Vitest Docs', url: 'https://vitest.dev' });
      await chrome.bookmarks.create({ title: '__qbrow_test__ MDN', url: 'https://developer.mozilla.org' });
    });

    page = await context.newPage();
    await page.goto('https://example.com');
  });

  test.afterAll(async () => {
    const worker = context.serviceWorkers().find((w) => w.url().includes('background.js'));
    if (worker) {
      await worker.evaluate(async () => {
        const existing = await chrome.bookmarks.search('__qbrow_test__');
        for (const b of existing) await chrome.bookmarks.remove(b.id);
      });
    }
    await context.close();
  });

  // Returns a FrameLocator scoped to the palette iframe
  function frame() {
    return page.frameLocator('#qbrow-host');
  }

  // Returns the actual Frame object (for evaluate calls)
  function paletteFrame() {
    return page.frames().find((f) => f.url().includes('palette.html'));
  }

  async function openPalette() {
    await sw.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE' });
    });
    await page.waitForSelector('#qbrow-host', { state: 'attached', timeout: 3000 });
    await frame().locator('#qbrow-input').waitFor({ timeout: 3000 });
  }

  async function closePalette() {
    const isOpen = await page.evaluate(() => !!document.getElementById('qbrow-host'));
    if (isOpen) {
      await frame().locator('#qbrow-input').press('Escape');
      await page.waitForSelector('#qbrow-host', { state: 'detached', timeout: 2000 }).catch(() => {});
    }
  }

  async function search(query) {
    await frame().locator('#qbrow-input').pressSequentially(query);
  }

  async function waitForResults(minCount = 1, timeout = 4000) {
    await frame().locator('.qbrow-item').nth(minCount - 1).waitFor({ timeout });
  }

  async function getShadowResults() {
    const f = paletteFrame();
    if (!f) return [];
    return f.evaluate(() =>
      Array.from(document.querySelectorAll('.qbrow-item')).map((el) => ({
        title: el.querySelector('.qbrow-item-title')?.textContent,
        url: el.dataset.url,
      })),
    );
  }

  async function pressEnterInPalette() {
    await frame().locator('#qbrow-input').press('Enter');
  }

  async function getFolderItems() {
    const f = paletteFrame();
    if (!f) return [];
    return f.evaluate(() =>
      Array.from(document.querySelectorAll('.qbrow-item')).map((el) => ({
        kind: el.dataset.kind,
        title: el.querySelector('.qbrow-item-title')?.textContent,
        path: el.querySelector('.qbrow-item-path')?.textContent ?? null,
      })),
    );
  }

  // ─── sanity check ────────────────────────────────────────────────────────────

  test('seeded bookmarks exist in background', async () => {
    const count = await sw.evaluate(async () => {
      const all = await chrome.bookmarks.search('__qbrow_test__');
      return all.length;
    });
    expect(count).toBe(3);
  });

  test('background returns results for SEARCH message', async () => {
    await page.goto('https://example.com');
    await openPalette();

    const results = await sw.evaluate(async () => {
      const tree = await chrome.bookmarks.getTree();
      const flat = [];
      (function flatten(nodes) {
        for (const n of nodes) {
          if (n.url) flat.push({ id: n.id, title: n.title || '', url: n.url });
          if (n.children) flatten(n.children);
        }
      })(tree);
      const q = 'playwright';
      return flat.filter(
        (b) => b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q),
      );
    });
    expect(results.length).toBeGreaterThan(0);

    await closePalette();
  });

  // ─── UI tests ────────────────────────────────────────────────────────────────

  test('palette opens via toggle', async () => {
    await page.goto('https://example.com');
    await openPalette();
    await expect(page.locator('#qbrow-host')).toBeAttached();
    await closePalette();
  });

  test('Escape closes the palette', async () => {
    await page.goto('https://example.com');
    await openPalette();
    await frame().locator('#qbrow-input').press('Escape');
    await expect(page.locator('#qbrow-host')).not.toBeAttached();
  });

  test('typing filters bookmarks', async () => {
    await page.goto('https://example.com');
    await openPalette();
    await search('playwright');

    await waitForResults(1);

    const results = await getShadowResults();
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.title?.toLowerCase().includes('playwright'))).toBe(true);

    await closePalette();
  });

  test('arrow down moves active selection', async () => {
    await page.goto('https://example.com');
    await openPalette();
    await search('playwright');
    await waitForResults(1);

    await frame().locator('#qbrow-input').press('ArrowDown');

    const isFirstActive = await paletteFrame().evaluate(() => {
      const items = document.querySelectorAll('.qbrow-item');
      return items?.[0]?.classList.contains('active') ?? false;
    });

    expect(isFirstActive).toBe(true);
    await closePalette();
  });

  test('Enter navigates to the active bookmark', async () => {
    await page.goto('https://example.com');
    await openPalette();
    await search('playwright');
    await waitForResults(1);

    await frame().locator('#qbrow-input').press('ArrowDown');
    await frame().locator('#qbrow-input').press('Enter');

    await page.waitForURL('https://playwright.dev/**', { timeout: 8000 });
    expect(page.url()).toContain('playwright.dev');
  });

  test('clicking a result navigates to the bookmark', async () => {
    await page.goto('https://example.com');
    await openPalette();
    await search('vitest');
    await waitForResults(1);

    await frame().locator('.qbrow-item').first().click();

    await page.waitForURL('https://vitest.dev/**', { timeout: 8000 });
    expect(page.url()).toContain('vitest.dev');
  });

  test('clicking outside closes the palette', async () => {
    await page.goto('https://example.com');
    await openPalette();

    // Click the overlay backdrop — top-left corner is outside the centered palette card
    await frame().locator('#qbrow-overlay').click({ position: { x: 10, y: 10 } });

    await expect(page.locator('#qbrow-host')).not.toBeAttached();
  });

  // ─── /tag command ─────────────────────────────────────────────────────────────

  test('/tag <query> shows matching bookmarks in tag mode', async () => {
    await page.goto('https://example.com');
    await openPalette();

    await frame().locator('#qbrow-input').pressSequentially('/tag add playwright');
    await waitForResults(1);

    const badgeText = await frame().locator('#qbrow-badge').textContent();
    expect(badgeText).toBe('tag: add');

    const results = await getShadowResults();
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.title?.toLowerCase().includes('playwright'))).toBe(true);

    await closePalette();
  });

  test('selecting a bookmark in tag mode transitions to tag-name step', async () => {
    await page.goto('https://example.com');
    await openPalette();

    await frame().locator('#qbrow-input').pressSequentially('/tag add playwright');
    await waitForResults(1);

    await pressEnterInPalette();

    const placeholder = await frame().locator('#qbrow-input').getAttribute('placeholder');
    expect(placeholder).toBe('Enter tag name…');

    const badgeText = await frame().locator('#qbrow-badge').textContent();
    expect(badgeText).toContain('tag →');

    await closePalette();
  });

  test('searching by tag returns tagged bookmarks', async () => {
    await sw.evaluate(async () => {
      const result = await chrome.storage.local.get('tags');
      const tags = result.tags ?? {};
      const [bm] = await chrome.bookmarks.search('__qbrow_test__ Playwright Docs');
      if (bm) { tags[bm.id] = ['e2e']; await chrome.storage.local.set({ tags }); }
    });
    await sw.evaluate(async () => {
      const b = await chrome.bookmarks.create({ title: '__qbrow_cache_bust__', url: 'https://example.com' });
      await chrome.bookmarks.remove(b.id);
    });

    await page.goto('https://example.com');
    await openPalette();
    await search('e2e');
    await waitForResults(1);

    const results = await getShadowResults();
    expect(results.some((r) => r.title?.includes('Playwright'))).toBe(true);

    await closePalette();
  });

  test('saving a tag stores it and shows as chip on the bookmark', async () => {
    await sw.evaluate(async () => {
      const result = await chrome.storage.local.get('tags');
      const tags = result.tags ?? {};
      for (const id of Object.keys(tags)) delete tags[id];
      await chrome.storage.local.set({ tags });
    });

    await page.goto('https://example.com');
    await openPalette();

    await frame().locator('#qbrow-input').pressSequentially('/tag add playwright');
    await waitForResults(1);

    await pressEnterInPalette();

    await frame().locator('#qbrow-input').pressSequentially('testing');
    await pressEnterInPalette();

    await expect(page.locator('#qbrow-host')).not.toBeAttached();

    await openPalette();
    await search('playwright');
    await waitForResults(1);

    const tagChip = await frame().locator('.qbrow-item .qbrow-tag').first().textContent().catch(() => null);
    expect(tagChip).toBe('testing');

    await closePalette();
  });

  // ─── scroll behaviour ────────────────────────────────────────────────────────

  test('results list scrolls to keep active item visible with peek', async () => {
    const prefix = '__qbrow_scroll_' + Date.now() + '__';
    const ids = await sw.evaluate(async (pfx) => {
      const created = [];
      for (let i = 1; i <= 10; i++) {
        const b = await chrome.bookmarks.create({
          title: `${pfx} item ${String(i).padStart(2, '0')}`,
          url: `https://example.com/scroll/${i}`,
        });
        created.push(b.id);
      }
      return created;
    }, prefix);

    await page.goto('https://example.com');
    await openPalette();
    await search(prefix);
    await waitForResults(10, 6000);

    const pf = paletteFrame();

    const getState = () => pf.evaluate(() => {
      const list = document.getElementById('qbrow-results');
      const items = [...list.querySelectorAll('.qbrow-item')];
      const idx = items.findIndex((el) => el.classList.contains('active'));
      const listRect = list.getBoundingClientRect();
      const activeRect = idx >= 0 ? items[idx].getBoundingClientRect() : null;
      return {
        scrollTop: list.scrollTop,
        clientHeight: list.clientHeight,
        activeIdx: idx,
        activeRelTop: activeRect ? activeRect.top - listRect.top : null,
        activeRelBottom: activeRect ? activeRect.bottom - listRect.top : null,
        itemCount: items.length,
      };
    });

    const s0 = await getState();
    expect(s0.scrollTop).toBe(0);
    expect(s0.activeIdx).toBe(0);
    expect(s0.itemCount).toBe(10);

    // Navigate down through all items — scroll must engage and active must stay in view
    let scrolled = false;
    for (let i = 0; i < 9; i++) {
      await frame().locator('#qbrow-input').press('ArrowDown');
      const s = await getState();
      expect(s.activeRelTop).toBeGreaterThanOrEqual(-1);
      expect(s.activeRelBottom).toBeLessThanOrEqual(s.clientHeight + 1);
      if (s.scrollTop > 0) scrolled = true;
    }
    expect(scrolled).toBe(true);

    const sBottom = await getState();
    expect(sBottom.scrollTop).toBeGreaterThan(0);
    expect(sBottom.activeIdx).toBe(9);

    // Navigate back up — active must stay in view and scroll must return to 0
    for (let i = 0; i < 9; i++) {
      await frame().locator('#qbrow-input').press('ArrowUp');
      const s = await getState();
      expect(s.activeRelTop).toBeGreaterThanOrEqual(-1);
      expect(s.activeRelBottom).toBeLessThanOrEqual(s.clientHeight + 1);
    }

    const sTop = await getState();
    expect(sTop.scrollTop).toBe(0);
    expect(sTop.activeIdx).toBe(0);

    await sw.evaluate(async (idList) => {
      for (const id of idList) await chrome.bookmarks.remove(id).catch(() => {});
    }, ids);

    await closePalette();
  });

  // ─── /save command ─────────────────────────────────────────────────────────────

  test('/save shows folder navigation after entering bookmark name', async () => {
    await page.goto('https://example.com');
    await openPalette();

    await frame().locator('#qbrow-input').pressSequentially('/save My Bookmark');
    await pressEnterInPalette();

    await frame().locator('.qbrow-item').first().waitFor({ timeout: 3000 });

    const items = await getFolderItems();
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.kind === 'folder')).toBe(true);

    const placeholder = await frame().locator('#qbrow-input').getAttribute('placeholder');
    expect(placeholder).toBe('Navigate to folder…');

    await closePalette();
  });

  test('/save navigates into a folder and shows Save here', async () => {
    await page.goto('https://example.com');
    await openPalette();

    await frame().locator('#qbrow-input').pressSequentially('/save My Bookmark');
    await pressEnterInPalette();

    await frame().locator('.qbrow-item').first().waitFor({ timeout: 3000 });

    // Navigate into the first folder (e.g. Bookmarks Bar)
    await pressEnterInPalette();

    await frame().locator('.qbrow-item[data-kind="save"]').first().waitFor({ timeout: 3000 });

    const items = await getFolderItems();
    expect(items[0].kind).toBe('save');
    expect(items[0].title).toBe('Save here');

    await closePalette();
  });

  test('/save creates a new folder when name has no match', async () => {
    const uniqueName = '__qbrow_newfolder_' + Date.now() + '__';

    await page.goto('https://example.com');
    await openPalette();

    await frame().locator('#qbrow-input').pressSequentially('/save Test Page');
    await pressEnterInPalette();

    await frame().locator('.qbrow-item').first().waitFor({ timeout: 3000 });
    await pressEnterInPalette();

    await frame().locator('.qbrow-item[data-kind="save"]').first().waitFor({ timeout: 3000 });

    await frame().locator('#qbrow-input').pressSequentially(uniqueName);

    await frame()
      .locator('.qbrow-item[data-kind="create"]')
      .filter({ hasText: uniqueName })
      .waitFor({ timeout: 3000 });

    const items = await getFolderItems();
    const createItem = items.find((i) => i.kind === 'create');
    expect(createItem).toBeTruthy();
    expect(createItem.title).toContain(uniqueName);

    await pressEnterInPalette();

    await frame().locator('.qbrow-item[data-kind="save"]').first().waitFor({ timeout: 3000 });

    await sw.evaluate(async (name) => {
      const results = await chrome.bookmarks.search(name);
      for (const b of results) await chrome.bookmarks.remove(b.id);
    }, uniqueName);

    await closePalette();
  });

  test('/tag remove shows existing tags and removes the selected one', async () => {
    // Seed a known tag
    await sw.evaluate(async () => {
      const result = await chrome.storage.local.get('tags');
      const tags = result.tags ?? {};
      const [bm] = await chrome.bookmarks.search('__qbrow_test__ Playwright Docs');
      if (bm) { tags[bm.id] = ['removable']; await chrome.storage.local.set({ tags }); }
      const b = await chrome.bookmarks.create({ title: '__qbrow_cache_bust__', url: 'https://example.com' });
      await chrome.bookmarks.remove(b.id);
    });

    await page.goto('https://example.com');
    await openPalette();

    await frame().locator('#qbrow-input').pressSequentially('/tag remove playwright');
    await waitForResults(1);

    const badgeText = await frame().locator('#qbrow-badge').textContent();
    expect(badgeText).toBe('tag: remove');

    // Select the Playwright bookmark — should transition to tag-remove-select
    await pressEnterInPalette();

    const placeholder = await frame().locator('#qbrow-input').getAttribute('placeholder');
    expect(placeholder).toBe('Select tag to remove…');

    // The existing tag should appear as an item
    await waitForResults(1);
    const items = await paletteFrame().evaluate(() =>
      Array.from(document.querySelectorAll('.qbrow-item')).map((el) => ({
        kind: el.dataset.kind,
        title: el.querySelector('.qbrow-item-title')?.textContent,
      })),
    );
    expect(items[0].title).toBe('removable');

    // Select it to remove
    await pressEnterInPalette();
    await expect(page.locator('#qbrow-host')).not.toBeAttached();

    // Verify the tag is gone
    const tagGone = await sw.evaluate(async () => {
      const result = await chrome.storage.local.get('tags');
      const tags = result.tags ?? {};
      const [bm] = await chrome.bookmarks.search('__qbrow_test__ Playwright Docs');
      return !(tags[bm?.id] ?? []).includes('removable');
    });
    expect(tagGone).toBe(true);
  });

  test('/save saves the bookmark and it appears in search results', async () => {
    const title = '__qbrow_saved_' + Date.now() + '__';

    await page.goto('https://example.com');
    await openPalette();

    await frame().locator('#qbrow-input').pressSequentially('/save ' + title);
    await pressEnterInPalette();

    await frame().locator('.qbrow-item').first().waitFor({ timeout: 3000 });
    await pressEnterInPalette();

    await frame().locator('.qbrow-item[data-kind="save"]').first().waitFor({ timeout: 3000 });
    await pressEnterInPalette();

    await expect(page.locator('#qbrow-host')).not.toBeAttached();

    const found = await sw.evaluate(async (t) => {
      const results = await chrome.bookmarks.search(t);
      return results.length > 0;
    }, title);
    expect(found).toBe(true);

    await sw.evaluate(async (t) => {
      const results = await chrome.bookmarks.search(t);
      for (const b of results) await chrome.bookmarks.remove(b.id);
    }, title);
  });
});
