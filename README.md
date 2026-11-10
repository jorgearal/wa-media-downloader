# WhatsApp Media Downloader

Chrome extension that downloads the photos and videos from a WhatsApp Web chat into
`~/Downloads/<Folder>/<YYYY-MM-DD>/`, keeping WhatsApp's original filenames.
It remembers what it already saved, so you can re-run it any time and only new (or previously missed) media is downloaded.

## Install
1. Clone or download this repository.
2. Go to `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the project folder.
4. In `chrome://settings/downloads`, turn **off** "Ask where to save each file before downloading".

## Use
1. Click the extension icon, then **Open WhatsApp Web** (log in if you need to).
2. Type or pick the chat name and set the folder name inside Downloads (default `DogDaycare`).
3. Optionally tick **Retry items that fail to load** (up to 3 tries per item; unticked = skip on first failure).
4. Click **Download new media**.

The extension opens the chat's *Media, links and docs* gallery, starts from the newest item and walks back to the oldest one:
- **Already saved** → skipped (no duplicate file).
- **Not saved yet** → downloaded into its date folder.
- **Unavailable** (e.g. old media WhatsApp can no longer load) → skipped and the run continues.
  If WhatsApp closes the viewer after a broken video, the extension reopens the gallery and carries on.

Press **Stop** to end a run early. **Forget download history for this chat** makes the next run download everything again.

## How "already downloaded" is tracked
The history lives in the extension's `chrome.storage.local` (one `seen:<chat name>` list of `filename|size` entries),
not in your Downloads folder — so you can move or rename saved files freely. Removing the extension deletes the history.

## Troubleshooting
- Debug logs are prefixed with `[WA-DL]` in the WhatsApp Web tab's DevTools console.
- Every WhatsApp DOM hook is in `selectors.js`; if WhatsApp changes its UI, that's the file to update.
- Timings (retries, waits) are constants at the top of `content.js` and `background.js`.

## Disclaimer
This project is not affiliated with, endorsed by, or connected to WhatsApp or Meta.
It only automates the WhatsApp Web interface in your own browser, for chats you already have access to.

## Developer
Jorge — [jorge.aral@live.com](mailto:jorge.aral@live.com) · [github.com/jorgearal](https://github.com/jorgearal)

## License
[MIT](LICENSE)
