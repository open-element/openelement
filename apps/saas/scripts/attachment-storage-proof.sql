insert into auth.users values
  ('30000000-0000-4000-8000-000000000001'),
  ('30000000-0000-4000-8000-000000000002');
-- A permissive policy from another integration cannot reopen this bucket.
insert into storage.buckets values ('unrelated', 'unrelated', false);
create policy proof_broad_policy on storage.objects to anon, authenticated
  using (true) with check (true);
insert into storage.objects values ('unrelated', 'control.txt');

do $$
declare
  owner_id uuid := '30000000-0000-4000-8000-000000000001';
  stranger uuid := '30000000-0000-4000-8000-000000000002';
  upload_id uuid := '20000000-0000-4000-8000-000000000001';
  abandoned_id uuid := '20000000-0000-4000-8000-000000000002';
  quarantine_id uuid := '20000000-0000-4000-8000-000000000004';
  failed_id uuid := '20000000-0000-4000-8000-000000000003';
  target_key text := owner_id::text || '/' || upload_id::text || '-clean.txt';
  stale_key text := owner_id::text || '/' || abandoned_id::text || '-abandoned.txt';
  failed_key text := owner_id::text || '/' || failed_id::text || '-failed.txt';
  quarantine_key text := owner_id::text || '/' || quarantine_id::text || '-blocked.txt';
  affected integer;
begin
  if exists (
    select 1 from (values
      ('finalize_attachment(uuid)'), ('finish_attachment_upload(uuid,uuid,text)'),
      ('release_attachment(uuid)'), ('release_attachment_by_key(text)'),
      ('release_stale_attachment(uuid)'), ('request_attachment_delete(text)'),
      ('complete_attachment_delete(text)'), ('begin_attachment_delete(uuid,uuid,boolean)'),
      ('complete_pending_attachment_delete(uuid)'), ('list_pending_attachment_deletions()'),
      ('complete_attachment_scan(uuid,text,text)'),
      ('authorize_brokered_attachment_scan(uuid,text)'),
      ('complete_brokered_attachment_scan(uuid,text,text)')
    ) denied(signature) cross join (values ('anon'), ('authenticated')) roles(role_name)
    where pg_catalog.has_function_privilege(roles.role_name, 'public.' || denied.signature, 'EXECUTE')
  ) then
    raise exception 'direct attachment mutation RPC remained callable';
  end if;

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  perform public.reserve_attachment(upload_id, target_key, 'clean.txt', 1, 'text/plain');
  perform public.reserve_attachment(abandoned_id, stale_key, 'abandoned.txt', 1, 'text/plain');
  perform public.reserve_attachment(failed_id, failed_key, 'failed.txt', 1, 'text/plain');
  perform public.reserve_attachment(quarantine_id, quarantine_key, 'blocked.txt', 1, 'text/plain');
  begin
    insert into storage.objects values ('notes-attachments', target_key);
    raise exception 'direct insertion with a matching reservation succeeded';
  exception when insufficient_privilege then null; end;
  begin
    insert into storage.objects values ('notes-attachments', owner_id::text || '/unreserved.txt');
    raise exception 'direct insertion without reservation succeeded';
  exception when insufficient_privilege then null; end;
  reset role;

  set local role service_role;
  begin
    perform public.finish_attachment_upload(upload_id, owner_id, target_key);
    raise exception 'finalization without object succeeded';
  exception when raise_exception then
    if sqlerrm <> 'attachment reservation or object not found' then raise; end if;
  end;
  insert into storage.objects values ('notes-attachments', target_key), ('notes-attachments', quarantine_key);
  if public.begin_attachment_delete(upload_id, owner_id, false) is not null then
    raise exception 'ordinary delete claimed an in-flight upload';
  end if;
  perform public.finish_attachment_upload(upload_id, owner_id, target_key);
  perform public.finish_attachment_upload(quarantine_id, owner_id, quarantine_key);
  perform public.record_attachment_scan_dead_letter(quarantine_id, quarantine_key);
  perform public.record_attachment_scan_dead_letter(quarantine_id, quarantine_key);
  if not exists (select 1 from public.attachment_scan_dead_letters as d
    where d.reservation_id = quarantine_id and d.delivery_count = 2) then
    raise exception 'duplicate dead letter did not increment delivery count';
  end if;
  if public.begin_attachment_delete(upload_id, stranger, false) is not null then
    raise exception 'wrong owner obtained a deletion key';
  end if;
  reset role;

  set local role authenticated;
  if exists (select 1 from storage.objects where bucket_id = 'notes-attachments')
    or not exists (select 1 from storage.objects where bucket_id = 'unrelated') then
    raise exception 'pending object exposed or unrelated bucket access changed';
  end if;
  if exists (select 1 from public.list_downloadable_attachments()) then
    raise exception 'pending attachment appeared in the clean list';
  end if;
  delete from storage.objects where bucket_id = 'notes-attachments';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'authenticated Storage delete succeeded'; end if;
  reset role;

  update public.attachment_reservations as r set state = 'replay_requested' where r.id = quarantine_id;
  update public.attachment_scan_dead_letters as d set state = 'replay_requested' where d.reservation_id = quarantine_id;
  set local role service_role;
  perform public.complete_brokered_attachment_scan(quarantine_id, quarantine_key, 'quarantined');
  perform public.complete_brokered_attachment_scan(upload_id, target_key, 'clean');
  reset role;
  set local role anon;
  if exists (select 1 from storage.objects where bucket_id = 'notes-attachments') then
    raise exception 'anonymous direct Storage read succeeded';
  end if;
  reset role;
  set local role authenticated;
  if exists (select 1 from storage.objects where bucket_id = 'notes-attachments')
    or not exists (select 1 from public.list_downloadable_attachments() as l where l.object_key = target_key)
    or exists (select 1 from public.list_downloadable_attachments() as l where l.object_key = quarantine_key) then
    raise exception 'clean attachment did not require the app download path';
  end if;
  perform set_config('request.jwt.claim.sub', stranger::text, true);
  if exists (select 1 from public.attachment_reservations) then
    raise exception 'foreign owner saw attachment reservation';
  end if;
  reset role;

  set local role service_role;
  if public.begin_attachment_delete(upload_id, owner_id, false) is distinct from target_key then
    raise exception 'server could not claim owner deletion';
  end if;
  perform public.complete_pending_attachment_delete(upload_id);
  if not exists (select 1 from public.attachment_reservations as r where r.id = upload_id and r.state = 'deleting') then
    raise exception 'completion discarded still-present object quota';
  end if;
  delete from storage.objects as o where o.bucket_id = 'notes-attachments' and o.name = target_key;
  perform public.complete_pending_attachment_delete(upload_id);
  if exists (select 1 from public.attachment_reservations as r where r.id = upload_id) then
    raise exception 'successful deletion did not release quota';
  end if;

  if public.begin_attachment_delete(failed_id, owner_id, true) is not null then
    raise exception 'ambiguous provider upload allowed immediate deletion';
  end if;
  if exists (select 1 from public.list_pending_attachment_deletions() as r where r.id = failed_id) then
    raise exception 'ambiguous upload skipped provider settling window';
  end if;
  reset role;
  update public.attachment_reservations as r set created_at = now() - interval '16 minutes'
    where r.id = abandoned_id;
  set local role service_role;
  if not exists (select 1 from public.list_pending_attachment_deletions() as r where r.id = abandoned_id and r.object_key = stale_key) then
    raise exception 'abandoned reservation did not enter reconciliation';
  end if;
  if not exists (select 1 from public.attachment_reservations as r where r.id = abandoned_id and r.state = 'deleting') then
    raise exception 'stale reconciliation did not persist deletion before provider I/O';
  end if;
