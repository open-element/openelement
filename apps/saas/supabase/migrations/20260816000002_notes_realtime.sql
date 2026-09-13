-- 20260816000002_notes_realtime.sql — publish notes changes over Supabase
-- Realtime for the reference starter's live island (#983).
--
-- The browser island subscribes with the anon key and a hard
-- user_id=eq.<uid> filter, so each page only receives the signed-in owner's
-- INSERT events — row visibility stays scoped exactly like the RLS policies
-- on the table itself.

alter publication supabase_realtime add table public.notes;
