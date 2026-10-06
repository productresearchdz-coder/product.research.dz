-- =====================================================================
-- PRODUCT RESEARCH PLATFORM — supabase.sql
-- PHASE 1: database (tables, constraints, indexes, triggers, RPCs,
--          RLS, Realtime, Storage buckets + policies, privileges, seeds)
-- =====================================================================
-- HOW TO RUN
--   Supabase Dashboard -> SQL Editor -> New query -> paste ALL -> Run.
--   Run ONCE on a fresh project. Do not re-run on a project that already
--   has these tables (it would fail on "already exists").
--
-- SECTIONS
--   0  Extensions and schemas
--   1  Tables
--   2  Internal helper functions (schema "private")
--   3  Triggers
--   4  RPC functions (called by the frontend)
--   5  View: user_directory
--   6  Row Level Security (enable + policies)
--   7  Realtime
--   8  Storage (buckets + policies)
--   9  Privileges
--  10  Seed data
--  11  Backfill + post-steps (commented)
--  12  PHASE 10/11 MIGRATION (micro-niche parent link). On an EXISTING project
--      run ONLY section 12 (it is idempotent); sections 0-11 are for fresh projects.
--
-- ERROR CODES (RAISE EXCEPTION messages the frontend must translate):
--   auth.not_authenticated  auth.forbidden
--   product.not_found  product.in_recycle_bin  product.already_in_recycle_bin
--   product.not_in_recycle_bin  product.transition_not_allowed
--   product.reason_required  product.missing_fields (DETAIL = comma list:
--   name,image,description,price_from,price_to)  product.limit_reached
--   product.protected_field  profile.protected_field  profile.last_admin
--   notification.not_found  notification.not_actionable  notification.invalid_action
--   evaluation.invalid_period  evaluation.future_period
--   evaluation.invalid_contributor  evaluation.invalid_scores  evaluation.inconsistent
--   chat.invalid_member  chat.invalid_name  chat.forbidden
--   chat.cannot_leave_direct  chat.invalid_message  chat.empty_message
--   chat.invalid_attachment  chat.attachment_missing
--   micro_niche.parent_required  micro_niche.niche_mismatch  micro_niche.parent_locked   (phase 11)
-- =====================================================================


-- =====================================================================
-- 0. EXTENSIONS AND SCHEMAS
-- =====================================================================
create extension if not exists pg_trgm with schema extensions;

-- "private" holds internal functions. It is NOT exposed through the API.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;


-- =====================================================================
-- 1. TABLES
-- =====================================================================

-- ---------- 1.1 Users and reference data ----------

create table public.avatars (
  id           text primary key check (id ~ '^(male|female)-[1-9][0-9]*$'),
  gender       text not null check (gender in ('male', 'female')),
  storage_path text,                       -- file inside bucket "profile-avatars"
  sort_order   int  not null default 0,
  is_active    boolean not null default false
);

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text not null check (char_length(btrim(full_name)) between 1 and 80),
  email       text not null unique,
  phone       text check (phone is null or char_length(phone) <= 30),
  gender      text check (gender in ('male', 'female')),
  avatar_id   text references public.avatars (id) on delete set null,
  role        text not null default 'contributor' check (role in ('admin', 'contributor')),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index profiles_role_active_idx on public.profiles (role, is_active);

-- ---------- 1.2 Product status system (data-driven) ----------

create table public.product_statuses (
  code            text primary key
                  check (code in ('draft', 'pending', 'accepted', 'rejected', 'successful')),
  sort_order      int     not null,
  owner_can_edit  boolean not null,
  admin_can_edit  boolean not null,
  admin_can_see   boolean not null
);

create table public.product_status_transitions (
  from_status     text not null references public.product_statuses (code),
  to_status       text not null references public.product_statuses (code),
  actor           text not null check (actor in ('owner', 'admin')),
  requires_reason boolean not null default false,
  primary key (from_status, to_status, actor),
  check (from_status <> to_status)
);

-- ---------- 1.3 Niches, micro-niches, checklist (database-driven) ----------

create table public.niches (
  id         uuid primary key default gen_random_uuid(),
  name_ar    text check (name_ar is null or char_length(btrim(name_ar)) between 1 and 100),
  name_fr    text check (name_fr is null or char_length(btrim(name_fr)) between 1 and 100),
  name_en    text check (name_en is null or char_length(btrim(name_en)) between 1 and 100),
  is_seed    boolean not null default false,
  is_active  boolean not null default true,
  sort_order int     not null default 0,
  created_by uuid references public.profiles (id) on delete set null,
  check (num_nonnulls(name_ar, name_fr, name_en) >= 1)
);
create unique index niches_name_ar_uq on public.niches (lower(btrim(name_ar))) where name_ar is not null;
create unique index niches_name_fr_uq on public.niches (lower(btrim(name_fr))) where name_fr is not null;
create unique index niches_name_en_uq on public.niches (lower(btrim(name_en))) where name_en is not null;

create table public.micro_niches (
  id         uuid primary key default gen_random_uuid(),
  name_ar    text check (name_ar is null or char_length(btrim(name_ar)) between 1 and 100),
  name_fr    text check (name_fr is null or char_length(btrim(name_fr)) between 1 and 100),
  name_en    text check (name_en is null or char_length(btrim(name_en)) between 1 and 100),
  is_seed    boolean not null default false,
  is_active  boolean not null default true,
  sort_order int     not null default 0,
  created_by uuid references public.profiles (id) on delete set null,
  check (num_nonnulls(name_ar, name_fr, name_en) >= 1)
);
create unique index micro_niches_name_ar_uq on public.micro_niches (lower(btrim(name_ar))) where name_ar is not null;
create unique index micro_niches_name_fr_uq on public.micro_niches (lower(btrim(name_fr))) where name_fr is not null;
create unique index micro_niches_name_en_uq on public.micro_niches (lower(btrim(name_en))) where name_en is not null;

create table public.checklist_items (
  id         uuid primary key default gen_random_uuid(),
  label_ar   text check (label_ar is null or char_length(btrim(label_ar)) between 1 and 200),
  label_fr   text check (label_fr is null or char_length(btrim(label_fr)) between 1 and 200),
  label_en   text check (label_en is null or char_length(btrim(label_en)) between 1 and 200),
  is_seed    boolean not null default false,
  is_active  boolean not null default true,
  sort_order int     not null default 0,
  created_by uuid references public.profiles (id) on delete set null,
  check (num_nonnulls(label_ar, label_fr, label_en) >= 1)
);

-- ---------- 1.4 Products ----------

create table public.products (
  id                      uuid primary key default gen_random_uuid(),
  created_by              uuid not null references public.profiles (id) on delete restrict,
  status                  text not null default 'draft' references public.product_statuses (code),

  -- names (the mandatory name at submit = at least one of these four)
  name_ar                 text check (char_length(name_ar) <= 300),
  name_fr                 text check (char_length(name_fr) <= 300),
  name_en                 text check (char_length(name_en) <= 300),
  other_names             text[] not null default '{}' check (cardinality(other_names) <= 20),

  -- product information
  description             text check (char_length(description) <= 20000),
  potential_customers     text check (char_length(potential_customers) <= 20000),
  potential_uses          text check (char_length(potential_uses) <= 20000),
  strengths               text check (char_length(strengths) <= 20000),
  weaknesses              text check (char_length(weaknesses) <= 20000),
  points_to_verify        text check (char_length(points_to_verify) <= 20000),
  problem_solved          text check (char_length(problem_solved) <= 20000),

  -- evaluation
  visual_value            smallint check (visual_value between 1 and 5),
  actual_value            smallint check (actual_value between 1 and 5),
  value_score             smallint generated always as (
                            case when visual_value is not null and actual_value is not null
                                 then visual_value + actual_value end
                          ) stored,
  competition             text check (competition in ('none', 'weak', 'medium', 'high')),
  source                  text check (source in ('local', 'import')),
  competitor_sales_method text check (competitor_sales_method in ('direct_sales', 'branding', 'both')),

  -- competitor selling price (per-product currency, DZD by default)
  price_from              numeric(12, 2) check (price_from >= 0),
  price_to                numeric(12, 2) check (price_to >= 0),
  currency_code           text not null default 'DZD' check (currency_code ~ '^[A-Z]{3}$'),

  -- additional research
  testability_notes       text check (char_length(testability_notes) <= 20000),
  commercial_risks        text check (char_length(commercial_risks) <= 20000),
  notes                   text check (char_length(notes) <= 20000),
  next_research_step      text check (char_length(next_research_step) <= 20000),

  -- search (maintained by trigger, Arabic/French-normalized)
  search_text             text not null default '',

  -- workflow dates and actors (only set by RPC functions)
  submitted_at            timestamptz,
  accepted_at             timestamptz,
  rejected_at             timestamptz,
  successful_at           timestamptz,
  accepted_by             uuid references public.profiles (id) on delete set null,
  rejected_by             uuid references public.profiles (id) on delete set null,
  successful_by           uuid references public.profiles (id) on delete set null,

  -- recycle bin
  deleted_at              timestamptz,
  deleted_by              uuid references public.profiles (id) on delete set null,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint products_price_range_ck
    check (price_from is null or price_to is null or price_to >= price_from),

  -- status <-> dates consistency
  constraint products_status_dates_ck check (
       (status = 'draft'      and submitted_at is null     and accepted_at is null     and rejected_at is null     and successful_at is null)
    or (status = 'pending'    and submitted_at is not null and accepted_at is null     and rejected_at is null     and successful_at is null)
    or (status = 'accepted'   and submitted_at is not null and accepted_at is not null and rejected_at is null     and successful_at is null)
    or (status = 'rejected'   and submitted_at is not null and rejected_at is not null and accepted_at is null     and successful_at is null)
    or (status = 'successful' and submitted_at is not null and accepted_at is not null and successful_at is not null and rejected_at is null)
  )
);

create index products_owner_status_idx   on public.products (created_by, status, created_at desc) where deleted_at is null;
create index products_status_created_idx on public.products (status, created_at desc) where deleted_at is null;
create index products_created_id_idx     on public.products (created_at desc, id desc);
create index products_deleted_idx        on public.products (deleted_at) where deleted_at is not null;
create index products_value_idx          on public.products (value_score);
create index products_competition_idx    on public.products (competition);
create index products_source_idx         on public.products (source);
create index products_search_trgm_idx    on public.products using gin (search_text extensions.gin_trgm_ops);

-- ---------- 1.5 Product child tables ----------

