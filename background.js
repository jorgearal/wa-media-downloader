// Service worker: rewrites WhatsApp download paths into <folder>/<YYYY-MM-DD>/<name>
// and remembers what was already saved so each run only downloads new media.

const DOWNLOAD_TIMEOUT_MS = 10000;

// In-memory handshake between the content script and the download listener.
let armed = false;
let pendingResult = null; // result that arrived before waitDownload was called
let waiter = null; // { resolve, timer }
const keyByDownloadId = new Map(); // downloadId -> { chat, key }

const getRun = async () => (await chrome.storage.session.get('run')).run || null;
const setProgress = (progress) => chrome.storage.session.set({ progress });

function sanitizeFolder(folder) {
  const clean = String(folder || 'DogDaycare')
    .split(/[\\/]+/)
    .map((p) => p.trim().replace(/[<>:"|?*\x00-\x1f]/g, ''))
    .filter((p) => p && p !== '.' && p !== '..')
    .join('/');
  return clean || 'DogDaycare';
}

function deliver(result) {
  // A late download from an attempt that already timed out: the file is still
  // saved (and recorded), but don't credit it to whatever item is shown now.
  if (!armed) return;
  armed = false;
  if (waiter) {
    clearTimeout(waiter.timer);
    waiter.resolve(result);
    waiter = null;
  } else {
    pendingResult = result;
  }
}

function isWhatsApp(item) {
  return [item.url, item.finalUrl, item.referrer].some((u) => (u || '').includes('web.whatsapp.com'));
}

const seenKey = (chat) => `seen:${chat}`;

async function handleDownload(item, suggest) {
  const run = await getRun();
  if (!run || !run.active) return suggest();

  const name = item.filename.split(/[\\/]/).pop();
  const date = (name.match(/(\d{4}-\d{2}-\d{2})/) || [])[1] || 'unknown-date';
  const size = item.totalBytes > 0 ? item.totalBytes : item.fileSize > 0 ? item.fileSize : 0;
  const key = `${name}|${size}`;

  const store = await chrome.storage.local.get(seenKey(run.chat));
  const seen = store[seenKey(run.chat)] || [];

  if (seen.includes(key)) {
    suggest();
    try {
      await chrome.downloads.cancel(item.id);
      await chrome.downloads.erase({ id: item.id });
    } catch (_) {}
    deliver('duplicate');
    return;
  }

  seen.push(key);
  await chrome.storage.local.set({ [seenKey(run.chat)]: seen });
  keyByDownloadId.set(item.id, { chat: run.chat, key });
  suggest({ filename: `${run.folder}/${date}/${name}`, conflictAction: 'uniquify' });
  deliver('new');
}

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  if (!isWhatsApp(item)) return; // not ours: let Chrome decide
  handleDownload(item, suggest).catch((e) => {
    console.error(e);
    try { suggest(); } catch (_) {}
  });
  return true; // we call suggest asynchronously
});

// If a download fails, forget it so the next run retries it.
chrome.downloads.onChanged.addListener(async (delta) => {
  const entry = keyByDownloadId.get(delta.id);
  if (!entry || !delta.state) return;
  if (delta.state.current === 'complete') keyByDownloadId.delete(delta.id);
  if (delta.state.current === 'interrupted') {
    keyByDownloadId.delete(delta.id);
    const k = seenKey(entry.chat);
    const seen = (await chrome.storage.local.get(k))[k] || [];
    await chrome.storage.local.set({ [k]: seen.filter((x) => x !== entry.key) });
  }
});

async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'ping' });
  } catch (_) {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['selectors.js', 'content.js'] });
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case 'startRun': {
        const folder = sanitizeFolder(msg.folder);
        await chrome.storage.session.set({ run: { active: true, chat: msg.chat, folder, tabId: msg.tabId } });
        await setProgress({ downloaded: 0, skipped: 0, status: 'Starting…', done: false });
        await ensureContentScript(msg.tabId);
        const res = await chrome.tabs.sendMessage(msg.tabId, { type: 'start', chat: msg.chat, retry: msg.retry !== false });
        sendResponse(res);
        break;
      }
      case 'stopRun': {
        const run = await getRun();
        if (run?.tabId) await chrome.tabs.sendMessage(run.tabId, { type: 'stop' }).catch(() => {});
        sendResponse({ ok: true });
        break;
      }
      case 'listChats': {
        await ensureContentScript(msg.tabId);
        sendResponse(await chrome.tabs.sendMessage(msg.tabId, { type: 'listChats' }));
        break;
      }
      case 'resetHistory': {
        await chrome.storage.local.remove(seenKey(msg.chat));
        sendResponse({ ok: true });
        break;
      }
      case 'armDownload': {
        armed = true;
        pendingResult = null;
        sendResponse({ ok: true });
        break;
      }
      case 'waitDownload': {
        if (pendingResult) {
          const r = pendingResult;
          pendingResult = null;
          sendResponse({ result: r });
          break;
        }
        await new Promise((resolve) => {
          waiter = {
            resolve: (result) => { sendResponse({ result }); resolve(); },
            timer: setTimeout(() => { waiter = null; armed = false; sendResponse({ result: 'timeout' }); resolve(); }, DOWNLOAD_TIMEOUT_MS)
          };
        });
        break;
      }
      case 'progress': {
        const { type, ...progress } = msg;
        await setProgress(progress);
        if (progress.done) {
          const run = await getRun();
          if (run) await chrome.storage.session.set({ run: { ...run, active: false } });
        }
        sendResponse({ ok: true });
        break;
      }
      default:
        sendResponse({ ok: false });
    }
  })().catch((e) => {
    console.error(e);
    try { sendResponse({ ok: false, error: e.message }); } catch (_) {}
  });
  return true;
});
