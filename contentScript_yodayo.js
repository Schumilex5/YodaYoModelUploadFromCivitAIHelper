// contentScript_yodayo.js — v2.9.2 (restored typing logic, fade overlay, 128-char title, underscores only for title/desc)
(() => {
  console.log("[Yodayo] content script loaded");

  const delay = (ms) => new Promise((res) => setTimeout(res, ms));
  const rand = (a, b) => a + Math.random() * (b - a);
  const norm = (s) => (s || "").replace(/\s+/g, " ").replace(/\u00A0/g, " ").trim().toLowerCase();
  const normLoose = (s) => norm(s).replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

  const looksLikeTags = (txt) => {
    if (!txt) return false;
    const commas = (txt.match(/,/g) || []).length;
    const words = txt.split(/\s+/).length;
    return commas > 5 && words / commas < 3;
  };

  const ensureOverlay = () => {
    let box = document.getElementById("__yodayo_groups_overlay");
    if (box) return box;
    box = document.createElement("div");
    box.id = "__yodayo_groups_overlay";
    box.style.cssText = `
      position: fixed; right: 12px; bottom: 12px; z-index: 999999;
      max-width: 380px; background: rgba(20,20,24,.9); color: #fff;
      font: 12px/1.4 system-ui, sans-serif; border: 1px solid rgba(255,255,255,.15);
      border-radius: 10px; padding: 10px 12px; box-shadow: 0 6px 18px rgba(0,0,0,.35);
    `;
    box.innerHTML = `
      <div style="font-weight:700;margin-bottom:6px">Trigger Groups (preview)</div>
      <div id="__yodayo_groups_body" style="display:flex;flex-direction:column;gap:6px;max-height:220px;overflow:auto"></div>
      <div id="__yodayo_groups_status" style="opacity:.8;margin-top:6px"></div>
    `;
    document.body.appendChild(box);
    return box;
  };

  const fadeOutOverlay = (delayMs = 3000) => {
    const box = document.getElementById("__yodayo_groups_overlay");
    if (!box) return;
    setTimeout(() => {
      box.style.transition = "opacity .4s ease";
      box.style.opacity = 0;
      setTimeout(() => box.remove(), 400);
    }, delayMs);
  };

  const setOverlayStatus = (txt) => {
    const el =
      document.getElementById("__yodayo_groups_status") ||
      ensureOverlay().querySelector("#__yodayo_groups_status");
    el.textContent = txt;
  };

  const renderOverlayGroups = (groups) => {
    const body =
      document.getElementById("__yodayo_groups_body") ||
      ensureOverlay().querySelector("#__yodayo_groups_body");
    body.innerHTML = "";
    groups.forEach((g, i) => {
      const row = document.createElement("div");
      row.style.cssText =
        "background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);padding:6px;border-radius:8px;";
      const words = Array.isArray(g) ? g.join(", ") : String(g || "");
      row.innerHTML = `<div><b>#${i + 1}</b> ${words}</div>`;
      body.appendChild(row);
    });
  };

  // ✅ Restored typing logic from v2.9.0 (per-word + key events)
  async function typeTriggerWordsIntoYodayoInput(inputEl, words) {
    inputEl.focus();
    for (const word of words) {
      for (const ch of word) {
        inputEl.value += ch;
        inputEl.dispatchEvent(new InputEvent("input", { bubbles: true }));
        await delay(rand(10, 25));
      }
      inputEl.value += ",";
      inputEl.dispatchEvent(new InputEvent("input", { bubbles: true }));
      inputEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Comma", code: "Comma", bubbles: true }));
      inputEl.dispatchEvent(new KeyboardEvent("keyup", { key: "Comma", code: "Comma", bubbles: true }));
      await delay(rand(60, 120));
    }
    inputEl.blur();
  }

  chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
    if (req.type !== "YODAYO_SET_FIELDS") return;
    const data = req.data || {};
    console.log("[Yodayo] Received data:", data);
    (async () => {
      try {
        await fillStep1(data);
        await waitForStep2();
        await fillStep2(data);
        sendResponse({ ok: true });
      } catch (err) {
        console.error("[Yodayo] error:", err);
        setOverlayStatus(`❌ ${err.message || err}`);
        fadeOutOverlay();
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  });

  async function fillStep1(data) {
    console.log("[Yodayo] Step 1");

    const name = document.querySelector("#display_name");
    if (name && data.title) {
      let title = data.title.replace(/_/g, " ");
      if (title.length > 128) title = title.slice(0, 125) + "...";
      name.value = title;
      name.dispatchEvent(new Event("input", { bubbles: true }));
    }

    if (data.modelType) {
      const typeLabel = Array.from(document.querySelectorAll("div, label"))
        .find(el => norm(el.textContent) === "type");
      const typeBtn = typeLabel
        ? typeLabel.parentElement.querySelector("button[id^='headlessui-listbox-button']")
        : Array.from(document.querySelectorAll("button[id^='headlessui-listbox-button']"))
            .find(b => /choose type/i.test(b.textContent));
      if (typeBtn) {
        typeBtn.click();
        await delay(300);
        const opt = Array.from(document.querySelectorAll("li, button"))
          .find(b => norm(b.textContent) === norm(data.modelType));
        if (opt) opt.click();
      }
    }

    if (data.category) {
      const catLabel = Array.from(document.querySelectorAll("div, label"))
        .find(el => norm(el.textContent) === "category");
      const catBtn = catLabel
        ? catLabel.parentElement.querySelector("button[id^='headlessui-listbox-button']")
        : Array.from(document.querySelectorAll("button[id^='headlessui-listbox-button']"))
            .find(b => /choose category/i.test(b.textContent));
      if (catBtn) {
        catBtn.click();
        await delay(300);
        const opt = Array.from(document.querySelectorAll("li, button"))
          .find(b => norm(b.textContent) === norm(data.category));
        if (opt) opt.click();
      }
    }

    const descBox = document.querySelector("#description");
    if (descBox) {
      let text = (data.description || "").replace(/_/g, " ");
      if (looksLikeTags(text)) text = data.title || "";
      descBox.value = text;
      descBox.dispatchEvent(new Event("input", { bubbles: true }));
    }

    const nextBtn = Array.from(document.querySelectorAll("button"))
      .find(b => norm(b.textContent) === "next");
    if (nextBtn) nextBtn.click();
  }

  function waitForStep2(timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const iv = setInterval(() => {
        const ver = document.querySelector("#name");
        const baseBtn = document.querySelector('button[id^="headlessui-listbox-button"][id*=":r"]');
        const addBtn = Array.from(document.querySelectorAll("button"))
          .find(b => /trigger\s*group/i.test(b.textContent));
        if (ver && baseBtn && addBtn) {
          clearInterval(iv);
          resolve();
        } else if (Date.now() - start > timeoutMs) {
          clearInterval(iv);
          reject(new Error("Step 2 not detected"));
        }
      }, 400);
    });
  }

  async function selectBaseModel(targetText) {
    if (!targetText || norm(targetText) === "unknown") return false;
    const want = normLoose(targetText);
    const wantTokens = want.split(" ").filter(Boolean);
    const baseBtn =
      document.querySelector('button[id^="headlessui-listbox-button"][id*=":rp:"]') ||
      Array.from(document.querySelectorAll('button[id^="headlessui-listbox-button"]'))
        .find(b => /base\s*model/i.test(b.closest("div")?.textContent || ""));
    if (!baseBtn) throw new Error("Base model dropdown not found");

    const openMenu = async () => {
      baseBtn.scrollIntoView({ behavior: "smooth", block: "center" });
      baseBtn.click();
      await delay(250);
    };

    const getOptions = () =>
      Array.from(document.querySelectorAll('[role="option"], li, button')).filter(
        el => el.textContent && el.textContent.trim().length > 0
      );

    for (let attempt = 0; attempt < 4; attempt++) {
      await openMenu();
      await delay(200);
      const options = getOptions();
      let best = null;
      for (const el of options) {
        const txt = normLoose(el.textContent);
        if (!txt) continue;
        const hits = wantTokens.filter(tok => txt.includes(tok)).length;
        const score = hits / wantTokens.length;
        if (score > 0.5 && (!best || score > best.score)) best = { el, score };
      }
      if (best) {
        best.el.click();
        return true;
      }
      await delay(250);
    }
    return false;
  }

  async function fillStep2(data) {
    console.log("[Yodayo] Step 2");

    const verInput = document.querySelector("#name");
    if (verInput && data.versionName) {
      verInput.value = data.versionName;
      verInput.dispatchEvent(new Event("input", { bubbles: true }));
    }

    if (data.baseModel) {
      try {
        await selectBaseModel(data.baseModel);
      } catch (e) {
        console.error("[Yodayo] Base model error:", e);
      }
    }

    const groups = Array.isArray(data.triggerGroups)
      ? data.triggerGroups.filter(g => Array.isArray(g) && g.length)
      : [];

    if (!groups.length) {
      setOverlayStatus("No trigger groups captured.");
      fadeOutOverlay();
      return;
    }

    ensureOverlay();
    renderOverlayGroups(groups);
    setOverlayStatus(`Creating ${groups.length} trigger group(s)…`);

    const findAddBtn = () =>
      Array.from(document.querySelectorAll("button"))
        .find(b => /trigger\s*group/i.test(b.textContent));

    const countInputs = () => document.querySelectorAll('input[name="trigger_word_groups"]').length;

    for (let i = 0; i < groups.length; i++) {
      try {
        const before = countInputs();
        const addBtn = findAddBtn();
        if (!addBtn) throw new Error("Add button not found");
        addBtn.scrollIntoView({ behavior: "smooth", block: "center" });
        addBtn.click();

        let tries = 0;
        while (countInputs() <= before && tries < 40) {
          await delay(150);
          tries++;
        }
        await delay(150);

        const allInputs = Array.from(document.querySelectorAll('input[name="trigger_word_groups"]'));
        const newInputs = allInputs.slice(before);
        const wordInput =
          newInputs.length >= 2
            ? newInputs[newInputs.length - 1]
            : allInputs[allInputs.length - 1];

        if (!wordInput) throw new Error("Word input not found after add");
        await typeTriggerWordsIntoYodayoInput(wordInput, groups[i]);
        await delay(700);
      } catch (err) {
        console.error(`[Yodayo] Group ${i + 1} failed:`, err);
        await delay(700);
      }
    }

    setOverlayStatus("✅ All trigger groups added successfully.");
    fadeOutOverlay();
  }
})();
