-- Feedback collected (opt-in) from the Photo Counter app.
-- The app only ever INSERTs with the public anon key. Reading is service-role only
-- (training/export_dataset.py), so uploaded photos are never exposed to other users.

create table public.feedback (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  device_id        uuid        not null,
  item             text        not null,
  model_version    text        not null,
  lighting_bucket  text        not null,
  lighting_mean    smallint    not null,
  lighting_contrast smallint   not null,
  thumbs_up        boolean,
  img_w            integer     not null,
  img_h            integer     not null,
  exemplar         jsonb       not null,
  model_dots       jsonb       not null,
  final_dots       jsonb       not null,
  image_path       text        not null,

  constraint feedback_item_ck check (item in
    ('pipes','rebar','lumber','boxes','bottles','bags','pallets','other')),
  constraint feedback_light_ck check (lighting_bucket in ('good','dim','poor')),
  constraint feedback_dims_ck check (img_w between 1 and 8000 and img_h between 1 and 8000),
  constraint feedback_dots_ck check (
    jsonb_typeof(model_dots) = 'array' and jsonb_array_length(model_dots) <= 3000 and
    jsonb_typeof(final_dots) = 'array' and jsonb_array_length(final_dots) <= 3000),
  constraint feedback_exemplar_ck check (jsonb_typeof(exemplar) = 'object'),
  constraint feedback_path_ck check (image_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$')
);

create index feedback_bucket_idx on public.feedback (lighting_bucket, created_at desc);
create index feedback_device_idx  on public.feedback (device_id);

alter table public.feedback enable row level security;

-- Anyone with the public key may add a row; nobody can read, change or delete through the API.
create policy feedback_insert_anon on public.feedback
  for insert to anon with check (true);

-- Private bucket for the photos: small JPEGs only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('feedback-images', 'feedback-images', false, 1572864, array['image/jpeg'])
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy feedback_images_insert_anon on storage.objects
  for insert to anon
  with check (
    bucket_id = 'feedback-images'
    and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$'
  );

-- Accuracy by lighting bucket: how often the user changed the count the model produced.
-- Service role only (views are not exposed to anon because the base table has no select policy).
create view public.feedback_accuracy with (security_invoker = true) as
select
  lighting_bucket,
  item,
  model_version,
  count(*)                                                        as photos,
  avg(abs(jsonb_array_length(model_dots) - jsonb_array_length(final_dots)))::numeric(10,2) as mean_abs_error,
  avg((abs(jsonb_array_length(model_dots) - jsonb_array_length(final_dots)) <= 1)::int)::numeric(10,3) as within_one,
  avg((thumbs_up)::int)::numeric(10,3)                            as thumbs_up_rate
from public.feedback
group by lighting_bucket, item, model_version;
