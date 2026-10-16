// Faz 16 rol arayüzünü sahte Supabase ile sınar (canlı DB'ye dokunmaz):
// admin → USERS/QR sekmeleri görünür, panel doluyor, davet/rol/çıkar
// çağrıları doğru gidiyor; kullanıcı → admin düğmeleri gizli; SIGN OUT
// oturumu kapatıp giriş ekranına dönüyor.
// Kullanım (qRaf/desktop içinden): node .claude/skills/run-qraf-desktop/roles-check.mjs [ekran-görüntüsü-klasörü]
import { _electron as electron } from 'playwright-core';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const APP_DIR = path.resolve(import.meta.dirname, '../../..');
const SHOT_DIR = process.argv[2] || path.join(APP_DIR, '.shots');
fs.mkdirSync(SHOT_DIR, { recursive: true });
const electronBin = process.platform === 'darwin'
  ? path.join(APP_DIR, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  : path.join(APP_DIR, 'node_modules/electron/dist/electron.exe');

let failed = 0;
const check = (cond, msg) => { console.log(cond ? '  ✓' : '  ✗', msg); if (!cond) failed++; };

// Sayfaya enjekte edilen sahte Supabase. `window.__calls` yapılan yazmaları tutar.
function installFake(role) {
  const me = { id: 'me', email: 'yonetici@example.com' };
  const db = {
    profiles: [
      { id: 'me', email: 'yonetici@example.com', role },
      { id: 'u2', email: 'ekip@example.com', role: 'standart' },
    ],
    invitations: [{ id: 'i1', email: 'yeni@example.com', role: 'standart', created_at: '2026-10-13' }],
    disks: [{ id: 'd1', name: '1. Disk', status: 'active', top_level_folders: [], total_bytes: 1e12, free_bytes: 5e11 }],
    organizations: [{ id: 'o1', name: 'Örnek Prodüksiyon' }],
  };
  window.__calls = [];
  function q(table) {
    let filter = null;
    let op = 'select';
    let values = null;
    const run = () => {
      let rows = db[table] || [];
      if (filter) rows = rows.filter((r) => r[filter[0]] === filter[1]);
      if (op !== 'select') window.__calls.push({ table, op, values, filter });
      if (op === 'update') rows.forEach((r) => Object.assign(r, values));
      if (op === 'delete') db[table] = db[table].filter((r) => !rows.includes(r));
      if (op === 'insert') db[table].push({ id: 'new', ...values });
      return { data: op === 'insert' ? null : rows, error: null };
    };
    const b = {
      select: () => b, order: () => b,
      eq: (c, v) => { filter = [c, v]; return b; },
      update: (v) => { op = 'update'; values = v; return b; },
      delete: () => { op = 'delete'; return b; },
      insert: (v) => { op = 'insert'; values = v; return b; },
      maybeSingle: async () => { const r = run(); return { data: r.data[0] ?? null, error: null }; },
      single: async () => { const r = run(); return { data: r.data[0] ?? null, error: null }; },
      then: (res, rej) => Promise.resolve(run()).then(res, rej),
    };
    return b;
  }
  supabaseClient.from = q;
  supabaseClient.rpc = async (name, args) => { window.__calls.push({ rpc: name, args }); db.profiles = db.profiles.filter((p) => p.id !== args.target); return { error: null }; };
  supabaseClient.auth.getUser = async () => ({ data: { user: me } });
  supabaseClient.auth.signOut = async () => { window.__calls.push({ auth: 'signOut' }); return { error: null }; };
  supabaseClient.storage = { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: '' } }) }) };
}

