const $ = (id) => document.getElementById(id);
const WA_URL = 'https://web.whatsapp.com/';

async function findWaTab() {
  const [tab] = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
  return tab || null;
}

function renderProgress(p) {
  if (!p) return;
  $('status').textContent = p.done
    ? `${p.status} (${p.downloaded || 0} new, ${p.alreadySaved || 0} already saved, ${p.skipped || 0} failed)`
    : p.status;
  $('start').disabled = !p.done;
  $('stop').disabled = !!p.done;
}

async function loadChats() {
  const tab = await findWaTab();
  if (!tab) return;
  try {
    const res = await chrome.runtime.sendMessage({ type: 'listChats', tabId: tab.id });
    $('chatList').innerHTML = '';
    for (const name of res?.chats || []) {
      const opt = document.createElement('option');
      opt.value = name;
      $('chatList').appendChild(opt);
    }
  } catch (_) { /* WhatsApp still loading */ }
}

async function init() {
  const { chat = '', folder = 'DogDaycare', retry = true } = await chrome.storage.local.get(['chat', 'folder', 'retry']);
  $('chat').value = chat;
  $('retry').checked = retry;
  $('folder').value = folder;
  $('folderPreview').textContent = folder;

  const { progress, run } = await chrome.storage.session.get(['progress', 'run']);
  if (run?.active) renderProgress(progress);
  else if (progress) $('status').textContent = progress.done ? `Last run: ${progress.status} (${progress.downloaded} downloaded)` : '';

  loadChats();
}

$('openWa').addEventListener('click', async () => {
  const tab = await findWaTab();
  if (tab) {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: WA_URL });
  }
});

$('folder').addEventListener('input', () => {
  $('folderPreview').textContent = $('folder').value.trim() || 'DogDaycare';
});

$('start').addEventListener('click', async () => {
  const chat = $('chat').value.trim();
  const folder = $('folder').value.trim() || 'DogDaycare';
  if (!chat) { $('status').textContent = 'Pick a chat first.'; return; }
  const tab = await findWaTab();
  if (!tab) { $('status').textContent = 'Open WhatsApp Web first.'; return; }

  const retry = $('retry').checked;
  await chrome.storage.local.set({ chat, folder, retry });
  renderProgress({ status: 'Starting…', done: false });
  const res = await chrome.runtime.sendMessage({ type: 'startRun', chat, folder, retry, tabId: tab.id });
  if (res && res.ok === false) {
    renderProgress({ status: res.error ? 'Error: ' + res.error : 'A run is already in progress.', done: true, downloaded: 0, skipped: 0 });
  }
});

$('stop').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'stopRun' }));

$('reset').addEventListener('click', async () => {
  const chat = $('chat').value.trim();
  if (!chat) return;
  await chrome.runtime.sendMessage({ type: 'resetHistory', chat });
  $('status').textContent = `History cleared for "${chat}". Next run downloads everything.`;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.progress) renderProgress(changes.progress.newValue);
});

init();