create table public.product_images (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid not null references public.products (id) on delete cascade,
  storage_path text not null check (char_length(btrim(storage_path)) > 0),
  thumb_path   text,
  position     int  not null default 0,
  mime_type    text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes   int  not null check (size_bytes between 1 and 5242880),
  created_at   timestamptz not null default now(),
  unique (product_id, storage_path)
);
create index product_images_product_pos_idx on public.product_images (product_id, position);

create table public.product_videos (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid not null references public.products (id) on delete cascade,
  kind         text not null check (kind in ('upload', 'url')),
  storage_path text,
  url          text check (char_length(url) <= 1000),
  mime_type    text check (mime_type in ('video/mp4', 'video/webm', 'video/quicktime')),
  size_bytes   bigint check (size_bytes between 1 and 52428800),
  position     int  not null default 0,
  created_at   timestamptz not null default now(),
  constraint product_videos_kind_ck check (
       (kind = 'upload' and storage_path is not null and url is null)
    or (kind = 'url'    and url is not null and storage_path is null and url ~* '^https?://\S+$')
  )
);
create index product_videos_product_idx on public.product_videos (product_id, position);

create table public.product_niches (
  product_id uuid not null references public.products (id) on delete cascade,
  niche_id   uuid not null references public.niches (id) on delete restrict,
  primary key (product_id, niche_id)
);
create index product_niches_niche_idx on public.product_niches (niche_id);

create table public.product_micro_niches (
  product_id    uuid not null references public.products (id) on delete cascade,
  micro_niche_id uuid not null references public.micro_niches (id) on delete restrict,
  primary key (product_id, micro_niche_id)
);
create index product_micro_niches_micro_idx on public.product_micro_niches (micro_niche_id);

create table public.marketing_angles (
  id         uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  name       text not null check (char_length(btrim(name)) between 1 and 200),
  details    text check (char_length(details) <= 5000),
  position   int  not null default 0
);
create index marketing_angles_product_idx on public.marketing_angles (product_id, position);

create table public.suppliers (
  id                uuid primary key default gen_random_uuid(),
  product_id        uuid not null references public.products (id) on delete cascade,
  name              text not null check (char_length(btrim(name)) between 1 and 200),
  contact_method    text check (contact_method in
                      ('email', 'phone', 'whatsapp', 'telegram', 'facebook', 'instagram', 'tiktok', 'alibaba')),
  contact_details   text check (char_length(contact_details) <= 500),
  supplier_message  text check (char_length(supplier_message) <= 5000),
  position          int  not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- URL-type contact methods must hold an http(s) link
  constraint suppliers_url_ck check (
    contact_method not in ('facebook', 'instagram', 'tiktok', 'alibaba')
    or contact_details is null
    or contact_details ~* '^https?://\S+$'
  )
);
create index suppliers_product_idx on public.suppliers (product_id, position);

create table public.product_checklist_items (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid not null references public.products (id) on delete cascade,
  item_id      uuid references public.checklist_items (id) on delete restrict,
  custom_label text check (char_length(custom_label) <= 300),
  is_checked   boolean not null default false,
  position     int     not null default 0,
  check (item_id is not null or (custom_label is not null and char_length(btrim(custom_label)) > 0))
);
create unique index product_checklist_item_uq on public.product_checklist_items (product_id, item_id) where item_id is not null;
create index product_checklist_product_idx on public.product_checklist_items (product_id, position);

-- ---------- 1.6 History and activity (append-only) ----------

create table public.product_status_history (
  id          bigint generated always as identity primary key,
  product_id  uuid not null references public.products (id) on delete cascade,
  from_status text references public.product_statuses (code),
  to_status   text not null references public.product_statuses (code),
  action      text not null check (action in
                ('created', 'submitted', 'accepted', 'rejected', 're_reviewed', 'marked_successful')),
  reason      text check (char_length(reason) <= 2000),
  changed_by  uuid references public.profiles (id) on delete set null,
  changed_at  timestamptz not null default now(),
  constraint status_history_reason_ck check (action <> 're_reviewed' or char_length(btrim(coalesce(reason, ''))) > 0)
);
create index status_history_product_idx on public.product_status_history (product_id, changed_at desc);

create table public.activity_logs (
  id           bigint generated always as identity primary key,
  user_id      uuid references public.profiles (id) on delete set null,
  user_name    text,
  action       text not null check (action in (
                 'product_created', 'product_submitted', 'product_viewed', 'product_edited',
                 'product_accepted', 'product_rejected', 'product_re_reviewed', 'product_marked_successful',
                 'supplier_added', 'supplier_edited', 'supplier_removed',
                 'product_trashed', 'product_restored', 'product_purged',
                 'user_created', 'user_updated', 'user_role_changed', 'user_password_changed',
                 'user_disabled', 'user_enabled', 'user_deleted',
                 'evaluation_created', 'evaluation_updated')),
  product_id   uuid references public.products (id) on delete set null,
  product_name text,
  entity_id    uuid,
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
create index activity_logs_created_idx on public.activity_logs (created_at desc);
create index activity_logs_product_idx on public.activity_logs (product_id);
create index activity_logs_user_idx    on public.activity_logs (user_id, created_at desc);
-- exactly one "product_viewed" entry per user per product
create unique index activity_logs_one_view_uq on public.activity_logs (user_id, product_id) where action = 'product_viewed';

-- ---------- 1.7 Notifications ----------

create table public.notifications (
  id           uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  type         text not null check (type in ('product_submitted')),
  product_id   uuid not null references public.products (id) on delete cascade,
  actor_id     uuid references public.profiles (id) on delete set null,
  payload      jsonb not null default '{}'::jsonb,
  state        text not null default 'active' check (state in ('active', 'snoozed', 'dismissed', 'resolved')),
  remind_at    timestamptz,
  viewed_at    timestamptz,
  dismissed_at timestamptz,
  resolved_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint notifications_snooze_ck check ((state = 'snoozed') = (remind_at is not null)),
  unique (recipient_id, product_id, type)
);
create index notifications_recipient_state_idx on public.notifications (recipient_id, state, remind_at);
create index notifications_product_idx         on public.notifications (product_id);

-- ---------- 1.8 Contributor evaluations ----------

create table public.contributor_evaluations (
  id            uuid primary key default gen_random_uuid(),
  contributor_id uuid not null references public.profiles (id) on delete restrict,
  evaluator_id  uuid not null references public.profiles (id) on delete restrict,
  updated_by    uuid references public.profiles (id) on delete set null,
  period_type   text not null check (period_type in ('weekly', 'monthly')),
  period_start  date not null,
  period_end    date not null,
  average_score numeric(4, 2) not null check (average_score between 0 and 10),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (contributor_id, period_type, period_start),
  constraint evaluations_period_ck check (
       (period_type = 'weekly'  and extract(isodow from period_start) = 1 and period_end = period_start + 6)
    or (period_type = 'monthly' and extract(day from period_start) = 1
                                and period_end = ((period_start + interval '1 month')::date - 1))
  )
);
create index evaluations_contributor_idx on public.contributor_evaluations (contributor_id, period_type, period_start desc);

create table public.contributor_evaluation_scores (
  evaluation_id uuid not null references public.contributor_evaluations (id) on delete cascade,
  criterion     text not null check (criterion in (
                  'products_added', 'product_quality', 'information_completeness',
                  'research_accuracy', 'accepted_products', 'checklist_compliance')),
  score         smallint not null check (score between 0 and 10),
  primary key (evaluation_id, criterion)
);

-- ---------- 1.9 Chat ----------

create table public.conversations (
  id              uuid primary key default gen_random_uuid(),
  type            text not null check (type in ('direct', 'group')),
  name            text check (name is null or char_length(btrim(name)) between 1 and 80),
  direct_key      text unique,
  created_by      uuid references public.profiles (id) on delete set null,
  last_message_at timestamptz,
  created_at      timestamptz not null default now(),
  constraint conversations_group_name_ck check (type <> 'group' or name is not null),
  constraint conversations_direct_key_ck check ((type = 'direct') = (direct_key is not null))
);

create table public.conversation_members (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  role            text not null default 'member' check (role in ('owner', 'member')),
  pseudo          text check (pseudo is null or char_length(btrim(pseudo)) between 1 and 40),
  last_read_at    timestamptz,
  joined_at       timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create unique index conversation_members_pseudo_uq
  on public.conversation_members (conversation_id, lower(btrim(pseudo))) where pseudo is not null;
create index conversation_members_user_idx on public.conversation_members (user_id);

create table public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id       uuid references public.profiles (id) on delete set null,
  kind            text not null check (kind in ('text', 'image', 'video', 'file', 'location')),
  body            text check (char_length(body) <= 4000),
  latitude        double precision,
  longitude       double precision,
  created_at      timestamptz not null default now(),
  constraint messages_text_ck check (kind <> 'text' or char_length(btrim(coalesce(body, ''))) > 0),
  constraint messages_location_ck check (
       (kind = 'location' and latitude is not null and longitude is not null
                          and latitude between -90 and 90 and longitude between -180 and 180)
    or (kind <> 'location' and latitude is null and longitude is null)
  )
);
create index messages_conversation_idx on public.messages (conversation_id, created_at desc, id desc);

create table public.message_attachments (
  id           uuid primary key default gen_random_uuid(),
  message_id   uuid not null references public.messages (id) on delete cascade,
  bucket       text not null check (bucket in ('chat-images', 'chat-videos', 'chat-files')),
  storage_path text not null,
  file_name    text not null check (char_length(file_name) between 1 and 255),
  mime_type    text not null,
  size_bytes   bigint not null,
  created_at   timestamptz not null default now(),
  constraint attachments_type_ck check (
       (bucket = 'chat-images' and mime_type in ('image/jpeg', 'image/png', 'image/webp', 'image/gif')
                               and size_bytes between 1 and 10485760)
    or (bucket = 'chat-videos' and mime_type in ('video/mp4', 'video/webm', 'video/quicktime')
                               and size_bytes between 1 and 52428800)
    or (bucket = 'chat-files'  and mime_type in (
          'application/pdf', 'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/vnd.ms-excel',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'text/plain', 'text/csv')
                               and size_bytes between 1 and 26214400)
  )
);
create index message_attachments_message_idx on public.message_attachments (message_id);

-- ---------- 1.10 Storage cleanup queue ----------
-- Deleting rows in SQL does NOT delete the real files in Storage.
-- purge_product() writes the file paths here; the app removes the files
-- through the Storage API and then calls ack_cleanup_queue().

create table public.storage_cleanup_queue (
  id         bigint generated always as identity primary key,
  bucket     text not null,
  path       text not null,
  created_at timestamptz not null default now(),
  unique (bucket, path)
);


-- =====================================================================
-- 2. INTERNAL HELPER FUNCTIONS (schema "private")
-- =====================================================================

create or replace function private.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Lowercase, strip Arabic diacritics/tatweel, unify alef/ya/ta-marbuta/hamza
-- forms, strip French accents, collapse spaces. Used for product search.
create or replace function private.normalize_search_text(p_text text)
returns text language sql immutable set search_path = '' as $$
  select btrim(regexp_replace(
           translate(
             translate(
               regexp_replace(lower(coalesce(p_text, '')), '[\u064B-\u065F\u0670]', '', 'g'),
               'أإآٱىةؤئàâäçéèêëîïôöùûüÿñ',
               'اااايهويaaaceeeeiioouuuyn'),
             'ـ', ''),
           '\s+', ' ', 'g'));
$$;

create or replace function private.try_uuid(p_value text)
returns uuid language plpgsql immutable set search_path = '' as $$
begin
  return p_value::uuid;
exception when others then
  return null;
end $$;

create or replace function private.is_active_user()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.is_active
  );
