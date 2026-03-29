<div align="center">
  <img src="icons/icon128.png" width="80" alt="qbrow">
  <h1>qbrow</h1>
  <p>Quickly browse through your bookmarks.</p>
</div>

A keyboard-driven command palette for your browser. Search bookmarks instantly, tag them for quick recall, and navigate without touching the mouse.

Built as a plain-JavaScript Manifest V3 extension — no framework, no build step.

**Works in:** Chrome, Brave, and any Chromium-based browser. Firefox support via the MV3 compatibility layer (Firefox 109+).

---

## Features

- **Instant bookmark search** — substring match on title, URL, and tags
- **Save the current page** with `/save` — navigate your folder tree and save in one flow
- **Tag bookmarks** with `/tag add` — assign custom labels and search by them later
- **Remove tags** with `/tag remove` — pick the bookmark, then the tag to remove
- **Settings page** via `/settings` — view and change the keyboard shortcut
- **Keyboard-first** — arrow keys to navigate, Enter to open, Escape to close
- **iframe isolation** — the palette never conflicts with the host page's styles or focus handling
- **Zero dependencies** — plain JS, no build step required

---

## Installation

### Chrome / Brave (unpacked)

1. Clone or download this repository
2. Open `chrome://extensions`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select the repo folder
5. Press `Ctrl+Shift+F` (`Cmd+Shift+F` on Mac) on any page to open the palette

### Firefox

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on**
3. Select `manifest.json` from the repo folder

> Firefox requires reloading the temporary add-on after each browser restart. For persistent installs, package the extension with `npx web-ext build` and install the resulting `.zip`.

---

## Usage

| Action           | How                            |
| ---------------- | ------------------------------ |
| Open palette     | `Ctrl+Shift+F` / `Cmd+Shift+F` |
| Search bookmarks | Type anything                  |
| Navigate results | `↑` / `↓` arrow keys           |
| Open selection   | `Enter` or click               |
| Close palette    | `Esc` or click outside         |

### `/save` command

Save the current page as a bookmark and choose exactly where it goes:

1. Type `/save <name>` and press `Enter`
2. Navigate your bookmark folder tree — type to filter, `Enter` to step into a folder
3. Select **Save here** to save at the current location

If a folder doesn't exist yet, type its name and select **Create "Name"** — the folder is created and you step into it automatically. `Escape` steps back up the tree one level at a time.

### `/tag add` command

Tag a bookmark so it surfaces when you search by that label:

1. Type `/tag add <search>` — results show bookmarks matching your search
2. Select a bookmark with `Enter` or click
3. Type the tag name (e.g. `tcg`, `work`, `reference`) and press `Enter`

Tags are shown as chips on each result row.

### `/tag remove` command

Remove a tag from a bookmark:

1. Type `/tag remove <search>` — results show bookmarks matching your search
2. Select a bookmark with `Enter` or click
3. Select the tag to remove from the list

### `/settings` command

Opens the settings page in a new tab. From there you can view your current keyboard shortcut and navigate to your browser's shortcut management page to change it.

### New tab / privileged pages

On pages where the palette cannot be injected (new tab, `chrome://`, `brave://`, etc.), pressing the shortcut navigates the current tab to a standalone palette page. On `https://` pages where injection is blocked (e.g. the Chrome Web Store), a new tab is opened instead so the original page is preserved.

---

## Development

### Prerequisites

- Node.js 18+
- Chromium-based browser

### Setup

```bash
git clone https://github.com/jcombee/qbrow.git
cd qbrow
npm install
npx playwright install chromium
```

### Running tests

```bash
# Unit tests (pure filter logic, no browser)
npm run test:unit

# E2E tests (full extension in a real Chromium instance)
npm run test:e2e

# Both
npm test
```

E2E tests launch a visible Chromium window — this is required because extensions cannot be tested headlessly.

### Project structure

```
qbrow/
├── manifest.json        # MV3 manifest — permissions, shortcuts, content scripts
├── background.js        # Service worker — bookmarks API, message routing
├── content.js           # Injected into every page — manages the palette iframe lifecycle
├── palette.html         # Extension page loaded inside the palette iframe
├── palette.js           # All palette UI logic — search, commands, keyboard handling
├── content.css          # Palette styles (loaded by palette.html)
├── settings.html        # Settings page (opened via /settings command)
├── settings.js          # Settings page logic
├── settings.css         # Settings page styles
└── tests/
    ├── unit/            # Vitest — filter logic
    └── e2e/             # Playwright — full extension flow
```

### Architecture

The palette runs as a `chrome-extension://` iframe injected by `content.js` into the current page. This gives full CSS and focus isolation from the host page without any Shadow DOM workarounds.

`content.js` and `palette.js` communicate via `window.postMessage`:

| Message | Direction | Meaning |
|---|---|---|
| `QBROW_READY` | palette → content | iframe finished loading |
| `QBROW_INIT` | content → palette | sends the current page URL |
| `QBROW_CLOSE` | palette → content | user dismissed the palette |

The background service worker caches the flat bookmark list in memory and invalidates it on any bookmark change event. All bookmark reads and writes go through it via `chrome.runtime.sendMessage`.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## License

[MIT](LICENSE)
