// Popup logic for Yodayo Helper Extension (free translate, no API key)
const $ = (s) => document.querySelector(s);

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

// ============================
// Load / Save Settings
// ============================
async function loadSettings() {
  const res = await chrome.runtime.sendMessage({ type: "GET_SETTINGS" });
  SETTINGS = res.settings || {};

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

// ============================
// Active Tab Helpers
// ============================
async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

async function getCivitaiDataInActiveTab() {
  const tabId = await getActiveTabId();
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: "CIVITAI_GET_TITLE" }, (res) => resolve(res || {}));
  });
}

async function pasteToYodayoInActiveTab(data) {
  const tabId = await getActiveTabId();
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: "YODAYO_SET_FIELDS", data }, resolve);
  });
}

// ============================
// Clipboard / Clip Storage
// ============================
async function saveClip(clip) {
  await chrome.runtime.sendMessage({ type: "SAVE_CLIP", clip });

  const type = clip.modelType || "?";
  const cat = clip.category || "?";

  let tgPreview = "";
  if (Array.isArray(clip.triggerGroups) && clip.triggerGroups.length) {
    const flat = clip.triggerGroups.map((g) =>
      Array.isArray(g) ? g.join(", ") : g
    ).join("\n");
    tgPreview = `\n\nTrigger Groups:\n${flat}`;
  } else {
    tgPreview = "\n\nTrigger Groups: (none)";
  }

  els.clipText.value =
    `${clip.title}\n[${type}] ${cat}\nver: ${clip.versionName || ""} | base: ${clip.baseModel || ""}${tgPreview}`;
}

async function loadClip() {
  const { clip } = await chrome.runtime.sendMessage({ type: "GET_CLIP" });
  if (clip?.title) {
    const type = clip.modelType || "?";
    const cat = clip.category || "?";
    els.clipText.value =
      `${clip.title}\n[${type}] ${cat}\nver: ${clip.versionName || ""} | base: ${clip.baseModel || ""}`;
  } else {
    els.clipText.value = "";
  }
}

// ============================
// Wallpaper Management
// ============================
async function fileToDataUrlCompressed(file, maxW = 1920, maxH = 1080, quality = 0.78) {
  const img = document.createElement("img");
  const fr = new FileReader();
  const dataUrl = await new Promise((res, rej) => {
    fr.onload = () => res(fr.result);
    fr.onerror = rej;
    fr.readAsDataURL(file);
  });
  await new Promise((res) => {
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
  return canvas.toDataURL("image/webp", quality);
}

async function saveSettings() {
  const ignoreList = els.ignoreWords.value
    .split(",")
    .map((s) => s.trim())
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

// ============================
// Initialization
// ============================
async function init() {
  await loadSettings();
  await loadClip();

  // UI
  els.btnSettings.onclick = () => {
    els.settingsPanel.classList.toggle("hidden");
    adjustPopupHeight();
  };
  els.btnCloseSettings.onclick = () => {
    els.settingsPanel.classList.add("hidden");
    adjustPopupHeight();
  };

  els.btnSaveSettings.onclick = async () => {
    await saveSettings();
    if (SETTINGS.wallpaperDataUrl) {
      els.wall.style.opacity = SETTINGS.wallpaperOpacity;
    }
    els.settingsPanel.classList.add("hidden");
    adjustPopupHeight();
  };

  els.wallFile.onchange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const dataUrl = await fileToDataUrlCompressed(file);
    SETTINGS.wallpaperDataUrl = dataUrl;
    await saveSettings();
    els.wall.style.backgroundImage = `url("${dataUrl}")`;
    els.wall.style.opacity = SETTINGS.wallpaperOpacity;
    await new Promise((r) => setTimeout(r, 100));
    adjustPopupHeight();
  };

  els.btnClearWall.onclick = async () => {
    SETTINGS.wallpaperDataUrl = null;
    await saveSettings();
    els.wall.style.backgroundImage = "";
    els.wall.style.opacity = 1;
    adjustPopupHeight();
  };

  els.wallOpacity.oninput = () => {
    els.wall.style.opacity = parseFloat(els.wallOpacity.value || "0.9");
  };

  // Main buttons
  els.btnCopy.onclick = async () => {
    const res = await getCivitaiDataInActiveTab();
    const { title, modelType, description, category, versionName, baseModel, triggerGroups } = res;
    if (!title) return alert("Could not find model title on this page.");

    const ignored = sanitizeWithIgnoreList(title, SETTINGS.ignoreWords);
    const finalTitle = await translateIfNeeded(ignored);
    const clip = { title: finalTitle, modelType, description, category, versionName, baseModel, triggerGroups };
    await saveClip(clip);
  };

  els.btnPaste.onclick = async () => {
    const { clip } = await chrome.runtime.sendMessage({ type: "GET_CLIP" });
    if (!clip || !clip.title) return alert("Clipboard is empty. Copy first.");
    const result = await pasteToYodayoInActiveTab(clip);
    if (!result?.ok) alert(result?.error || "Paste failed. Open Yodayo's model form first.");
  };

  observeLayoutChanges();
  adjustPopupHeight();
  setTimeout(adjustPopupToWallpaper, 500);
  watchWallpaperResize();
}

// ============================
// Auto Adjust Popup Height
// ============================
function adjustPopupHeight() {
  const body = document.body;
  const html = document.documentElement;
  const newHeight = Math.max(body.scrollHeight, html.scrollHeight);
  html.style.height = newHeight + "px";
  body.style.height = newHeight + "px";
}

function observeLayoutChanges() {
  const observer = new MutationObserver(() => adjustPopupHeight());
  observer.observe(document.body, { childList: true, subtree: true, attributes: true });
}

// ============================
// Wallpaper Aspect Fit
// ============================
async function adjustPopupToWallpaper() {
  const wall = document.querySelector("#wallpaper");
  if (!wall) return;

  const style = getComputedStyle(wall);
  const match = style.backgroundImage.match(/url\(["']?(.*?)["']?\)/);
  if (!match) return;
  const imgUrl = match[1];
  if (!imgUrl) return;

  const img = new Image();
  img.src = imgUrl;
  await new Promise((res) => (img.onload = res));

  const popupWidth = window.innerWidth;
  const popupHeight = window.innerHeight;
  const popupRatio = popupWidth / popupHeight;
  const imgRatio = img.width / img.height;

  if (imgRatio > popupRatio + 0.05) {
    const targetWidth = Math.round(popupHeight * imgRatio);
    const maxWidth = 900;
    const newWidth = Math.min(targetWidth, maxWidth);
    try {
      window.resizeTo(newWidth, popupHeight);
      console.log(`[Yodayo Helper] Expanded popup width to ${newWidth}px to fit wallpaper.`);
    } catch {
      console.warn("Popup resizing blocked by Chrome (normal in default_popup mode).");
    }
  }
}

function watchWallpaperResize() {
  const wall = document.querySelector("#wallpaper");
  if (!wall) return;
  const observer = new MutationObserver(() => adjustPopupToWallpaper());
  observer.observe(wall, { attributes: true, attributeFilter: ["style"] });
}

init();
