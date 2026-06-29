// Initialize extension settings upon installation
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get({
    autoLearn: true,
    autoSub: true,
    autoNext: true,
    seekSpeed: 10,
    seekInterval: 5
  }, (settings) => {
    chrome.storage.sync.set(settings);
    console.log('[Rikkei Booster Background] Initialized settings:', settings);
  });
});

// Relay messages if needed (e.g. from popup to content script or vice versa)
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Currently content script and popup communicate directly,
  // but we can add background features if required in future.
  sendResponse({ status: 'received' });
});
