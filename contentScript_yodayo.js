// contentScript_yodayo.js
(() => {
  console.log("[Yodayo] content script loaded");

  const delay = (ms) => new Promise((res) => setTimeout(res, ms));

  const looksLikeTags = (txt) => {
    if (!txt) return false;
    const commas = (txt.match(/,/g) || []).length;
    const words = txt.split(/\s+/).length;
    return commas > 5 && words / commas < 3;
  };

  const norm = (s) => (s || "")
    .replace(/\s+/g, " ")
    .replace(/\u00A0/g, " ")
    .trim()
    .toLowerCase();

  function findTriggerAddButton() {
    // Be aggressive: scan buttons, anchors, and role="button"
    const candidates = Array.from(document.querySelectorAll('button, a, [role="button"]'));
    return candidates.find((el) => norm(el.textContent).includes("trigger group"));
  }

  function countTriggerInputs() {
    // Each group adds *two* inputs with the same name: [Group Name, Trigger Words]
    return document.querySelectorAll('input[name="trigger_word_groups"]').length;
  }

  function getLastTriggerWordBox() {
    const inputs = Array.from(document.querySelectorAll('input[name="trigger_word_groups"]'));
    if (inputs.length < 2) return null;
    // The last pair is [groupName, wordList]; we want the wordList (second)
    return inputs.slice(-2)[1] || null;
  }

  function ensureOverlay() {
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
  }

  function renderOverlayGroups(groups) {
    const body = document.getElementById("__yodayo_groups_body") || ensureOverlay().querySelector("#__yodayo_groups_body");
    body.innerHTML = "";
    groups.forEach((g, i) => {
      const row = document.createElement("div");
      row.id = `__yodayo_group_row_${i}`;
      row.style.cssText = "background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);padding:6px;border-radius:8px;";
      const words = Array.isArray(g) ? g.join(", ") : String(g || "");
      row.innerHTML = `
        <div style="display:flex;align-items:center;gap:6px">
          <span id="__yodayo_group_status_${i}" style="font-weight:700">⏳</span>
          <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:300px">
            ${words}
          </div>
        </div>
      `;
      body.appendChild(row);
    });
    setOverlayStatus(`Ready to create ${groups.length} group(s)…`);
  }

  function setRowStatus(i, ok, msg = "") {
    const icon = document.getElementById(`__yodayo_group_status_${i}`);
    if (!icon) return;
    icon.textContent = ok ? "✅" : "❌";
    if (msg) icon.title = msg;
  }

  function setOverlayStatus(text) {
    const el = document.getElementById("__yodayo_groups_status") || ensureOverlay().querySelector("#__yodayo_groups_status");
    el.textContent = text;
  }

  chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
    if (req.type !== "YODAYO_SET_FIELDS") return;
    const data = req.data || {};
    console.log("[Yodayo] received data", data);

    (async () => {
      try {
        await fillStep1(data);
        await waitForStep2();
        await fillStep2(data);
        // Stop here — do NOT click Next (user wants to edit groups manually)
        sendResponse({ ok: true });
      } catch (err) {
        console.error("[Yodayo] error:", err);
        sendResponse({ ok: false, error: err.message });
      }
    })();

    return true; // keep async channel open
  });

  // --------------------- STEP 1 ---------------------
  async function fillStep1(data) {
    console.log("[Yodayo] Step 1");
    const name = document.querySelector("#display_name");
    if (name && data.title) {
      name.value = data.title;
      name.dispatchEvent(new Event("input", { bubbles: true }));
    }

    // Type
    if (data.modelType) {
      const typeBtn = document.querySelector('button[id^="headlessui-listbox-button"][id*=":r8:"]');
      if (typeBtn) {
        typeBtn.click();
        await delay(350);
        const opt = Array.from(document.querySelectorAll("li, button"))
          .find((b) => norm(b.textContent) === norm(data.modelType));
        if (opt) opt.click();
      }
    }

    // Category
    if (data.category) {
      const catBtn = document.querySelector('button[id^="headlessui-listbox-button"][id*=":ra:"]');
      if (catBtn) {
        catBtn.click();
        await delay(350);
        const opt = Array.from(document.querySelectorAll("li, button"))
          .find((b) => norm(b.textContent) === norm(data.category));
        if (opt) opt.click();
      }
    }

    // Description
    const descBox = document.querySelector("#description");
    if (descBox) {
      let text = data.description || "";
      if (looksLikeTags(text)) text = data.title || "";
      if (!text && data.title) text = data.title;
      descBox.value = text;
      descBox.dispatchEvent(new Event("input", { bubbles: true }));
    }

    // Next → Step 2
    const nextBtn = Array.from(document.querySelectorAll("button"))
      .find((b) => norm(b.textContent) === "next");
    if (nextBtn) {
      nextBtn.click();
      console.log("[Yodayo] clicked Next → Step 2");
    }
  }

  // --------------------- STEP 2 ---------------------
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

  async function fillStep2(data) {
    console.log("[Yodayo] Step 2");

    // Version Name
    const verInput = document.querySelector("#name");
    if (verInput && data.versionName) {
      verInput.value = data.versionName;
      verInput.dispatchEvent(new Event("input", { bubbles: true }));
    }

    // Base Model
    if (data.baseModel) {
      const baseBtn = document.querySelector('button[id^="headlessui-listbox-button"][id*=":rq:"]');
      if (baseBtn) {
        baseBtn.click();
        await delay(350);
        const opt = Array.from(document.querySelectorAll("li, button"))
          .find((b) => norm(b.textContent).includes(norm(data.baseModel)));
        if (opt) opt.click();
      }
    }

    // Trigger Groups
    const groups = Array.isArray(data.triggerGroups) ? data.triggerGroups.filter(g => Array.isArray(g) && g.length) : [];
    if (!groups.length) {
      console.log("[Yodayo] no triggerGroups provided");
      setOverlayStatus("No trigger groups captured from CivitAI.");
      return;
    }

    ensureOverlay();
    renderOverlayGroups(groups);
    setOverlayStatus(`Creating ${groups.length} group(s)…`);

    const addBtn = findTriggerAddButton();
    if (!addBtn) {
      setOverlayStatus("⚠️ Could not find 'Trigger Group' button.");
      console.warn("[Yodayo] Trigger Group button not found");
      return;
    }

    // Create each group sequentially and fill words
    for (let i = 0; i < groups.length; i++) {
      const wordsArr = groups[i];
      try {
        const before = countTriggerInputs();
        addBtn.click();
        console.log("[Yodayo] clicked Trigger Group (creating group", i + 1, ")");

        // wait for +2 inputs to appear (GroupName + Words)
        let tries = 0;
        while (countTriggerInputs() < before + 2 && tries < 20) {
          await delay(150);
          tries++;
        }

        const wordInput = getLastTriggerWordBox();
        if (!wordInput) {
          setRowStatus(i, false, "Word input not found");
          console.warn("[Yodayo] word input not found for group", i);
          continue;
        }

        const words = wordsArr.join(", ");
        wordInput.value = words;
        wordInput.dispatchEvent(new Event("input", { bubbles: true }));
        setRowStatus(i, true);
        console.log("[Yodayo] filled group", i + 1, "with:", words);

      } catch (e) {
        setRowStatus(i, false, e?.message || "unknown error");
        console.error("[Yodayo] failed to create/fill group", i, e);
      }
    }

    setOverlayStatus("Done. Staying on page 2.");
    console.log("[Yodayo] done — staying on page 2 (no Next click)");
  }
})();
