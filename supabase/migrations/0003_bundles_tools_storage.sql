-- 0003: bundles (a purchase can include other products), tool delivery, private storage.

-- ---------- A. schema + functions ----------
do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.products'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%type%'
  loop
    execute format('alter table public.products drop constraint %I', c);
  end loop;
end $$;

alter table products add constraint products_type_check
  check (type in ('threshold_topic','assessment','journal','tool','coaching_package','other'));

alter table products add column if not exists included_product_ids uuid[] not null default '{}';
alter table products add column if not exists tool_path text unique;

create or replace function public.grant_product_entitlements(
  p_client_id uuid, p_product_id uuid, p_purchase_id uuid, p_relationship_id uuid
) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into entitlements (client_id, product_id, coaching_relationship_id, source, purchase_id)
  values (p_client_id, p_product_id, p_relationship_id, 'purchase', p_purchase_id)
  on conflict (client_id, product_id) do nothing;

  insert into entitlements (client_id, product_id, coaching_relationship_id, source, purchase_id)
  select p_client_id, inc.product_id, p_relationship_id, 'purchase', p_purchase_id
  from products p, unnest(p.included_product_ids) as inc(product_id)
  where p.id = p_product_id
  on conflict (client_id, product_id) do nothing;
end;
$$;

revoke all on function public.grant_product_entitlements(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.grant_product_entitlements(uuid, uuid, uuid, uuid) to service_role;

create or replace function public.reconcile_my_entitlements()
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_email text := lower(auth.jwt() ->> 'email');
  v_rel uuid;
  r record;
begin
  if v_uid is null or v_email is null then
    return;
  end if;

  insert into clients (id, email) values (v_uid, v_email) on conflict do nothing;

  select id into v_rel from coaching_relationships
  where active and lower(client_email) = v_email limit 1;

  for r in select id, product_id from purchases where lower(client_email) = v_email loop
    perform public.grant_product_entitlements(v_uid, r.product_id, r.id, v_rel);
  end loop;
end;
$$;

revoke all on function public.reconcile_my_entitlements() from public, anon;
grant execute on function public.reconcile_my_entitlements() to authenticated;

-- ---------- B. seed products ----------
insert into products (slug, title, type, description, tool_path) values
  ('values-finder', 'Values Finder', 'tool', 'A values card-sort: browse, keep what resonates, and narrow to your core five.', 'values-finder.html'),
  ('decision-navigator', 'Decision Navigator', 'tool', 'Structured ways of looking at a decision so your own thinking has room to surface.', 'decision-navigator.html')
on conflict (slug) do nothing;

update products set tool_path = 'guided-reflection-journal.html' where slug = 'guided-reflection-journal';

insert into products (slug, title, type, description, paperbell_product_id)
values ('pro-bono-package', 'Pro Bono Package', 'coaching_package', 'Four coaching sessions with the coaching tools included.', '234290')
on conflict (slug) do nothing;

update products
set included_product_ids = array(select id from products where slug in ('values-finder','decision-navigator','guided-reflection-journal'))
where slug = 'pro-bono-package';

-- ---------- C. private storage + access rule ----------
insert into storage.buckets (id, name, public) values ('tools', 'tools', false)
on conflict (id) do nothing;

create or replace function public.has_tool_access(object_name text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from entitlements e join products p on p.id = e.product_id
    where e.client_id = auth.uid() and e.revoked_at is null and p.tool_path = object_name
  );
$$;
grant execute on function public.has_tool_access(text) to authenticated;

drop policy if exists "tools readable by entitled clients" on storage.objects;
create policy "tools readable by entitled clients"
on storage.objects for select to authenticated
using (bucket_id = 'tools' and public.has_tool_access(name));
