-- Faz 9: çok kiracılı (multi-tenant) mimariye geçiş — tek organizasyonla.
-- Bir organizasyonun admin'i bile başka organizasyonun kullanıcı/disk
-- verisine erişemesin diye her satır artık bir organizations.id'ye bağlı.
-- Şu an sistemde tek organizasyon var; mimari ileride yeni organizasyon
-- eklemeye hazır ama bu faz yeni organizasyon *oluşturma akışı* eklemiyor
-- (bkz. INTENT.md, 22 Ağustos 2026 notu).

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  logo_path text,
  logo_design_approved_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.organizations enable row level security;

grant select, update on public.organizations to authenticated;

insert into public.organizations (name) values ('Şirketim');

alter table public.profiles add column org_id uuid references public.organizations(id);
alter table public.disks add column org_id uuid references public.organizations(id);

update public.profiles set org_id = (select id from public.organizations order by created_at limit 1);
update public.disks set org_id = (select id from public.organizations order by created_at limit 1);

alter table public.profiles alter column org_id set not null;
alter table public.disks alter column org_id set not null;

-- RLS'de sonsuz özyinelemeye girmeden "bu kullanıcının organizasyonu ne"
-- kontrolü için security definer fonksiyon (is_admin() ile aynı desen).
create function public.current_org_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select org_id from public.profiles where id = auth.uid();
$$;

-- Yeni kullanıcı kaydı olduğunda (şimdilik) tek organizasyona atanır —
-- çoklu organizasyon davet akışı ayrı ve sonraki bir faz.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, org_id)
  values (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    (select id from public.organizations order by created_at limit 1)
  );
  return new;
end;
$$;

-- --- organizations RLS ---
create policy "organizations: kullanıcı kendi organizasyonunu görür"
  on public.organizations for select
  to authenticated
  using (id = public.current_org_id());

create policy "organizations: admin kendi organizasyonunu günceller"
  on public.organizations for update
  to authenticated
  using (public.is_admin() and id = public.current_org_id())
  with check (public.is_admin() and id = public.current_org_id());

-- --- profiles RLS: org_id kontrolü eklendi ---
-- Not: DROP edilen policy adları DB'de kayıtlı GERÇEK adlar (Faz 2'de SQL
-- Editor'e yazılırken Türkçe karakterler ASCII'ye düşmüş — "gunceller",
-- "kullanici" gibi — bkz. pg_policies ile doğrulandı, 22 Ağustos 2026).
drop policy "profiles: admin tum profilleri gorur" on public.profiles;
create policy "profiles: admin kendi organizasyonundaki profilleri görür"
  on public.profiles for select
  to authenticated
  using (public.is_admin() and org_id = public.current_org_id());

drop policy "profiles: admin rol gunceller" on public.profiles;
create policy "profiles: admin kendi organizasyonunda rol günceller"
  on public.profiles for update
  to authenticated
  using (public.is_admin() and org_id = public.current_org_id())
  with check (public.is_admin() and org_id = public.current_org_id());

-- --- disks RLS: org_id kontrolü eklendi ---
drop policy "disks: yetkili kullanici okur" on public.disks;
create policy "disks: yetkili kullanıcı kendi organizasyonunu okur"
  on public.disks for select
  to authenticated
  using (org_id = public.current_org_id());

drop policy "disks: admin ekler" on public.disks;
create policy "disks: admin kendi organizasyonuna ekler"
  on public.disks for insert
  to authenticated
  with check (public.is_admin() and org_id = public.current_org_id());

drop policy "disks: admin gunceller" on public.disks;
create policy "disks: admin kendi organizasyonunda günceller"
  on public.disks for update
  to authenticated
  using (public.is_admin() and org_id = public.current_org_id())
  with check (public.is_admin() and org_id = public.current_org_id());

drop policy "disks: admin siler" on public.disks;
create policy "disks: admin kendi organizasyonunda siler"
  on public.disks for delete
  to authenticated
  using (public.is_admin() and org_id = public.current_org_id());

-- --- org-logos storage bucket ---
-- Public bucket: PDF export ve önizleme görseli doğrudan public URL ile
-- okunuyor (Electron'un gizli print penceresinde ekstra auth gerekmesin
-- diye). Yazma yalnızca o organizasyonun admin'ine ait; dosya yolu
-- "<org_id>/logo.<uzantı>" biçiminde tutulur.
insert into storage.buckets (id, name, public) values ('org-logos', 'org-logos', true);

create policy "org-logos: admin kendi organizasyonunun logosunu yükler"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'org-logos'
    and public.is_admin()
    and (storage.foldername(name))[1] = public.current_org_id()::text
  );

create policy "org-logos: admin kendi organizasyonunun logosunu günceller"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'org-logos'
    and public.is_admin()
    and (storage.foldername(name))[1] = public.current_org_id()::text
  )
  with check (
    bucket_id = 'org-logos'
    and public.is_admin()
    and (storage.foldername(name))[1] = public.current_org_id()::text
  );

create policy "org-logos: giriş yapmış kullanıcı okur"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'org-logos');
