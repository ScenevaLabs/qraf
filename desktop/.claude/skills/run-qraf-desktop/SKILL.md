---
name: run-qraf-desktop
description: Build, run, and drive the qRaf Electron desktop app. Use when asked to start the desktop app, take a screenshot of it, or interact with its UI (login screen, disk dashboard).
---

qRaf desktop is a plain Electron app (no bundler — `renderer/*.html/js/css`
loaded directly). This machine runs Windows with a real desktop session,
so the app window actually appears on screen — no xvfb needed.

All paths are relative to `qRaf/desktop/`.

## Setup

```bash
npm install
```

(First install needs the Electron postinstall script approved once:
`npm approve-scripts electron` if npm reports it as pending.)

## Run (agent path)

Drive it via the Playwright REPL:

```bash
node .claude/skills/run-qraf-desktop/driver.mjs
```

For one-shot batch use (no persistent session needed), pipe commands in:

```bash
printf 'launch\nss dashboard\nquit\n' | node .claude/skills/run-qraf-desktop/driver.mjs
```

Screenshots land in `.shots/` (override: `SCREENSHOT_DIR`).

### Commands

| command | what it does |
|---|---|
| `launch` | launch the app, wait for the window |
| `ss [name]` | screenshot → `.shots/<name>.png` |
| `click <css-sel>` | click element (via DOM, not coords) |
| `fill <css-sel> <value>` | set an input's value + fire `input` event |
| `wait <css-sel>` | wait for element, 10s timeout |
| `eval <js>` | evaluate in the page, print JSON (wrap async code as `(async()=>{...})()`) |
| `text [css-sel]` | print innerText |
| `windows` | list windows |
| `quit` | close app, exit |

## Run (human path)

```bash
npm start   # opens a real window
```

## Gotchas

- **`hidden` attribute vs authored CSS:** if a view/element uses the
  `hidden` attribute for show/hide, make sure no class rule sets
  `display` on it without a matching `[hidden] { display: none }`
  override — an authored `display: flex` on `.view` silently beats the
  browser's default `[hidden]` styling and the "hidden" panel still
  renders. Bit us once in `renderer/styles.css`.
- **Path separators in `eval`:** passing a Windows path with
  backslashes through `printf`/bash quoting mangles the escapes. Use
  forward slashes in test paths (`fs`/Node accept both on Windows).
- **Piped batch input + readline:** stdin EOF fires `close` before
  async command handlers (e.g. `launch`, which takes a few seconds)
  finish. The driver queues line handlers and awaits the queue before
  exiting on `close` — don't remove that if you touch the driver.
- **Disk scanning is real I/O:** `disks:scan` recursively sums every
  file under a top-level folder — on a real multi-hundred-GB drive this
  is genuinely slow. The renderer renders all disk cards immediately
  from the cheap `disks:list` data and fills in scan results as each
  one resolves in parallel (`Promise.all`, not a sequential loop) —
  don't reintroduce sequential `for (const d of disks) await scan(d)`.
- **Native modules:** `drivelist` needs node-gyp/Visual Studio Build
  Tools to compile on this machine (no prebuilt binary for this
  Node/napi combo) and isn't installed. The app uses `systeminformation`
  instead (pure JS, shells out to OS commands) — don't reintroduce
  drivelist without confirming build tools are available.
