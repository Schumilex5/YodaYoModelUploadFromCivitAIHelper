// service_worker.js
// Handles storage, translation, and clipboard logic for Yodayo Helper

const DEFAULT_SETTINGS = {
  targetLang: "en",
  translateEnabled: true,
  ignoreWords: ["LoRA", "Checkpoint"],
  wallpaperDataUrl: null,
  wallpaperOpacity: 0.9
};

// Initialize default storage on first install
chrome.runtime.onInstalled.addListener(async () => {
  const { settings } = await chrome.storage.local.get("settings");
  if (!settings) {
    await chrome.storage.local.set({
      settings: DEFAULT_SETTINGS,
      clip: null
    });
  }
});

// Simple Google Translate API (same logic as easygoogletranslate)
async function easyGoogleTranslate(text, targetLang = "en") {
  const url =
    "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=" +
    encodeURIComponent(targetLang) +
    "&dt=t&q=" +
    encodeURIComponent(text);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Translate request failed (${res.status})`);
  const data = await res.json();
  if (!Array.isArray(data) || !Array.isArray(data[0])) return text;

  // Flatten translation array
  const translated = data[0].map(t => t[0]).join("");
  return translated || text;
}

// Message handling
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg.type === "GET_SETTINGS") {
      const { settings } = await chrome.storage.local.get("settings");
      sendResponse({ settings: settings || DEFAULT_SETTINGS });
      return;
    }

    if (msg.type === "SAVE_SETTINGS") {
      await chrome.storage.local.set({ settings: msg.settings });
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === "SAVE_CLIP") {
      await chrome.storage.local.set({ clip: msg.clip });
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === "GET_CLIP") {
      const { clip } = await chrome.storage.local.get("clip");
      sendResponse({ clip: clip || null });
      return;
    }

    // Translation (free endpoint)
    if (msg.type === "TRANSLATE") {
      const { text, targetLang } = msg.payload;
      try {
        const translated = await easyGoogleTranslate(text, targetLang);
        sendResponse({ ok: true, text: translated });
      } catch (e) {
        console.error("Translation failed:", e);
        sendResponse({ ok: false, error: e?.message || String(e) });
      }
      return;
    }
  })();

  return true; // allow async
});