end;
$$;

do $$
declare
  legacy_owner uuid := '30000000-0000-4000-8000-000000000009';
  legacy_id uuid := '20000000-0000-4000-8000-000000000009';
  legacy_key text := '30000000-0000-4000-8000-000000000009/legacy.txt';
begin
  if exists (select 1 from storage.buckets where id = 'notes-attachments' and public) then
    raise exception 'the migrated attachment bucket remains public';
  end if;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', legacy_owner::text, true);
  if exists (select 1 from public.list_downloadable_attachments()) then
    raise exception 'legacy clean verdict exposed an unrescanned attachment';
  end if;
  if (select sum(byte_size) from public.attachment_reservations) is distinct from 101::numeric then
    raise exception 'rescan changed legacy quota';
  end if;

  reset role;
  set local role service_role;
  begin
    perform public.complete_attachment_scan(legacy_id, legacy_key, 'clean');
    raise exception 'pre-cutover completion could still bless an old scan';
  exception when insufficient_privilege then null; end;
  if not exists (
    select 1 from public.list_pending_attachment_scans() as r
    where r.id = legacy_id and r.object_key = legacy_key
  ) then
    raise exception 'worker reconciliation missed the inherited attachment';
  end if;
  if public.authorize_brokered_attachment_scan(legacy_id, legacy_key)->>'scan_policy'
    is distinct from 'brokered-storage' then
    raise exception 'worker did not receive broker-era scan authorization';
  end if;
  perform public.complete_brokered_attachment_scan(legacy_id, legacy_key, 'clean');
  reset role;

  set local role authenticated;
  if not exists (select 1 from public.list_downloadable_attachments() as a where a.object_key = legacy_key)
    or (select sum(byte_size) from public.attachment_reservations) is distinct from 101::numeric then
    raise exception 'broker-era verdict did not restore download or duplicated quota';
  end if;
  if (select count(*) from public.storage_audit as a where a.reservation_id = legacy_id and a.event = 'scan_clean') <> 2
    or not exists (select 1 from public.storage_audit as a where a.reservation_id = legacy_id and a.event = 'scan_requeued') then
    raise exception 'legacy scan history or new cutover audit missing';
  end if;
end;
$$;
