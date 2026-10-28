-- Team OKR Tracker: schema, row-level security and server-side rules.
-- Run once in the Supabase SQL editor (Project > SQL Editor > New query).

-- ---------- tables ----------
create table if not exists people (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  role text not null check (role in ('ceo','hr','manager','member')),
  team text not null default '',
  uid uuid unique references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists signups (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
create table if not exists okrs (
  id uuid primary key default gen_random_uuid(),
  objective text not null,
  owner text not null,                     -- a person's name, or 'Company'
  year int not null,
  krs jsonb not null check (jsonb_typeof(krs) = 'array' and jsonb_array_length(krs) between 2 and 20),
  created_at timestamptz not null default now()
);
create table if not exists logs (
  id uuid primary key default gen_random_uuid(),
  owner text not null, week text not null, delta numeric not null, okr uuid, ts bigint not null
);
create table if not exists stand (
  id uuid primary key default gen_random_uuid(),
  week text not null, owner text not null, text text not null,
  status text not null default 'Not done' check (status in ('Not done','In progress','Done')),
  ts bigint not null default 0
);
create table if not exists ach (
  id uuid primary key default gen_random_uuid(),
  week text not null, owner text not null, text text not null, ts bigint not null default 0
);
create table if not exists prios (
  id uuid primary key default gen_random_uuid(),
  week text not null, text text not null, assignee text not null, by text not null,
  status text not null default 'Agreed' check (status in ('Agreed','In progress','Done','Blocked')),
  outcome text not null default '', pct numeric not null default 0 check (pct between 0 and 100),
  feedback text not null default '', reviewed boolean not null default false, ts bigint not null default 0
);
create table if not exists wnotes (            -- Friday blockers, achievements, feedback
  id text primary key, week text not null, owner text not null, text text not null default '', ts bigint not null default 0
);
create index if not exists okrs_owner on okrs(owner);
create index if not exists stand_week on stand(week);
create index if not exists ach_week on ach(week);
create index if not exists prios_week on prios(week);
create index if not exists wnotes_week on wnotes(week);
create index if not exists logs_owner_week on logs(owner, week);

-- ---------- helpers (security definer so policies can read people) ----------
create or replace function my_name() returns text language sql stable security definer set search_path = public
  as $$ select name from people where uid = auth.uid() $$;
create or replace function my_role() returns text language sql stable security definer set search_path = public
  as $$ select role from people where uid = auth.uid() $$;
create or replace function is_ceo() returns boolean language sql stable security definer set search_path = public
  as $$ select coalesce((select role = 'ceo' from people where uid = auth.uid()), false) $$;
-- Whose data the signed-in person may see: CEO and HR everyone, managers their team and themselves, members themselves.
create or replace function in_scope(n text) returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from people me where me.uid = auth.uid() and (
      me.role in ('ceo','hr') or me.name = n or
      (me.role = 'manager' and me.team <> '' and exists (select 1 from people t where t.name = n and t.team = me.team))
    )
  )
$$;
create or replace function okr_pct(k jsonb) returns numeric language sql immutable
as $$
  select coalesce(100.0 * count(*) filter (where (e->>'pct')::numeric = 100) / nullif(count(*), 0), 0)
  from jsonb_array_elements(k) e
$$;

-- ---------- row-level security ----------
alter table people enable row level security;
alter table signups enable row level security;
alter table okrs enable row level security;
alter table logs enable row level security;
alter table stand enable row level security;
alter table ach enable row level security;
alter table prios enable row level security;
alter table wnotes enable row level security;

-- people: everyone who is set up can read; only the CEO changes anything
drop policy if exists people_read on people;
create policy people_read on people for select to authenticated using (my_role() is not null);
drop policy if exists people_ceo on people;
create policy people_ceo on people for all to authenticated using (is_ceo()) with check (is_ceo());

-- signups: a person registers themselves; the CEO reads and clears them
drop policy if exists signups_insert on signups;
create policy signups_insert on signups for insert to authenticated with check (id = auth.uid());
drop policy if exists signups_read on signups;
create policy signups_read on signups for select to authenticated using (is_ceo() or id = auth.uid());
drop policy if exists signups_delete on signups;
create policy signups_delete on signups for delete to authenticated using (is_ceo() or id = auth.uid());

-- okrs: direct edits are CEO only; everyone else changes key results through set_kr / approve_kr
drop policy if exists okrs_read on okrs;
create policy okrs_read on okrs for select to authenticated
  using (my_role() is not null and (owner = 'Company' or in_scope(owner)));
drop policy if exists okrs_insert on okrs;
create policy okrs_insert on okrs for insert to authenticated
  with check (is_ceo() or (my_role() in ('manager','member') and owner <> 'Company' and in_scope(owner)));
drop policy if exists okrs_update on okrs;
create policy okrs_update on okrs for update to authenticated using (is_ceo()) with check (is_ceo());
drop policy if exists okrs_delete on okrs;
create policy okrs_delete on okrs for delete to authenticated using (is_ceo() or owner = my_name());

create or replace function okrs_normalize() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not is_ceo() then   -- new key results always start not completed
    new.krs := (select jsonb_agg(jsonb_build_object('title', e->>'title', 'pct', 0, 'req', false, 'reqAt', 0, 'apBy', ''))
                from jsonb_array_elements(new.krs) e);
  end if;
  return new;
end $$;
drop trigger if exists okrs_normalize_ins on okrs;
create trigger okrs_normalize_ins before insert on okrs for each row execute function okrs_normalize();

-- logs: read only; written by the functions below
drop policy if exists logs_read on logs;
create policy logs_read on logs for select to authenticated using (in_scope(owner));

-- standup, achievements, Friday notes: read your scope, write your own (CEO any), never HR
do $$
declare t text;
begin
  foreach t in array array['stand','ach','wnotes'] loop
    execute format('drop policy if exists %1$s_read on %1$s', t);
    execute format('create policy %1$s_read on %1$s for select to authenticated using (in_scope(owner))', t);
    execute format('drop policy if exists %1$s_write on %1$s', t);
    execute format($p$create policy %1$s_write on %1$s for all to authenticated
      using (my_role() in ('ceo','manager','member') and (is_ceo() or owner = my_name()))
      with check (my_role() in ('ceo','manager','member') and (is_ceo() or owner = my_name()))$p$, t);
  end loop;
end $$;

-- priorities: managers assign to their team, members to themselves; owner, assigner or CEO update
drop policy if exists prios_read on prios;
create policy prios_read on prios for select to authenticated using (in_scope(assignee));
drop policy if exists prios_insert on prios;
create policy prios_insert on prios for insert to authenticated
  with check (my_role() in ('ceo','manager','member') and by = my_name() and (is_ceo() or in_scope(assignee)));
drop policy if exists prios_update on prios;
create policy prios_update on prios for update to authenticated
  using (my_role() in ('ceo','manager','member') and (is_ceo() or assignee = my_name() or by = my_name()))
  with check (my_role() in ('ceo','manager','member') and (is_ceo() or assignee = my_name() or by = my_name()));
drop policy if exists prios_delete on prios;
create policy prios_delete on prios for delete to authenticated
  using (my_role() in ('ceo','manager','member') and (is_ceo() or assignee = my_name() or by = my_name()));

-- ---------- functions the app calls ----------
-- The first person to sign in becomes the CEO.
create or replace function claim_ceo(p_name text) returns boolean language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(7001);
  if exists (select 1 from people) then return false; end if;
  insert into people(name, role, team, uid) values (coalesce(nullif(trim(p_name), ''), 'CEO'), 'ceo', '', auth.uid());
  return true;
end $$;

create or replace function add_log(o okrs, p numeric, p_week text) returns void language plpgsql security definer set search_path = public as $$
declare n int;
begin
  select count(*) into n from okrs where owner = o.owner;
  insert into logs(owner, week, delta, okr, ts)
  values (o.owner, p_week, p / jsonb_array_length(o.krs) / greatest(n, 1), o.id, (extract(epoch from now()) * 1000)::bigint);
end $$;

-- Request, withdraw, complete (CEO) or reopen (CEO) a key result.
create or replace function set_kr(p_okr uuid, p_idx int, p_done boolean, p_week text) returns void
language plpgsql security definer set search_path = public as $$
declare me people; o okrs; k jsonb; nowms bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  select * into me from people where uid = auth.uid();
  if me.id is null then raise exception 'Your account is not set up yet.'; end if;
  select * into o from okrs where id = p_okr;
  if o.id is null then raise exception 'OKR not found.'; end if;
  if p_idx < 0 or p_idx >= jsonb_array_length(o.krs) then raise exception 'Key result not found.'; end if;
  k := o.krs -> p_idx;
  if p_done then
    if (k->>'pct')::numeric = 100 then return; end if;
    if me.role = 'ceo' then
      k := k || jsonb_build_object('pct', 100, 'req', false, 'reqAt', nowms, 'apBy', me.name);
      perform add_log(o, 100, p_week);
    elsif o.owner = me.name and me.role in ('member','manager') then
      k := k || jsonb_build_object('req', true, 'reqAt', nowms);
    else raise exception 'You cannot complete this key result.'; end if;
  elsif (k->>'pct')::numeric = 100 then
    if me.role <> 'ceo' then raise exception 'Only the CEO can reopen an approved key result.'; end if;
    k := k || jsonb_build_object('pct', 0, 'req', false, 'apBy', '');
    perform add_log(o, -100, p_week);
  else
    if not (me.role = 'ceo' or o.owner = me.name) then raise exception 'You cannot change this key result.'; end if;
    k := k || jsonb_build_object('req', false);
  end if;
  update okrs set krs = jsonb_set(krs, array[p_idx::text], k) where id = p_okr;
end $$;

-- Approve or send back a requested key result. Members' requests: a manager of the same team or the CEO.
-- Managers' requests: the CEO.
create or replace function approve_kr(p_okr uuid, p_idx int, p_ok boolean, p_week text) returns void
language plpgsql security definer set search_path = public as $$
declare me people; o okrs; k jsonb; owner_p people; allowed boolean := false;
begin
  select * into me from people where uid = auth.uid();
  if me.id is null then raise exception 'Your account is not set up yet.'; end if;
  select * into o from okrs where id = p_okr;
  if o.id is null or o.owner = 'Company' then raise exception 'Nothing to approve here.'; end if;
  select * into owner_p from people where name = o.owner;
  if me.role = 'ceo' then allowed := true;
  elsif me.role = 'manager' and owner_p.role = 'member' and owner_p.team <> '' and owner_p.team = me.team and owner_p.name <> me.name then allowed := true;
  end if;
  if not allowed then raise exception 'You cannot approve this request.'; end if;
  if p_idx < 0 or p_idx >= jsonb_array_length(o.krs) then raise exception 'Key result not found.'; end if;
  k := o.krs -> p_idx;
  if not coalesce((k->>'req')::boolean, false) then raise exception 'No request is waiting on this key result.'; end if;
  if p_ok then
    k := k || jsonb_build_object('pct', 100, 'req', false, 'apBy', me.name);
    perform add_log(o, 100, p_week);
  else
    k := k || jsonb_build_object('req', false);
  end if;
  update okrs set krs = jsonb_set(krs, array[p_idx::text], k) where id = p_okr;
end $$;

-- Leaderboard rows for the viewer's scope (members and managers: their team; CEO and HR: everyone).
create or replace function leaderboard(p_week text)
returns table(name text, team text, pct numeric, gain numeric, rev_n int, rev_avg numeric)
language sql stable security definer set search_path = public as $$
  select p.name, p.team,
    coalesce((select avg(okr_pct(o.krs)) from okrs o where o.owner = p.name), 0),
    coalesce((select sum(l.delta) from logs l where l.owner = p.name and l.week = p_week), 0),
    (select count(*)::int from prios r where r.assignee = p.name and r.week = p_week and r.reviewed),
    coalesce((select avg(r.pct) from prios r where r.assignee = p.name and r.week = p_week and r.reviewed), 0)
  from people p, people me
  where me.uid = auth.uid() and p.role <> 'hr' and (
    me.role in ('ceo','hr') or p.name = me.name or (p.team <> '' and p.team = me.team)
  )
$$;

-- ---------- permissions ----------
revoke all on all functions in schema public from public, anon;
grant execute on function my_name(), my_role(), is_ceo(), in_scope(text), okr_pct(jsonb) to authenticated;
grant execute on function claim_ceo(text), set_kr(uuid,int,boolean,text), approve_kr(uuid,int,boolean,text), leaderboard(text) to authenticated;
grant usage on schema public to authenticated;
grant select, insert, update, delete on people, signups, okrs, stand, ach, prios, wnotes to authenticated;
grant select on logs to authenticated;

-- ---------- live updates ----------
do $$
declare t text;
begin
  foreach t in array array['people','signups','okrs','logs','stand','ach','prios','wnotes'] loop
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
