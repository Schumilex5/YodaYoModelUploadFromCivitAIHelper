// Popup logic for Yodayo Helper Extension (free translate, no API key)
// Also carries versionName & baseModel through to the paste step.

const $ = sel => document.querySelector(sel);

const els = {
  btnCopy: $("#btnCopy"),
  btnPaste: $("#btnPaste"),
  btnSettings: $("#btnSettings"),
  btnSaveSettings: $("#btnSaveSettings"),
  btnCloseSettings: $("#btnCloseSettings"),
  settingsPanel: $("#settingsPanel"),
  ignoreWords: $("#ignoreWords"),
  clipText: $("#clipText"),
  chkTranslate: $("#chkTranslate"),
  targetLang: $("#targetLang"),
  wallFile: $("#wallFile"),
  wall: $("#wallpaper"),
  wallOpacity: $("#wallOpacity"),
  btnClearWall: $("#btnClearWall")
};

let SETTINGS = null;

async function loadSettings() {
  const res = await chrome.runtime.sendMessage({ type: "GET_SETTINGS" });
  SETTINGS = res.settings;

  els.chkTranslate.checked = !!SETTINGS.translateEnabled;
  els.targetLang.value = SETTINGS.targetLang || "en";
  els.ignoreWords.value = (SETTINGS.ignoreWords || []).join(", ");
  els.wallOpacity.value = SETTINGS.wallpaperOpacity || 0.9;

  if (SETTINGS.wallpaperDataUrl) {
    els.wall.style.backgroundImage = `url("${SETTINGS.wallpaperDataUrl}")`;
    els.wall.style.opacity = SETTINGS.wallpaperOpacity ?? 0.9;
  } else {
    els.wall.style.backgroundImage = "";
    els.wall.style.opacity = 1;
  }
}

function sanitizeWithIgnoreList(text, ignoreWords) {
  if (!text) return text;
  if (!ignoreWords || !ignoreWords.length) return text;
  const rx = new RegExp(
    `\\b(${ignoreWords.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`,
    "gi"
  );
  return text.replace(rx, "").replace(/\s{2,}/g, " ").trim();
}

async function translateIfNeeded(text) {
  if (!SETTINGS.translateEnabled) return text;
  const target = SETTINGS.targetLang || "en";
  const resp = await chrome.runtime.sendMessage({
    type: "TRANSLATE",
    payload: { text, targetLang: target }
  });
  if (resp?.ok) return resp.text;
  return text;
}

async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

async function getCivitaiDataInActiveTab() {
  const tabId = await getActiveTabId();
  return new Promise(resolve => {
    chrome.tabs.sendMessage(tabId, { type: "CIVITAI_GET_TITLE" }, res => {
      resolve(res || {});
    });
  });
}

async function pasteToYodayoInActiveTab(data) {
  const tabId = await getActiveTabId();
  return new Promise(resolve => {
    chrome.tabs.sendMessage(tabId, { type: "YODAYO_SET_FIELDS", data }, resolve);
  });
}

async function saveClip(clip) {
  await chrome.runtime.sendMessage({ type: "SAVE_CLIP", clip });
  // Show brief summary
  const type = clip.modelType || "?";
  const cat = clip.category || "?";
  els.clipText.value = `${clip.title}\n[${type}] ${cat}\nver: ${clip.versionName || ""} | base: ${clip.baseModel || ""}`;
}

async function loadClip() {
  const { clip } = await chrome.runtime.sendMessage({ type: "GET_CLIP" });
  if (clip?.title) {
    const type = clip.modelType || "?";
    const cat = clip.category || "?";
    els.clipText.value = `${clip.title}\n[${type}] ${cat}\nver: ${clip.versionName || ""} | base: ${clip.baseModel || ""}`;
  } else {
    els.clipText.value = "";
  }
}

async function fileToDataUrlCompressed(file, maxW = 1920, maxH = 1080, quality = 0.78) {
  const img = document.createElement("img");
  const fr = new FileReader();
  const dataUrl = await new Promise((res, rej) => {
    fr.onload = () => res(fr.result);
    fr.onerror = rej;
    fr.readAsDataURL(file);
  });
  await new Promise(res => {
    img.onload = res;
    img.src = dataUrl;
  });

  const canvas = document.createElement("canvas");
  let { width, height } = img;
  const scale = Math.min(maxW / width, maxH / height, 1);
  width = Math.round(width * scale);
  height = Math.round(height * scale);

  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, width, height);

  const out = canvas.toDataURL("image/webp", quality);
  return out;
}

