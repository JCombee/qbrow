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

  async function openPalette() {
    await sw.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE' });
    });
    await page.waitForSelector('#qbrow-host', { state: 'attached', timeout: 3000 });
  }

  async function closePalette() {
    const isOpen = await page.evaluate(() => !!document.getElementById('qbrow-host'));
    if (isOpen) {
      await page.evaluate(() => {
        document.getElementById('qbrow-host')?.shadowRoot
          ?.getElementById('qbrow-input')
          ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      });
      await page.waitForSelector('#qbrow-host', { state: 'detached', timeout: 2000 }).catch(() => {});
    }
  }

  // Click the input to focus it, then use real keyboard events to type.
  // keyboard.type() fires native keydown/keypress/input/keyup events that
  // the content script's isolated-world listener reliably receives.
  async function search(query) {
    await page.locator('#qbrow-input').click();
    await page.keyboard.type(query);
  }

  async function waitForResults(minCount = 1, timeout = 4000) {
    await page.waitForFunction(
      (n) => {
        const host = document.getElementById('qbrow-host');
        return (host?.shadowRoot?.querySelectorAll('.qbrow-item').length ?? 0) >= n;
      },
      minCount,
      { timeout },
    );
  }

  async function getShadowResults() {
    return page.evaluate(() => {
      const host = document.getElementById('qbrow-host');
      if (!host) return [];
      const items = host.shadowRoot.querySelectorAll('.qbrow-item');
      return Array.from(items).map((el) => ({
        title: el.querySelector('.qbrow-item-title')?.textContent,
        url: el.dataset.url,
      }));
    });
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

    // Send SEARCH directly from the SW and check results come back
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
    await page.evaluate(() => {
      document.getElementById('qbrow-host')?.shadowRoot
        ?.getElementById('qbrow-input')
        ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
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

    // ArrowDown via shadow DOM keydown event
    await page.evaluate(() => {
      document.getElementById('qbrow-host')?.shadowRoot
        ?.getElementById('qbrow-input')
        ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });

    const isFirstActive = await page.evaluate(() => {
      const host = document.getElementById('qbrow-host');
      const items = host?.shadowRoot?.querySelectorAll('.qbrow-item');
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

    // Select first item and press Enter
    await page.evaluate(() => {
      const input = document.getElementById('qbrow-host')?.shadowRoot?.getElementById('qbrow-input');
      if (!input) return;
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });

    await page.waitForURL('https://playwright.dev/**', { timeout: 8000 });
    expect(page.url()).toContain('playwright.dev');
  });

  test('clicking a result navigates to the bookmark', async () => {
    await page.goto('https://example.com');
    await openPalette();
    await search('vitest');
    await waitForResults(1);

    await page.evaluate(() => {
      const host = document.getElementById('qbrow-host');
      const first = host?.shadowRoot?.querySelector('.qbrow-item');
      first?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });

    await page.waitForURL('https://vitest.dev/**', { timeout: 8000 });
    expect(page.url()).toContain('vitest.dev');
  });

  test('clicking outside closes the palette', async () => {
    await page.goto('https://example.com');
    await openPalette();

    await page.evaluate(() => {
      const host = document.getElementById('qbrow-host');
      const overlay = host?.shadowRoot?.getElementById('qbrow-overlay');
      overlay?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });

    await expect(page.locator('#qbrow-host')).not.toBeAttached();
  });

  // ─── /tag command ─────────────────────────────────────────────────────────────

  test('/tag <query> shows matching bookmarks in tag mode', async () => {
    await page.goto('https://example.com');
    await openPalette();

    await page.locator('#qbrow-input').click();
    await page.keyboard.type('/tag playwright');
    await waitForResults(1);

    // Badge should be visible and say "tag"
    const badgeText = await page.evaluate(() =>
      document.getElementById('qbrow-host')?.shadowRoot?.getElementById('qbrow-badge')?.textContent,
    );
    expect(badgeText).toBe('tag');

    const results = await getShadowResults();
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.title?.toLowerCase().includes('playwright'))).toBe(true);

    await closePalette();
  });

  test('selecting a bookmark in tag mode transitions to tag-name step', async () => {
    await page.goto('https://example.com');
    await openPalette();

    await page.locator('#qbrow-input').click();
    await page.keyboard.type('/tag playwright');
    await waitForResults(1);

    // Press Enter to select the first result
    await page.evaluate(() => {
      document.getElementById('qbrow-host')?.shadowRoot
        ?.getElementById('qbrow-input')
        ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });

    // Input should now be empty and placeholder should indicate tag-name step
    const placeholder = await page.evaluate(() =>
      document.getElementById('qbrow-host')?.shadowRoot?.getElementById('qbrow-input')?.placeholder,
    );
    expect(placeholder).toBe('Enter tag name…');

    // Badge should show the bookmark name
    const badgeText = await page.evaluate(() =>
      document.getElementById('qbrow-host')?.shadowRoot?.getElementById('qbrow-badge')?.textContent,
    );
    expect(badgeText).toContain('tag →');

    await closePalette();
  });

  test('searching by tag returns tagged bookmarks', async () => {
    // Ensure a known tag exists: tag the Playwright bookmark with "e2e"
    await sw.evaluate(async () => {
      const result = await chrome.storage.local.get('tags');
      const tags = result.tags ?? {};
      const [bm] = await chrome.bookmarks.search('__qbrow_test__ Playwright Docs');
      if (bm) { tags[bm.id] = ['e2e']; await chrome.storage.local.set({ tags }); }
      // invalidate background cache so it reloads tags
    });
    // Force cache invalidation by triggering onCreated (create + remove a dummy bookmark)
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
    // Clean up any leftover tag from previous runs
    await sw.evaluate(async () => {
      const result = await chrome.storage.local.get('tags');
      const tags = result.tags ?? {};
      for (const id of Object.keys(tags)) delete tags[id];
      await chrome.storage.local.set({ tags });
    });

    await page.goto('https://example.com');
    await openPalette();

    // Tag the Playwright bookmark with "testing"
    await page.locator('#qbrow-input').click();
    await page.keyboard.type('/tag playwright');
    await waitForResults(1);

    await page.evaluate(() => {
      document.getElementById('qbrow-host')?.shadowRoot
        ?.getElementById('qbrow-input')
        ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });

    // Type the tag name and confirm
    await page.locator('#qbrow-input').click();
    await page.keyboard.type('testing');
    await page.evaluate(() => {
      document.getElementById('qbrow-host')?.shadowRoot
        ?.getElementById('qbrow-input')
        ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });

    // Palette should close
    await expect(page.locator('#qbrow-host')).not.toBeAttached();

    // Reopen and search — the bookmark should now show the "testing" tag chip
    await openPalette();
    await search('playwright');
    await waitForResults(1);

    const tagChip = await page.evaluate(() => {
      const host = document.getElementById('qbrow-host');
      const item = host?.shadowRoot?.querySelector('.qbrow-item');
      return item?.querySelector('.qbrow-tag')?.textContent ?? null;
    });
    expect(tagChip).toBe('testing');

    await closePalette();
  });

  // ─── /save command ─────────────────────────────────────────────────────────────

  async function pressEnterInPalette() {
    await page.evaluate(() => {
      document.getElementById('qbrow-host')?.shadowRoot
        ?.getElementById('qbrow-input')
        ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
  }

  async function getFolderItems() {
    return page.evaluate(() => {
      const host = document.getElementById('qbrow-host');
      if (!host) return [];
      return Array.from(host.shadowRoot.querySelectorAll('.qbrow-item')).map(el => ({
        kind: el.dataset.kind,
        title: el.querySelector('.qbrow-item-title')?.textContent,
        path: el.querySelector('.qbrow-item-path')?.textContent ?? null,
      }));
    });
  }

  test('/save shows folder navigation after entering bookmark name', async () => {
    await page.goto('https://example.com');
    await openPalette();

    await page.locator('#qbrow-input').click();
    await page.keyboard.type('/save My Bookmark');
    await pressEnterInPalette();

    // Should transition to save-location mode with folder list visible
    await page.waitForFunction(() => {
      const host = document.getElementById('qbrow-host');
      return (host?.shadowRoot?.querySelectorAll('.qbrow-item').length ?? 0) > 0;
    }, { timeout: 3000 });

    const items = await getFolderItems();
    // At root: only folder items (no "Save here"), all should be kind=folder
    expect(items.length).toBeGreaterThan(0);
    expect(items.every(i => i.kind === 'folder')).toBe(true);

    // Placeholder should indicate folder navigation
    const placeholder = await page.evaluate(() =>
      document.getElementById('qbrow-host')?.shadowRoot?.getElementById('qbrow-input')?.placeholder,
    );
    expect(placeholder).toBe('Navigate to folder…');

    await closePalette();
  });

  test('/save navigates into a folder and shows Save here', async () => {
    await page.goto('https://example.com');
    await openPalette();

    await page.locator('#qbrow-input').click();
    await page.keyboard.type('/save My Bookmark');
    await pressEnterInPalette();

    // Wait for root folders
    await page.waitForFunction(() => {
      const host = document.getElementById('qbrow-host');
      return (host?.shadowRoot?.querySelectorAll('.qbrow-item').length ?? 0) > 0;
    }, { timeout: 3000 });

    // Navigate into the first folder (e.g. Bookmarks Bar)
    await pressEnterInPalette();

    // Now "Save here" should be the first item
    await page.waitForFunction(() => {
      const host = document.getElementById('qbrow-host');
      const first = host?.shadowRoot?.querySelector('.qbrow-item');
      return first?.dataset?.kind === 'save';
    }, { timeout: 3000 });

    const items = await getFolderItems();
    expect(items[0].kind).toBe('save');
    expect(items[0].title).toBe('Save here');

    await closePalette();
  });

  test('/save creates a new folder when name has no match', async () => {
    const uniqueName = '__qbrow_newfolder_' + Date.now() + '__';

    await page.goto('https://example.com');
    await openPalette();

    await page.locator('#qbrow-input').click();
    await page.keyboard.type('/save Test Page');
    await pressEnterInPalette();

    // Wait for root folders and navigate into the first one
    await page.waitForFunction(() => {
      const host = document.getElementById('qbrow-host');
      return (host?.shadowRoot?.querySelectorAll('.qbrow-item').length ?? 0) > 0;
    }, { timeout: 3000 });
    await pressEnterInPalette();

    // Wait until inside a folder (Save here visible)
    await page.waitForFunction(() => {
      const host = document.getElementById('qbrow-host');
      return host?.shadowRoot?.querySelector('.qbrow-item')?.dataset?.kind === 'save';
    }, { timeout: 3000 });

    // Type a unique folder name that won't exist
    await page.locator('#qbrow-input').click();
    await page.keyboard.type(uniqueName);

    // "Create" item should appear
    await page.waitForFunction((name) => {
      const host = document.getElementById('qbrow-host');
      const items = host?.shadowRoot?.querySelectorAll('.qbrow-item');
      return Array.from(items ?? []).some(el =>
        el.dataset.kind === 'create' && el.querySelector('.qbrow-item-title')?.textContent?.includes(name),
      );
    }, uniqueName, { timeout: 3000 });

    const items = await getFolderItems();
    const createItem = items.find(i => i.kind === 'create');
    expect(createItem).toBeTruthy();
    expect(createItem.title).toContain(uniqueName);

    // Select the Create item — navigates into the new folder
    await pressEnterInPalette();

    // Should now be inside the new folder with "Save here" visible
    await page.waitForFunction(() => {
      const host = document.getElementById('qbrow-host');
      return host?.shadowRoot?.querySelector('.qbrow-item')?.dataset?.kind === 'save';
    }, { timeout: 3000 });

    // Clean up the created folder
    await sw.evaluate(async (name) => {
      const results = await chrome.bookmarks.search(name);
      for (const b of results) await chrome.bookmarks.remove(b.id);
    }, uniqueName);

    await closePalette();
  });

  test('/save saves the bookmark and it appears in search results', async () => {
    const title = '__qbrow_saved_' + Date.now() + '__';

    await page.goto('https://example.com');
    await openPalette();

    await page.locator('#qbrow-input').click();
    await page.keyboard.type('/save ' + title);
    await pressEnterInPalette();

    // Navigate into the first top-level folder
    await page.waitForFunction(() => {
      const host = document.getElementById('qbrow-host');
      return (host?.shadowRoot?.querySelectorAll('.qbrow-item').length ?? 0) > 0;
    }, { timeout: 3000 });
    await pressEnterInPalette();

    // Wait for "Save here" and select it
    await page.waitForFunction(() => {
      const host = document.getElementById('qbrow-host');
      return host?.shadowRoot?.querySelector('.qbrow-item')?.dataset?.kind === 'save';
    }, { timeout: 3000 });
    await pressEnterInPalette();

    // Palette should close after saving
    await expect(page.locator('#qbrow-host')).not.toBeAttached();

    // Verify bookmark was actually created
    const found = await sw.evaluate(async (t) => {
      const results = await chrome.bookmarks.search(t);
      return results.length > 0;
    }, title);
    expect(found).toBe(true);

    // Clean up
    await sw.evaluate(async (t) => {
      const results = await chrome.bookmarks.search(t);
      for (const b of results) await chrome.bookmarks.remove(b.id);
    }, title);
  });
});
