-- 130_avatars_bucket.sql
-- Profile-picture storage. Public-read bucket (avatars render in the sidebar / team
-- lists / profile without signed URLs), but write is locked to the OWNER: a user may
-- only create/replace/delete objects under their own uid prefix (avatars/<uid>/...).
-- The public URL is stored on the user's auth metadata (user_metadata.avatar_url) by
-- the client after upload — no extra table needed.

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

-- Anyone may READ (bucket is public / avatars are shown across the app).
drop policy if exists "avatars public read" on storage.objects;
create policy "avatars public read"
  on storage.objects for select
  using (bucket_id = 'avatars');

-- Only the authenticated owner may write to their own folder (first path segment = uid).
drop policy if exists "avatars owner insert" on storage.objects;
create policy "avatars owner insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars owner update" on storage.objects;
create policy "avatars owner update"
  on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars owner delete" on storage.objects;
create policy "avatars owner delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
