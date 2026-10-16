-- qRaf: başlangıç şeması — profiles (rol) + disks (envanter) + RLS
-- Faz 2: Backend — veritabanı şeması + auth + rol modeli

-- ---------------------------------------------------------------------------
-- profiles: her auth.users kaydına karşılık gelen rol bilgisi
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'standart' check (role in ('admin', 'standart')),
  full_name text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Yeni bir auth.users kaydı oluşturulduğunda otomatik olarak profiles satırı
-- açar (varsayılan rol: standart). İlk admin, bu satır oluştuktan sonra elle
-- 'admin' olarak güncellenir (bkz. Faz 2 PLAN.md).
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- RLS'de sonsuz özyinelemeye girmeden "bu kullanıcı admin mi" kontrolü için
-- security definer fonksiyon.
create function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

create policy "profiles: kullanıcı kendi profilini görür"
  on public.profiles for select
  to authenticated
  using (id = auth.uid());

create policy "profiles: admin tum profilleri gorur"
  on public.profiles for select
  to authenticated
  using (public.is_admin());

create policy "profiles: admin rol gunceller"
  on public.profiles for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- disks: fiziksel disklerin envanter kaydı
-- ---------------------------------------------------------------------------
create table public.disks (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  qr_code_value text not null unique,
  top_level_folders jsonb not null default '[]'::jsonb,
  total_bytes bigint,
  free_bytes bigint,
  last_scanned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.disks enable row level security;

create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger disks_set_updated_at
  before update on public.disks
  for each row execute function public.set_updated_at();

-- Giriş yapmış ve sistemde tanınan (profiles kaydı olan) her kullanıcı
-- diskleri görebilir — admin ve standart rol farkı yok, ikisi de okur.
create policy "disks: yetkili kullanici okur"
  on public.disks for select
  to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid()));

-- Disk kayıtlarını yazma/güncelleme/silme yalnızca admin'e ait (masaüstü
-- tarama uygulaması da admin hesabıyla oturum açar, bkz. Faz 3/4).
create policy "disks: admin ekler"
  on public.disks for insert
  to authenticated
  with check (public.is_admin());

create policy "disks: admin gunceller"
  on public.disks for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "disks: admin siler"
  on public.disks for delete
  to authenticated
  using (public.is_admin());
