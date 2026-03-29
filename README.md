# qbrow

> Quickly browse through your bookmarks.

A keyboard-driven command palette for your browser. Search bookmarks instantly, tag them for quick recall, and navigate without touching the mouse.

Built as a plain-JavaScript Manifest V3 extension — no framework, no build step.

**Works in:** Chrome, Brave, and any Chromium-based browser. Firefox support via the MV3 compatibility layer (Firefox 109+).

---

## Features

- **Instant bookmark search** — fuzzy substring match on title, URL, and tags
- **Tag bookmarks** with `/tag` — assign custom labels and search by them later
- **Keyboard-first** — arrow keys to navigate, Enter to open, Escape to close
- **Shadow DOM isolation** — the palette never conflicts with the host page's styles
- **Zero dependencies** — plain JS, no build step required

---

## Installation

### Chrome / Brave (unpacked)

1. Clone or download this repository
2. Open `chrome://extensions`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select the repo folder
5. Press `Ctrl+Shift+E` (`Cmd+Shift+E` on Mac) on any page to open the palette

### Firefox

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on**
3. Select `manifest.json` from the repo folder

> Firefox requires reloading the temporary add-on after each browser restart. For persistent installs, package the extension with `npx web-ext build` and install the resulting `.zip`.

---

## Usage

| Action           | How                            |
| ---------------- | ------------------------------ |
| Open palette     | `Ctrl+Shift+E` / `Cmd+Shift+E` |
| Search bookmarks | Type anything                  |
| Navigate results | `↑` / `↓` arrow keys           |
| Open selection   | `Enter` or click               |
| Close palette    | `Esc` or click outside         |

### `/tag` command

Tag a bookmark so it surfaces when you search by that label:

1. Type `/tag <search>` — results show bookmarks matching your search
2. Select a bookmark with `Enter` or click
3. Type the tag name (e.g. `tcg`, `work`, `reference`) and press `Enter`

The bookmark will now appear in results whenever you search for that tag. Tags are shown as chips on each result row.

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
├── content.js           # Injected into every page — palette UI and commands
├── content.css          # Palette styles (loaded into the shadow root)
├── filter.js            # Pure filter functions — shared with unit tests
└── tests/
    ├── unit/            # Vitest — filter logic
    └── e2e/             # Playwright — full extension flow
```

### Making changes

- **background.js** and **filter.js** share the same `flattenBookmarkTree` / `filterBookmarks` logic. If you change the filter behaviour, update both files.
- The palette is a Shadow DOM tree attached to `document.body` — all styles live in `content.css` inside the shadow root, so host-page CSS never leaks in.
- The service worker caches the flat bookmark list in memory and invalidates it on any bookmark change event.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## License

[MIT](LICENSE)
