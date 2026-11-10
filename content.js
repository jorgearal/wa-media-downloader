// Runs on web.whatsapp.com. Drives WhatsApp's own media viewer and clicks Download per item.
(() => {
  if (window.__waMediaDl) return; // guard against double injection
  window.__waMediaDl = true;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const log = (...a) => console.log('[WA-DL]', ...a);

  const MAX_ATTEMPTS = 3; // per media item, then skip it
  const RETRY_DELAY_MS = 1000;
  const BUTTON_TIMEOUT_MS = 8000; // max wait for the Download button to become usable
  const UNAVAILABLE_GRACE_MS = 1500; // button missing this long → media unavailable
  const NAV_DELAY_MS = 250; // pause after moving to the previous item
  const MAX_REOPENS = 200; // safety cap on viewer re-opens per run

  let running = false;
  let stopRequested = false;

  async function waitFor(fn, timeout = 10000, interval = 200) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const v = fn();
      if (v) return v;
      await sleep(interval);
    }
    return null;
  }

  function realClick(el) {
    for (const type of ['mousedown', 'mouseup', 'click']) {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    }
  }

  function byLabel(root, labels) {
    for (const l of labels) {
      const el = root.querySelector(`[aria-label="${CSS.escape(l)}"]`);
      if (el) return el;
    }
    return null;
  }

  // ---------- chats ----------
  function listChats() {
    const names = $$(WA_SEL.chatRowTitle, $(WA_SEL.chatList) || document)
      .map((s) => s.getAttribute('title'))
      .filter(Boolean);
    return [...new Set(names)];
  }

  function findRow(name) {
    return $$(WA_SEL.chatRow).find((r) =>
      $$(WA_SEL.chatRowTitle, r).some((s) => s.getAttribute('title') === name)
    );
  }

  function setInputValue(input, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  async function openChat(name) {
    const current = $(WA_SEL.headerTitle);
    if (current && current.textContent.trim() === name) return;

    let row = findRow(name);
    let usedSearch = false;
    if (!row) {
      const input = $(WA_SEL.searchInput);
      if (!input) throw new Error('Search box not found');
      input.focus();
      setInputValue(input, name);
      usedSearch = true;
      row = await waitFor(() => findRow(name), 8000);
    }
    if (!row) throw new Error(`Chat "${name}" not found`);
    realClick($(WA_SEL.chatRowClickable, row) || row);

    const ok = await waitFor(() => $(WA_SEL.headerTitle)?.textContent.trim() === name, 8000);
    if (usedSearch) {
      const input = $(WA_SEL.searchInput);
      if (input) setInputValue(input, '');
    }
    if (!ok) throw new Error(`Could not open chat "${name}"`);
  }

  // ---------- gallery / viewer ----------
  // Make sure the chat's "Media, links and docs" → Media tab is showing.
  async function ensureGallery() {
    if (!$(WA_SEL.galleryGrid)) {
      if (!$(WA_SEL.mediaLinksDocsEntry)) {
        const info = await waitFor(() => $(WA_SEL.headerInfoButton));
        if (!info) throw new Error('Chat info button not found');
        info.click();
      }
      const entry = await waitFor(() => $(WA_SEL.mediaLinksDocsEntry));
      if (!entry) throw new Error('"Media, links and docs" not found');
      entry.click();
    }
    const tab = await waitFor(() => $(WA_SEL.galleryMediaTab));
    if (tab && tab.getAttribute('aria-selected') !== 'true') tab.click();
    return waitFor(() => $(WA_SEL.galleryItem), 10000);
  }

  function scrollContainer(el) {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const oy = getComputedStyle(n).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight) return n;
    }
    return null;
  }

  // Open the gallery item at `index` (0 = newest) in the viewer.
  // Scrolls the gallery so older items load. Returns the viewer, or null if
  // there is no item at that position (we're past the oldest one).
  async function openGalleryItem(index) {
    if (!(await ensureGallery())) return null; // chat has no media
    let items = $$(WA_SEL.galleryItem);
    let stalls = 0;
    while (items.length <= index && stalls < 6) {
      const scroller = scrollContainer($(WA_SEL.galleryGrid));
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
      else items[items.length - 1].scrollIntoView({ block: 'end' });
      await sleep(700);
      const now = $$(WA_SEL.galleryItem);
      stalls = now.length === items.length ? stalls + 1 : 0;
      items = now;
    }
    if (items.length <= index) return null;
    const target = items[index];
    target.scrollIntoView({ block: 'center' });
    await sleep(200);
    realClick($('button', target) || target);
    return waitFor(getModal, 10000);
  }

  const getModal = () => $(WA_SEL.viewerModal);
  const isEnabled = (el) => el && !el.disabled && el.getAttribute('aria-disabled') !== 'true';

  // Wait for the current item's Download button. WhatsApp removes the button when
  // the media is no longer available, so if it stays missing for UNAVAILABLE_GRACE_MS
  // we treat the item as unavailable instead of waiting out a long timeout.
  async function waitForDownloadButton() {
    let missingSince = Date.now();
    const end = Date.now() + BUTTON_TIMEOUT_MS;
    while (Date.now() < end) {
      const modal = getModal();
      if (!modal) return null;
      const dl = byLabel(modal, WA_SEL.viewerLabels.download);
      if (isEnabled(dl)) return dl;
      if (dl) missingSince = Date.now(); // present but still disabled: keep waiting
      else if (Date.now() - missingSince > UNAVAILABLE_GRACE_MS) return null;
      await sleep(100);
    }
    return null;
  }

  // One attempt at saving the item currently shown in the viewer.
  // Returns 'new' | 'duplicate' | 'timeout' | 'unavailable'.
  async function tryDownloadCurrent() {
    const dl = await waitForDownloadButton();
    if (!dl) return 'unavailable';
    await chrome.runtime.sendMessage({ type: 'armDownload' });
    dl.click();
    const { result } = await chrome.runtime.sendMessage({ type: 'waitDownload' });
    return result;
  }

  // Identifies the item on screen: sender/time header + media source.
  function mediaSignature() {
    const modal = getModal();
    if (!modal) return '';
    const header = [...modal.querySelectorAll('*')]
      .filter((e) => e.children.length === 0 && e.textContent.trim())
      .slice(0, 2)
      .map((e) => e.textContent.trim())
      .join('|');
    const v = modal.querySelector('video');
    const img = [...modal.querySelectorAll('img')].find((i) => i.naturalWidth > 200);
    return header + '|' + (v ? v.currentSrc || v.src : img ? img.src : '');
  }

  // Close any "media not available"-style dialog layered over the viewer.
  function dismissPopups() {
    const modal = getModal();
    for (const d of $$('[role="dialog"]')) {
      if (modal && (modal.contains(d) || d.contains(modal))) continue;
      // The media gallery drawer is also a role=dialog — never touch it.
      if (d.closest('[data-testid="drawer-right"]') || d.querySelector(WA_SEL.galleryGrid)) continue;
      const btns = d.querySelectorAll('button');
      if (btns.length >= 1 && btns.length <= 2) btns[btns.length - 1].click();
    }
  }

  // Move to the previous (older) item. Returns false only when there is nothing older.
  // Returns true (moved), false (oldest reached) or 'closed' (viewer disappeared).
  async function goPrevious() {
    dismissPopups();
    if (!getModal()) return 'closed';
    const before = mediaSignature();
    const prev = await waitFor(() => {
      const m = getModal();
      return m && byLabel(m, WA_SEL.viewerLabels.previous);
    }, 3000, 100);

    if (prev) {
      if (!isEnabled(prev)) return false; // first (oldest) item reached
      prev.click();
    } else {
      // Button missing (e.g. unavailable item layout): fall back to the keyboard.
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37, bubbles: true }));
    }
    const moved = await waitFor(() => !getModal() || mediaSignature() !== before, 4000, 100);
    if (!getModal()) return 'closed';
    if (!moved && !prev) return false;
    await sleep(NAV_DELAY_MS);
    return true;
  }

  function report(progress) {
    chrome.runtime.sendMessage({ type: 'progress', ...progress }).catch(() => {});
  }

  async function run(chat, { retry = true } = {}) {
    const maxAttempts = retry ? MAX_ATTEMPTS : 1;
    running = true;
    stopRequested = false;
    const p = { downloaded: 0, alreadySaved: 0, skipped: 0, status: 'Opening chat…', done: false };
    report(p);
    try {
      await openChat(chat);
      p.status = 'Opening media…';
      report(p);
      if (!(await openGalleryItem(0))) {
        p.status = 'No media in this chat.';
        return;
      }

      // index = gallery position of the item on screen (0 = newest).
      let index = 0;
      let reopens = 0;
      while (!stopRequested) {
        // WhatsApp closes the viewer when a broken video crashes its player.
        // Reopen the gallery at the current position and carry on.
        if (!getModal()) {
          if (++reopens > MAX_REOPENS) throw new Error('The media viewer kept closing — giving up');
          p.status = `Viewer closed — reopening at item ${index + 1}…`;
          report(p);
          log(`viewer closed, reopening at index ${index}`);
          await sleep(1000);
          dismissPopups();
          if (!(await openGalleryItem(index))) {
            p.status = 'Reached the oldest media — done.';
            break;
          }
        }

        const item = index + 1;
        let result = 'failed';
        for (let attempt = 1; attempt <= maxAttempts && !stopRequested; attempt++) {
          if (attempt > 1) {
            p.status = `Item ${item}: retry ${attempt - 1}/${maxAttempts - 1}…`;
            report(p);
            await sleep(RETRY_DELAY_MS);
          }
          if (!getModal()) { result = 'viewer-closed'; break; }
          result = await tryDownloadCurrent();
          log(`item ${item} attempt ${attempt}:`, result);
          if (result === 'new' || result === 'duplicate') break;
        }
        if (stopRequested) break;

        if (result === 'new') p.downloaded++;
        else if (result === 'duplicate') p.alreadySaved++;
        else p.skipped++;
        p.status = `Working… ${p.downloaded} new, ${p.alreadySaved} already saved, ${p.skipped} failed`;
        report(p);

        const nav = await goPrevious();
        if (nav === false) {
          p.status = 'Reached the oldest media — done.';
          break;
        }
        index++; // moved on, or viewer closed → top of loop reopens at the next item
      }
      if (stopRequested) p.status = 'Stopped.';
    } catch (e) {
      log(e);
      p.status = 'Error: ' + e.message;
    } finally {
      const m = $(WA_SEL.viewerModal);
      const close = m && byLabel(m, WA_SEL.viewerLabels.close);
      if (close) close.click();
      running = false;
      p.done = true;
      report(p);
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'listChats') sendResponse({ chats: listChats() });
    else if (msg.type === 'start') {
      const alreadyRunning = running;
      if (!alreadyRunning) run(msg.chat, { retry: msg.retry !== false });
      sendResponse({ ok: !alreadyRunning });
    } else if (msg.type === 'stop') {
      stopRequested = true;
      sendResponse({ ok: true });
    } else if (msg.type === 'ping') sendResponse({ ok: true, running });
  });
})();
