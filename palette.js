(() => {
  let pageUrl = '';
  let mode = 'search'; // 'search' | 'tag-pick' | 'tag-name' | 'tag-remove-select' | 'save-location'
  let tagAction = 'add'; // 'add' | 'remove'
  let tagTarget = null; // { id, title, tags? }
  let saveName = '';
  let saveStack = []; // [{ id, title }]
  let debounceTimer = null;

  const COMMANDS = [
    { title: '/save',        desc: 'Save current page as a bookmark',  prefix: '/save '        },
    { title: '/tag add',     desc: 'Add a tag to a bookmark',          prefix: '/tag add '     },
    { title: '/tag remove',  desc: 'Remove a tag from a bookmark',     prefix: '/tag remove '  },
  ];

  const input = document.getElementById('qbrow-input');
  const resultsList = document.getElementById('qbrow-results');
  const badge = document.getElementById('qbrow-badge');
  const overlay = document.getElementById('qbrow-overlay');

  window.parent.postMessage({ type: 'QBROW_READY' }, '*');

  window.addEventListener('message', (e) => {
    if (e.data?.type === 'QBROW_INIT') {
      pageUrl = e.data.url ?? '';
    }
  });

  function close() {
    window.parent.postMessage({ type: 'QBROW_CLOSE' }, '*');
  }

  function setBadge(text) {
    if (text) {
      badge.textContent = text;
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }
  }

  function clearResults() {
    resultsList.innerHTML = '';
  }

  function getItems() {
    return [...resultsList.querySelectorAll('.qbrow-item')];
  }

  function getActiveIndex() {
    return getItems().findIndex((el) => el.classList.contains('active'));
  }

  function setActive(index) {
    getItems().forEach((el, i) => el.classList.toggle('active', i === index));
  }

  function renderItems(items) {
    clearResults();
    for (const item of items) {
      const li = document.createElement('li');
      li.className = 'qbrow-item';
      if (item.kind) li.dataset.kind = item.kind;
      if (item.url) li.dataset.url = item.url;
      if (item.id) li.dataset.id = item.id;
      if (item.folderName) li.dataset.name = item.folderName;
      if (item.prefix) li.dataset.prefix = item.prefix;

      if (item.kind === 'save') li.classList.add('qbrow-save-item');
      if (item.kind === 'folder') li.classList.add('qbrow-folder-item');
      if (item.kind === 'create') li.classList.add('qbrow-create-item');
      if (item.kind === 'command') li.classList.add('qbrow-command-item');

      const titleEl = document.createElement('span');
      titleEl.className = 'qbrow-item-title';
      titleEl.textContent = item.title;
      li.appendChild(titleEl);

      if (item.url) {
        const urlEl = document.createElement('span');
        urlEl.className = 'qbrow-item-url';
        urlEl.textContent = item.url;
        li.appendChild(urlEl);
      }

      if (item.path) {
        const pathEl = document.createElement('span');
        pathEl.className = 'qbrow-item-path';
        pathEl.textContent = item.path;
        li.appendChild(pathEl);
      }

      if (item.tags?.length) {
        const tagsDiv = document.createElement('div');
        tagsDiv.className = 'qbrow-item-tags';
        for (const tag of item.tags) {
          const chip = document.createElement('span');
          chip.className = 'qbrow-tag';
          chip.textContent = tag;
          tagsDiv.appendChild(chip);
        }
        li.appendChild(tagsDiv);
      }

      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        activateItem(li);
      });

      resultsList.appendChild(li);
    }

    if (resultsList.children.length > 0) {
      setActive(0);
    }
  }

  function activateItem(li) {
    const kind = li.dataset.kind;
    const url = li.dataset.url;
    const id = li.dataset.id;
    const folderName = li.dataset.name;
    const titleText = li.querySelector('.qbrow-item-title')?.textContent ?? '';

    if (kind === 'command') {
      const prefix = li.dataset.prefix;
      if (prefix) {
        input.value = prefix;
        input.dispatchEvent(new Event('input'));
        input.focus();
      }
      return;
    }

    if (mode === 'search') {
      if (url) {
        chrome.runtime.sendMessage({ type: 'OPEN', url });
        close();
      }
    } else if (mode === 'tag-pick') {
      if (tagAction === 'add') {
        tagTarget = { id, title: titleText };
        mode = 'tag-name';
        setBadge('tag → ' + titleText);
        input.value = '';
        input.placeholder = 'Enter tag name…';
        clearResults();
        input.focus();
      } else {
        const existingTags = [...li.querySelectorAll('.qbrow-tag')].map((el) => el.textContent);
        tagTarget = { id, title: titleText, tags: existingTags };
        mode = 'tag-remove-select';
        setBadge('untag → ' + titleText);
        input.value = '';
        input.placeholder = 'Select tag to remove…';
        renderItems(existingTags.map((t) => ({ kind: 'tag-option', title: t })));
        input.focus();
      }
    } else if (mode === 'tag-remove-select') {
      chrome.runtime.sendMessage({ type: 'REMOVE_TAG', bookmarkId: tagTarget.id, tag: titleText });
      close();
    } else if (mode === 'save-location') {
      if (kind === 'save') {
        const parentId = saveStack.length ? saveStack[saveStack.length - 1].id : null;
        chrome.runtime.sendMessage({ type: 'SAVE_BOOKMARK', parentId, title: saveName, url: pageUrl });
        close();
      } else if (kind === 'folder') {
        saveStack.push({ id, title: titleText });
        input.value = '';
        loadFolders(id, '');
      } else if (kind === 'create') {
        const name = folderName || titleText.replace(/^Create "(.+)"$/, '$1');
        const parentId = saveStack.length ? saveStack[saveStack.length - 1].id : null;
        chrome.runtime.sendMessage({ type: 'CREATE_FOLDER', parentId, title: name }, (response) => {
          if (response) {
            saveStack.push({ id: response.id, title: response.title });
            input.value = '';
            loadFolders(response.id, '');
          }
        });
      }
    }
  }

  function openActive() {
    const items = getItems();
    const idx = getActiveIndex();
    if (idx >= 0) activateItem(items[idx]);
  }

  function loadFolders(parentId, filter) {
    chrome.runtime.sendMessage({ type: 'GET_FOLDERS', parentId }, (response) => {
      const folders = response?.folders ?? [];
      const items = [];

      if (saveStack.length > 0) {
        items.push({ kind: 'save', title: 'Save here' });
      }

      const filtered = filter
        ? folders.filter((f) => f.title.toLowerCase().includes(filter.toLowerCase()))
        : folders;

      for (const f of filtered) {
        items.push({ kind: 'folder', id: f.id, title: f.title });
      }

      const exactMatch = folders.some((f) => f.title.toLowerCase() === filter.toLowerCase());
      if (filter && !exactMatch) {
        items.push({ kind: 'create', title: `Create "${filter}"`, folderName: filter });
      }

      renderItems(items);

      // When filtering inside a folder: keep "Save here" at idx 0 but auto-focus the second item
      if (saveStack.length > 0 && filter) {
        setActive(items.length > 1 ? 1 : 0);
      } else {
        setActive(0);
      }
    });
  }

  input.addEventListener('input', (e) => {
    const val = e.target.value;

    // ── Active tag flows (full sub-command prefix matched) ────────────────────
    if (val.startsWith('/tag add ')) {
      if (mode !== 'tag-pick' || tagAction !== 'add') {
        mode = 'tag-pick';
        tagAction = 'add';
        setBadge('tag: add');
        input.placeholder = 'Search bookmarks to tag…';
      }
      clearTimeout(debounceTimer);
      const q = val.slice(9);
      debounceTimer = setTimeout(() => {
        if (!q.trim()) { clearResults(); return; }
        chrome.runtime.sendMessage({ type: 'SEARCH', query: q }, (r) => renderItems(r?.results ?? []));
      }, 100);
      return;
    }

    if (val.startsWith('/tag remove ')) {
      if (mode !== 'tag-pick' || tagAction !== 'remove') {
        mode = 'tag-pick';
        tagAction = 'remove';
        setBadge('tag: remove');
        input.placeholder = 'Search bookmarks to untag…';
      }
      clearTimeout(debounceTimer);
      const q = val.slice(12);
      debounceTimer = setTimeout(() => {
        if (!q.trim()) { clearResults(); return; }
        chrome.runtime.sendMessage({ type: 'SEARCH', query: q }, (r) => renderItems(r?.results ?? []));
      }, 100);
      return;
    }

    // Exit tag-pick if full prefix no longer matches
    if (mode === 'tag-pick') {
      mode = 'search';
      tagAction = 'add';
      setBadge(null);
      input.placeholder = 'Search bookmarks…';
    }

    // These modes handle their own input (tag name entry, folder filter, tag selection)
    if (mode === 'tag-name' || mode === 'tag-remove-select') return;

    if (mode === 'save-location') {
      clearTimeout(debounceTimer);
      const captured = val;
      debounceTimer = setTimeout(() => {
        const parentId = saveStack.length ? saveStack[saveStack.length - 1].id : null;
        loadFolders(parentId, captured);
      }, 100);
      return;
    }

    // ── Command list + bookmark matches when input starts with / ─────────────
    if (val.startsWith('/')) {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const commandItems = COMMANDS
          .filter((c) => c.title.startsWith(val) || val.startsWith(c.title))
          .map((c) => ({ kind: 'command', title: c.title, path: c.desc, prefix: c.prefix }));
        chrome.runtime.sendMessage({ type: 'SEARCH', query: val }, (r) => {
          renderItems([...commandItems, ...(r?.results ?? [])]);
        });
      }, 100);
      return;
    }

    // ── Regular bookmark search ───────────────────────────────────────────────
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (!val.trim()) { clearResults(); return; }
      chrome.runtime.sendMessage({ type: 'SEARCH', query: val }, (r) => renderItems(r?.results ?? []));
    }, 100);
  });

  input.addEventListener('keydown', (e) => {
    const items = getItems();
    const count = items.length;

    if (e.key === 'Escape') {
      e.preventDefault();
      if (mode === 'tag-pick') {
        mode = 'search';
        setBadge(null);
        input.value = '';
        input.placeholder = 'Search bookmarks…';
        clearResults();
      } else if (mode === 'tag-name' || mode === 'tag-remove-select') {
        mode = 'search';
        tagAction = 'add';
        tagTarget = null;
        setBadge(null);
        input.value = '';
        input.placeholder = 'Search bookmarks…';
        clearResults();
      } else if (mode === 'save-location') {
        if (saveStack.length > 0) {
          saveStack.pop();
          const parentId = saveStack.length ? saveStack[saveStack.length - 1].id : null;
          input.value = '';
          loadFolders(parentId, '');
        } else {
          close();
        }
      } else {
        close();
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(Math.min(getActiveIndex() + 1, count - 1));
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(Math.max(getActiveIndex() - 1, 0));
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();

      if (mode === 'tag-name') {
        const tag = input.value.trim();
        if (tag && tagTarget) {
          chrome.runtime.sendMessage({ type: 'TAG', bookmarkId: tagTarget.id, tag });
          close();
        }
        return;
      }

      if (mode === 'search' && input.value.startsWith('/save ')) {
        const name = input.value.slice(6).trim();
        if (name) {
          saveName = name;
          saveStack = [];
          mode = 'save-location';
          setBadge('save');
          input.value = '';
          input.placeholder = 'Navigate to folder…';
          loadFolders(null, '');
        }
        return;
      }

      openActive();
    }
  });

  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) close();
  });

  input.focus();
})();
