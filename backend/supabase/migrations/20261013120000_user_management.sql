-- Faz 16: kullanıcı yönetimi (davet / çıkarma).
-- Roller: 'admin' ve 'standart' (arayüzde "Kullanıcı"). Disk yazma
-- yetkileri Faz 2/9'dan beri yalnız admin'de; bu migration hesap açma
-- akışını davete bağlar.
--
-- Neden: handle_new_user her yeni auth kullanıcısını organizasyona
-- bağlıyordu. Uygulamalar shouldCreateUser:false kullansa da APK'daki
-- anon anahtarla doğrudan Supabase'e kayıt olan biri tüm diskleri
-- görebilirdi. Artık davetsiz kayıt veritabanında reddedilir.
--
-- Not: Supabase panelinden "Add user / Invite" ile açılan hesaplar da
-- bu kurala tabi — önce invitations'a satır eklenmeli.

-- --- profiles.email: panelde kullanıcıyı göstermek için ---
alter table public.profiles add column email text;

update public.profiles p
set email = u.email
from auth.users u
where u.id = p.id;

-- --- invitations ---
create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default public.current_org_id() references public.organizations (id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and email like '%_@_%'),
  role text not null default 'standart' check (role in ('admin', 'standart')),
  invited_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index invitations_email_key on public.invitations (email);

alter table public.invitations enable row level security;

grant select, insert, update, delete on public.invitations to authenticated;

create policy "invitations: admin kendi organizasyonunun davetlerini görür"
  on public.invitations for select
  to authenticated
  using (public.is_admin() and org_id = public.current_org_id());

create policy "invitations: admin kendi organizasyonuna davet ekler"
  on public.invitations for insert
  to authenticated
  with check (public.is_admin() and org_id = public.current_org_id());

create policy "invitations: admin kendi organizasyonunda davet günceller"
  on public.invitations for update
  to authenticated
  using (public.is_admin() and org_id = public.current_org_id())
  with check (public.is_admin() and org_id = public.current_org_id());

create policy "invitations: admin kendi organizasyonunda davet siler"
  on public.invitations for delete
  to authenticated
  using (public.is_admin() and org_id = public.current_org_id());

-- --- Yeni auth kullanıcısı: yalnız davetliyse profil alır ---
-- Davet yoksa istisna fırlatılır → auth kaydı geri alınır, istemci
-- "Database error saving new user" alır (uygulamalar bunu "davet yok"
-- olarak gösterir). Davet kullanılınca silinir.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.invitations;
begin
  select * into inv
  from public.invitations
  where email = lower(btrim(new.email))
  limit 1;

  if inv.id is null then
    raise exception 'qraf: sign-up without an invitation rejected (%)', new.email
      using errcode = 'P0001';
  end if;

  insert into public.profiles (id, full_name, org_id, role, email)
  values (new.id, new.raw_user_meta_data ->> 'full_name', inv.org_id, inv.role, lower(btrim(new.email)));

  delete from public.invitations where id = inv.id;
  return new;
end;
$$;

-- --- Organizasyonda her zaman en az bir admin kalsın ---
create or replace function public.keep_one_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.role = 'admin'
     and (tg_op = 'DELETE' or new.role <> 'admin')
     and not exists (
       select 1 from public.profiles
       where org_id = old.org_id and role = 'admin' and id <> old.id
     ) then
    raise exception 'qraf: the last admin of the organization cannot be removed';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger profiles_keep_one_admin
  before update of role or delete on public.profiles
  for each row execute function public.keep_one_admin();

-- --- Kullanıcıyı çıkar: auth hesabı silinir, profil cascade ile gider ---
create or replace function public.admin_remove_user(target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'qraf: this action requires admin permission';
  end if;
  if target = auth.uid() then
    raise exception 'qraf: you cannot remove yourself';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = target and org_id = public.current_org_id()
  ) then
    raise exception 'qraf: user not found';
  end if;

  delete from auth.users where id = target;
end;
$$;

revoke all on function public.admin_remove_user(uuid) from public, anon;
grant execute on function public.admin_remove_user(uuid) to authenticated;
