-- "Tüm Diskler" listesi kayıp/bozuk/başka yere gönderilmiş diskleri de
-- aktif diskler arasında gösteriyordu ve kafa karıştırıyordu. Bu diskler
-- envanterden silinmiyor (geçmiş kaydı korunmalı) ama ayrı bir bölümde
-- gösterilecek — bunun için bir durum alanı gerekiyor.
alter table public.disks
  add column status text not null default 'active'
    check (status in ('active', 'inactive'));

-- Faz 7'nin Excel aktarımında "notes" alanına yazılan durum notlarından
-- zaten kayıp/bozuk/gönderilmiş olduğu bilinen diskler geriye dönük
-- olarak "inactive" işaretlendi.
update public.disks
set status = 'inactive'
where notes in ('YOK/BOZUK', 'YOK', 'İBB''YE GİTTİ. / 33''e kopyalandı.', 'İBB''YE GİTTİ');
