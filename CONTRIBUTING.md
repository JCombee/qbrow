# Contributing to qbrow

Thanks for your interest in contributing! Here's everything you need to get started.

---

## Development setup

```bash
git clone https://github.com/your-username/qbrow.git
cd qbrow
npm install
npx playwright install chromium
```

Load the extension in Chrome / Brave:

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**, select the repo folder
4. After any change to `background.js`, `content.js`, or `manifest.json`, click the reload icon on the extension card

---

## Running tests

```bash
npm run test:unit   # fast, no browser required
npm run test:e2e    # launches a real Chromium window
npm test            # both
```

E2E tests must run with a visible browser window — Chrome does not support loading extensions in headless mode.

---

## Project conventions

- **No build step.** All source files are loaded directly by the browser. Keep it that way.
- **No runtime dependencies.** Dev dependencies (Vitest, Playwright) are fine.
- **Plain JavaScript.** No TypeScript, no transpilation. JSDoc comments are welcome for complex functions.
- **filter.js and background.js stay in sync.** The filter functions are inlined in `background.js` for service worker reliability and also live in `filter.js` for unit testing. If you change filter behaviour, update both.
- **Tests for new features.** Add a unit test if the change is pure logic; add an E2E test if it touches the UI or extension APIs.

---

## Submitting a pull request

1. Fork the repo and create a branch from `main`
2. Make your changes and add/update tests
3. Run `npm test` and make sure everything passes
4. Open a pull request with a clear description of what changed and why

---

## Reporting bugs

Open an issue and include:
- Browser and version
- Steps to reproduce
- What you expected vs. what happened
