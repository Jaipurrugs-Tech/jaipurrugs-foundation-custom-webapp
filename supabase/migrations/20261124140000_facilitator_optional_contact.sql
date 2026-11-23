-- Facilitators: only the name is required; email and phone are optional.
-- Blank values are stored as NULL (the app sends null), so the existing
-- "not blank" checks still hold for any value that is given, and the unique
-- email index ignores facilitators without an email.
alter table public.facilitators
  alter column email drop not null,
  alter column phone drop not null;
