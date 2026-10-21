-- Ejecuta esto una vez en Supabase → SQL Editor → New query → Run.
-- Crea una sola tabla donde se guardan movimientos, categorías, cuentas,
-- recurrentes, metas y ajustes. Cada usuario solo puede ver sus propios datos.

create table if not exists public.items (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind       text not null,          -- transactions | categories | accounts | recurring | goals | settings
  id         text not null,
  data       jsonb not null,
  deleted    boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, kind, id)
);

create index if not exists items_user_updated_idx on public.items (user_id, updated_at);

-- La hora de actualización la pone el servidor para que la sincronización
-- no dependa del reloj del celular o la laptop.
create or replace function public.items_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end $$;

drop trigger if exists items_touch on public.items;
create trigger items_touch before insert or update on public.items
for each row execute function public.items_touch();

alter table public.items enable row level security;

drop policy if exists "items_select_own" on public.items;
drop policy if exists "items_insert_own" on public.items;
drop policy if exists "items_update_own" on public.items;
drop policy if exists "items_delete_own" on public.items;

create policy "items_select_own" on public.items for select using (auth.uid() = user_id);
create policy "items_insert_own" on public.items for insert with check (auth.uid() = user_id);
create policy "items_update_own" on public.items for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "items_delete_own" on public.items for delete using (auth.uid() = user_id);
