// URLs donde Chrome no permite inyectar scripts.
const RESTRICTED_PREFIXES = [
  "chrome://",
  "chrome-extension://",
  "edge://",
  "about:",
  "view-source:",
  "https://chrome.google.com/webstore",
  "https://chromewebstore.google.com",
];

function isRestricted(url) {
  if (!url) return true;
  return RESTRICTED_PREFIXES.some((p) => url.startsWith(p));
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;

  if (isRestricted(tab.url)) {
    // No se puede inyectar aquí: muestra un badge para avisar.
    chrome.action.setBadgeText({ tabId: tab.id, text: "!" });
    chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: "#ef4444" });
    setTimeout(() => chrome.action.setBadgeText({ tabId: tab.id, text: "" }), 2000);
    return;
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"],
    });

    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ["content.css"],
    });

    await chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_DIV_INSPECTOR" });
  } catch (err) {
    console.error("Div Inspector error:", err);
  }
});