async function saveSettings() {
  const ignoreList = els.ignoreWords.value
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

  const newSettings = {
    ...SETTINGS,
    translateEnabled: els.chkTranslate.checked,
    targetLang: els.targetLang.value.trim() || "en",
    ignoreWords: ignoreList,
    wallpaperOpacity: parseFloat(els.wallOpacity.value || "0.9")
  };

  await chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", settings: newSettings });
  SETTINGS = newSettings;
}

async function init() {
  await loadSettings();
  await loadClip();

  els.btnSettings.onclick = () => els.settingsPanel.classList.toggle("hidden");
  els.btnCloseSettings.onclick = () => els.settingsPanel.classList.add("hidden");

  els.btnSaveSettings.onclick = async () => {
    try {
      await saveSettings();
      if (SETTINGS.wallpaperDataUrl) {
        els.wall.style.opacity = SETTINGS.wallpaperOpacity;
      }
      els.settingsPanel.classList.add("hidden");
    } catch (err) {
      console.error("Settings save failed:", err);
      alert("Failed to save settings: " + (err.message || err));
    }
  };

  els.wallFile.onchange = async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await fileToDataUrlCompressed(file);
      SETTINGS.wallpaperDataUrl = dataUrl;
      await saveSettings();
      els.wall.style.backgroundImage = `url("${dataUrl}")`;
      els.wall.style.opacity = SETTINGS.wallpaperOpacity;
    } catch (err) {
      console.error(err);
      alert("Failed to process wallpaper image.");
    }
  };

  els.btnClearWall.onclick = async () => {
    SETTINGS.wallpaperDataUrl = null;
    await saveSettings();
    els.wall.style.backgroundImage = "";
    els.wall.style.opacity = 1;
  };

  els.wallOpacity.oninput = () => {
    els.wall.style.opacity = parseFloat(els.wallOpacity.value || "0.9");
  };

  els.btnCopy.onclick = async () => {
    try {
      const res = await getCivitaiDataInActiveTab();
      const { title, modelType, description, category, versionName, baseModel } = res;

      if (!title) {
        alert("Could not find model title on this page.");
        return;
      }

      const ignored = sanitizeWithIgnoreList(title, SETTINGS.ignoreWords);
      const finalTitle = await translateIfNeeded(ignored);

      const clip = { title: finalTitle, modelType, description, category, versionName, baseModel };
      await saveClip(clip);
    } catch (e) {
      console.error(e);
      alert("Copy failed. Make sure you're on a CivitAI model page.");
    }
  };

  els.btnPaste.onclick = async () => {
    try {
      const { clip } = await chrome.runtime.sendMessage({ type: "GET_CLIP" });
      if (!clip || !clip.title) {
        alert("Clipboard is empty. Copy first.");
        return;
      }
      const result = await pasteToYodayoInActiveTab(clip);
      if (!result?.ok) {
        alert(result?.error || "Paste failed. Open Yodayo's model form first.");
      }
    } catch (e) {
      console.error(e);
      alert("Paste failed. Are you on the Yodayo model page?");
    }
  };

  // === Popup auto-resize + remember size ===
  applySavedPopupSize();
  observePanelSize();
}

async function applySavedPopupSize() {
  try {
    const { popupSize } = await chrome.storage.local.get("popupSize");
    if (popupSize?.width && popupSize?.height) {
      window.resizeTo(popupSize.width, popupSize.height);
    } else {
      autoAdjustHeight();
    }
  } catch (err) {
    console.warn("Could not apply saved popup size:", err);
  }
}

function autoAdjustHeight() {
  const root = document.documentElement;
  const body = document.body;
  const desiredHeight = Math.max(
    root.scrollHeight,
    body.scrollHeight,
    root.offsetHeight,
    body.offsetHeight
  );
  const desiredWidth = Math.max(root.scrollWidth, body.scrollWidth, 400);
  window.resizeTo(desiredWidth, desiredHeight);
}

// Save size when user resizes popup manually
let resizeTimeout;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(() => {
    const popupSize = { width: window.outerWidth, height: window.outerHeight };
    chrome.storage.local.set({ popupSize });
  }, 500);
});

// Auto adjust when settings panel is opened
function observePanelSize() {
  const observer = new MutationObserver(() => {
    if (!els.settingsPanel.classList.contains("hidden")) {
      autoAdjustHeight();
    }
  });
  observer.observe(els.settingsPanel, { attributes: true, attributeFilter: ["class"] });
}

init();