$$;

create or replace function private.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.is_active and p.role = 'admin'
  );
$$;

create or replace function private.product_label(p_product_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(
           nullif(btrim(p.name_ar), ''),
           nullif(btrim(p.name_fr), ''),
           nullif(btrim(p.name_en), ''),
           (select btrim(n) from unnest(p.other_names) n where btrim(n) <> '' limit 1))
  from public.products p
  where p.id = p_product_id;
$$;

-- Who can SEE a product (database-enforced):
--   owner: own products that are not in the recycle bin (drafts included)
--   admin: every status flagged admin_can_see (drafts are never visible to admins)
create or replace function private.can_view_product(p_product_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select (pr.created_by = (select auth.uid()) and pr.deleted_at is null and private.is_active_user())
        or (private.is_admin() and s.admin_can_see)
    from public.products pr
    join public.product_statuses s on s.code = pr.status
    where pr.id = p_product_id
  ), false);
$$;

-- Who can EDIT a product (database-enforced), driven by product_statuses:
--   contributor (owner): draft, pending        admin: pending, accepted, rejected, successful
--   nobody edits a product that is in the recycle bin.
-- Note: an admin can only edit a draft if he is its owner (admin-created draft);
-- an admin can never edit a contributor's draft.
create or replace function private.can_edit_product(p_product_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select pr.deleted_at is null
       and private.is_active_user()
       and ((pr.created_by = (select auth.uid()) and s.owner_can_edit)
            or (private.is_admin() and s.admin_can_edit))
    from public.products pr
    join public.product_statuses s on s.code = pr.status
    where pr.id = p_product_id
  ), false);
$$;

create or replace function private.is_conversation_member(p_conversation_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = p_conversation_id and cm.user_id = (select auth.uid())
  ) and private.is_active_user();
$$;

-- Single entry point for writing activity logs (append-only table).
-- Inserting a second "product_viewed" for the same user/product is ignored.
create or replace function private.write_activity(
  p_action     text,
  p_product_id uuid  default null,
  p_metadata   jsonb default '{}'::jsonb,
  p_entity_id  uuid  default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  insert into public.activity_logs (user_id, user_name, action, product_id, product_name, entity_id, metadata)
  values (
    v_uid,
    (select p.full_name from public.profiles p where p.id = v_uid),
    p_action,
    p_product_id,
    case when p_product_id is null then null else private.product_label(p_product_id) end,
    p_entity_id,
    coalesce(p_metadata, '{}'::jsonb))
  on conflict do nothing;
end $$;


-- =====================================================================
-- 3. TRIGGERS
-- =====================================================================

-- ---------- 3.1 Auth -> profiles ----------
-- IMPORTANT: the role comes from raw_app_meta_data (only the server can set it),
-- NEVER from raw_user_meta_data (user-editable). Default role: contributor.

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name, email, role, gender)
  values (
    new.id,
    left(coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1)), 80),
    new.email,
    case when new.raw_app_meta_data ->> 'role' = 'admin' then 'admin' else 'contributor' end,
    case when new.raw_user_meta_data ->> 'gender' in ('male', 'female')
         then new.raw_user_meta_data ->> 'gender' end);
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.sync_user_email()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set email = new.email
  where id = new.id and email is distinct from new.email;
  return null;
end $$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function public.sync_user_email();

-- ---------- 3.2 profiles ----------
-- Guard (SECURITY INVOKER on purpose: current_user must be the caller's role).
-- A logged-in user (role "authenticated") can never change role/is_active/email.

create or replace function private.profiles_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon') then
    if new.id is distinct from old.id
       or new.email is distinct from old.email
       or new.role is distinct from old.role
       or new.is_active is distinct from old.is_active
       or new.created_at is distinct from old.created_at then
      raise exception 'profile.protected_field' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

create trigger profiles_a_guard
  before update on public.profiles
  for each row execute function private.profiles_guard();

create trigger profiles_b_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

-- The last active admin can never be demoted, disabled or deleted.
create or replace function private.profiles_last_admin()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'admin' and old.is_active
     and (tg_op = 'DELETE' or new.role <> 'admin' or not new.is_active) then
    if not exists (
      select 1 from public.profiles p
      where p.role = 'admin' and p.is_active and p.id <> old.id) then
      raise exception 'profile.last_admin' using errcode = '23514';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

create trigger profiles_last_admin
  before update or delete on public.profiles
  for each row execute function private.profiles_last_admin();

-- ---------- 3.3 products ----------

-- Guard (SECURITY INVOKER): direct writes by logged-in users cannot touch
-- status, workflow dates/authors or recycle-bin columns. Those change only
-- inside the RPC functions of section 4 (which run as the function owner).
create or replace function private.products_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.status := 'draft';
      new.submitted_at := null;  new.accepted_at := null;  new.rejected_at := null;  new.successful_at := null;
      new.accepted_by := null;   new.rejected_by := null;  new.successful_by := null;
      new.deleted_at := null;    new.deleted_by := null;
    else
      if new.id            is distinct from old.id
         or new.created_by    is distinct from old.created_by
         or new.created_at    is distinct from old.created_at
         or new.status        is distinct from old.status
         or new.submitted_at  is distinct from old.submitted_at
         or new.accepted_at   is distinct from old.accepted_at
         or new.rejected_at   is distinct from old.rejected_at
         or new.successful_at is distinct from old.successful_at
         or new.accepted_by   is distinct from old.accepted_by
         or new.rejected_by   is distinct from old.rejected_by
         or new.successful_by is distinct from old.successful_by
         or new.deleted_at    is distinct from old.deleted_at
         or new.deleted_by    is distinct from old.deleted_by then
        raise exception 'product.protected_field' using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end $$;

create trigger products_a_guard
  before insert or update on public.products
  for each row execute function private.products_guard();

-- search_text + updated_at (runs on every write, including draft autosave)
create or replace function private.products_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.search_text := private.normalize_search_text(
    concat_ws(' ', new.name_ar, new.name_fr, new.name_en, array_to_string(new.other_names, ' ')));
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end $$;

create trigger products_b_before_write
  before insert or update on public.products
  for each row execute function private.products_before_write();

-- Creation: first history row + activity log
create or replace function private.products_after_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.product_status_history (product_id, from_status, to_status, action, changed_by)
  values (new.id, null, new.status, 'created', new.created_by);
  perform private.write_activity('product_created', new.id);
  return null;
end $$;

create trigger products_c_after_insert
  after insert on public.products
  for each row execute function private.products_after_insert();

-- Edits: logged ONLY when the product is no longer a draft (so draft autosave
-- never creates "product_edited" entries) and real content columns changed.
create or replace function private.products_log_edit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_skip constant text[] := array[
    'id', 'created_by', 'created_at', 'updated_at', 'search_text', 'value_score', 'status',
    'submitted_at', 'accepted_at', 'rejected_at', 'successful_at',
    'accepted_by', 'rejected_by', 'successful_by', 'deleted_at', 'deleted_by'];
  v_old     jsonb := to_jsonb(old) - v_skip;
  v_new     jsonb := to_jsonb(new) - v_skip;
  v_changed text[];
begin
  if old.status = 'draft' or new.status <> old.status then
    return null;
  end if;

  select coalesce(array_agg(n.key order by n.key), '{}')
    into v_changed
    from jsonb_each(v_new) n
   where n.value is distinct from (v_old -> n.key);

  if cardinality(v_changed) > 0 then
    perform private.write_activity('product_edited', new.id,
                                   jsonb_build_object('changed_fields', to_jsonb(v_changed)));
  end if;
  return null;
end $$;

create trigger products_d_log_edit
  after update on public.products
  for each row execute function private.products_log_edit();

-- ---------- 3.4 product child tables ----------

-- Limits per product (images 10, videos 3, suppliers 20, angles 20, checklist 50)
create or replace function private.enforce_child_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_max   int := tg_argv[0]::int;
  v_count int;
begin
  execute format('select count(*) from public.%I where product_id = $1', tg_table_name)
    into v_count using new.product_id;
  if v_count >= v_max then
    raise exception 'product.limit_reached' using errcode = '23514', detail = tg_table_name;
  end if;
  return new;
end $$;

create trigger product_images_limit before insert on public.product_images
  for each row execute function private.enforce_child_limit(10);
create trigger product_videos_limit before insert on public.product_videos
  for each row execute function private.enforce_child_limit(3);
create trigger suppliers_limit before insert on public.suppliers
  for each row execute function private.enforce_child_limit(20);
create trigger marketing_angles_limit before insert on public.marketing_angles
  for each row execute function private.enforce_child_limit(20);
create trigger product_checklist_items_limit before insert on public.product_checklist_items
  for each row execute function private.enforce_child_limit(50);

-- Any child change touches the parent's updated_at (also during draft autosave).
-- When the product is NOT a draft, the change is also written to the activity log:
-- suppliers -> supplier_added / supplier_edited / supplier_removed,
-- other child tables -> product_edited with the section name.
create or replace function private.on_child_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_pid    uuid;
  v_row    jsonb;
  v_status text;
  v_action text;
  v_meta   jsonb;
begin
  if tg_op = 'DELETE' then
    v_pid := old.product_id;  v_row := to_jsonb(old);
  else
    v_pid := new.product_id;  v_row := to_jsonb(new);
  end if;

  update public.products set updated_at = now() where id = v_pid returning status into v_status;
  if not found then
    return null;  -- parent already deleted (cascade)
  end if;
  if v_status = 'draft' then
    return null;  -- draft autosave: no activity log
  end if;

  if tg_table_name = 'suppliers' then
    v_action := case tg_op
                  when 'INSERT' then 'supplier_added'
                  when 'UPDATE' then 'supplier_edited'
                  else 'supplier_removed' end;
    v_meta := jsonb_build_object('supplier_id', v_row ->> 'id', 'supplier_name', v_row ->> 'name');
  else
    v_action := 'product_edited';
    v_meta := jsonb_build_object('section', tg_table_name, 'operation', lower(tg_op));
  end if;

  perform private.write_activity(v_action, v_pid, v_meta);
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'product_images', 'product_videos', 'product_niches', 'product_micro_niches',
    'marketing_angles', 'suppliers', 'product_checklist_items'] loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I
         for each row execute function private.on_child_change()',
      t || '_after_change', t);
  end loop;
