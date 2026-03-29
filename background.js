// Inline from filter.js — importScripts is unreliable in MV3 service workers
function flattenBookmarkTree(nodes) {
  const result = [];
  for (const node of nodes) {
    if (node.url) {
      result.push({ id: node.id, title: node.title || '', url: node.url });
    }
    if (node.children) {
      result.push(...flattenBookmarkTree(node.children));
    }
  }
  return result;
}

function filterBookmarks(bookmarks, query) {
  if (!query || !query.trim()) return [];
  const q = query.trim().toLowerCase();
  const results = [];
  for (const bookmark of bookmarks) {
    if (
      bookmark.title.toLowerCase().includes(q) ||
      bookmark.url.toLowerCase().includes(q) ||
      bookmark.tags?.some((t) => t.toLowerCase().includes(q))
    ) {
      results.push(bookmark);
      if (results.length === 10) break;
    }
  }
  return results;
}

let cachedBookmarks = null;

async function getBookmarks() {
  if (!cachedBookmarks) {
    const tree = await chrome.bookmarks.getTree();
    const flat = flattenBookmarkTree(tree);
    const result = await chrome.storage.local.get('tags');
    const tags = result.tags ?? {};
    cachedBookmarks = flat.map((b) => ({ ...b, tags: tags[b.id] ?? [] }));
  }
  return cachedBookmarks;
}

// Invalidate cache when bookmarks change
chrome.bookmarks.onCreated.addListener(() => { cachedBookmarks = null; });
chrome.bookmarks.onRemoved.addListener(() => { cachedBookmarks = null; });
chrome.bookmarks.onChanged.addListener(() => { cachedBookmarks = null; });
chrome.bookmarks.onMoved.addListener(() => { cachedBookmarks = null; });

// Returns true for URLs where content scripts can never be injected
// (chrome://, brave://, about:, extension pages, etc.)
// Regular https:// pages where injection happens to be blocked (e.g. Web Store)
// are NOT privileged — we simply can't open the palette there.
function isPrivilegedUrl(url) {
  if (!url) return false;
  try {
    return !['http:', 'https:', 'file:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

// Toggle palette via keyboard shortcut
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-palette') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  // 1. Happy path — content script already running
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE' });
    return;
  } catch { /* not injected yet */ }

  // 2. Regular page that loaded before the extension — inject on demand
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE' });
    return;
  } catch { /* privileged URL (new tab, chrome://, etc.) */ }

  // 3. Injection was blocked.
  //    - Privileged schemes (chrome://, brave://, about:): navigate the current tab to the
  //      landing page — there is nothing useful on that tab to preserve.
  //    - Regular https:// pages where injection is blocked (e.g. Chrome Web Store): open a
  //      new tab so the original page is not replaced.
  const landingUrl = chrome.runtime.getURL('palette.html')
    + `?mode=landing&pageUrl=${encodeURIComponent(tab.url ?? '')}`;
  if (isPrivilegedUrl(tab.url)) {
    chrome.tabs.update(tab.id, { url: landingUrl });
  } else {
    chrome.tabs.create({ url: landingUrl });
  }
});

