-- Raise bucket file_size_limit to match the client-side IMAGE_MAX_SIZE constant (5 MB).
-- The mismatch (buckets: 2 MB, client: 5 MB) caused HTTP 400 on uploads between 2–5 MB,
-- which surfaced as "Couldn't save settings" for all users uploading large avatars/logos.
UPDATE storage.buckets
SET file_size_limit = 5242880
WHERE id IN ('avatars', 'logos');
