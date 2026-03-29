(() => {
  let host = null;
  let activeIndex = -1;
  let debounceTimer = null;
  let mode = 'normal'; // 'normal' | 'tag-search' | 'tag-name' | 'save-name' | 'save-location'
  let pendingTagBookmark = null; // { id, title, url } — set in tag-name step
  let saveState = null; // { bookmarkName, url, folderStack: [{id,title}], folders: [{id,title}] }

  function getItems() {
    return host?.shadowRoot?.querySelectorAll('.qbrow-item') ?? [];
  }

  function setActive(index) {
    const items = getItems();
    items.forEach((el, i) => el.classList.toggle('active', i === index));
    if (items[index]) items[index].scrollIntoView({ block: 'nearest' });
    activeIndex = index;
  }

  function openUrl(url) {
    chrome.runtime.sendMessage({ type: 'OPEN', url });
    close();
  }

  function getInput() {
    return host?.shadowRoot?.getElementById('qbrow-input');
  }

  function setBadge(text) {
    const badge = host?.shadowRoot?.getElementById('qbrow-badge');
    if (!badge) return;
    if (text) {
      badge.textContent = text;
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }
  }

  // ─── /tag command ─────────────────────────────────────────────────────────────

  function enterTagNameStep(bookmark) {
    pendingTagBookmark = bookmark;
    mode = 'tag-name';
    setBadge('tag → ' + (bookmark.title || bookmark.url).slice(0, 32));
    const input = getInput();
    if (input) {
      input.value = '';
      input.placeholder = 'Enter tag name…';
    }
    renderResults([]);
  }

  // ─── /save command ────────────────────────────────────────────────────────────

  function renderFolderItems(folders, query) {
    const list = host.shadowRoot.getElementById('qbrow-results');
    list.innerHTML = '';
    activeIndex = -1;

    const trimmed = query.trim();
    const q = trimmed.toLowerCase();
    const isRoot = saveState.folderStack.length === 0;

    // Filter subfolders; at root with no match fall back to showing all (so the
    // list is never empty just because the user typed the wrong thing)
    let filtered = trimmed ? folders.filter(f => f.title.toLowerCase().includes(q)) : folders;
    if (isRoot && filtered.length === 0) filtered = folders;

    const items = [];
    if (!isRoot) items.push({ kind: 'save' });
    filtered.forEach(f => items.push({ kind: 'folder', id: f.id, title: f.title }));
    // Show "Create" only inside a real folder when typing yields no match
    if (!isRoot && trimmed && filtered.length === 0) {
      items.push({ kind: 'create', title: trimmed });
    }

    for (const item of items) {
      const li = document.createElement('li');
      li.className = 'qbrow-item';
      li.dataset.kind = item.kind;

      if (item.kind === 'save') {
        li.classList.add('qbrow-save-item');
        const pathStr = saveState.folderStack.map(f => f.title).join(' / ');
        const label = document.createElement('span');
        label.className = 'qbrow-item-title';
        label.textContent = 'Save here';
        const sub = document.createElement('span');
        sub.className = 'qbrow-item-path';
        sub.textContent = pathStr;
        li.appendChild(label);
        li.appendChild(sub);
      } else if (item.kind === 'folder') {
        li.classList.add('qbrow-folder-item');
        li.dataset.folderId = item.id;
        li.dataset.folderTitle = item.title;
        const label = document.createElement('span');
        label.className = 'qbrow-item-title';
        label.textContent = item.title;
        li.appendChild(label);
      } else if (item.kind === 'create') {
        li.classList.add('qbrow-create-item');
        li.dataset.folderTitle = item.title;
        const label = document.createElement('span');
        label.className = 'qbrow-item-title';
        label.textContent = `Create "${item.title}"`;
        const sub = document.createElement('span');
        sub.className = 'qbrow-item-path';
        sub.textContent = 'New folder in ' + saveState.folderStack[saveState.folderStack.length - 1].title;
        li.appendChild(label);
        li.appendChild(sub);
      }

      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        activateFolderItem(li);
      });

      li.addEventListener('mousemove', () => {
        setActive(Array.from(getItems()).indexOf(li));
      });

      list.appendChild(li);
    }

    const total = list.querySelectorAll('.qbrow-item').length;
    if (total > 0) setActive(trimmed && total > 1 ? 1 : 0);
  }

  function activateFolderItem(el) {
    const kind = el.dataset.kind;
    if (kind === 'save') {
      const parentId = saveState.folderStack[saveState.folderStack.length - 1].id;
      chrome.runtime.sendMessage({
        type: 'SAVE_BOOKMARK',
        parentId,
        title: saveState.bookmarkName,
        url: saveState.url,
      });
      close();
    } else if (kind === 'folder') {
      navigateIntoFolder({ id: el.dataset.folderId, title: el.dataset.folderTitle });
    } else if (kind === 'create') {
      const parentId = saveState.folderStack[saveState.folderStack.length - 1].id;
      chrome.runtime.sendMessage(
        { type: 'CREATE_FOLDER', parentId, title: el.dataset.folderTitle },
        (response) => {
          if (response?.id) navigateIntoFolder({ id: response.id, title: el.dataset.folderTitle });
        },
      );
    }
  }

  function navigateIntoFolder(folder) {
    saveState.folderStack.push(folder);
    chrome.runtime.sendMessage({ type: 'GET_FOLDERS', parentId: folder.id }, (response) => {
      saveState.folders = response?.folders ?? [];
      const input = getInput();
      if (input) input.value = '';
      renderFolderItems(saveState.folders, '');
    });
  }

  function enterSaveLocation() {
    mode = 'save-location';
    chrome.runtime.sendMessage({ type: 'GET_FOLDERS', parentId: null }, (response) => {
      saveState.folders = response?.folders ?? [];
      const input = getInput();
      if (input) {
        input.value = '';
        input.placeholder = 'Navigate to folder…';
      }
      renderFolderItems(saveState.folders, '');
    });
  }

  // ─── Bookmark results ─────────────────────────────────────────────────────────

  function renderResults(results) {
    const list = host.shadowRoot.getElementById('qbrow-results');
    list.innerHTML = '';
    activeIndex = -1;

    for (const bookmark of results) {
      const li = document.createElement('li');
      li.className = 'qbrow-item';
      li.dataset.url = bookmark.url;
      li.dataset.bookmarkId = bookmark.id;

      const title = document.createElement('span');
      title.className = 'qbrow-item-title';
      title.textContent = bookmark.title || bookmark.url;

      const url = document.createElement('span');
      url.className = 'qbrow-item-url';
      url.textContent = bookmark.url;

      li.appendChild(title);
      li.appendChild(url);

      if (bookmark.tags?.length) {
        const tagRow = document.createElement('div');
        tagRow.className = 'qbrow-item-tags';
        for (const tag of bookmark.tags) {
          const chip = document.createElement('span');
          chip.className = 'qbrow-tag';
          chip.textContent = tag;
          tagRow.appendChild(chip);
        }
        li.appendChild(tagRow);
      }

      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        if (mode === 'tag-search') {
          enterTagNameStep({ id: bookmark.id, title: bookmark.title, url: bookmark.url });
        } else {
          openUrl(bookmark.url);
        }
      });

      li.addEventListener('mousemove', () => {
        const items = getItems();
        const i = Array.from(items).indexOf(li);
        setActive(i);
      });

      list.appendChild(li);
    }

    if (results.length) setActive(0);
  }

  function search(query) {
    chrome.runtime.sendMessage({ type: 'SEARCH', query }, (response) => {
      if (response?.results) renderResults(response.results);
    });
  }

  // ─── Input handlers ───────────────────────────────────────────────────────────

  function onInput(e) {
    if (mode === 'tag-name') return;

    const val = e.target.value;

    if (mode === 'save-location') {
      renderFolderItems(saveState.folders, val);
      return;
    }

    const tagMatch = val.match(/^\/tag (.*)$/);
    if (tagMatch) {
      mode = 'tag-search';
      setBadge('tag');
      const query = tagMatch[1];
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => search(query), 100);
      return;
    }

    const saveMatch = val.match(/^\/save (.*)$/);
    if (saveMatch) {
      if (mode !== 'save-name') {
        mode = 'save-name';
        setBadge('save');
        saveState = { bookmarkName: saveMatch[1], url: window.location.href, folderStack: [], folders: [] };
      } else {
        saveState.bookmarkName = saveMatch[1];
      }
      renderResults([]);
      return;
    }

    mode = 'normal';
    saveState = null;
    setBadge(null);
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => search(val), 100);
  }

  function onKeydown(e) {
    const items = getItems();

    if (e.key === 'Escape') {
      e.stopPropagation();
      if (mode === 'tag-name') {
        mode = 'tag-search';
        pendingTagBookmark = null;
        setBadge('tag');
        const input = getInput();
        if (input) {
          input.value = '/tag ';
          input.placeholder = 'Search bookmarks…';
          renderResults([]);
        }
      } else if (mode === 'save-location') {
        if (saveState.folderStack.length > 0) {
          // Step up one folder
          saveState.folderStack.pop();
          const parentId = saveState.folderStack.length > 0
            ? saveState.folderStack[saveState.folderStack.length - 1].id
            : null;
          chrome.runtime.sendMessage({ type: 'GET_FOLDERS', parentId }, (response) => {
            saveState.folders = response?.folders ?? [];
            const input = getInput();
            if (input) input.value = '';
            renderFolderItems(saveState.folders, '');
          });
        } else {
          // Back to save-name step
          mode = 'save-name';
          const input = getInput();
          if (input) {
            input.value = '/save ' + saveState.bookmarkName;
            input.placeholder = 'Search bookmarks…';
          }
          setBadge('save');
          renderResults([]);
        }
      } else {
        close();
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(Math.min(activeIndex + 1, items.length - 1));
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(Math.max(activeIndex - 1, 0));
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();

      if (mode === 'save-name') {
        if (saveState?.bookmarkName?.trim()) enterSaveLocation();
        return;
      }

      if (mode === 'save-location') {
        const active = items[activeIndex] ?? items[0];
        if (active) activateFolderItem(active);
        return;
      }

      if (mode === 'tag-name') {
        const tagName = e.target.value.trim();
        if (tagName && pendingTagBookmark) {
          chrome.runtime.sendMessage({ type: 'TAG', bookmarkId: pendingTagBookmark.id, tag: tagName });
          close();
        }
        return;
      }

      const active = items[activeIndex] ?? items[0];
      if (!active) return;
      if (mode === 'tag-search') {
        enterTagNameStep({
          id: active.dataset.bookmarkId,
          title: active.querySelector('.qbrow-item-title')?.textContent,
          url: active.dataset.url,
        });
      } else {
        if (active.dataset.url) openUrl(active.dataset.url);
      }
    }
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────────

  function close() {
    if (host) {
      host.remove();
      host = null;
      activeIndex = -1;
      mode = 'normal';
      pendingTagBookmark = null;
      saveState = null;
    }
  }

  function open() {
    if (host) return;

    host = document.createElement('div');
    host.id = 'qbrow-host';
    const shadow = host.attachShadow({ mode: 'open' });

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL('content.css');
    shadow.appendChild(link);

    const overlay = document.createElement('div');
    overlay.id = 'qbrow-overlay';

    const palette = document.createElement('div');
    palette.id = 'qbrow-palette';

    const inputRow = document.createElement('div');
    inputRow.id = 'qbrow-input-row';

    const badge = document.createElement('span');
    badge.id = 'qbrow-badge';
    badge.hidden = true;

    const input = document.createElement('input');
    input.id = 'qbrow-input';
    input.type = 'text';
    input.placeholder = 'Search bookmarks…';
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('spellcheck', 'false');
    input.addEventListener('input', onInput);
    input.addEventListener('keydown', onKeydown);

    inputRow.appendChild(badge);
    inputRow.appendChild(input);

    const results = document.createElement('ul');
    results.id = 'qbrow-results';
    results.setAttribute('role', 'listbox');

    palette.appendChild(inputRow);
    palette.appendChild(results);
    overlay.appendChild(palette);

    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) close();
    });

    shadow.appendChild(overlay);
    document.body.appendChild(host);

    requestAnimationFrame(() => input.focus());
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'TOGGLE') {
      host ? close() : open();
    }
  });
})();
