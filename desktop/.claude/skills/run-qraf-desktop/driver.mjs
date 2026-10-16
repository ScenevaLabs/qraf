// REPL driver for qRaf desktop (Electron). Windows has a real desktop
// session here, so no xvfb — the window actually appears on screen.
// Designed for agents: wrap in tmux/background shell, send commands via
// stdin, read output/screenshots.
import { _electron as electron } from 'playwright-core';
import * as readline from 'node:readline';
import * as fs from 'node:fs';
import * as path from 'node:path';

const APP_DIR = path.resolve(import.meta.dirname, '../../..');
const SHOT_DIR = process.env.SCREENSHOT_DIR || path.join(APP_DIR, '.shots');
fs.mkdirSync(SHOT_DIR, { recursive: true });

let app = null;
let page = null;

const electronBin = process.platform === 'darwin'
  ? path.join(APP_DIR, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  : path.join(APP_DIR, 'node_modules/electron/dist/electron.exe');

const COMMANDS = {
  async launch() {
    if (app) return console.log('already launched');
    app = await electron.launch({
      executablePath: electronBin,
      args: [APP_DIR],
      timeout: 30_000,
    });
    page = app.windows().find((w) => !w.url().startsWith('devtools://'))
      ?? await app.firstWindow();
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    console.log('launched.', app.windows().length, 'windows:');
    for (const w of app.windows()) console.log(' ', w.url());
  },

  async ss(name) {
    if (!page) return console.log('ERROR: launch first');
    const f = path.join(SHOT_DIR, (name || `ss-${Date.now()}`) + '.png');
    await page.screenshot({ path: f });
    console.log('screenshot:', f);
  },

  async click(sel) {
    if (!page) return console.log('ERROR: launch first');
    const r = await page.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) return 'NOT_FOUND';
      el.click();
      return 'OK';
    }, sel);
    console.log('click', sel, '→', r);
  },

  async fill(args) {
    if (!page) return console.log('ERROR: launch first');
    const sp = args.indexOf(' ');
    const sel = args.slice(0, sp);
    const value = args.slice(sp + 1);
    const r = await page.evaluate(({ s, v }) => {
      const el = document.querySelector(s);
      if (!el) return 'NOT_FOUND';
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return 'OK';
    }, { s: sel, v: value });
    console.log('fill', sel, '→', r);
  },

  async wait(sel) {
    if (!page) return console.log('ERROR: launch first');
    try {
      await page.waitForSelector(sel, { timeout: 10_000 });
      console.log('found:', sel);
    } catch {
      console.log('TIMEOUT:', sel);
    }
  },

  async eval(expr) {
    if (!page) return console.log('ERROR: launch first');
    try {
      console.log(JSON.stringify(await page.evaluate(expr)));
    } catch (e) {
      console.log('ERROR:', e.message);
    }
  },

  async text(sel) {
    if (!page) return console.log('ERROR: launch first');
    console.log(
      await page.evaluate(
        (s) => (s ? document.querySelector(s) : document.body)?.innerText ?? '(null)',
        sel || null
      )
    );
  },

  async windows() {
    if (!app) return console.log('ERROR: launch first');
    for (const w of app.windows()) console.log(' ', w.url());
  },

  async type(text) {
    if (!page) return console.log('ERROR: launch first');
    await page.keyboard.type(text, { delay: 20 });
    console.log('typed:', JSON.stringify(text));
  },

  async press(key) {
    if (!page) return console.log('ERROR: launch first');
    await page.keyboard.press(key);
    console.log('pressed:', key);
  },

  async quit() {
    if (app) await app.close().catch(() => {});
    app = null;
    page = null;
  },
  help() {
    console.log('commands:', Object.keys(COMMANDS).join(', '));
  },
};

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'driver> ' });

// Lines can arrive faster than an async command finishes (e.g. all piped
// in at once) — queue them so each command completes before the next runs.
let queue = Promise.resolve();

// stdin can already be closed by the time we get here (e.g. piped batch
// input) — rl.prompt() throws ERR_USE_AFTER_CLOSE in that case, harmless.
function safePrompt() {
  try {
    rl.prompt();
  } catch {
    // ignore
  }
}

rl.on('line', (line) => {
  queue = queue.then(async () => {
    const sp = line.indexOf(' ');
    const cmd = sp === -1 ? line.trim() : line.slice(0, sp).trim();
    const rest = sp === -1 ? '' : line.slice(sp + 1);
    if (!cmd) return safePrompt();
    const fn = COMMANDS[cmd];
    if (!fn) {
      console.log('unknown:', cmd, '— try: help');
      return safePrompt();
    }
    try {
      await fn(rest);
    } catch (e) {
      console.log('ERROR:', e.message);
    }
    if (cmd === 'quit') {
      rl.close();
      process.exit(0);
    }
    safePrompt();
  });
});
rl.on('close', async () => {
  await queue;
  if (app) await COMMANDS.quit();
  process.exit(0);
});

console.log('qraf-desktop driver — "help" for commands, "launch" to start');
rl.prompt();
