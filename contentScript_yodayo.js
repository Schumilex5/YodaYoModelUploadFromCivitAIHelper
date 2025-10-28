// contentScript_yodayo.js — v2.8.0 (per-word typing + reliable base model pick)
(() => {
  console.log("[Yodayo] content script loaded");

  const delay = (ms) => new Promise((res) => setTimeout(res, ms));
  const rand = (a, b) => a + Math.random() * (b - a);

  const norm = (s) =>
    (s || "").replace(/\s+/g, " ").replace(/\u00A0/g, " ").trim().toLowerCase();

  const normLoose = (s) =>
    norm(s).replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

  const looksLikeTags = (txt) => {
    if (!txt) return false;
    const commas = (txt.match(/,/g) || []).length;
    const words = txt.split(/\s+/).length;
    return commas > 5 && words / commas < 3;
  };

  const findTriggerAddButton = () =>
    Array.from(document.querySelectorAll("button, a, [role='button']"))
      .find((el) => norm(el.textContent).includes("trigger group"));

  const countTriggerInputs = () =>
    document.querySelectorAll('input[name="trigger_word_groups"]').length;

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

  const setRowStatus = (i, ok, msg = "") => {
    const el = document.getElementById(`__yodayo_group_row_${i}`);
    if (el) el.style.background = ok ? "rgba(0,200,0,.2)" : "rgba(200,0,0,.2)";
    if (msg) el.title = msg;
  };

  // --- new typing logic ---
  async function typeTriggerWordsIntoYodayoInput(inputEl, words) {
    inputEl.focus();
    for (const word of words) {
      inputEl.value = word;
      inputEl.dispatchEvent(new InputEvent("input", { bubbles: true }));
      await delay(rand(30, 70));

      inputEl.value += ",";
      inputEl.dispatchEvent(new InputEvent("input", { bubbles: true }));
      inputEl.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Comma", code: "Comma", bubbles: true })
      );
      inputEl.dispatchEvent(
        new KeyboardEvent("keyup", { key: "Comma", code: "Comma", bubbles: true })
      );

      await delay(rand(60, 120));
    }
    inputEl.blur();
  }

  // ---------------------
  // Listen from popup
  // ---------------------
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
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  });

  // Step 1
  async function fillStep1(data) {
    console.log("[Yodayo] Step 1");
    const name = document.querySelector("#display_name");
    if (name && data.title) {
      name.value = data.title;
      name.dispatchEvent(new Event("input", { bubbles: true }));
    }

    if (data.modelType) {
      const typeBtn = document.querySelector(
        'button[id^="headlessui-listbox-button"][id*=":r8:"]'
      );
      if (typeBtn) {
        typeBtn.click();
        await delay(300);
        const opt = Array.from(document.querySelectorAll("li, button")).find(
          (b) => norm(b.textContent) === norm(data.modelType)
        );
        if (opt) opt.click();
      }
    }

    if (data.category) {
      const catBtn = document.querySelector(
        'button[id^="headlessui-listbox-button"][id*=":ra:"]'
      );
      if (catBtn) {
        catBtn.click();
        await delay(300);
        const opt = Array.from(document.querySelectorAll("li, button")).find(
          (b) => norm(b.textContent) === norm(data.category)
        );
        if (opt) opt.click();
      }
    }

    const descBox = document.querySelector("#description");
    if (descBox) {
      let text = data.description || "";
      if (looksLikeTags(text)) text = data.title || "";
      if (!text && data.title) text = data.title;
      descBox.value = text;
      descBox.dispatchEvent(new Event("input", { bubbles: true }));
    }

    const nextBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => norm(b.textContent) === "next"
    );
    if (nextBtn) {
      nextBtn.click();
      console.log("[Yodayo] clicked Next → Step 2");
    }
  }

  // Step 2
  function waitForStep2() {
    return new Promise((resolve) => {
      const iv = setInterval(() => {
        const ver = document.querySelector("#name");
        const base = document.querySelector(
          'button[id^="headlessui-listbox-button"][id*=":rq:"]'
        );
        const addBtn = findTriggerAddButton();
        if (ver && base && addBtn) {
          clearInterval(iv);
          resolve();
        }
      }, 400);
    });
  }

  // ---------- Robust HeadlessUI listbox selection for Base Model ----------
  async function selectBaseModel(targetText) {
    if (!targetText || norm(targetText) === "unknown") return false;

    // Normalize target + tokenization
    const want = normLoose(targetText);
    const wantTokens = want.split(" ").filter(Boolean);

    const baseBtn =
      document.querySelector('button[id^="headlessui-listbox-button"][id*=":rq:"]') ||
      // fallback: any listbox button near "Base model" label
      Array.from(document.querySelectorAll('button[id^="headlessui-listbox-button"]'))
        .find(b => /base\s*model/i.test(b.closest("div")?.textContent || ""));

    if (!baseBtn) throw new Error("Base model dropdown not found");

    // Open (or re-open) dropdown
    const openMenu = async () => {
      baseBtn.scrollIntoView({ behavior: "smooth", block: "center" });
      baseBtn.click();
      await delay(200);
      // also try keyboard open in case of event swallowing
      baseBtn.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      baseBtn.dispatchEvent(new KeyboardEvent("keyup",   { key: "ArrowDown", bubbles: true }));
      await delay(120);
    };

    // Find currently open listbox menu
    const queryMenus = () => {
      const listboxes = [
        ...document.querySelectorAll('[role="listbox"]'),
        ...document.querySelectorAll('[id^="headlessui-portal-root"] [role="listbox"]'),
      ];
      // Also collect generic popovers that HeadlessUI sometimes uses
      const popovers = Array.from(document.querySelectorAll('[id^="headlessui-portal-root"] *'))
        .filter(el => /listbox|menu/i.test(el.getAttribute?.("role") || ""));

      return [...new Set([...listboxes, ...popovers])];
    };

    const gatherOptions = () => {
      const menus = queryMenus();
      const opts = [];
      menus.forEach(menu => {
        opts.push(
          ...menu.querySelectorAll('[role="option"], li, button, div[role="option"]')
        );
      });
      // Final fallback: any menu-ish items under portals
      if (!opts.length) {
        opts.push(
          ...document.querySelectorAll('[id^="headlessui-portal-root"] li, [id^="headlessui-portal-root"] button')
        );
      }
      // dedupe
      return Array.from(new Set(opts));
    };

    const scoreOption = (el) => {
      const text = el.textContent || "";
      const tNorm = normLoose(text);
      if (!tNorm) return { score: 0, text };

      // scoring tiers
      if (tNorm === want) return { score: 100, text };
      if (tNorm.startsWith(want)) return { score: 90, text };

      // token coverage
      const hasAllTokens = wantTokens.every(tok => tNorm.includes(tok));
      if (hasAllTokens) return { score: 80, text };

      // partial (at least half tokens)
      const hits = wantTokens.filter(tok => tNorm.includes(tok)).length;
      if (hits >= Math.max(1, Math.ceil(wantTokens.length * 0.5))) {
        return { score: 60, text };
      }

      // some common aliases (example: illustrious vs illustrious xl / x l / illu)
      const aliasHit =
        (/illustrious/.test(want) && /illustrious|illu/.test(tNorm)) ||
        (/sdxl/.test(want) && /sdxl|stable diffusion xl/.test(tNorm)) ||
        (/1\.?5/.test(want) && /(1\.?5|sd\s*1\.?5|stable diffusion 1\.?5)/.test(tNorm)) ||
        (/flux/.test(want) && /flux/.test(tNorm));
      if (aliasHit) return { score: 55, text };

      return { score: 0, text };
    };

    // Try up to N attempts: open → read → pick
    for (let attempt = 0; attempt < 5; attempt++) {
      await openMenu();

      // wait menu mount
      let menuReady = false;
      for (let i = 0; i < 10; i++) {
        if (queryMenus().length) { menuReady = true; break; }
        await delay(80);
      }
      if (!menuReady) {
        await delay(150);
        continue;
      }

      // collect and score
      const options = gatherOptions();
      if (!options.length) {
        await delay(150);
        continue;
      }

      let best = null;
      for (const el of options) {
        const s = scoreOption(el);
        if (s.score > 0) {
          if (!best || s.score > best.score) best = { ...s, el };
        }
      }

      if (best && best.score >= 60) {
        best.el.scrollIntoView({ behavior: "smooth", block: "center" });
        await delay(80);
        (best.el.closest("button") || best.el).click();
        console.log("[Yodayo] Base model chosen:", best.text.trim());
        await delay(200);
        return true;
      }

      // if not found, try slight delay and re-open next loop
      await delay(200);
    }

    console.warn("[Yodayo] Base model option not matched for:", targetText);
    return false;
  }

  // --- fixed multi-group creation ---
  async function fillStep2(data) {
    console.log("[Yodayo] Step 2");

    const verInput = document.querySelector("#name");
    if (verInput && data.versionName) {
      verInput.value = data.versionName;
      verInput.dispatchEvent(new Event("input", { bubbles: true }));
    }

    if (data.baseModel) {
      try {
        const ok = await selectBaseModel(data.baseModel);
        if (!ok) {
          console.warn("[Yodayo] Falling back: could not click a base model option – leaving default.");
        }
      } catch (e) {
        console.error("[Yodayo] Base model selection error:", e);
      }
    }

    const groups = Array.isArray(data.triggerGroups)
      ? data.triggerGroups.filter((g) => Array.isArray(g) && g.length)
      : [];
    if (!groups.length) {
      setOverlayStatus("No trigger groups captured.");
      return;
    }

    ensureOverlay();
    renderOverlayGroups(groups);
    setOverlayStatus(`Creating ${groups.length} trigger group(s)…`);

    const findAddBtn = () =>
      Array.from(document.querySelectorAll("button")).find((b) =>
        b.textContent.trim().toLowerCase().includes("trigger group")
      );

    for (let i = 0; i < groups.length; i++) {
      try {
        const before = countTriggerInputs();

        let addBtn = findAddBtn();
        if (!addBtn) throw new Error("Add button not found before click");
        addBtn.scrollIntoView({ behavior: "smooth", block: "center" });
        addBtn.click();
        console.log(`[Yodayo] Clicked Add Trigger Group #${i + 1}`);

        // Wait for new inputs
        let tries = 0;
        while (countTriggerInputs() < before + 2 && tries < 30) {
          await delay(150);
          tries++;
        }

        const inputs = Array.from(
          document.querySelectorAll('input[name="trigger_word_groups"]')
        );
        const wordInput = inputs.slice(-1)[0];
        if (!wordInput) throw new Error("Word input not found after add");

        await typeTriggerWordsIntoYodayoInput(wordInput, groups[i]);
        console.log(`[Yodayo] Typed group ${i + 1}: ${groups[i].join(", ")}`);
        setRowStatus(i, true);
        await delay(700);
      } catch (err) {
        console.error(`[Yodayo] Failed on group ${i + 1}:`, err);
        setRowStatus(i, false, err.message);
        await delay(700);
      }
    }

    setOverlayStatus("✅ All trigger groups added successfully.");
    console.log("[Yodayo] Completed Step 2.");
  }
})();
