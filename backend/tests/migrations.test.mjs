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
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}', encrypted_password text, email_confirmed_at timestamptz);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  grant usage on schema auth to authenticated, anon;
  grant execute on function auth.uid(), auth.jwt() to authenticated, anon;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, allowed_mime_types text[], file_size_limit bigint);
  create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text, owner uuid);
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql as $$ select string_to_array(name, '/') $$;
`);

const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
// Faz 16 migration'ı canlı veriyle (aşağıdaki taklit) çalıştırılır;
// sonrasındakiler onun üzerine uygulanır.
const faz16 = files.indexOf('20261013120000_user_management.sql');
const after = files.splice(faz16 + 1);
const last = files.pop();
for (const f of files) {
  await db.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
}

// Faz 16 öncesi canlı durumu taklit et: admin + standart kullanıcı + disk
const admin = '00000000-0000-0000-0000-00000000000a';
const std = '00000000-0000-0000-0000-00000000000b';
await db.exec(`
  insert into auth.users (id, email, email_confirmed_at) values ('${admin}', 'yonetici@example.com', now()), ('${std}', 'ekip@example.com', now());
  update public.profiles set role = 'admin' where id = '${admin}';
  insert into public.disks (name, org_id) select '1. Disk', id from public.organizations;
`);
console.log('Faz 16 migration:', last);
await db.exec(fs.readFileSync(path.join(dir, last), 'utf8'));
for (const f of after) {
  console.log('Sonraki migration:', f);
  await db.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
}

// Supabase gibi: auth.uid() = sub, auth.jwt() = tüm claim'ler (amr = giriş yöntemi).
async function as(uid, fn, method = 'otp') {
  const claims = JSON.stringify({ sub: uid, amr: [{ method, timestamp: 0 }] });
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false), set_config('request.jwt.claims', '${claims}', false);`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claims', '', false);`); }
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
await db.exec(`insert into auth.users (email, email_confirmed_at) values ('YENI@example.com ', now())`);
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

console.log('Davetli e-postaya şifreyle önden kayıt');
await as(admin, () => db.exec(`insert into public.invitations (email, role) values ('patron@example.com', 'admin')`));
// Saldırgan şifreli signup yapar: davetin rolünü alır ama oturumu şifreyle.
await db.exec(`insert into auth.users (email, encrypted_password, email_confirmed_at) values ('patron@example.com', 'x', now())`);
const atk = (await db.query(`select id from auth.users where email='patron@example.com'`)).rows[0].id;
const atkAdmin = await as(atk, () => db.query(`select public.is_admin() a, public.current_org_id() o`), 'password');
!atkAdmin.rows[0].a && atkAdmin.rows[0].o === null ? ok('şifreli oturum: admin değil, organizasyonu yok') : bad(JSON.stringify(atkAdmin.rows[0]));
const atkDisks = await as(atk, () => db.query(`select count(*)::int c from public.disks`), 'password');
atkDisks.rows[0].c === 0 ? ok('şifreli oturum diskleri göremez') : bad('şifreli oturum diskleri görüyor');
const atkInv = await as(atk, () => fails(`insert into public.invitations (email) values ('kotu@x.com')`), 'password');
atkInv ? ok('şifreli oturum davet ekleyemez') : bad('şifreli oturum davet ekledi');
const atkDel = await as(atk, () => fails(`select public.admin_remove_user('${std}')`), 'password');
atkDel ? ok('şifreli oturum kullanıcı çıkaramaz') : bad('şifreli oturum kullanıcı çıkardı');
// Aynı hesap e-posta koduyla (gerçek kişi) → yetki normal.
const otpAdmin = await as(atk, () => db.query(`select public.is_admin() a`));
otpAdmin.rows[0].a ? ok('aynı hesap kodla girince admin (gerçek davetli etkilenmez)') : bad('kodla giriş yetkisiz kaldı');
await db.exec(`update auth.users set email_confirmed_at = null where id = '${atk}'`);
const unconf = await as(atk, () => db.query(`select public.is_admin() a, public.current_org_id() o`));
!unconf.rows[0].a && unconf.rows[0].o === null ? ok('e-postası doğrulanmamış hesap yetkisiz') : bad(JSON.stringify(unconf.rows[0]));
await as(admin, () => db.exec(`select public.admin_remove_user('${atk}')`));
const e8 = await fails(`set role anon; select public.session_verified()`);
await db.exec('reset role');
e8 ? ok('anon session_verified() çağıramaz') : bad('anon session_verified() çağırdı');

console.log('Logo bucket sınırları');
const bucket = (await db.query(`select allowed_mime_types, file_size_limit::int l from storage.buckets where id = 'org-logos'`)).rows[0];
JSON.stringify(bucket.allowed_mime_types) === '["image/png","image/jpeg"]' && bucket.l === 2097152
  ? ok('org-logos yalnız PNG/JPEG, en fazla 2 MB') : bad(JSON.stringify(bucket));

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
