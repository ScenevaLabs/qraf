-- org-logos bucket'ı yalnız PNG/JPEG ve en fazla 2 MB kabul eder
-- (26 Ekim 2026, güvenlik incelemesi).
--
-- Bucket herkese açık; tür/boyut sınırı yalnız arayüzdeki accept
-- özniteliğindeydi. Admin oturumu (ya da ele geçirilmiş bir admin
-- token'ı) API'den herhangi bir dosyayı, script taşıyabilen SVG dahil,
-- herkese açık URL'ye koyabiliyordu. SVG bu yüzden listede yok.
-- Önceden yüklenmiş dosyalar etkilenmez; sınır yeni yüklemelerde geçerli.

update storage.buckets
set allowed_mime_types = array['image/png', 'image/jpeg'],
    file_size_limit = 2097152
where id = 'org-logos';