end $$;

create trigger suppliers_updated_at before update on public.suppliers
  for each row execute function private.set_updated_at();

-- ---------- 3.5 notifications / evaluations ----------

create trigger notifications_updated_at before update on public.notifications
  for each row execute function private.set_updated_at();

create trigger evaluations_updated_at before update on public.contributor_evaluations
  for each row execute function private.set_updated_at();

-- Deferred check (at COMMIT): exactly 6 scores and a stored average that
-- matches them. Nothing inconsistent can ever be committed.
create or replace function private.check_evaluation_complete()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_id     uuid;
  v_stored numeric;
  v_n      int;
  v_avg    numeric;
begin
  if tg_table_name = 'contributor_evaluations' then
    if tg_op = 'DELETE' then v_id := old.id; else v_id := new.id; end if;
  else
    if tg_op = 'DELETE' then v_id := old.evaluation_id; else v_id := new.evaluation_id; end if;
  end if;

  select e.average_score into v_stored from public.contributor_evaluations e where e.id = v_id;
  if not found then
    return null;  -- evaluation deleted: nothing to check
  end if;

  select count(*), round(avg(s.score), 2)
    into v_n, v_avg
    from public.contributor_evaluation_scores s
   where s.evaluation_id = v_id;

  if v_n <> 6 or v_avg is distinct from v_stored then
    raise exception 'evaluation.inconsistent' using errcode = '23514';
  end if;
  return null;
end $$;

create constraint trigger evaluation_parent_check
  after insert or update on public.contributor_evaluations
  deferrable initially deferred
  for each row execute function private.check_evaluation_complete();

create constraint trigger evaluation_scores_check
  after insert or update or delete on public.contributor_evaluation_scores
  deferrable initially deferred
  for each row execute function private.check_evaluation_complete();

-- ---------- 3.6 chat ----------

-- Members can only change their own pseudo / last_read_at (SECURITY INVOKER guard).
create or replace function private.conversation_members_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon') then
    if new.conversation_id is distinct from old.conversation_id
       or new.user_id   is distinct from old.user_id
       or new.role      is distinct from old.role
       or new.joined_at is distinct from old.joined_at then
      raise exception 'chat.forbidden' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

create trigger conversation_members_a_guard
  before update on public.conversation_members
  for each row execute function private.conversation_members_guard();

-- A direct conversation has at most 2 members.
create or replace function private.conversation_members_direct_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.conversations c where c.id = new.conversation_id and c.type = 'direct')
     and (select count(*) from public.conversation_members m where m.conversation_id = new.conversation_id) >= 2 then
    raise exception 'chat.forbidden' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger conversation_members_direct_limit
  before insert on public.conversation_members
  for each row execute function private.conversation_members_direct_limit();

create or replace function private.messages_after_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.conversations set last_message_at = new.created_at where id = new.conversation_id;
  return null;
end $$;

create trigger messages_after_insert
  after insert on public.messages
  for each row execute function private.messages_after_insert();


-- =====================================================================
-- 4. RPC FUNCTIONS (called by the frontend with supabase.rpc)
-- =====================================================================

-- ---------- 4.1 Product workflow ----------
-- The ONLY way to change a product's status. Validates actor + transition
-- (table product_status_transitions), the mandatory fields at submission,
-- sets dates/authors, writes history + activity, creates/resolves notifications.

create or replace function public.change_product_status(
  p_product_id uuid,
  p_to_status  text,
  p_reason     text default null)
returns public.products
language plpgsql security definer set search_path = '' as $$
declare
  v_uid      uuid := auth.uid();
  v_prod     public.products%rowtype;
  v_trans    public.product_status_transitions%rowtype;
  v_is_admin boolean;
  v_reason   text := nullif(btrim(coalesce(p_reason, '')), '');
  v_missing  text[] := '{}';
  v_action   text;
  v_activity text;
begin
  if v_uid is null or not private.is_active_user() then
    raise exception 'auth.not_authenticated' using errcode = '42501';
  end if;

  if not private.can_view_product(p_product_id) then
    raise exception 'product.not_found' using errcode = 'P0002';
  end if;

  select * into v_prod from public.products where id = p_product_id for update;
  if v_prod.deleted_at is not null then
    raise exception 'product.in_recycle_bin' using errcode = '23514';
  end if;

  v_is_admin := private.is_admin();

  -- allowed transition for THIS actor?
  select t.* into v_trans
    from public.product_status_transitions t
   where t.from_status = v_prod.status
     and t.to_status   = p_to_status
     and ((t.actor = 'admin' and v_is_admin)
          or (t.actor = 'owner' and v_prod.created_by = v_uid))
   order by case t.actor when 'admin' then 0 else 1 end
   limit 1;
  if not found then
    raise exception 'product.transition_not_allowed' using errcode = '42501',
      detail = v_prod.status || '->' || coalesce(p_to_status, '');
  end if;

  if v_trans.requires_reason and v_reason is null then
    raise exception 'product.reason_required' using errcode = '23514';
  end if;

  -- submission (draft -> pending): the mandatory fields
  if v_prod.status = 'draft' then
    if coalesce(btrim(v_prod.name_ar), '') = ''
       and coalesce(btrim(v_prod.name_fr), '') = ''
       and coalesce(btrim(v_prod.name_en), '') = ''
       and not exists (select 1 from unnest(v_prod.other_names) n where btrim(n) <> '') then
      v_missing := array_append(v_missing, 'name');
    end if;
    if not exists (select 1 from public.product_images i where i.product_id = v_prod.id) then
      v_missing := array_append(v_missing, 'image');
    end if;
    if coalesce(btrim(v_prod.description), '') = '' then
      v_missing := array_append(v_missing, 'description');
    end if;
    if v_prod.price_from is null then
      v_missing := array_append(v_missing, 'price_from');
    end if;
    if v_prod.price_to is null then
      v_missing := array_append(v_missing, 'price_to');
    end if;
    if cardinality(v_missing) > 0 then
      raise exception 'product.missing_fields' using errcode = '23514',
        detail = array_to_string(v_missing, ',');
    end if;
  end if;

  -- apply the transition
  if p_to_status = 'pending' and v_prod.status = 'draft' then
    update public.products set status = 'pending', submitted_at = now() where id = v_prod.id;
    v_action := 'submitted';  v_activity := 'product_submitted';

  elsif p_to_status = 'pending' then
    -- re-review: clear the decision (the history table keeps it)
    update public.products
       set status = 'pending',
           accepted_at = null,   accepted_by = null,
           rejected_at = null,   rejected_by = null,
           successful_at = null, successful_by = null
     where id = v_prod.id;
    v_action := 're_reviewed';  v_activity := 'product_re_reviewed';

  elsif p_to_status = 'accepted' then
    update public.products set status = 'accepted', accepted_at = now(), accepted_by = v_uid where id = v_prod.id;
    v_action := 'accepted';  v_activity := 'product_accepted';

  elsif p_to_status = 'rejected' then
    update public.products set status = 'rejected', rejected_at = now(), rejected_by = v_uid where id = v_prod.id;
    v_action := 'rejected';  v_activity := 'product_rejected';

  elsif p_to_status = 'successful' then
    update public.products set status = 'successful', successful_at = now(), successful_by = v_uid where id = v_prod.id;
    v_action := 'marked_successful';  v_activity := 'product_marked_successful';
  end if;

  insert into public.product_status_history (product_id, from_status, to_status, action, reason, changed_by)
  values (v_prod.id, v_prod.status, p_to_status, v_action, v_reason, v_uid);

  perform private.write_activity(v_activity, v_prod.id,
            jsonb_build_object('from', v_prod.status, 'to', p_to_status, 'reason', v_reason));

  -- notifications
  if v_action = 'submitted' then
    -- one notification per active admin (except the submitter)
    insert into public.notifications (recipient_id, type, product_id, actor_id, payload)
    select a.id, 'product_submitted', v_prod.id, v_uid,
           jsonb_build_object(
             'product_name', private.product_label(v_prod.id),
             'actor_name',   (select p.full_name from public.profiles p where p.id = v_uid))
      from public.profiles a
     where a.role = 'admin' and a.is_active and a.id <> v_uid
    on conflict (recipient_id, product_id, type) do nothing;

  elsif v_prod.status = 'pending' and p_to_status in ('accepted', 'rejected') then
    -- reviewed: resolve for every admin (dismissed ones stay dismissed)
    update public.notifications
       set state = 'resolved', resolved_at = now(), remind_at = null
     where product_id = v_prod.id and state in ('active', 'snoozed');
  end if;

  select * into v_prod from public.products where id = p_product_id;
  return v_prod;
end $$;

-- ---------- 4.2 Recycle bin ----------

