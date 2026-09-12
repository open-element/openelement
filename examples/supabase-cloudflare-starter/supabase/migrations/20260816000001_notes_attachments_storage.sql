-- 20260816000001_notes_attachments_storage.sql — private Storage bucket for
-- the reference starter's upload route (#983). Applies on top of
-- 20260816000000_notes.sql; the storage schema comes from Supabase itself.
--
-- Same must-not-break rules as the notes table:
-- - RLS on storage.objects is the floor: anon can never read or write the
--   bucket, and authenticated users can only touch their own folder
--   (objects are keyed "<auth.uid()>/<filename>" by the upload route).
-- - The bucket is private (public = false) — no unauthenticated URL access.

insert into storage.buckets (id, name, public)
values ('notes-attachments', 'notes-attachments', false)
on conflict (id) do nothing;

create policy "attachments: owner reads own folder"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'notes-attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "attachments: owner uploads own folder"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'notes-attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "attachments: owner deletes own folder"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'notes-attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);
