# Prepost

A local, human-in-the-loop assistant that **prepares** social media posts in the official web interfaces of Meta Business Suite (Facebook / Instagram), X, YouTube Studio and TikTok Studio, using a visible Playwright-controlled browser.

**It never publishes.** It fills the composer, uploads your media, verifies what it can, and stops. You review each post and click the platform's own Publish / Post button yourself.

## Using Prepost as a team (Netlify)

Prepost has two parts:

| Part | Where it runs | What it does |
|---|---|---|
| **Dashboard** | Netlify (one shared URL) | Where you write the post, choose platforms and follow progress |
| **Engine** | Each person's own computer (`npm start`) | Fills the posts in that person's own Chrome, with their own logins |

The engine can't run on Netlify. It needs a real browser and each person's accounts, and Netlify only serves web pages. When someone opens the Netlify URL without the engine running, the dashboard shows a "Start Prepost on this computer" screen with the steps.

### Deploy the dashboard (once)

1. Push this repository to GitHub.
2. On Netlify: **Add new site → Import an existing project**, then pick the repository. `netlify.toml` already sets the build (`npm run build`, publish `dist`).
3. In `netlify.toml`, set `VITE_REPO_URL` to your repository URL so the setup screen shows the right `git clone` command.
4. Add your Netlify address (for example `https://prepost-team.netlify.app`) to `engine.config.json`, commit and push:

   ```json
   { "allowedOrigins": ["https://prepost-team.netlify.app"] }
   ```

   The engine only accepts requests from the addresses listed there, plus local pages on the same computer.

### Each colleague (once)

1. Install Node.js 20 or newer.
2. Clone the repository and install: `npm install && npm run setup:browser`.
3. Start the engine with `npm start`. Keep it running while working.
4. Load the Chrome extension: open `chrome://extensions`, turn on Developer mode, click **Load unpacked**, choose the `extension` folder, and paste the pairing code the dashboard shows.
5. Open the Netlify URL. Chrome may ask to let the site connect to devices on your local network. Allow it, because that's how the page reaches the engine at `127.0.0.1`.

Without Netlify, `npm start` also serves the dashboard locally at http://localhost:5174 (after `npm run build`).

## Requirements

- macOS, Windows or Linux with **Node.js 20+** (tested on Node 24)
- About 500 MB for Playwright's Chromium

## Install

```bash
cd social-post-assistant
npm install
npm run setup:browser      # downloads Playwright's Chromium (once)
```

## Run

```bash
npm run dev
```

Open **http://127.0.0.1:5173**. The API runs on 127.0.0.1:5174 and only accepts local requests.

For a single process: `npm run build && npm start`, then open http://localhost:5174.

Other scripts: `npm test` (validation, safety guard and module tests), `npm run typecheck`.

### Optional environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `5174` | API port |
| `SPA_BROWSER_CHANNEL` | *(bundled Chromium)* | Set to `chrome` to drive your installed Google Chrome, which Google sign-in tends to accept more readily |
| `SPA_DATA_DIR` | `~/.social-post-assistant` | Where the browser profile, temporary media and logs are kept |
| `SPA_MAX_UPLOAD_BYTES` | 8 GiB | Maximum size of one media file |

## Choosing the browser

The **Browser** menu at the top of the dashboard has three modes:

| Mode | What it does |
|---|---|
| **My Chrome profile (extension)** (recommended) | Prepares posts in **your everyday Chrome profile**, using the accounts you're already signed in to. A small bridge extension opens background tabs and fills them. |
| **Google Chrome (separate profile)** | Your installed Chrome with a dedicated profile (`~/.social-post-assistant/chrome-profile`). You sign in there once. |
| **Automation Chromium** | Playwright's bundled Chromium with its own profile. |

### Setting up "My Chrome profile (extension)"

Since version 136, Chrome refuses to let automation tools take over your main profile. An extension you install yourself is the supported way to automate it. One-time setup (the dashboard shows these steps, with copy buttons):

1. In your Chrome profile, open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and choose the `extension/` folder of this project.
3. Click the extension's icon (**Prepost Bridge**), paste the **pairing code** shown on the dashboard, and press **Save & connect**. The dashboard turns green.

How it works: `extension/background.js` connects to `ws://127.0.0.1:5174/bridge/extension` with the pairing code. When you press **Prepare**, the app's relay (`server/bridge/cdpRelay.ts`) asks the extension to open a **background tab** and drives it through Chrome's `chrome.debugger` API. All the platform modules and the no-publish guard work exactly as in the other modes.

- You stay on your current tab. Use **Show tab** / **Review prepared post** on a status card to switch.
- While a tab is under automation, Chrome shows a "started debugging this browser" bar. That's Chrome's own safety notice. Pressing **Cancel** on it, or closing the tab, stops the automation for that tab.
- The extension controls only tabs the app opened. It only connects to `127.0.0.1` with the pairing code, and the relay rejects connections that don't come from an extension or that have the wrong code.
- Keep the pairing code private. If you think it leaked, delete `bridgeToken` from `~/.social-post-assistant/settings.json` and restart the app to get a new one.
- Developer-mode extensions are kept across restarts, but Chrome may show a reminder about them.