async function run(role) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'qraf-ui-'));
  const app = await electron.launch({ executablePath: electronBin, args: [APP_DIR, `--user-data-dir=${userData}`], timeout: 30000 });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(800);
  await page.evaluate(installFake, role);
  await page.evaluate(() => showDashboard());
  await page.waitForTimeout(800);
  const vis = (sel) => page.evaluate((s) => { const e = document.querySelector(s); return !!e && !e.hidden && e.offsetParent !== null; }, sel);
  console.log(`\n${role === 'admin' ? 'ADMIN' : 'USER'}`);
  check(await vis('#view-dashboard'), 'pano açıldı');
  const account = await page.evaluate(() => [document.querySelector('#account-email').textContent, document.querySelector('#account-role').textContent]);
  check(account[0] === 'yonetici@example.com' && account[1] === (role === 'admin' ? 'ADMIN' : 'USER'), `hesap ve rol üst çubukta (${account.join(' / ')})`);
  check(await vis('#sign-out-btn'), 'SIGN OUT görünür');
  if (role === 'admin') {
    check(await vis('#tab-users-btn'), 'USERS sekmesi görünür');
    check(await vis('#tab-qr-btn'), 'QR CODES sekmesi görünür');
    await page.screenshot({ path: path.join(SHOT_DIR, 'admin-dashboard.png') });
    await page.evaluate(() => document.querySelector('#tab-users-btn').click());
    await page.waitForTimeout(500);
    const rows = await page.evaluate(() => [...document.querySelectorAll('#users-list .user-row-email')].map((e) => e.textContent));
    check(rows.join(',') === 'yonetici@example.com,ekip@example.com', 'kullanıcılar listelendi');
    check(await page.evaluate(() => document.querySelector('#users-list .user-row select').disabled), 'kendi rolü kilitli');
    check(await vis('#invites-title'), 'bekleyen davetler görünür');
    await page.screenshot({ path: path.join(SHOT_DIR, 'users-panel.png') });

    await page.evaluate(() => { document.querySelector('#invite-email-input').value = ' Usta@Example.com '; document.querySelector('#invite-btn').click(); });
    await page.waitForTimeout(400);
    let calls = await page.evaluate(() => window.__calls);
    check(calls.some((c) => c.table === 'invitations' && c.op === 'insert' && c.values.email === 'usta@example.com' && c.values.role === 'standart'), 'davet küçük harfle kaydedildi');

    await page.evaluate(() => { const s = document.querySelectorAll('#users-list .user-row select')[1]; s.value = 'admin'; s.dispatchEvent(new Event('change')); });
    await page.waitForTimeout(300);
    calls = await page.evaluate(() => window.__calls);
    check(calls.some((c) => c.table === 'profiles' && c.op === 'update' && c.values.role === 'admin' && c.filter[1] === 'u2'), 'rol değiştirildi');

    await page.evaluate(() => document.querySelector('#users-list .user-row-btn').click());
    check(await page.evaluate(() => document.querySelector('#users-list .user-row-btn').textContent) === 'ARE YOU SURE? REMOVE', 'çıkarma onay istiyor');
    await page.evaluate(() => document.querySelector('#users-list .user-row-btn').click());
    await page.waitForTimeout(300);
    calls = await page.evaluate(() => window.__calls);
    check(calls.some((c) => c.rpc === 'admin_remove_user' && c.args.target === 'u2'), 'admin_remove_user çağrıldı');
    await page.screenshot({ path: path.join(SHOT_DIR, 'users-panel-after.png') });
  } else {
    check(!(await vis('#tab-users-btn')), 'USERS sekmesi gizli');
    check(!(await vis('#tab-qr-btn')), 'QR CODES sekmesi gizli');
    check(await page.evaluate(() => document.querySelector('#disk-detail-status-btn').hidden), 'durum düğmesi gizli');
    check(await page.evaluate(async () => {
      const ok = await syncScanToSupabase('d1', { topLevelFolders: [] });
      const queue = JSON.parse(localStorage.getItem('qraf.pendingSync') || '{}');
      return ok === true && !queue.d1 && !window.__calls.some((c) => c.table === 'disks');
    }), 'senkron diske yazmıyor, kuyruğa almıyor');
    await page.screenshot({ path: path.join(SHOT_DIR, 'standart-dashboard.png') });
  }
  if (role === 'admin') await page.evaluate(() => document.querySelector('#tab-users-btn').click());
  await page.evaluate(() => document.querySelector('#sign-out-btn').click());
  await page.waitForTimeout(400);
  check(await page.evaluate(() => window.__calls.some((c) => c.auth === 'signOut')), 'SIGN OUT signOut çağırdı');
  check(await vis('#view-login') && !(await vis('#view-dashboard')), 'giriş ekranına dönüldü');
  check(await vis('#email-input') && !(await vis('#code-input')), 'e-posta adımı açık');
  check(await page.evaluate(() => document.querySelector('#login-status').textContent) === 'Signed out.', '"Signed out." yazıyor');
  check(await page.evaluate(() => document.querySelector('#tab-users-btn').hidden && document.querySelector('#panel-users').hidden), 'admin sekmesi kapandı');
  if (role === 'admin') await page.screenshot({ path: path.join(SHOT_DIR, 'signed-out.png') });
  await app.close();
  fs.rmSync(userData, { recursive: true, force: true });
}

await run('admin');
await run('standart');
console.log(failed ? `\n${failed} HATA` : '\nHepsi geçti');
process.exit(failed ? 1 : 0);
