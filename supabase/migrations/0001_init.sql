create table coaches (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now()
);

create table clients (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  display_name text,
  created_at timestamptz not null default now()
);

create table products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  type text not null check (type in ('threshold_topic', 'assessment', 'journal', 'other')),
  description text,
  related_product_ids uuid[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table coaching_relationships (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete set null,
  client_email text not null,
  started_at timestamptz not null default now(),
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);
create index idx_coaching_relationships_email on coaching_relationships (lower(client_email));

create table purchases (
  id uuid primary key default gen_random_uuid(),
  client_email text not null,
  product_id uuid not null references products(id),
  purchased_at timestamptz not null default now(),
  source text not null default 'paperbell',
  webhook_event_id text unique,
  raw_payload jsonb,
  created_at timestamptz not null default now()
);
create index idx_purchases_email on purchases (lower(client_email));

create table entitlements (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  product_id uuid not null references products(id),
  coaching_relationship_id uuid references coaching_relationships(id),
  source text not null check (source in ('purchase', 'manual_grant')),
  purchase_id uuid references purchases(id),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (client_id, product_id)
);

create table progress (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  product_id uuid not null references products(id),
  unit_id text not null,
  opened_at timestamptz,
  completed_at timestamptz,
  last_position jsonb,
  visible_to_coach boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (client_id, product_id, unit_id)
);

create table journal_entries (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  entry_text text not null,
  tags text[] not null default '{}',
  source_product_id uuid references products(id),
  shared_with_coach boolean not null default false,
  created_at timestamptz not null default now()
);

create table exercise_responses (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  product_id uuid not null references products(id),
  unit_id text not null,
  prompt_id text not null,
  response_text text not null,
  shared_with_coach boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, product_id, unit_id, prompt_id)
);

create table assessment_results (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  assessment_id uuid not null references products(id),
  responses jsonb not null,
  computed_output jsonb not null,
  updated_at timestamptz not null default now(),
  unique (client_id, assessment_id)
);

alter table clients enable row level security;
alter table entitlements enable row level security;
alter table progress enable row level security;
alter table journal_entries enable row level security;
alter table exercise_responses enable row level security;
alter table assessment_results enable row level security;
alter table coaching_relationships enable row level security;
alter table purchases enable row level security;
alter table products enable row level security;

create or replace function is_coach() returns boolean as $$
  select exists (select 1 from coaches where id = auth.uid());
$$ language sql stable security definer;

create policy "clients read own" on clients for select using (id = auth.uid());
create policy "clients update own" on clients for update using (id = auth.uid());

create policy "products readable" on products for select using (true);

create policy "entitlements read own" on entitlements for select using (client_id = auth.uid());
create policy "entitlements read by coach" on entitlements for select using (is_coach());

create policy "progress read own" on progress for select using (client_id = auth.uid());
create policy "progress write own" on progress for insert with check (client_id = auth.uid());
create policy "progress update own" on progress for update using (client_id = auth.uid());
create policy "progress read by coach if shared" on progress for select
  using (is_coach() and visible_to_coach = true);

create policy "journal read own" on journal_entries for select using (client_id = auth.uid());
create policy "journal write own" on journal_entries for insert with check (client_id = auth.uid());
create policy "journal update own" on journal_entries for update using (client_id = auth.uid());
create policy "journal read by coach if shared" on journal_entries for select
  using (is_coach() and shared_with_coach = true);

create policy "exercises read own" on exercise_responses for select using (client_id = auth.uid());
create policy "exercises write own" on exercise_responses for insert with check (client_id = auth.uid());
create policy "exercises update own" on exercise_responses for update using (client_id = auth.uid());
create policy "exercises read by coach if shared" on exercise_responses for select
  using (is_coach() and shared_with_coach = true);

create policy "assessment read own" on assessment_results for select using (client_id = auth.uid());
create policy "assessment write own" on assessment_results for insert with check (client_id = auth.uid());
create policy "assessment update own" on assessment_results for update using (client_id = auth.uid());

create policy "relationships coach only" on coaching_relationships for select using (is_coach());

create policy "purchases coach only" on purchases for select using (is_coach());

grant select, insert, update, delete on table
  clients, products, coaching_relationships, purchases, entitlements,
  progress, journal_entries, exercise_responses, assessment_results, coaches
to authenticated;
