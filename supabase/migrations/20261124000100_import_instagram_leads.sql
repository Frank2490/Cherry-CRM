begin;

create function public.normalize_lead_instagram(profile text)
returns text
language sql
immutable
strict
security invoker
set search_path = ''
as $$
  with cleaned as (
    select lower(btrim(profile, U&' \0009\000A\000B\000C\000D\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF') collate "C") as value
  ), handles as (
    select coalesce(
      substring(value collate "C" from '^(?:https?://)?(?:www\.|m\.)?instagram\.com/([a-z0-9_.]{1,30})/?(?:[?#][^[:space:]]*)?$'),
      regexp_replace(value, '^@', '')
    ) as handle
    from cleaned
  )
  select handle from handles
  where handle collate "C" ~ '^[a-z0-9_](?:[a-z0-9_.]{0,28}[a-z0-9_])?$'
    and strpos(handle, '..') = 0;
$$;

revoke all on function public.normalize_lead_instagram(text) from public, anon;
grant execute on function public.normalize_lead_instagram(text) to authenticated, service_role;

-- Celowo nieunikalny: ręczne dodawanie nadal pozwala na powtórzenia.
create index leads_user_instagram_normalized_idx
  on public.leads (user_id, public.normalize_lead_instagram(instagram))
  where instagram is not null;

create function public.import_instagram_lead(
  p_company_name text,
  p_instagram text,
  p_notes text,
  p_next_step text
)
returns text
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  handle text := public.normalize_lead_instagram(p_instagram);
begin
  if owner_id is null or coalesce(auth.jwt() ->> 'is_anonymous', 'false') <> 'false' then
    raise exception 'Authenticated owner required' using errcode = '42501';
  end if;

  if p_company_name is null or p_company_name !~ '[^[:space:]]'
    or char_length(p_company_name) > 200
    or handle is null or char_length(p_instagram) > 500
    or p_notes is null or char_length(p_notes) > 12000
    or char_length(p_next_step) > 1000 then
    raise exception 'Invalid lead import payload' using errcode = '22023';
  end if;

  -- Po oczekiwaniu na blokadę SELECT musi zobaczyć zatwierdzony zapis poprzedniego importu.
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Lead import requires READ COMMITTED' using errcode = '25000';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('cherry.leads.instagram:' || owner_id::text || ':' || handle, 0));

  if exists (
    select 1 from public.leads as lead
    where lead.user_id = owner_id
      and lead.instagram is not null
      and public.normalize_lead_instagram(lead.instagram) = handle
  ) then
    return 'already_exists';
  end if;

  insert into public.leads (user_id, company_name, instagram, status, notes, next_step)
  values (owner_id, p_company_name, '@' || handle, 'new', p_notes, p_next_step);

  return 'created';
end;
$$;

revoke all on function public.import_instagram_lead(text, text, text, text) from public, anon, service_role;
grant execute on function public.import_instagram_lead(text, text, text, text) to authenticated;

commit;