// Handle messages from content script
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // ── E2E test helpers ──────────────────────────────────────────────────────
  // These handlers are only called from the Playwright test suite.
  // Using explicit message types instead of eval avoids the extension CSP
  // 'unsafe-eval' restriction while keeping all logic in the SW context.

  if (message.type === 'TEST_SEED_BOOKMARKS') {
    (async () => {
      const existing = await chrome.bookmarks.search('__qbrow_test__');
      for (const b of existing) await chrome.bookmarks.remove(b.id);
      await chrome.bookmarks.create({ title: '__qbrow_test__ Playwright Docs', url: 'https://playwright.dev' });
      await chrome.bookmarks.create({ title: '__qbrow_test__ Vitest Docs',     url: 'https://vitest.dev'     });
      await chrome.bookmarks.create({ title: '__qbrow_test__ MDN',             url: 'https://developer.mozilla.org' });
      cachedBookmarks = null;
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (message.type === 'TEST_CLEAN_BOOKMARKS') {
    (async () => {
      const existing = await chrome.bookmarks.search('__qbrow_test__');
      for (const b of existing) await chrome.bookmarks.remove(b.id);
      cachedBookmarks = null;
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (message.type === 'TEST_COUNT_BOOKMARKS') {
    (async () => {
      const all = await chrome.bookmarks.search('__qbrow_test__');
      sendResponse({ count: all.length });
    })();
    return true;
  }

  if (message.type === 'TEST_CLEAR_TAGS') {
    (async () => {
      const result = await chrome.storage.local.get('tags');
      const tags = result.tags ?? {};
      for (const id of Object.keys(tags)) delete tags[id];
      await chrome.storage.local.set({ tags });
      cachedBookmarks = null;
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (message.type === 'TEST_SET_TAG') {
    // Sets message.tagName on the Playwright Docs test bookmark and busts the cache.
    (async () => {
      const result = await chrome.storage.local.get('tags');
      const tags = result.tags ?? {};
      const [bm] = await chrome.bookmarks.search('__qbrow_test__ Playwright Docs');
      if (bm) { tags[bm.id] = [message.tagName]; await chrome.storage.local.set({ tags }); }
      const bust = await chrome.bookmarks.create({ title: '__qbrow_cache_bust__', url: 'https://example.com' });
      await chrome.bookmarks.remove(bust.id);
      cachedBookmarks = null;
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (message.type === 'TEST_HAS_TAG') {
    // Returns { has: bool } — whether the Playwright Docs bookmark has message.tagName.
    (async () => {
      const result = await chrome.storage.local.get('tags');
      const tags = result.tags ?? {};
      const [bm] = await chrome.bookmarks.search('__qbrow_test__ Playwright Docs');
      const has = (tags[bm?.id] ?? []).includes(message.tagName);
      sendResponse({ has });
    })();
    return true;
  }

  if (message.type === 'TEST_CREATE_SCROLL_BOOKMARKS') {
    // message.prefix — title prefix; creates 10 numbered bookmarks, returns their IDs.
    (async () => {
      const ids = [];
      for (let i = 1; i <= 10; i++) {
        const b = await chrome.bookmarks.create({
          title: `${message.prefix} item ${String(i).padStart(2, '0')}`,
          url:   `https://example.com/scroll/${i}`,
        });
        ids.push(b.id);
      }
      cachedBookmarks = null;
      sendResponse({ ids });
    })();
    return true;
  }

  if (message.type === 'TEST_REMOVE_BOOKMARKS') {
    // message.ids — array of bookmark IDs to remove.
    (async () => {
      for (const id of message.ids) await chrome.bookmarks.remove(id).catch(() => {});
      cachedBookmarks = null;
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (message.type === 'TEST_CLASSIFY_URLS') {
    sendResponse({
      chromeNewtab: isPrivilegedUrl('chrome://newtab/'),
      braveNewtab:  isPrivilegedUrl('brave://newtab/'),
      aboutBlank:   isPrivilegedUrl('about:blank'),
      extPage:      isPrivilegedUrl('chrome-extension://abc/page.html'),
      webstore:     isPrivilegedUrl('https://chrome.google.com/webstore/devconsole/'),
      example:      isPrivilegedUrl('https://example.com'),
      httpPage:     isPrivilegedUrl('http://localhost:3000'),
    });
  }

  if (message.type === 'TEST_SEARCH_REMOVE') {
    // message.query — search string; removes all matches, returns { found }.
    (async () => {
      const results = await chrome.bookmarks.search(message.query);
      for (const b of results) await chrome.bookmarks.remove(b.id);
      cachedBookmarks = null;
      sendResponse({ found: results.length > 0 });
    })();
    return true;
  }

  if (message.type === 'TEST_TOGGLE_PALETTE') {
    // Sends TOGGLE to the active tab (mirrors the keyboard-shortcut handler).
    (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE' }).catch(() => {});
      sendResponse({ ok: true });
    })();
    return true;
  }
  // ── end E2E test helpers ───────────────────────────────────────────────────

  if (message.type === 'SEARCH') {
    getBookmarks().then((bookmarks) => {
      sendResponse({ results: filterBookmarks(bookmarks, message.query) });
    });
    return true;
  }

  if (message.type === 'GET_FOLDERS') {
    (async () => {
      if (message.parentId) {
        const children = await chrome.bookmarks.getChildren(message.parentId);
        sendResponse({ folders: children.filter(n => !n.url).map(f => ({ id: f.id, title: f.title })) });
      } else {
        const tree = await chrome.bookmarks.getTree();
        const topLevel = tree[0].children
          .filter(n => !n.url)
          .map(f => ({ id: f.id, title: f.title }));
        sendResponse({ folders: topLevel });
      }
    })();
    return true;
  }

  if (message.type === 'CREATE_FOLDER') {
    (async () => {
      const folder = await chrome.bookmarks.create({ parentId: message.parentId, title: message.title });
      sendResponse({ id: folder.id, title: folder.title });
    })();
    return true;
  }

  if (message.type === 'OPEN') {
    chrome.tabs.update({ url: message.url }).catch(() => {});
  }

  if (message.type === 'OPEN_SETTINGS') {
    chrome.tabs.create({ url: chrome.runtime.getURL('settings.html') });
  }


  if (message.type === 'SAVE_BOOKMARK') {
    (async () => {
      await chrome.bookmarks.create({ parentId: message.parentId, title: message.title, url: message.url });
      cachedBookmarks = null;
    })();
  }

  if (message.type === 'TAG') {
    (async () => {
      const result = await chrome.storage.local.get('tags');
      const tags = result.tags ?? {};
      const bookmarkTags = tags[message.bookmarkId] ?? [];
      if (!bookmarkTags.includes(message.tag)) {
        bookmarkTags.push(message.tag);
        tags[message.bookmarkId] = bookmarkTags;
        await chrome.storage.local.set({ tags });
      }
      cachedBookmarks = null;
    })();
  }

  if (message.type === 'REMOVE_TAG') {
    (async () => {
      const result = await chrome.storage.local.get('tags');
      const tags = result.tags ?? {};
      const bookmarkTags = tags[message.bookmarkId] ?? [];
      const idx = bookmarkTags.indexOf(message.tag);
      if (idx !== -1) {
        bookmarkTags.splice(idx, 1);
        if (bookmarkTags.length === 0) {
          delete tags[message.bookmarkId];
        } else {
          tags[message.bookmarkId] = bookmarkTags;
        }
        await chrome.storage.local.set({ tags });
      }
      cachedBookmarks = null;
    })();
  }
});