create or replace function public.trash_product(p_product_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_deleted timestamptz;
begin
  if not private.is_admin() then
    raise exception 'auth.forbidden' using errcode = '42501';
  end if;
  if not private.can_view_product(p_product_id) then
    raise exception 'product.not_found' using errcode = 'P0002';
  end if;

  select deleted_at into v_deleted from public.products where id = p_product_id for update;
  if v_deleted is not null then
    raise exception 'product.already_in_recycle_bin' using errcode = '23514';
  end if;

  update public.products set deleted_at = now(), deleted_by = auth.uid() where id = p_product_id;
  perform private.write_activity('product_trashed', p_product_id);
end $$;

create or replace function public.restore_product(p_product_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_deleted timestamptz;
begin
  if not private.is_admin() then
    raise exception 'auth.forbidden' using errcode = '42501';
  end if;
  if not private.can_view_product(p_product_id) then
    raise exception 'product.not_found' using errcode = 'P0002';
  end if;

  select deleted_at into v_deleted from public.products where id = p_product_id for update;
  if v_deleted is null then
    raise exception 'product.not_in_recycle_bin' using errcode = '23514';
  end if;

  update public.products set deleted_at = null, deleted_by = null where id = p_product_id;
  perform private.write_activity('product_restored', p_product_id);
end $$;

-- Permanent delete: queues every Storage file path, logs, then deletes the
-- product (children + history cascade). Returns how many files were queued.
create or replace function public.purge_product(p_product_id uuid)
returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_deleted timestamptz;
  v_count   int := 0;
begin
  if not private.is_admin() then
    raise exception 'auth.forbidden' using errcode = '42501';
  end if;
  if not private.can_view_product(p_product_id) then
    raise exception 'product.not_found' using errcode = 'P0002';
  end if;

  select deleted_at into v_deleted from public.products where id = p_product_id for update;
  if v_deleted is null then
    raise exception 'product.not_in_recycle_bin' using errcode = '23514';
  end if;

  insert into public.storage_cleanup_queue (bucket, path)
  select 'product-images', i.storage_path from public.product_images i where i.product_id = p_product_id
  union
  select 'product-images', i.thumb_path from public.product_images i
   where i.product_id = p_product_id and i.thumb_path is not null
  union
  select 'product-videos', v.storage_path from public.product_videos v
   where v.product_id = p_product_id and v.kind = 'upload' and v.storage_path is not null
  on conflict (bucket, path) do nothing;
  get diagnostics v_count = row_count;

  perform private.write_activity('product_purged', p_product_id,
            jsonb_build_object('files_queued', v_count), p_product_id);

  delete from public.products where id = p_product_id;
  return v_count;
end $$;

-- After the app has removed the files through the Storage API:
create or replace function public.ack_cleanup_queue(p_ids bigint[])
returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_count int;
begin
  if not private.is_admin() then
    raise exception 'auth.forbidden' using errcode = '42501';
  end if;
  delete from public.storage_cleanup_queue where id = any (p_ids);
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- First view per admin per product only (see unique index on activity_logs).
create or replace function public.log_product_view(p_product_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then
    return;  -- contributors: nothing to log
  end if;
  if not private.can_view_product(p_product_id) then
    raise exception 'product.not_found' using errcode = 'P0002';
  end if;
  perform private.write_activity('product_viewed', p_product_id);
end $$;

-- ---------- 4.3 Notifications ----------

-- Due = active, or snoozed with remind_at reached, AND the product is still
-- pending and not in the recycle bin. Uses the DATABASE clock.
create or replace function public.get_due_notifications()
returns setof public.notifications
language sql stable security invoker set search_path = '' as $$
  select n.*
    from public.notifications n
    join public.products p on p.id = n.product_id
   where n.recipient_id = (select auth.uid())
     and (n.state = 'active' or (n.state = 'snoozed' and n.remind_at <= now()))
     and p.status = 'pending'
     and p.deleted_at is null
   order by n.created_at;
$$;

-- p_action: 'view' (marks viewed, keeps reminding), 'dismiss', 'snooze' (+30 min)
create or replace function public.notification_action(p_notification_id uuid, p_action text)
returns public.notifications
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_n   public.notifications%rowtype;
begin
  if v_uid is null or not private.is_active_user() then
    raise exception 'auth.not_authenticated' using errcode = '42501';
  end if;

  select * into v_n from public.notifications
   where id = p_notification_id and recipient_id = v_uid for update;
  if not found then
    raise exception 'notification.not_found' using errcode = 'P0002';
  end if;

  if p_action = 'view' then
    update public.notifications set viewed_at = coalesce(viewed_at, now()) where id = v_n.id;

  elsif p_action = 'dismiss' then
    if v_n.state not in ('active', 'snoozed') then
      raise exception 'notification.not_actionable' using errcode = '23514';
    end if;
    update public.notifications
       set state = 'dismissed', dismissed_at = now(), remind_at = null
     where id = v_n.id;

  elsif p_action = 'snooze' then
    if v_n.state not in ('active', 'snoozed') then
      raise exception 'notification.not_actionable' using errcode = '23514';
    end if;
    update public.notifications
       set state = 'snoozed', remind_at = now() + interval '30 minutes'
     where id = v_n.id;

  else
    raise exception 'notification.invalid_action' using errcode = '22023';
  end if;

  select * into v_n from public.notifications where id = p_notification_id;
  return v_n;
end $$;

-- ---------- 4.4 Evaluations ----------

-- p_scores example: {"products_added":8,"product_quality":7,"information_completeness":9,
--                    "research_accuracy":8,"accepted_products":6,"checklist_compliance":9}
-- All 6 scores are entered by the supervisor (integers 0-10). The average is
-- computed here (sum / 6, 2 decimals). Re-saving the same period is a
-- correction: the previous scores are kept in activity_logs (before/after).
create or replace function public.save_evaluation(
  p_contributor_id uuid,
  p_period_type    text,
  p_period_start   date,
  p_scores         jsonb)
returns public.contributor_evaluations
language plpgsql security definer set search_path = '' as $$
declare
  v_uid        uuid := auth.uid();
  v_criteria   constant text[] := array[
    'products_added', 'product_quality', 'information_completeness',
    'research_accuracy', 'accepted_products', 'checklist_compliance'];
  v_c          text;
  v_val        numeric;
  v_sum        numeric := 0;
  v_avg        numeric(4, 2);
  v_end        date;
  v_new_scores jsonb := '{}'::jsonb;
  v_existing   uuid;
  v_old_avg    numeric;
  v_before     jsonb;
  v_eval       public.contributor_evaluations%rowtype;
begin
  if not private.is_admin() then
    raise exception 'auth.forbidden' using errcode = '42501';
  end if;
  if p_period_type is null or p_period_type not in ('weekly', 'monthly') or p_period_start is null then
    raise exception 'evaluation.invalid_period' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_contributor_id and p.role = 'contributor') then
    raise exception 'evaluation.invalid_contributor' using errcode = '22023';
  end if;

  if p_period_type = 'weekly' then
    if extract(isodow from p_period_start) <> 1 then
      raise exception 'evaluation.invalid_period' using errcode = '22023';
    end if;
    v_end := p_period_start + 6;
  else
    if extract(day from p_period_start) <> 1 then
      raise exception 'evaluation.invalid_period' using errcode = '22023';
    end if;
    v_end := (p_period_start + interval '1 month')::date - 1;
  end if;

  -- a period that has not started yet cannot be evaluated (+1 day tolerance for time zones)
  if p_period_start > current_date + 1 then
    raise exception 'evaluation.future_period' using errcode = '22023';
  end if;

  -- validate the 6 manual scores
  if p_scores is null or jsonb_typeof(p_scores) <> 'object' then
    raise exception 'evaluation.invalid_scores' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_object_keys(p_scores)) <> 6 then
    raise exception 'evaluation.invalid_scores' using errcode = '22023';
  end if;
  foreach v_c in array v_criteria loop
    if (p_scores -> v_c) is null or jsonb_typeof(p_scores -> v_c) <> 'number' then
      raise exception 'evaluation.invalid_scores' using errcode = '22023';
    end if;
    v_val := (p_scores ->> v_c)::numeric;
    if v_val <> trunc(v_val) or v_val < 0 or v_val > 10 then
      raise exception 'evaluation.invalid_scores' using errcode = '22023';
    end if;
    v_sum := v_sum + v_val;
    v_new_scores := v_new_scores || jsonb_build_object(v_c, v_val::int);
  end loop;
  v_avg := round(v_sum / 6, 2);

  select e.id, e.average_score into v_existing, v_old_avg
    from public.contributor_evaluations e
   where e.contributor_id = p_contributor_id
     and e.period_type = p_period_type
     and e.period_start = p_period_start
   for update;

  if v_existing is null then
    insert into public.contributor_evaluations
      (contributor_id, evaluator_id, updated_by, period_type, period_start, period_end, average_score)
    values (p_contributor_id, v_uid, v_uid, p_period_type, p_period_start, v_end, v_avg)
    returning * into v_eval;

    insert into public.contributor_evaluation_scores (evaluation_id, criterion, score)
    select v_eval.id, c, (v_new_scores ->> c)::smallint from unnest(v_criteria) c;

    perform private.write_activity('evaluation_created', null,
      jsonb_build_object('contributor_id', p_contributor_id, 'period_type', p_period_type,
                         'period_start', p_period_start, 'scores', v_new_scores, 'average', v_avg),
      v_eval.id);
  else
    select jsonb_build_object('scores', jsonb_object_agg(s.criterion, s.score), 'average', v_old_avg)
      into v_before
      from public.contributor_evaluation_scores s
     where s.evaluation_id = v_existing;

    update public.contributor_evaluation_scores s
       set score = (v_new_scores ->> s.criterion)::smallint
     where s.evaluation_id = v_existing;

    update public.contributor_evaluations
       set average_score = v_avg, updated_by = v_uid
     where id = v_existing
    returning * into v_eval;

    perform private.write_activity('evaluation_updated', null,
      jsonb_build_object('contributor_id', p_contributor_id, 'period_type', p_period_type,
                         'period_start', p_period_start, 'before', v_before,
                         'after', jsonb_build_object('scores', v_new_scores, 'average', v_avg)),
      v_eval.id);
  end if;

  return v_eval;
end $$;

-- ---------- 4.5 Contributor statistics ----------
-- Computed on the fly (no stored counters). Drafts and recycle-bin products are excluded.
--   acceptance_rate = (accepted + successful) / (accepted + rejected + successful)
--   rejection_rate  = rejected / (accepted + rejected + successful)
--   success_rate    = successful / (accepted + successful)
-- Rates are NULL when the denominator is 0 (never a misleading 0%).
-- A contributor can only read his own stats; an admin can read anyone's.
create or replace function public.get_contributor_stats(
  p_contributor_id uuid default null,
  p_tz             text default 'UTC')
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid         uuid := auth.uid();
  v_target      uuid := coalesce(p_contributor_id, auth.uid());
  v_tz          text := coalesce(p_tz, 'UTC');
  v_week_start  timestamptz;
  v_month_start timestamptz;
  v_total int; v_pending int; v_accepted int; v_rejected int; v_successful int;
  v_week int;  v_month int;
  v_reviewed int; v_accepted_all int;
  v_w_latest numeric; v_w_avg numeric; v_w_n int;
  v_m_latest numeric; v_m_avg numeric; v_m_n int;
begin
  if v_uid is null or not private.is_active_user() then
    raise exception 'auth.not_authenticated' using errcode = '42501';
  end if;
  if v_target <> v_uid and not private.is_admin() then
    raise exception 'auth.forbidden' using errcode = '42501';
  end if;

  if not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = v_tz) then
    v_tz := 'UTC';
  end if;
  v_week_start  := date_trunc('week',  now() at time zone v_tz) at time zone v_tz;
  v_month_start := date_trunc('month', now() at time zone v_tz) at time zone v_tz;

  select count(*),
         count(*) filter (where status = 'pending'),
         count(*) filter (where status = 'accepted'),
         count(*) filter (where status = 'rejected'),
         count(*) filter (where status = 'successful'),
         count(*) filter (where submitted_at >= v_week_start),
         count(*) filter (where submitted_at >= v_month_start)
    into v_total, v_pending, v_accepted, v_rejected, v_successful, v_week, v_month
    from public.products
   where created_by = v_target and deleted_at is null and status <> 'draft';

  v_accepted_all := v_accepted + v_successful;
  v_reviewed     := v_accepted + v_rejected + v_successful;

  select (array_agg(e.average_score order by e.period_start desc))[1], round(avg(e.average_score), 2), count(*)
    into v_w_latest, v_w_avg, v_w_n
    from public.contributor_evaluations e
   where e.contributor_id = v_target and e.period_type = 'weekly';

  select (array_agg(e.average_score order by e.period_start desc))[1], round(avg(e.average_score), 2), count(*)
    into v_m_latest, v_m_avg, v_m_n
    from public.contributor_evaluations e
   where e.contributor_id = v_target and e.period_type = 'monthly';

  return jsonb_build_object(
    'total_added',       v_total,
    'pending',           v_pending,
    'accepted',          v_accepted,
    'rejected',          v_rejected,
    'successful',        v_successful,
    'reviewed',          v_reviewed,
    'acceptance_rate',   case when v_reviewed > 0 then round(100.0 * v_accepted_all / v_reviewed, 1) end,
    'rejection_rate',    case when v_reviewed > 0 then round(100.0 * v_rejected / v_reviewed, 1) end,
    'success_rate',      case when v_accepted_all > 0 then round(100.0 * v_successful / v_accepted_all, 1) end,
    'added_this_week',   v_week,
    'added_this_month',  v_month,
    'weekly_latest',     v_w_latest,
    'weekly_average',    v_w_avg,
    'weekly_count',      v_w_n,
    'monthly_latest',    v_m_latest,
    'monthly_average',   v_m_avg,
    'monthly_count',     v_m_n,
    'timezone',          v_tz);
