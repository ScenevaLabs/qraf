-- Faz 4: masaüstü uygulama diskleri Supabase'e QR henüz atanmadan (elle
-- eşleştirme ile) yazabilmeli. qr_code_value ancak Faz 5'te (QR üretimi)
-- doldurulacak. unique kısıtı korunuyor — Postgres'te NULL değerler
-- unique kısıtına aykırı sayılmaz, yani birden fazla eşlenmemiş disk
-- aynı anda NULL qr_code_value ile var olabilir.
alter table public.disks alter column qr_code_value drop not null;
