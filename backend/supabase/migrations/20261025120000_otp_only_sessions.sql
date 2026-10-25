-- Yetki yalnız e-posta koduyla (OTP) açılmış, e-postası doğrulanmış
-- oturuma (25 Ekim 2026, güvenlik incelemesi).
--
-- Uygulamalar yalnızca e-posta kodu kullanıyor, ama Supabase Auth
-- publishable anahtarla /auth/v1/signup üzerinden şifreli kaydı da kabul
-- ediyor. handle_new_user() yalnız "bu e-postaya davet var mı" diye
-- baktığı için, bekleyen bir davetin e-postasını bilen biri o adresle
-- şifreli kayıt olup davetin rolünü (admin olabilir) alabiliyordu;
-- "Confirm email" açıkken bile koyduğu şifre, gerçek kişi kodla girip
-- e-postayı doğruladıktan sonra hesapta kalıyordu.
--
-- Kayıt anında şifreli kayıt ayırt edilemiyor (Supabase kodla ilk
-- girişte de kullanıcıya rastgele geçici şifre yazıyor). Bu yüzden
-- kontrol oturumda: JWT'deki giriş yöntemi (amr) şifre ise ya da e-posta
-- doğrulanmamışsa is_admin() false, current_org_id() null döner → RLS
-- hiçbir organizasyon verisini göstermez, hiçbir yazmaya izin vermez.
-- Mevcut kullanıcılar kodla girdiği için etkilenmez.

create or replace function public.session_verified()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from auth.users u
    where u.id = auth.uid() and u.email_confirmed_at is not null
  )
  and not coalesce(auth.jwt() -> 'amr', '[]'::jsonb) @> '[{"method": "password"}]'::jsonb;
$$;

create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.session_verified() and exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.current_org_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select org_id from public.profiles
  where id = auth.uid() and public.session_verified();
$$;

revoke all on function public.session_verified() from public, anon;
grant execute on function public.session_verified() to authenticated;
