begin;

grant delete on table public.leads to authenticated;

create policy leads_delete_own_closed on public.leads
  for delete to authenticated
  using (
    (select auth.uid()) = user_id
    and status in ('won', 'lost')
    and coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') = 'false'
  );

-- Istniejący ON DELETE CASCADE usuwa aktywności razem z ich leadem.
-- Nie przyznajemy uprawnień do bezpośredniego usuwania aktywności.
commit;
