-- 20260816000001 is recorded without the owner UPDATE policy, but projects that
-- applied its original version still carry it remotely. Converge forward:
-- attachments are insert-only (README: immutable after INSERT), so the owner
-- UPDATE policy must not exist. Idempotent no-op where already absent.
drop policy if exists "attachments: owner updates own folder" on storage.objects;
