# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.1.0] - 2026-03-29

### Added

- Command palette overlay triggered by `Ctrl+Shift+E` (`Cmd+Shift+E` on Mac)
- Bookmark search — case-insensitive substring match on title, URL, and tags
- `/save <name>` command — save the current page as a bookmark by navigating the folder tree; typing filters subfolders, `Escape` steps back up, non-existing folders are created on the fly
- `/tag <query>` command — search bookmarks and assign a custom text tag
- Tag-based search — bookmarks surface when searching by their tag labels
- Tag chips displayed on result rows
- Arrow key navigation with first result auto-selected
- `Enter` to open the active bookmark in the current tab
- `Escape` to close the palette (or step back through multi-step commands)
- Click a result to open it; click the backdrop to close
- Shadow DOM isolation — palette styles never conflict with host pages
- In-memory bookmark cache invalidated on any Chrome bookmark change event
- Tags and saved bookmarks persisted via `chrome.storage.local` and `chrome.bookmarks`
- Vitest unit tests for `flattenBookmarkTree` and `filterBookmarks`
- Playwright E2E tests covering the full extension flow
