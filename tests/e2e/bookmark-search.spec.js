const { test, expect, chromium } = require('@playwright/test');
const path = require('path');

const extensionPath = path.resolve(__dirname, '../../');

test.describe.configure({ timeout: 60000 });

test.describe('qbrow bookmark palette', () => {
  let context;
  let page;
  let keepAlivePage = null; // open extension page used by swEval

  // swEval sends a named test-helper message to the SW via the already-open extension
  // page. chrome.runtime.sendMessage auto-wakes a sleeping SW, so there is no risk of
  // hanging on a stale Playwright ServiceWorker reference.
  async function swEval(type, data = {}) {
    return keepAlivePage.evaluate(
      ([msgType, msgData]) => chrome.runtime.sendMessage({ type: msgType, ...msgData }),
      [type, data],
    );
  }

  test.beforeAll(async () => {
    context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });

    // Get the extension ID from the background SW URL so we can open a page
    // on the extension's origin — needed for chrome.runtime.sendMessage access.
    let swRef = context.serviceWorkers().find((w) => w.url().includes('background.js'));
    if (!swRef) {
      swRef = await context.waitForEvent('serviceworker', {
        predicate: (w) => w.url().includes('background.js'),
        timeout: 10000,
      });
    }
    const extId = new URL(swRef.url()).hostname;

    // Open a persistent extension page for the duration of the suite.
    // swEval routes all SW calls through this page via sendMessage, which
    // auto-wakes a sleeping SW — no stale Playwright ServiceWorker reference needed.
    keepAlivePage = await context.newPage();
    await keepAlivePage.goto(`chrome-extension://${extId}/settings.html`, {
      waitUntil: 'domcontentloaded',
    });

    await swEval('TEST_SEED_BOOKMARKS');

    page = await context.newPage();
    await page.goto('https://example.com');
  });

  test.afterAll(async () => {
    await swEval('TEST_CLEAN_BOOKMARKS').catch(() => {});
    await keepAlivePage.close().catch(() => {});
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
    await swEval('TEST_TOGGLE_PALETTE');
    await page.waitForSelector('#qbrow-host', { state: 'attached', timeout: 3000 });
    await frame().locator('#qbrow-input').waitFor({ timeout: 3000 });
  }

  async function closePalette() {
    const isOpen = await page.evaluate(() => !!document.getElementById('qbrow-host'));
    if (isOpen) {
      // .catch: pressing Escape removes the iframe; Playwright may throw because the
      // frame closes while it is still completing the press() call — that is expected.
      await frame().locator('#qbrow-input').press('Escape').catch(() => {});
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
    const { count } = await swEval('TEST_COUNT_BOOKMARKS');
    expect(count).toBe(3);
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
    await frame().locator('#qbrow-input').press('Escape').catch(() => {});
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
    await page.goto('https://example.com');

    await swEval('TEST_SET_TAG', { tagName: 'e2e' });
    await openPalette();
    await search('e2e');
    await waitForResults(1);

    const results = await getShadowResults();
    expect(results.some((r) => r.title?.includes('Playwright'))).toBe(true);

    await closePalette();
  });

  test('saving a tag stores it and shows as chip on the bookmark', async () => {
    await page.goto('https://example.com');

    await swEval('TEST_CLEAR_TAGS');
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

  // ─── landing-page guard ──────────────────────────────────────────────────────

  test('isPrivilegedUrl correctly classifies URLs', async () => {
    const results = await swEval('TEST_CLASSIFY_URLS');

    expect(results.chromeNewtab).toBe(true);
    expect(results.braveNewtab).toBe(true);
    expect(results.aboutBlank).toBe(true);
    expect(results.extPage).toBe(true);
    // https:// pages must never trigger landing navigation, even if injection is blocked
    expect(results.webstore).toBe(false);
    expect(results.example).toBe(false);
    expect(results.httpPage).toBe(false);
  });

  test('palette opens as iframe overlay on https pages, not as landing navigation', async () => {
    await page.goto('https://example.com');
    const urlBefore = page.url();
    const tabsBefore = context.pages().length;

    await openPalette();

    // URL must not have changed — no landing navigation or new tab
    expect(page.url()).toBe(urlBefore);
    expect(page.url()).not.toContain('palette.html');
    expect(context.pages().length).toBe(tabsBefore);

    // Palette must be present as an iframe, not a full-page takeover
    await expect(page.locator('#qbrow-host')).toBeAttached();

    await closePalette();
  });

  // ─── scroll behaviour ────────────────────────────────────────────────────────

  test('results list scrolls to keep active item visible with peek', async () => {
    const prefix = '__qbrow_scroll_' + Date.now() + '__';
    const { ids } = await swEval('TEST_CREATE_SCROLL_BOOKMARKS', { prefix });

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

    await swEval('TEST_REMOVE_BOOKMARKS', { ids });

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

    await swEval('TEST_SEARCH_REMOVE', { query: uniqueName });

    await closePalette();
  });

  test('/tag remove shows existing tags and removes the selected one', async () => {
    await page.goto('https://example.com');

    // Seed a known tag
    await swEval('TEST_SET_TAG', { tagName: 'removable' });
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
    const { has } = await swEval('TEST_HAS_TAG', { tagName: 'removable' });
    expect(has).toBe(false);
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

    const { found } = await swEval('TEST_SEARCH_REMOVE', { query: title });
    expect(found).toBe(true);
  });
});
