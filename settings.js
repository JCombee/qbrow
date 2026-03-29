// Display current shortcut
chrome.commands.getAll((commands) => {
  const cmd = commands.find((c) => c.name === 'toggle-palette');
  const el = document.getElementById('current-shortcut');
  el.textContent = cmd?.shortcut || 'Not set';
});

// Open the browser's shortcut management page
document.getElementById('change-shortcut').addEventListener('click', (e) => {
  e.preventDefault();
  const url = navigator.userAgent.includes('Firefox')
    ? 'about:addons'
    : 'chrome://extensions/shortcuts';
  chrome.tabs.create({ url });
});

// Sidebar navigation (for future pages)
document.querySelectorAll('.qbrow-nav-link').forEach((link) => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    const pageId = link.dataset.page;
    document.querySelectorAll('.qbrow-nav-link').forEach((l) => l.classList.remove('active'));
    document.querySelectorAll('.qbrow-page').forEach((p) => p.hidden = true);
    link.classList.add('active');
    document.getElementById('page-' + pageId).hidden = false;
  });
});
