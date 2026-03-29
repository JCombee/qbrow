(() => {
  let iframe = null;

  function onMessage(e) {
    if (e.source !== iframe?.contentWindow) return;
    if (e.data?.type === 'QBROW_CLOSE') close();
    if (e.data?.type === 'QBROW_READY') {
      iframe.contentWindow.postMessage({ type: 'QBROW_INIT', url: window.location.href }, '*');
    }
  }

  function open() {
    if (iframe) return;
    iframe = document.createElement('iframe');
    iframe.id = 'qbrow-host';
    iframe.src = chrome.runtime.getURL('palette.html');
    iframe.setAttribute('allowtransparency', 'true');
    Object.assign(iframe.style, {
      position: 'fixed',
      inset: '0',
      width: '100%',
      height: '100%',
      border: 'none',
      background: 'transparent',
      zIndex: '2147483647',
      colorScheme: 'normal',
    });
    document.documentElement.appendChild(iframe);
    window.addEventListener('message', onMessage);
  }

  function close() {
    if (iframe) {
      window.removeEventListener('message', onMessage);
      iframe.remove();
      iframe = null;
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'TOGGLE') {
      iframe ? close() : open();
    }
  });
})();
