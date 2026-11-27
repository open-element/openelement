-- User 1 is A admin; user 2 is A member; user 3 is B member; user 4 is outsider.
insert into auth.users select ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid from generate_series(1, 4) n;
insert into public.workspaces (id, name, created_by) values
 ('10000000-0000-0000-0000-000000000001', 'A', '00000000-0000-0000-0000-000000000001'),
 ('10000000-0000-0000-0000-000000000002', 'B', '00000000-0000-0000-0000-000000000003');
insert into public.workspace_members (workspace_id, user_id, role) values
 ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'admin'),
 ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'member'),
 ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000003', 'member');
insert into public.workspace_records (workspace_id, created_by, title, status) values
 ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'A record', 'active'),
 ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000003', 'B record', 'active');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
do $$ declare n integer; begin
 select count(*) into n from public.workspace_records;
 if n <> 1 then raise exception 'member read isolation failed: %', n; end if;
 update public.workspace_records set title = 'forbidden' where title = 'A record';
 get diagnostics n = row_count;
 if n <> 0 then raise exception 'member updated another creator record'; end if;
 begin
   insert into public.workspace_records (workspace_id, created_by, title, status) values ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', 'forbidden', 'active');
   raise exception 'cross-workspace insert succeeded';
 exception when insufficient_privilege then null; end;
 begin
   update public.workspace_members set role = 'admin';
   raise exception 'membership update succeeded';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
update public.workspace_records set created_by = '00000000-0000-0000-0000-000000000002' where title = 'A record';
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
do $$ declare n integer; begin
 update public.workspace_records set title = 'admin update' where title = 'A record';
 get diagnostics n = row_count;
 if n <> 1 then raise exception 'admin update failed'; end if;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
do $$ declare n integer; begin
 select count(*) into n from public.workspace_records where workspace_id = '10000000-0000-0000-0000-000000000001';
 if n <> 0 then raise exception 'B read A records'; end if;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', false);
do $$ declare n integer; begin
 select count(*) into n from public.workspace_records;
 if n <> 0 then raise exception 'outsider read records'; end if;
end $$;
reset role;
\echo 'workspace RLS proof passed (local Postgres; not hosted Realtime)'