end $$;

-- ---------- 4.6 Chat ----------

create or replace function public.get_or_create_direct_conversation(p_other_user_id uuid)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_key text;
  v_id  uuid;
begin
  if v_uid is null or not private.is_active_user() then
    raise exception 'auth.not_authenticated' using errcode = '42501';
  end if;
  if p_other_user_id is null or p_other_user_id = v_uid
     or not exists (select 1 from public.profiles p where p.id = p_other_user_id and p.is_active) then
    raise exception 'chat.invalid_member' using errcode = '22023';
  end if;

  v_key := least(v_uid::text, p_other_user_id::text) || ':' || greatest(v_uid::text, p_other_user_id::text);

  select c.id into v_id from public.conversations c where c.direct_key = v_key;
  if v_id is null then
    insert into public.conversations (type, direct_key, created_by)
    values ('direct', v_key, v_uid)
    on conflict (direct_key) do nothing
    returning id into v_id;
    if v_id is null then
      select c.id into v_id from public.conversations c where c.direct_key = v_key;
    end if;
  end if;

  insert into public.conversation_members (conversation_id, user_id, role)
  values (v_id, v_uid, 'member'), (v_id, p_other_user_id, 'member')
  on conflict do nothing;

  return v_id;
end $$;

create or replace function public.create_group(p_name text, p_member_ids uuid[])
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_id   uuid;
begin
  if v_uid is null or not private.is_active_user() then
    raise exception 'auth.not_authenticated' using errcode = '42501';
  end if;
  if char_length(v_name) not between 1 and 80 then
    raise exception 'chat.invalid_name' using errcode = '22023';
  end if;
  if p_member_ids is null
     or not exists (select 1 from unnest(p_member_ids) as u(member_id) where u.member_id <> v_uid)
     or exists (select 1 from unnest(p_member_ids) as u(member_id)
                 where u.member_id <> v_uid
                   and not exists (select 1 from public.profiles p where p.id = u.member_id and p.is_active)) then
    raise exception 'chat.invalid_member' using errcode = '22023';
  end if;

  insert into public.conversations (type, name, created_by)
  values ('group', v_name, v_uid)
  returning id into v_id;

  insert into public.conversation_members (conversation_id, user_id, role) values (v_id, v_uid, 'owner');

  insert into public.conversation_members (conversation_id, user_id, role)
  select distinct v_id, u.member_id, 'member'
    from unnest(p_member_ids) as u(member_id)
   where u.member_id <> v_uid;

  return v_id;
end $$;

create or replace function public.add_member(p_conversation_id uuid, p_user_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not private.is_active_user() then
    raise exception 'auth.not_authenticated' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.conversation_members cm
      join public.conversations c on c.id = cm.conversation_id
     where cm.conversation_id = p_conversation_id and cm.user_id = v_uid
       and cm.role = 'owner' and c.type = 'group') then
    raise exception 'chat.forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_user_id and p.is_active) then
    raise exception 'chat.invalid_member' using errcode = '22023';
  end if;

  insert into public.conversation_members (conversation_id, user_id, role)
  values (p_conversation_id, p_user_id, 'member')
  on conflict do nothing;
end $$;

create or replace function public.remove_member(p_conversation_id uuid, p_user_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not private.is_active_user() then
    raise exception 'auth.not_authenticated' using errcode = '42501';
  end if;
  if p_user_id = v_uid or not exists (
    select 1 from public.conversation_members cm
      join public.conversations c on c.id = cm.conversation_id
     where cm.conversation_id = p_conversation_id and cm.user_id = v_uid
       and cm.role = 'owner' and c.type = 'group') then
    raise exception 'chat.forbidden' using errcode = '42501';  -- to leave yourself, use leave_conversation()
  end if;

  delete from public.conversation_members
   where conversation_id = p_conversation_id and user_id = p_user_id and role <> 'owner';
end $$;

create or replace function public.leave_conversation(p_conversation_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := auth.uid();
  v_type text;
  v_role text;
begin
  if v_uid is null or not private.is_active_user() then
    raise exception 'auth.not_authenticated' using errcode = '42501';
  end if;

  select c.type, cm.role into v_type, v_role
    from public.conversation_members cm
    join public.conversations c on c.id = cm.conversation_id
   where cm.conversation_id = p_conversation_id and cm.user_id = v_uid;
  if not found then
    raise exception 'chat.forbidden' using errcode = '42501';
  end if;
  if v_type <> 'group' then
    raise exception 'chat.cannot_leave_direct' using errcode = '22023';
  end if;

  delete from public.conversation_members
   where conversation_id = p_conversation_id and user_id = v_uid;

  -- the longest-standing remaining member becomes the new owner
  if v_role = 'owner' then
    update public.conversation_members
       set role = 'owner'
     where conversation_id = p_conversation_id
       and user_id = (select m.user_id from public.conversation_members m
                       where m.conversation_id = p_conversation_id
                       order by m.joined_at, m.user_id limit 1);
  end if;
end $$;

-- p_attachments: [{"storage_path":"<conversation_id>/<uuid>-name.ext",
--                  "file_name":"name.ext","mime_type":"...","size_bytes":123}, ...]
-- The files must already be uploaded to the matching chat bucket.
create or replace function public.send_message(
  p_conversation_id uuid,
  p_kind            text,
  p_body            text default null,
  p_latitude        double precision default null,
  p_longitude       double precision default null,
  p_attachments     jsonb default '[]'::jsonb)
returns public.messages
language plpgsql security definer set search_path = '' as $$
declare
  v_uid      uuid := auth.uid();
  v_atts     jsonb := coalesce(p_attachments, '[]'::jsonb);
  v_expected text;
  v_msg      public.messages%rowtype;
  v_att      jsonb;
  v_path     text;
begin
  if v_uid is null or not private.is_conversation_member(p_conversation_id) then
    raise exception 'chat.forbidden' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('text', 'image', 'video', 'file', 'location')
     or jsonb_typeof(v_atts) <> 'array' then
    raise exception 'chat.invalid_message' using errcode = '22023';
  end if;
  if p_kind = 'text' and char_length(btrim(coalesce(p_body, ''))) = 0 then
    raise exception 'chat.empty_message' using errcode = '22023';
  end if;

  v_expected := case p_kind
                  when 'image' then 'chat-images'
                  when 'video' then 'chat-videos'
                  when 'file'  then 'chat-files' end;

  if p_kind in ('image', 'video', 'file') then
    if jsonb_array_length(v_atts) not between 1 and 10 then
      raise exception 'chat.invalid_attachment' using errcode = '22023';
    end if;
  elsif jsonb_array_length(v_atts) <> 0 then
    raise exception 'chat.invalid_attachment' using errcode = '22023';
  end if;

  insert into public.messages (conversation_id, sender_id, kind, body, latitude, longitude)
  values (p_conversation_id, v_uid, p_kind, nullif(btrim(coalesce(p_body, '')), ''), p_latitude, p_longitude)
  returning * into v_msg;

  for v_att in select value from jsonb_array_elements(v_atts) loop
    v_path := v_att ->> 'storage_path';
    if v_path is null or left(v_path, char_length(p_conversation_id::text) + 1) <> p_conversation_id::text || '/' then
      raise exception 'chat.invalid_attachment' using errcode = '22023';
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = v_expected and o.name = v_path) then
      raise exception 'chat.attachment_missing' using errcode = '22023';
    end if;

    insert into public.message_attachments (message_id, bucket, storage_path, file_name, mime_type, size_bytes)
    values (v_msg.id, v_expected, v_path,
            left(coalesce(v_att ->> 'file_name', 'file'), 255),
            v_att ->> 'mime_type',
            (v_att ->> 'size_bytes')::bigint);
  end loop;

  return v_msg;
end $$;

create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.conversation_members
     set last_read_at = now()
   where conversation_id = p_conversation_id and user_id = auth.uid();
end $$;


-- =====================================================================
-- 5. VIEW: user_directory (limited columns, active users only)
-- =====================================================================
-- Lets every logged-in user list colleagues for chat WITHOUT exposing
-- email / phone. Disabled users do not appear.

create view public.user_directory as
select p.id, p.full_name, p.avatar_id, p.gender, p.role
  from public.profiles p
 where p.is_active and private.is_active_user();


-- =====================================================================
-- 6. ROW LEVEL SECURITY
-- =====================================================================

do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', r.tablename);
  end loop;
end $$;

-- ---------- profiles ----------
-- Own row (always, so the app can detect a disabled account) + admins see all.
-- Users update only their own safe fields (also limited by column grants + guard trigger).
-- Admin user management goes through the Edge Function (service role), not through these policies.
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select private.is_admin()));
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid()) and (select private.is_active_user()))
  with check (id = (select auth.uid()));

