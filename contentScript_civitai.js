// contentScript_civitai.js — v3.4.5 (pose→concept + underscore fix + fade msg)
(() => {
  console.log("[CivitAI Script] Persistent mode loaded");

  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  const looksLikeTags = (text) => {
    if (!text) return false;
    const commas = (text.match(/,/g) || []).length;
    const words = text.split(/\s+/).length;
    return commas > 5 && words / commas < 3;
  };

  const isEnglish = (str) => /^[\x00-\x7F\s.,!?'"()\-:;0-9A-Za-z]*$/.test(str);

  async function translateToEnglish(text) {
    try {
      const url =
        "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=" +
        encodeURIComponent(text);
      const res = await fetch(url);
      const data = await res.json();
      return data?.[0]?.map((a) => a[0]).join("") || text;
    } catch {
      return text;
    }
  }

  const titleSelectors = [
    'h1[class*="_____slug___title__"]',
    'div[class*="_____slug___titleWrapper__"] h1[class*="_____slug___title__"]',
    "h1.mantine-Title-root",
    "h1.mantine-Text-root",
    "h1[data-testid='model-title']",
    "div[data-testid='model-header'] h1",
    ".mantine-Group-root h1",
    ".mantine-Stack-root h1",
    "h1"
  ];

  async function waitForTitle(timeout = 6000) {
    let title = "";
    for (const s of titleSelectors) {
      const el = document.querySelector(s);
      if (el && el.textContent.trim().length > 1) return el.textContent.trim();
    }

    title = await new Promise((resolve) => {
      let found = "";
      const obs = new MutationObserver(() => {
        for (const sel of titleSelectors) {
          const el = document.querySelector(sel);
          if (el && el.textContent.trim().length > 1) {
            found = el.textContent.trim();
            obs.disconnect();
            resolve(found);
            return;
          }
        }
      });
      obs.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => {
        if (!found) {
          obs.disconnect();
          resolve("");
        }
      }, timeout);
    });

    if (!title) {
      const meta =
        document.querySelector('meta[property="og:title"]') ||
        document.querySelector('meta[name="twitter:title"]');
      if (meta && meta.content) title = meta.content.trim();
      else if (document.title)
        title = document.title.replace(/\s*\|.*$/, "").trim();
    }
    return title || "";
  }

  async function extractData() {
    let title = await waitForTitle();
    if (!title) console.warn("[CivitAI] Could not find model title.");

    // Category
    let category = "";
    const catEl = document.querySelector('a[href^="/tag/"]');
    if (catEl) category = catEl.textContent.trim();
    if (/^poses?$/i.test(category)) category = "concept"; // fix

    // Version
    let versionName = "";
    const brushIcon = document.querySelector("svg.tabler-icon-brush");
    if (brushIcon) {
      const vParent = brushIcon.closest("div[class*='mantine-Group-root']");
      if (vParent) versionName = vParent.textContent.trim();
    }
    if (!versionName) versionName = "v1.0";

    // Model type & base
    let modelType = "";
    let baseModel = "";
    const rows = Array.from(document.querySelectorAll("table tr"));
    for (const tr of rows) {
      const labelEl = tr.querySelector("td:first-child p");
      const valueEl = tr.querySelector("td:nth-child(2)");
      if (!labelEl || !valueEl) continue;
      const label = labelEl.textContent.trim().toLowerCase();
      const value = valueEl.textContent.trim();
      if (label === "type" && value) modelType = value;
      if (label === "base model" && value) baseModel = value;
    }
    if (!modelType) modelType = "?";
    if (!baseModel) baseModel = "Unknown";

    // Trigger groups
    const triggerGroups = [];
    try {
      const triggerRow = Array.from(document.querySelectorAll("tr")).find((tr) =>
        /trigger\s*words/i.test(tr.textContent)
      );
      if (triggerRow) {
        const wordDivs = triggerRow.querySelectorAll(
          "div.whitespace-normal.m_4081bf90.mantine-Group-root"
        );
        wordDivs.forEach((div) => {
          const raw = div.childNodes[0]?.textContent?.trim() || "";
          if (raw) triggerGroups.push([raw]);
        });
      }
    } catch (err) {
      console.error("[CivitAI] Trigger group parse failed:", err);
    }

    // Description
    let description = "";
    const descBlocks = document.querySelectorAll(
      ".RenderHtml_htmlRenderer__z8vxT pre, .RenderHtml_htmlRenderer__z8vxT code, .RenderHtml_htmlRenderer__z8vxT p"
    );
    if (descBlocks.length > 0) {
      description = Array.from(descBlocks)
        .map((el) => el.textContent.trim())
        .filter(Boolean)
        .join("\n\n");
    } else {
      const fallback = document.querySelector(
        '[data-testid="model-description"], .mantine-TypographyStylesProvider-root'
      );
      if (fallback) description = fallback.textContent.trim();
    }

    const blacklist = /(sponsor|commission|support|ko-?fi|patreon|credit)/i;
    const ignorePixai = /for\s+pixai\s+users?/i;
    const linkPattern = /(https?:\/\/|www\.|pixai\.art|civitai\.com)/i;
    const keepWeight = /^weight\s*:/i;

    description = description
      .split(/\n+/)
      .map((line) => line.trim())
      .filter((line) => {
        if (!line) return false;
        if (keepWeight.test(line)) return true;
        if (blacklist.test(line)) return false;
        if (ignorePixai.test(line)) return false;
        if (linkPattern.test(line)) return false;
        return true;
      })
      .join("\n\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    if (looksLikeTags(description)) description = title || "";
    else if (description && !isEnglish(description))
      description = await translateToEnglish(description);

    // underscore normalization
    title = title.replace(/_/g, " ");
    description = description.replace(/_/g, " ");

    return { title, modelType, category, versionName, baseModel, description, triggerGroups };
  }

  chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
    if (req.type !== "CIVITAI_GET_TITLE") return;
    (async () => {
      const data = await extractData();
      console.log("[CivitAI Script] Extracted data:", data);
      const div = document.createElement("div");
      div.textContent = `✅ Copied ${data.triggerGroups.length} trigger group${data.triggerGroups.length !== 1 ? "s" : ""}`;
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
      sendResponse(data);
    })();
    return true;
  });

  let lastUrl = location.href;
  const urlObserver = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      console.log("[CivitAI] Detected page change → reinitializing");
      lastUrl = location.href;
      waitForTitle(8000);
    }
  });
  urlObserver.observe(document.body, { childList: true, subtree: true });
})();
