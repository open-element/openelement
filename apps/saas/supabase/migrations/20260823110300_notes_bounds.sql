-- Route validation is not a database boundary: direct Data API clients must
-- receive the same note-size constraints as the application action.

alter table public.notes
  add constraint notes_title_length_check
  check (char_length(btrim(title)) between 1 and 120);
alter table public.notes
  add constraint notes_body_length_check
  check (char_length(body) <= 10000);