-- ---------- reference tables (read-only for the app) ----------
create policy avatars_select on public.avatars for select to authenticated
  using ((select private.is_active_user()));
create policy product_statuses_select on public.product_statuses for select to authenticated
  using ((select private.is_active_user()));
create policy product_status_transitions_select on public.product_status_transitions for select to authenticated
  using ((select private.is_active_user()));

-- ---------- niches / micro-niches / checklist items ----------
-- Everyone active can read and ADD; only admins edit/hide/delete.
do $$
declare t text;
begin
  foreach t in array array['niches', 'micro_niches', 'checklist_items'] loop
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select private.is_active_user()))',
      t || '_select', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated
         with check ((select private.is_active_user()) and created_by = (select auth.uid()) and is_seed = false)',
      t || '_insert', t);
    execute format(
      'create policy %I on public.%I for update to authenticated
         using ((select private.is_admin())) with check ((select private.is_admin()))',
      t || '_update', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using ((select private.is_admin()))',
      t || '_delete', t);
  end loop;
end $$;

-- ---------- products ----------
create policy products_select on public.products for select to authenticated
  using (
    (created_by = (select auth.uid()) and deleted_at is null and (select private.is_active_user()))
    or ((select private.is_admin())
        and exists (select 1 from public.product_statuses s where s.code = status and s.admin_can_see))
  );

create policy products_insert on public.products for insert to authenticated
  with check ((select private.is_active_user()) and created_by = (select auth.uid()));

create policy products_update on public.products for update to authenticated
  using (private.can_edit_product(id))
  with check (private.can_edit_product(id));

-- Hard delete directly: only an owner discarding his own DRAFT.
-- Everything else goes through trash_product / purge_product.
create policy products_delete_own_draft on public.products for delete to authenticated
  using (created_by = (select auth.uid()) and status = 'draft' and deleted_at is null
         and (select private.is_active_user()));

-- ---------- product child tables ----------
do $$
declare t text;
begin
  foreach t in array array[
    'product_images', 'product_videos', 'product_niches', 'product_micro_niches',
    'marketing_angles', 'suppliers', 'product_checklist_items'] loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (private.can_view_product(product_id))',
      t || '_select', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (private.can_edit_product(product_id))',
      t || '_insert', t);
    execute format(
      'create policy %I on public.%I for update to authenticated
         using (private.can_edit_product(product_id)) with check (private.can_edit_product(product_id))',
      t || '_update', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (private.can_edit_product(product_id))',
      t || '_delete', t);
  end loop;
end $$;

-- ---------- history / activity / notifications (read-only for the app) ----------
create policy status_history_select on public.product_status_history for select to authenticated
  using (private.can_view_product(product_id));

create policy activity_logs_select on public.activity_logs for select to authenticated
  using ((select private.is_admin()));

create policy notifications_select on public.notifications for select to authenticated
  using (recipient_id = (select auth.uid()) and (select private.is_active_user()));

-- ---------- evaluations (read-only for the app; writes via save_evaluation) ----------
create policy evaluations_select on public.contributor_evaluations for select to authenticated
  using ((select private.is_admin())
         or (contributor_id = (select auth.uid()) and (select private.is_active_user())));

create policy evaluation_scores_select on public.contributor_evaluation_scores for select to authenticated
  using (exists (select 1 from public.contributor_evaluations e where e.id = evaluation_id));

-- ---------- chat ----------
create policy conversations_select on public.conversations for select to authenticated
  using (private.is_conversation_member(id));

create policy conversation_members_select on public.conversation_members for select to authenticated
  using (private.is_conversation_member(conversation_id));

-- members edit only their own row (pseudo / last_read_at; enforced by guard trigger + column grants)
create policy conversation_members_update_own on public.conversation_members for update to authenticated
  using (user_id = (select auth.uid()) and (select private.is_active_user()))
  with check (user_id = (select auth.uid()));

create policy messages_select on public.messages for select to authenticated
  using (private.is_conversation_member(conversation_id));

create policy message_attachments_select on public.message_attachments for select to authenticated
  using (exists (select 1 from public.messages m where m.id = message_id));

-- ---------- cleanup queue ----------
create policy cleanup_queue_select on public.storage_cleanup_queue for select to authenticated
  using ((select private.is_admin()));


-- =====================================================================
-- 7. REALTIME
-- =====================================================================
-- Realtime respects the SELECT policies above.
do $$
begin
  alter publication supabase_realtime
    add table public.messages, public.notifications, public.conversation_members;
exception when duplicate_object then
  raise notice 'Tables already in publication supabase_realtime';
end $$;


