// qRaf migration'larını Supabase benzeri sahte auth/storage şemasıyla
// PGlite'ta (WASM Postgres) çalıştırıp Faz 16 senaryolarını sınar —
// canlı veritabanına dokunmadan. Kullanım: cd backend/tests && npm test
import { PGlite } from '@electric-sql/pglite';
process.on('unhandledRejection', (e) => { console.log('HATA:', e.message); process.exit(1); });
import fs from 'fs';
import path from 'path';

const dir = process.argv[2] || path.resolve(import.meta.dirname, '../supabase/migrations');
const db = new PGlite();
const ok = (m) => console.log('  ✓', m);
let failed = 0;
const bad = (m) => { failed++; console.log('  ✗', m); };

await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to authenticated, anon;
  grant execute on function auth.uid() to authenticated, anon;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean);
  create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text, owner uuid);
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql as $$ select string_to_array(name, '/') $$;
`);

const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
const last = files.pop();
for (const f of files) {
  await db.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
}

// Faz 16 öncesi canlı durumu taklit et: admin + standart kullanıcı + disk
const admin = '00000000-0000-0000-0000-00000000000a';
const std = '00000000-0000-0000-0000-00000000000b';
await db.exec(`
  insert into auth.users (id, email) values ('${admin}', 'yonetici@example.com'), ('${std}', 'ekip@example.com');
  update public.profiles set role = 'admin' where id = '${admin}';
  insert into public.disks (name, org_id) select '1. Disk', id from public.organizations;
`);
console.log('Faz 16 migration:', last);
await db.exec(fs.readFileSync(path.join(dir, last), 'utf8'));

async function as(uid, fn) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
}
async function fails(sql) { try { await db.exec(sql); return null; } catch (e) { return e.message; } }

console.log('Mevcut kullanıcılar');
const emails = (await db.query(`select email, role from public.profiles order by email`)).rows;
JSON.stringify(emails) === JSON.stringify([{ email: 'ekip@example.com', role: 'standart' }, { email: 'yonetici@example.com', role: 'admin' }])
  ? ok('profiles.email geriye dönük dolduruldu, roller korunuyor') : bad(JSON.stringify(emails));

console.log('Davetsiz kayıt');
const e1 = await fails(`insert into auth.users (email) values ('yabanci@gmail.com')`);
e1 && e1.includes('without an invitation') ? ok('reddedildi: ' + e1) : bad('davetsiz kayıt kabul edildi');
(await db.query(`select count(*)::int c from auth.users where email='yabanci@gmail.com'`)).rows[0].c === 0
  ? ok('auth kaydı geri alındı') : bad('auth kaydı kaldı');

console.log('Davet (admin)');
await as(admin, () => db.exec(`insert into public.invitations (email, role) values ('yeni@example.com', 'standart')`));
ok('admin davet ekledi (org_id / invited_by varsayılanla)');
const inv = (await db.query(`select org_id is not null o, invited_by from public.invitations`)).rows[0];
inv.o && inv.invited_by === admin ? ok('org_id ve invited_by dolu') : bad(JSON.stringify(inv));
const e2 = await as(admin, () => fails(`insert into public.invitations (email) values ('Buyuk@Harf.com')`));
e2 ? ok('küçük harfe çevrilmemiş e-posta reddedildi') : bad('büyük harfli e-posta kabul edildi');

console.log('Davet (standart kullanıcı)');
const e3 = await as(std, () => fails(`insert into public.invitations (email) values ('x@y.com')`));
e3 ? ok('standart davet ekleyemez') : bad('standart davet ekledi');
const seen = await as(std, () => db.query(`select count(*)::int c from public.invitations`));
seen.rows[0].c === 0 ? ok('standart davetleri göremez') : bad('standart davetleri görüyor');

console.log('Davetli kayıt');
await db.exec(`insert into auth.users (email) values ('YENI@example.com ')`);
const p = (await db.query(`select p.role, p.email, p.org_id is not null o from public.profiles p join auth.users u on u.id = p.id where u.email like 'YENI%'`)).rows[0];
p && p.role === 'standart' && p.email === 'yeni@example.com' && p.o ? ok('profil davetteki rol ve org ile açıldı (büyük harf/boşluk tolere)') : bad(JSON.stringify(p));
(await db.query(`select count(*)::int c from public.invitations`)).rows[0].c === 0 ? ok('davet kullanıldı, silindi') : bad('davet duruyor');
const newId = (await db.query(`select id from auth.users where email like 'YENI%'`)).rows[0].id;
const disks = await as(newId, () => db.query(`select count(*)::int c from public.disks`));
disks.rows[0].c === 1 ? ok('yeni kullanıcı diskleri görür') : bad('diskleri göremiyor');
const upd = await as(newId, () => db.query(`update public.disks set status='inactive' returning id`));
upd.rows.length === 0 ? ok('standart disk güncelleyemez (0 satır)') : bad('standart disk güncelledi');
const ins = await as(newId, () => fails(`insert into public.disks (name, org_id) values ('x', public.current_org_id())`));
ins ? ok('standart disk ekleyemez') : bad('standart disk ekledi');

console.log('Rol değiştirme');
const r1 = await as(newId, () => db.query(`update public.profiles set role='admin' where id='${newId}' returning id`));
r1.rows.length === 0 ? ok('standart kendini admin yapamaz') : bad('standart kendini admin yaptı');
await as(admin, () => db.exec(`update public.profiles set role='admin' where id='${newId}'`));
(await db.query(`select role from public.profiles where id='${newId}'`)).rows[0].role === 'admin' ? ok('admin rol verdi') : bad('rol verilemedi');
await as(admin, () => db.exec(`update public.profiles set role='standart' where id='${newId}'`));
const e4 = await as(admin, () => fails(`update public.profiles set role='standart' where id='${admin}'`));
e4 && e4.includes('last admin') ? ok('son admin kendini düşüremez') : bad('son admin düşürüldü: ' + e4);

console.log('Çıkarma');
const e5 = await as(std, () => fails(`select public.admin_remove_user('${newId}')`));
e5 ? ok('standart kullanıcı çıkaramaz') : bad('standart çıkardı');
const e6 = await as(admin, () => fails(`select public.admin_remove_user('${admin}')`));
e6 && e6.includes('yourself') ? ok('admin kendini çıkaramaz') : bad('kendini çıkardı');
await as(admin, () => db.exec(`select public.admin_remove_user('${newId}')`));
(await db.query(`select count(*)::int c from auth.users where id='${newId}'`)).rows[0].c === 0 &&
(await db.query(`select count(*)::int c from public.profiles where id='${newId}'`)).rows[0].c === 0
  ? ok('auth hesabı ve profil silindi') : bad('silinmedi');
const e7 = await fails(`set role anon; select public.admin_remove_user('${std}')`);
await db.exec('reset role');
e7 ? ok('anon fonksiyonu çağıramaz') : bad('anon çağırdı');

console.log(failed ? `\n${failed} HATA` : '\nHepsi geçti');
process.exit(failed ? 1 : 0);
