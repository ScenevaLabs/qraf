-- "Automatically expose new tables" proje oluşturulurken kapatıldığı için
-- yeni tablolara varsayılan rol izinleri (grant) otomatik verilmedi.
-- RLS politikaları doğru olsa bile, temel GRANT olmadan Postgres daha
-- kaba bir seviyede erişimi tamamen reddediyor ("permission denied").
--
-- anon rolüne KASITLI olarak hiçbir grant verilmiyor: yetkisiz/giriş
-- yapmamış istekler hâlâ "permission denied" alacak. authenticated role
-- ise RLS politikalarının (bkz. 20260821173208_init_schema.sql) devreye
-- girebilmesi için gerekli temel tablo izinlerine sahip olmalı.

grant usage on schema public to authenticated;

grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.disks to authenticated;
