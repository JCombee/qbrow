(() => {
  let host = null;
  let activeIndex = -1;
  let debounceTimer = null;
  let mode = 'normal'; // 'normal' | 'tag-search' | 'tag-name'
  let pendingTagBookmark = null; // { id, title, url } — set in tag-name step

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

  function enterTagNameStep(bookmark) {
    pendingTagBookmark = bookmark;
    mode = 'tag-name';
    const label = (bookmark.title || bookmark.url).slice(0, 32);
    setBadge('tag → ' + label);
    const input = getInput();
    if (input) {
      input.value = '';
      input.placeholder = 'Enter tag name…';
    }
    renderResults([]);
  }

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

  function onInput(e) {
    if (mode === 'tag-name') return;

    const val = e.target.value;
    const tagMatch = val.match(/^\/tag (.*)$/);

    if (tagMatch) {
      mode = 'tag-search';
      setBadge('tag');
      const query = tagMatch[1];
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => search(query), 100);
    } else {
      mode = 'normal';
      setBadge(null);
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => search(val), 100);
    }
  }

  function onKeydown(e) {
    const items = getItems();

    if (e.key === 'Escape') {
      e.stopPropagation();
      if (mode === 'tag-name') {
        // Step back to tag-search — restore /tag prefix and clear results
        mode = 'tag-search';
        pendingTagBookmark = null;
        setBadge('tag');
        const input = getInput();
        if (input) {
          input.value = '/tag ';
          input.placeholder = 'Search bookmarks…';
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

  function close() {
    if (host) {
      host.remove();
      host = null;
      activeIndex = -1;
      mode = 'normal';
      pendingTagBookmark = null;
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
