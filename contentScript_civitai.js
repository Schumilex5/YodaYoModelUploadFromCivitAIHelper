// contentScript_civitai.js
(() => {
  console.log("[CivitAI Script] Running...");

  const getText = (sel) => {
    const el = document.querySelector(sel);
    return el ? el.textContent.trim() : "";
  };

  const looksLikeTags = (text) => {
    if (!text) return false;
    const commas = (text.match(/,/g) || []).length;
    const words = text.split(/\s+/).length;
    return commas > 5 && words / commas < 3;
  };

  const isEnglish = (str) => /^[\x00-\x7F\s.,!?'"()\-:;0-9A-Za-z]*$/.test(str);

  async function translateToEnglish(text) {
    try {
      const url = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=" + encodeURIComponent(text);
      const res = await fetch(url);
      const data = await res.json();
      return data?.[0]?.map((a) => a[0]).join("") || text;
    } catch {
      return text;
    }
  }

  // --- Title ---
  let title = "";
  const titleSelectors = [
    "h1.mantine-Title-root",
    "h1.mantine-Text-root",
    "h1[data-testid='model-title']",
    "div[data-testid='model-header'] h1",
    "h1",
  ];
  for (const s of titleSelectors) {
    const el = document.querySelector(s);
    if (el && el.textContent.trim()) {
      title = el.textContent.trim();
      break;
    }
  }

  // --- Category ---
  let category = "";
  const catEl = document.querySelector('a[href^="/tag/"]');
  if (catEl) category = catEl.textContent.trim();

  // --- Version ---
  let versionName = "";
  const brushIcon = document.querySelector("svg.tabler-icon-brush");
  if (brushIcon) {
    const vParent = brushIcon.closest("div[class*='mantine-Group-root']");
    if (vParent) versionName = vParent.textContent.trim();
  }
  if (!versionName) versionName = "v1.0";

  // --- Type, Base, Trigger Words ---
  let modelType = "";
  let baseModel = "";
  let triggerGroups = [];

  const rows = Array.from(document.querySelectorAll("table tr"));
  for (const tr of rows) {
    const labelEl = tr.querySelector("td:first-child p");
    const valueEl = tr.querySelector("td:nth-child(2)");
    if (!labelEl || !valueEl) continue;

    const label = labelEl.textContent.trim().toLowerCase();
    const value = valueEl.textContent.trim();

    if (label === "type" && value) modelType = value;
    if (label === "base model" && value) baseModel = value;

    if (label === "trigger words") {
      const txt = valueEl.textContent
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length);
      const unique = [...new Set(txt)];
      if (unique.length) triggerGroups.push(unique);
    }
  }

  if (!modelType) modelType = "?";
  if (!baseModel) baseModel = "Unknown";

  // --- Description extraction (improved multi-block + filtering) ---
  let description = "";
  const descBlocks = document.querySelectorAll(
    ".RenderHtml_htmlRenderer__z8vxT pre, .RenderHtml_htmlRenderer__z8vxT code, .RenderHtml_htmlRenderer__z8vxT p"
  );

  if (descBlocks.length > 0) {
    description = Array.from(descBlocks)
      .map((el) => el.textContent.trim())
      .filter((t) => t.length > 0)
      .join("\n\n");
  } else {
    const fallback = document.querySelector('[data-testid="model-description"], .mantine-TypographyStylesProvider-root');
    if (fallback) description = fallback.textContent.trim();
  }

  // filter out unwanted lines
  const blacklist = /(sponsor|commission|support|ko-?fi|patreon)/i;
  description = description
    .split(/\n+/)
    .filter((line) => !blacklist.test(line))
    .join("\n\n")
    .trim();

  // Fallbacks
  if (looksLikeTags(description)) {
    description = title || "";
  } else if (description && !isEnglish(description)) {
    translateToEnglish(description).then((translated) => {
      description = translated;
      finalize();
    });
    return;
  }

  finalize();

  function finalize() {
    const data = { title, modelType, category, versionName, baseModel, description, triggerGroups };
    console.log("[CivitAI Script] Extracted data:", data);

    const div = document.createElement("div");
    div.textContent = `✅ Copied ${triggerGroups.length} trigger group${triggerGroups.length !== 1 ? "s" : ""}`;
    div.style.cssText = `
      position: fixed; right: 14px; bottom: 14px; z-index: 999999;
      background: rgba(0,0,0,.85); color: #fff; font: 12px system-ui;
      padding: 6px 10px; border-radius: 6px; opacity: 0;
      transition: opacity .25s ease;
    `;
    document.body.appendChild(div);
    requestAnimationFrame(() => (div.style.opacity = 1));
    setTimeout(() => {
      div.style.opacity = 0;
      setTimeout(() => div.remove(), 400);
    }, 2000);

    chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
      if (req.type === "CIVITAI_GET_TITLE") {
        sendResponse(data);
      }
    });
  }
})();
