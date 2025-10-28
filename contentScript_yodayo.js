// contentScript_yodayo.js
(() => {
  console.log("[Yodayo] content script loaded");

  const delay = (ms) => new Promise((res) => setTimeout(res, ms));

  const norm = (s) => (s || "")
    .replace(/\s+/g, " ")
    .replace(/\u00A0/g, " ")
    .trim()
    .toLowerCase();

  const looksLikeTags = (txt) => {
    if (!txt) return false;
    const commas = (txt.match(/,/g) || []).length;
    const words = txt.split(/\s+/).length;
    return commas > 5 && words / commas < 3;
  };

  // helpers
  const findTriggerAddButton = () =>
    Array.from(document.querySelectorAll('button, a, [role="button"]'))
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
    const el = document.getElementById("__yodayo_groups_status") || ensureOverlay().querySelector("#__yodayo_groups_status");
    el.textContent = txt;
  };

  const renderOverlayGroups = (groups) => {
    const body = document.getElementById("__yodayo_groups_body") || ensureOverlay().querySelector("#__yodayo_groups_body");
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
      const typeBtn = document.querySelector('button[id^="headlessui-listbox-button"][id*=":r8:"]');
      if (typeBtn) {
        typeBtn.click();
        await delay(300);
        const opt = Array.from(document.querySelectorAll("li, button"))
          .find((b) => norm(b.textContent) === norm(data.modelType));
        if (opt) opt.click();
      }
    }

    if (data.category) {
      const catBtn = document.querySelector('button[id^="headlessui-listbox-button"][id*=":ra:"]');
      if (catBtn) {
        catBtn.click();
        await delay(300);
        const opt = Array.from(document.querySelectorAll("li, button"))
          .find((b) => norm(b.textContent) === norm(data.category));
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

    const nextBtn = Array.from(document.querySelectorAll("button"))
      .find((b) => norm(b.textContent) === "next");
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
        const base = document.querySelector('button[id^="headlessui-listbox-button"][id*=":rq:"]');
        const addBtn = findTriggerAddButton();
        if (ver && base && addBtn) {
          clearInterval(iv);
          resolve();
        }
      }, 400);
    });
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
    const baseBtn = document.querySelector('button[id^="headlessui-listbox-button"][id*=":rq:"]');
    if (baseBtn) {
      baseBtn.click();
      await delay(300);
      const opt = Array.from(document.querySelectorAll("li, button"))
        .find((b) => b.textContent.toLowerCase().includes(data.baseModel.toLowerCase()));
      if (opt) opt.click();
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
    Array.from(document.querySelectorAll("button"))
      .find((b) => b.textContent.trim().toLowerCase().includes("trigger group"));

  for (let i = 0; i < groups.length; i++) {
    const words = groups[i].join(", ");
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

      const inputs = Array.from(document.querySelectorAll('input[name="trigger_word_groups"]'));
      const wordInput = inputs.slice(-1)[0];
      if (!wordInput) throw new Error("Word input not found after add");

      wordInput.value = words;
      wordInput.dispatchEvent(new Event("input", { bubbles: true }));
      console.log(`[Yodayo] Filled group ${i + 1}: ${words}`);
      setRowStatus(i, true);

      // Give React time to remount the button
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