The mode is saved in `~/.social-post-assistant/settings.json`. You can also set it with `SPA_BROWSER_MODE=extension|chrome|bundled`.

## Signing in (once per platform)

1. In the dashboard, click **Open platform** on a destination card (or **Open browser**).
2. Sign in **in that browser window, on the official site**, including any 2-step verification or CAPTCHA.
3. Done. The session is stored in a dedicated profile (`~/.social-post-assistant/browser-profile`, permissions `700`) and reused on later launches.

| Platform | What to sign into |
|---|---|
| Facebook / Instagram | business.facebook.com. Your Instagram account must be connected to the Page in Meta Business Suite. |
| X | x.com |
| YouTube | Your Google account at studio.youtube.com. A channel must exist. |
| TikTok | tiktok.com, then TikTok Studio |

The app never asks for, sees or stores your passwords. If a job finds you signed out, or a site shows a security check, the job pauses as **Login required** / **Needs attention**. Handle it in the browser and the job continues on its own, or press **Continue**.

> Google sometimes refuses sign-in from automation-controlled browsers ("This browser or app may not be secure"). If that happens, run with `SPA_BROWSER_CHANNEL=chrome npm run dev`. If Google still refuses, YouTube can't be automated on this machine. The app doesn't try to work around this.

## Using it

1. **Content**: write the main text (Arabic/RTL, French, English, emoji, hashtags and line breaks are preserved). Add an optional link and choose whether to append it to the text. Drop images or videos. Use **Import as media file** only for *direct* image/video URLs; anything else stays a link.
2. **Destinations**: tick Facebook, Instagram, X, YouTube Studio and/or TikTok Studio.
3. **Customize & preview**: per destination, use the main text or a custom one, choose which media to include, and toggle the link. YouTube has its own title, thumbnail, audience and visibility fields. Each preview shows the final text, the media, and any warnings or blocking errors.
4. Click **Prepare Selected Platforms**. Each destination gets its own tab and its own status card, and a failure on one doesn't stop the others.
5. When a card says **Ready for manual review**, click **Review prepared post**, check everything, and publish it yourself.

Card actions: **Continue** (after you handle something in the browser), **Retry**, **Cancel**, **Review prepared post**, **Remove**, and **Log** for the step-by-step log.

### What each module does, and where it stops

| Module | Fills / uploads | Stops before |
|---|---|---|
| Meta Business Suite | Opens the composer, **pauses so you can tick the right Page / Instagram account under "Post to"**, then fills the text and uploads photos or a video | Publish / Schedule |
| X | Opens `x.com/compose/post`, fills the text, uploads up to 4 images or 1 video, waits for processing | Post |
| YouTube Studio | Uploads the video, fills title and description, optional thumbnail, audience if configured, clicks **Next** to the Visibility step if enabled, optionally selects a visibility | Save / Publish |
| TikTok Studio | Uploads the video (or photos if the page accepts them), replaces the auto-filled caption, waits for the upload | Post |

When Facebook and Instagram have identical text and media, they're prepared in one Meta composer. Otherwise each gets its own tab.

## YouTube channels

When you tick **YouTube Studio** under Destinations, it shows a **Channel** choice. **Load from YouTube** reads your channels from YouTube's channel switcher, and **Edit list** lets you add or remove channels by hand. Before filling anything, the job checks which channel YouTube is acting as, using the heading of youtube.com/profile. If it's a different one, the job switches through the channel switcher and checks again. If the switch can't be confirmed, the job pauses and asks you to switch.

You choose one channel per preparation. YouTube's active channel applies to the whole browser, so preparing two channels at once could leave a draft that would publish as the wrong channel.

## Platform tabs and video covers

**One tab per platform.** Each platform gets its own tab, and Meta gets one per Page. **Prepare**, **Retry** and **Open platform** all work inside that tab instead of opening and closing new ones. Preparing again in the same tab replaces the previous, unpublished draft there. In extension mode the tab is handed back to you when the job finishes, so Chrome's debugging bar disappears, and it's taken over again on the next run. This needs extension version 1.1.0 or later: after updating the app, open `chrome://extensions` and press the reload icon on **Prepost Bridge**. With an older extension, the app falls back to opening a new tab.

**Video cover / thumbnail.** In **Media**, tick **Video cover** on an image. It's used as:

| Destination | Where the cover goes |
|---|---|
| YouTube video or Short | Studio's thumbnail upload (needs a verified channel) |
| TikTok video | **Modifier la couverture** → upload → **Enregistrer** (only inside the cover editor) |
| Meta Reel | Thumbnail → **Upload image** |