-- =====================================================================
-- 8. STORAGE (buckets + policies)
-- =====================================================================
-- Public:  logos, profile-avatars (the login page needs the logo before sign-in).
-- Private: everything else (served with short-lived signed URLs).
-- Note: on the Supabase free plan the global per-file limit is 50 MB.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('logos',           'logos',           true,  2097152,
     array['image/png', 'image/svg+xml', 'image/webp']),
  ('profile-avatars', 'profile-avatars', true,  1048576,
     array['image/png', 'image/svg+xml', 'image/webp']),
  ('product-images',  'product-images',  false, 5242880,
     array['image/jpeg', 'image/png', 'image/webp']),
  ('product-videos',  'product-videos',  false, 52428800,
     array['video/mp4', 'video/webm', 'video/quicktime']),
  ('chat-images',     'chat-images',     false, 10485760,
     array['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
  ('chat-videos',     'chat-videos',     false, 52428800,
     array['video/mp4', 'video/webm', 'video/quicktime']),
  ('chat-files',      'chat-files',      false, 26214400,
     array['application/pdf', 'application/msword',
           'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
           'application/vnd.ms-excel',
           'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
           'text/plain', 'text/csv'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- logos / profile-avatars: no write policies -> uploaded only from the dashboard.

-- product files: first folder of the path = product_id
create policy product_files_select on storage.objects for select to authenticated
  using (bucket_id in ('product-images', 'product-videos')
         and private.can_view_product(private.try_uuid((storage.foldername(name))[1])));

create policy product_files_insert on storage.objects for insert to authenticated
  with check (bucket_id in ('product-images', 'product-videos')
              and private.can_edit_product(private.try_uuid((storage.foldername(name))[1])));

create policy product_files_update on storage.objects for update to authenticated
  using (bucket_id in ('product-images', 'product-videos')
         and private.can_edit_product(private.try_uuid((storage.foldername(name))[1])))
  with check (bucket_id in ('product-images', 'product-videos')
              and private.can_edit_product(private.try_uuid((storage.foldername(name))[1])));

create policy product_files_delete on storage.objects for delete to authenticated
  using (bucket_id in ('product-images', 'product-videos')
         and private.can_edit_product(private.try_uuid((storage.foldername(name))[1])));

-- after a permanent delete the product no longer exists: an admin may delete
-- exactly the files that purge_product() put in the cleanup queue.
create policy product_files_cleanup_delete on storage.objects for delete to authenticated
  using (bucket_id in ('product-images', 'product-videos')
         and private.is_admin()
         and exists (select 1 from public.storage_cleanup_queue q
                      where q.bucket = bucket_id and q.path = name));

-- chat files: first folder of the path = conversation_id
create policy chat_files_select on storage.objects for select to authenticated
  using (bucket_id in ('chat-images', 'chat-videos', 'chat-files')
         and private.is_conversation_member(private.try_uuid((storage.foldername(name))[1])));

create policy chat_files_insert on storage.objects for insert to authenticated
  with check (bucket_id in ('chat-images', 'chat-videos', 'chat-files')
              and private.is_conversation_member(private.try_uuid((storage.foldername(name))[1])));

create policy chat_files_delete on storage.objects for delete to authenticated
  using (bucket_id in ('chat-images', 'chat-videos', 'chat-files')
         and owner_id = (select auth.uid())::text
         and private.is_conversation_member(private.try_uuid((storage.foldername(name))[1])));


-- =====================================================================
-- 9. PRIVILEGES (defense in depth: RLS + explicit grants)
-- =====================================================================
-- Supabase grants broad default privileges. Start from zero and grant only
-- what the app needs. (Tables created in future migrations need the same care.)

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
revoke all on all functions in schema private from public, anon;

-- read access (RLS decides which rows)
grant select on all tables in schema public to authenticated;

-- profiles: only these columns can be updated by a user
grant update (full_name, phone, gender, avatar_id) on public.profiles to authenticated;

-- products: only content columns. status, workflow dates/authors and
-- recycle-bin columns are NOT writable by the app (only RPC functions change them).
grant insert (id, created_by,
              name_ar, name_fr, name_en, other_names,
              description, potential_customers, potential_uses, strengths, weaknesses,
              points_to_verify, problem_solved,
              visual_value, actual_value, competition, source, competitor_sales_method,
              price_from, price_to, currency_code,
              testability_notes, commercial_risks, notes, next_research_step)
  on public.products to authenticated;

grant update (name_ar, name_fr, name_en, other_names,
              description, potential_customers, potential_uses, strengths, weaknesses,
              points_to_verify, problem_solved,
              visual_value, actual_value, competition, source, competitor_sales_method,
              price_from, price_to, currency_code,
              testability_notes, commercial_risks, notes, next_research_step)
  on public.products to authenticated;

grant delete on public.products to authenticated;   -- RLS: owner's own drafts only

-- product child tables
grant insert, update, delete on
  public.product_images, public.product_videos, public.product_niches,
  public.product_micro_niches, public.marketing_angles, public.suppliers,
  public.product_checklist_items
  to authenticated;

-- niches / micro-niches / checklist: anyone adds (names only), admin edits/deletes
grant insert (name_ar, name_fr, name_en, created_by) on public.niches       to authenticated;
grant insert (name_ar, name_fr, name_en, created_by) on public.micro_niches to authenticated;
grant insert (label_ar, label_fr, label_en, created_by) on public.checklist_items to authenticated;
grant update, delete on public.niches, public.micro_niches, public.checklist_items to authenticated;

-- chat: members edit only their own pseudo / read marker
grant update (pseudo, last_read_at) on public.conversation_members to authenticated;

-- internal helper functions (needed by RLS policies and storage policies)
grant execute on all functions in schema private to authenticated;

-- RPC functions the frontend may call
grant execute on function public.change_product_status(uuid, text, text)          to authenticated;
grant execute on function public.trash_product(uuid)                              to authenticated;
grant execute on function public.restore_product(uuid)                            to authenticated;
grant execute on function public.purge_product(uuid)                              to authenticated;
grant execute on function public.ack_cleanup_queue(bigint[])                      to authenticated;
grant execute on function public.log_product_view(uuid)                           to authenticated;
grant execute on function public.get_due_notifications()                          to authenticated;
grant execute on function public.notification_action(uuid, text)                  to authenticated;
grant execute on function public.save_evaluation(uuid, text, date, jsonb)         to authenticated;
grant execute on function public.get_contributor_stats(uuid, text)                to authenticated;
grant execute on function public.get_or_create_direct_conversation(uuid)          to authenticated;
grant execute on function public.create_group(text, uuid[])                       to authenticated;
grant execute on function public.add_member(uuid, uuid)                           to authenticated;
grant execute on function public.remove_member(uuid, uuid)                        to authenticated;
grant execute on function public.leave_conversation(uuid)                         to authenticated;
grant execute on function public.send_message(uuid, text, text, double precision, double precision, jsonb)
                                                                                  to authenticated;
grant execute on function public.mark_conversation_read(uuid)                     to authenticated;
-- handle_new_user() and sync_user_email() stay non-callable (triggers only).


-- =====================================================================
-- 10. SEED DATA
-- =====================================================================

-- 10.1 Product statuses (permissions) and allowed transitions
insert into public.product_statuses (code, sort_order, owner_can_edit, admin_can_edit, admin_can_see) values
  ('draft',      1, true,  false, false),
  ('pending',    2, true,  true,  true),
  ('accepted',   3, false, true,  true),
  ('rejected',   4, false, true,  true),
  ('successful', 5, false, true,  true);

insert into public.product_status_transitions (from_status, to_status, actor, requires_reason) values
  ('draft',    'pending',    'owner', false),   -- submit
  ('pending',  'accepted',   'admin', false),
  ('pending',  'rejected',   'admin', false),
  ('accepted', 'successful', 'admin', false),
  ('rejected', 'pending',    'admin', true),    -- re-review (reason required)
  ('accepted', 'pending',    'admin', true);    -- re-review (reason required)
  -- successful has NO way back.

-- 10.2 Avatars: 4 male + 4 female. Files are not set yet (inactive until provided).
insert into public.avatars (id, gender, sort_order) values
  ('male-1',   'male',   1), ('male-2',   'male',   2), ('male-3',   'male',   3), ('male-4',   'male',   4),
  ('female-1', 'female', 5), ('female-2', 'female', 6), ('female-3', 'female', 7), ('female-4', 'female', 8);
-- When the 8 files are uploaded to bucket "profile-avatars" (folder "presets/"), run e.g.:
--   update public.avatars set storage_path = 'presets/male-1.png', is_active = true where id = 'male-1';

-- 10.3 SEED: NICHES  (waiting for the final five — fill in and run)
-- insert into public.niches (name_ar, name_fr, name_en, is_seed, sort_order) values
--   ('<ar 1>', '<fr 1>', '<en 1>', true, 1),
--   ('<ar 2>', '<fr 2>', '<en 2>', true, 2),
--   ('<ar 3>', '<fr 3>', '<en 3>', true, 3),
--   ('<ar 4>', '<fr 4>', '<en 4>', true, 4),
--   ('<ar 5>', '<fr 5>', '<en 5>', true, 5);

-- 10.4 SEED: MICRO_NICHES (none provided yet; same format as niches)
-- 10.5 SEED: CHECKLIST_ITEMS (none provided yet)
-- insert into public.checklist_items (label_ar, label_fr, label_en, is_seed, sort_order) values (...);


-- =====================================================================
-- 11. BACKFILL + POST-STEPS
-- =====================================================================

-- Creates a profile for any Auth user that already exists (so the order
-- "create users first, run SQL later" also works). Does nothing on a fresh project.
insert into public.profiles (id, full_name, email)
select u.id, left(coalesce(nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''), split_part(u.email, '@', 1)), 80), u.email
  from auth.users u
 where u.email is not null
   and not exists (select 1 from public.profiles p where p.id = u.id);

-- POST-STEP (run manually AFTER the 3 users exist in Authentication -> Users):
-- profiles are created automatically as "contributor"; promote the two admins:
--   update public.profiles set role = 'admin', full_name = 'Walid'  where email = 'walidwinner@product.com';
--   update public.profiles set role = 'admin', full_name = 'Kheira' where email = 'kheira@product.com';
--   update public.profiles set full_name = 'Aziz' where email = 'abdelaziz@product.com';
-- Also: Authentication -> Providers/Settings -> turn OFF "Allow new users to sign up".

-- =====================================================================
-- TEST DATA (optional, development only) — none is inserted by this file.
-- Any test rows added later must be deleted before production.
-- =====================================================================


-- =====================================================================
-- 12. PHASE 10/11 MIGRATION — Niche -> Micro-niche -> Product
-- =====================================================================
-- EXISTING PROJECT: copy and run ONLY this section (12.1 - 12.6). It is idempotent and
-- destroys no data: existing micro_niches keep niche_id = NULL ("unassigned") until an
-- admin assigns a parent in the app. product_micro_niches rows are never touched.
--
-- 12.0 AUDIT (read-only, run first and look at the numbers):
--   select count(*) from public.micro_niches;
--   select count(*) from public.product_micro_niches;
--   select m.id, m.name_ar, m.name_fr, m.name_en,
--          count(pm.product_id) as products, count(distinct pn.niche_id) as niches_on_products
--     from public.micro_niches m
--     left join public.product_micro_niches pm on pm.micro_niche_id = m.id
--     left join public.product_niches pn on pn.product_id = pm.product_id
--    group by m.id order by products desc;
--   -- Micro-niches whose products all share exactly one niche can be assigned to it safely
--   -- in the app; everything else is assigned by the admin (Admin > Micro-niches).

-- 12.1 Parent link (nullable on purpose: legacy rows have no parent)
alter table public.micro_niches
  add column if not exists niche_id uuid references public.niches (id) on delete restrict;
create index if not exists micro_niches_niche_idx on public.micro_niches (niche_id);

-- 12.2 Names are unique PER parent Niche (the same Micro-niche name may exist under two Niches).
--      Legacy rows without parent keep being unique among themselves.
drop index if exists public.micro_niches_name_ar_uq;
drop index if exists public.micro_niches_name_fr_uq;
drop index if exists public.micro_niches_name_en_uq;
create unique index if not exists micro_niches_parent_name_ar_uq on public.micro_niches
  (coalesce(niche_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(name_ar))) where name_ar is not null;
create unique index if not exists micro_niches_parent_name_fr_uq on public.micro_niches
  (coalesce(niche_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(name_fr))) where name_fr is not null;
create unique index if not exists micro_niches_parent_name_en_uq on public.micro_niches
  (coalesce(niche_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(name_en))) where name_en is not null;

-- 12.3 RLS / grants: micro-niches are now managed by admins only (everyone active still reads them).
--      A new micro-niche must have a parent Niche. Update/delete policies are unchanged (admin only).
drop policy if exists micro_niches_insert on public.micro_niches;
create policy micro_niches_insert on public.micro_niches for insert to authenticated
  with check ((select private.is_admin()) and created_by = (select auth.uid())
              and is_seed = false and niche_id is not null);
revoke insert on public.micro_niches from authenticated;
grant insert (name_ar, name_fr, name_en, created_by, niche_id, is_active) on public.micro_niches to authenticated;

-- 12.4 Guard: the parent can be assigned, but never removed, and never changed while products use the micro-niche.
create or replace function private.micro_niches_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.niche_id is not null and new.niche_id is null then
    raise exception 'micro_niche.parent_required' using errcode = '23514';
  end if;
  if old.niche_id is not null and new.niche_id is distinct from old.niche_id
     and exists (select 1 from public.product_micro_niches pm where pm.micro_niche_id = old.id) then
    raise exception 'micro_niche.parent_locked' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists micro_niches_guard on public.micro_niches;
create trigger micro_niches_guard before update on public.micro_niches
  for each row execute function private.micro_niches_guard();

-- 12.5 Guard: a NEW product <-> micro-niche link needs a parent, and the product must carry that parent Niche.
--      (Existing legacy links are not re-validated.)
create or replace function private.product_micro_niches_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_parent uuid;
begin
  select m.niche_id into v_parent from public.micro_niches m where m.id = new.micro_niche_id;
  if v_parent is null then
    raise exception 'micro_niche.parent_required' using errcode = '23514';
  end if;
  if not exists (select 1 from public.product_niches pn
                  where pn.product_id = new.product_id and pn.niche_id = v_parent) then
    raise exception 'micro_niche.niche_mismatch' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists product_micro_niches_guard on public.product_micro_niches;
create trigger product_micro_niches_guard before insert on public.product_micro_niches
  for each row execute function private.product_micro_niches_guard();

-- 12.6 Removing a Niche from a product removes that product's micro-niches of that Niche.
create or replace function private.product_niches_drop_micros()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.product_micro_niches pm
   using public.micro_niches m
   where pm.product_id = old.product_id and m.id = pm.micro_niche_id and m.niche_id = old.niche_id;
  return old;
end $$;
drop trigger if exists product_niches_drop_micros on public.product_niches;
create trigger product_niches_drop_micros after delete on public.product_niches
  for each row execute function private.product_niches_drop_micros();

revoke all on function private.micro_niches_guard(), private.product_micro_niches_guard(),
  private.product_niches_drop_micros() from public, anon;
grant execute on function private.micro_niches_guard(), private.product_micro_niches_guard(),
  private.product_niches_drop_micros() to authenticated;

-- No other database change is needed for phase 10 (trash_product, restore_product, purge_product,
-- ack_cleanup_queue and the cleanup-queue storage policy already exist in sections 4 and 8)
-- or for user management (done by the Edge Function admin-users with the existing profiles guards).