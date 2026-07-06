/*
 * OLX Smart Helper — background service worker (MV3).
 * Minimal: exists so the content script can open the options page via the
 * proper extension API. Content scripts cannot call chrome.runtime.openOptionsPage()
 * directly, and raw-navigating to the comet-extension://…/options.html URL is
 * blocked by the browser (ERR_BLOCKED_BY_CLIENT).
 */
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "openOptions") {
    // openOptionsPage respects manifest `options_page` and opens it correctly.
    chrome.runtime.openOptionsPage(() => {
      // callback keeps the message channel tidy; ignore lastError if any
      void chrome.runtime.lastError;
      sendResponse && sendResponse({ ok: true });
    });
    return true; // async response
  }
});