The cover image is never posted as a photo. Business Suite has no custom thumbnail for regular video posts, and X has none for videos on the web; the preview warns you when the cover won't be used.

## The no-publish guarantee

- Platform modules never call `click()`, `press()` or `submit()` directly. Every click goes through `safeClick()` in `server/automation/safeActions.ts`, which inspects the element first. It refuses anything labelled Post / Publish / Share / Send / Schedule / Save / Done (English, French and Arabic), any known final-submission selector, and any form submit button. A refusal fails that job with a "Safety stop" message.
- Text is inserted with paste events or text insertion. Line breaks use Shift+Enter. No submit shortcut is ever pressed.
- A test (`tests/safety.test.ts`) checks the guard against sample buttons and scans the platform modules for direct `click`, `press` and `keyboard` calls.
- The UI has no "Published" state. The successful end state is **Ready for manual review**.

## Data and security

- The server binds to `127.0.0.1` and rejects non-local `Host` / `Origin` headers, cross-site requests, and state-changing requests that lack the app's custom header.
- The frontend can't send file paths. Uploads are copied to a private staging folder, identified by their file signature (not the extension), and referenced only by ID. Staged copies are deleted on **Clear content** and on server start and stop.
- The browser only opens fixed official URLs. User text and URLs are never navigated to or executed.
- Logs (`~/.social-post-assistant/logs/app.log`) redact cookie, token, password and session values and strip URL query strings.
- Draft text is kept in the tab's `sessionStorage`. Only non-sensitive preferences (selected destinations, YouTube/Meta defaults) are kept in `localStorage`.

## When a platform changes its interface

Selectors live in one file per platform, separate from the workflow logic:

```
server/platforms/selectors/meta.ts
server/platforms/selectors/x.ts
server/platforms/selectors/youtube.ts
server/platforms/selectors/tiktok.ts
```

Each entry is a list of candidates tried in order. To fix a broken step:

1. Open the job's **Log**. The failed step and the selectors that were tried are named there.
2. Open the page in the automation browser, right-click the element and choose **Inspect**. Prefer stable attributes: `data-testid`, `data-e2e`, `name`, `aria-label`, `role`.
3. Add the new selector at the **front** of the relevant list and save. `npm run dev` reloads the server automatically.
4. If a site adds a new final-submission button, add its selector to that file's `forbidden` list. If it uses a new label, add the label to `FORBIDDEN_EXACT` in `safeActions.ts`.

Platform limits (characters, file types, sizes, counts) are in `shared/rules.ts`. The UI and the server share them.

## Project layout

```
shared/        types, platform rules, validation (used by UI and server)
src/           React + Vite dashboard (components/, pages/Dashboard.tsx, api.ts)
server/
  index.ts                 Express API, local-only guards, SSE status stream
  browser/browserManager.ts persistent visible Chromium context
  automation/              safeActions (no-publish guard), helpers, session/login handling
  platforms/               meta.ts, x.ts, youtubeStudio.ts, tiktokStudio.ts + selectors/
  services/                automationManager, mediaStore, contentValidator
  utils/logger.ts
tests/         node:test suites (run with npm test)
```

## What has been verified, and what has not

Verified during development:
- All validation rules, the no-publish guard, and the X and YouTube modules' full fill/upload/verify flow, run against **local mock pages** that imitate the selectors.
- The extension bridge end to end (`tests/bridge.test.ts`): a Chromium with the unpacked extension loaded pairs with the relay. The X module then fills text and uploads an image in a background tab, the user's active tab stays in front, a wrong pairing code is rejected, and the Post button is refused. `npm test` runs 22 tests.
- Against the **real sites, signed out**, in a visible browser: each module opens the official page and correctly detects that sign-in is needed (Meta Business Suite, X, YouTube Studio, TikTok Studio). Cancel and browser close are handled.
- Local-only API guards, file-signature checks, and refusal of non-media URL imports.

**Not verified:** the signed-in composer workflows on the live sites, because no accounts were available during development. The selectors for those steps come from the sites' known structure and have fallbacks, but expect to adjust some of them on first use, especially Meta Business Suite and TikTok Studio, which change often. When a selector fails, the job stops safely and names the step and the selectors it tried.

### Known platform limitations

- **Meta**: choosing the Page / Instagram account is left to you (the app pauses for it), because the "Post to" picker can't be identified reliably. Media previews can't always be counted automatically; the check then shows as "unverified".
- **YouTube**: selecting a file creates a *private draft* on your channel even if you never publish it. Custom thumbnails need a verified channel. The audience ("made for kids") question is required; if you don't set it, the job stops on the Details step.
- **TikTok**: photo posts on the web aren't available for every account or region. If the upload page doesn't accept images, the job says so and stops.
- **X**: posts over 280 characters need Premium (shown as a warning). Headless browsers get HTTP 403 from X, which is one reason the app always uses a visible browser.
- Platforms may show rate limits, policy prompts or new dialogs. The app pauses or fails with a message rather than guessing.
