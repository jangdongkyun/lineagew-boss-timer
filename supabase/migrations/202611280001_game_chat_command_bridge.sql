-- LINEAGE W game chat bridge schema.
create table if not exists public.chat_capture_devices (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  platform text not null check (platform in ('android','windows')),
  device_name text not null default '',
  server_id smallint not null default 1 check (server_id in (1,2,3)),
  token_hash text not null unique,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);
create index if not exists chat_capture_devices_owner_idx on public.chat_capture_devices(owner_user_id, created_at desc);

create table if not exists public.game_chat_member_mappings (
  id uuid primary key default gen_random_uuid(),
  server_id smallint not null check (server_id in (1,2,3)),
  game_nickname text not null,
  normalized_game_nickname text not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint game_chat_member_mappings_server_nick_unique unique (server_id, normalized_game_nickname)
);
create index if not exists game_chat_member_mappings_user_idx on public.game_chat_member_mappings(user_id, server_id);

create table if not exists public.game_chat_command_logs (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.chat_capture_devices(id) on delete cascade,
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  source_message_id text not null,
  game_nickname text not null default '',
  mapped_user_id uuid references public.profiles(id) on delete set null,
  boss_id uuid references public.bosses(id) on delete set null,
  action text check (action in ('cut','cancel')),
  cut_at timestamptz,
  raw_message text not null,
  status text not null,
  result_detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint game_chat_command_logs_device_message_unique unique (device_id, source_message_id)
);
create index if not exists game_chat_command_logs_created_idx on public.game_chat_command_logs(created_at desc);
create index if not exists game_chat_command_logs_owner_idx on public.game_chat_command_logs(owner_user_id, created_at desc);

alter table public.chat_capture_devices enable row level security;
alter table public.game_chat_member_mappings enable row level security;
alter table public.game_chat_command_logs enable row level security;

drop policy if exists chat_capture_devices_select_own on public.chat_capture_devices;
create policy chat_capture_devices_select_own on public.chat_capture_devices for select to authenticated
  using (owner_user_id = auth.uid() or public.is_admin());

drop policy if exists game_chat_mappings_select_own_or_admin on public.game_chat_member_mappings;
create policy game_chat_mappings_select_own_or_admin on public.game_chat_member_mappings for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists game_chat_mappings_insert_own_or_admin on public.game_chat_member_mappings;
create policy game_chat_mappings_insert_own_or_admin on public.game_chat_member_mappings for insert to authenticated
  with check ((user_id = auth.uid() or public.is_admin()) and public.is_approved_member());

drop policy if exists game_chat_mappings_update_own_or_admin on public.game_chat_member_mappings;
create policy game_chat_mappings_update_own_or_admin on public.game_chat_member_mappings for update to authenticated
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

drop policy if exists game_chat_mappings_delete_own_or_admin on public.game_chat_member_mappings;
create policy game_chat_mappings_delete_own_or_admin on public.game_chat_member_mappings for delete to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists game_chat_logs_select_owner_or_admin on public.game_chat_command_logs;
create policy game_chat_logs_select_owner_or_admin on public.game_chat_command_logs for select to authenticated
  using (owner_user_id = auth.uid() or public.is_admin());

create or replace function public.process_game_chat_command(
  p_device_id uuid, p_owner_user_id uuid, p_source_message_id text,
  p_game_nickname text, p_mapped_user_id uuid, p_boss_id uuid,
  p_action text, p_cut_at timestamptz, p_server_id smallint, p_raw_message text
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_log_id uuid;
  v_existing_log_id uuid;
  v_record_ids uuid[];
  v_record_id uuid;
  v_count integer;
  v_cut_id uuid;
  v_status text;
  v_detail jsonb := '{}'::jsonb;
begin
  if p_action not in ('cut','cancel') then raise exception 'invalid_action'; end if;
  if p_server_id not in (1,2,3) then raise exception 'invalid_server'; end if;
  if p_source_message_id is null or length(p_source_message_id) < 1 or length(p_source_message_id) > 180 then
    raise exception 'invalid_source_message_id';
  end if;

  insert into public.game_chat_command_logs (
    device_id, owner_user_id, source_message_id, game_nickname,
    mapped_user_id, boss_id, action, cut_at, raw_message, status
  ) values (
    p_device_id, p_owner_user_id, p_source_message_id, coalesce(p_game_nickname,''),
    p_mapped_user_id, p_boss_id, p_action, p_cut_at, left(coalesce(p_raw_message,''),300), 'processing'
  )
  on conflict (device_id, source_message_id) do nothing returning id into v_log_id;

  if v_log_id is null then
    select id into v_existing_log_id from public.game_chat_command_logs
    where device_id = p_device_id and source_message_id = p_source_message_id;
    return jsonb_build_object('ok',true,'status','duplicate_message','log_id',v_existing_log_id);
  end if;

  if p_mapped_user_id is null then
    v_status := 'unmapped_member';
    v_detail := jsonb_build_object('message','게임 닉네임과 보탐봇 회원 연결이 필요합니다.');
  elsif p_boss_id is null then
    v_status := 'unknown_boss';
    v_detail := jsonb_build_object('message','보스 이름 또는 별칭을 찾지 못했습니다.');
  elsif p_cut_at is null then
    v_status := 'invalid_time';
    v_detail := jsonb_build_object('message','컷 시각을 해석하지 못했습니다.');
  else
    perform set_config('request.jwt.claim.sub', p_mapped_user_id::text, true);
    if p_action = 'cut' then
      update public.cut_records set pending_delete_at = null
      where boss_id = p_boss_id and server_id = p_server_id and pending_delete_at is not null;

      select array_agg(id) into v_record_ids from public.cut_records
      where boss_id = p_boss_id and server_id = p_server_id and pending_delete_at is null
        and date_trunc('minute', cut_at at time zone 'Asia/Seoul') =
            date_trunc('minute', p_cut_at at time zone 'Asia/Seoul');

      if coalesce(array_length(v_record_ids,1),0) > 0 then
        v_status := 'duplicate_cut';
        v_detail := jsonb_build_object('message','동일한 보스와 시각의 컷 기록이 이미 있습니다.');
      else
        insert into public.cut_records (boss_id, cut_at, created_by, created_by_nickname, server_id)
        values (p_boss_id, p_cut_at, p_mapped_user_id, '혈맹원', p_server_id)
        returning id into v_cut_id;
        v_status := 'saved';
        v_detail := jsonb_build_object('cut_record_id',v_cut_id,'message','컷 기록을 자동 저장했습니다.');
      end if;
    else
      perform 1 from public.cut_records
      where boss_id = p_boss_id and server_id = p_server_id and pending_delete_at is null
        and (cut_at at time zone 'Asia/Seoul')::date = (p_cut_at at time zone 'Asia/Seoul')::date
        and date_trunc('minute', cut_at at time zone 'Asia/Seoul') =
            date_trunc('minute', p_cut_at at time zone 'Asia/Seoul')
      for update;

      select array_agg(id) into v_record_ids from public.cut_records
      where boss_id = p_boss_id and server_id = p_server_id and pending_delete_at is null
        and (cut_at at time zone 'Asia/Seoul')::date = (p_cut_at at time zone 'Asia/Seoul')::date
        and date_trunc('minute', cut_at at time zone 'Asia/Seoul') =
            date_trunc('minute', p_cut_at at time zone 'Asia/Seoul');

      v_count := coalesce(array_length(v_record_ids,1),0);
      if v_count = 0 then
        v_status := 'cancel_not_found';
        v_detail := jsonb_build_object('message','해당 보스와 시각에 일치하는 활성 컷 기록이 없습니다.');
      elsif v_count > 1 then
        v_status := 'cancel_ambiguous';
        v_detail := jsonb_build_object('message','일치하는 기록이 여러 개라 취소하지 않았습니다.');
      else
        v_record_id := v_record_ids[1];
        update public.cut_records set pending_delete_at = now() + interval '10 minutes'
        where id = v_record_id and server_id = p_server_id;
        v_status := 'cancelled';
        v_detail := jsonb_build_object('cut_record_id',v_record_id,'message','일치하는 컷 기록을 10분 삭제 대기 상태로 변경했습니다.');
      end if;
    end if;
  end if;

  update public.game_chat_command_logs set status = v_status, result_detail = v_detail where id = v_log_id;
  return jsonb_build_object('ok',true,'status',v_status,'log_id',v_log_id,'detail',v_detail);
end;
$$;

revoke all on function public.process_game_chat_command(uuid,uuid,text,text,uuid,uuid,text,timestamptz,smallint,text) from public, anon, authenticated;
grant execute on function public.process_game_chat_command(uuid,uuid,text,text,uuid,uuid,text,timestamptz,smallint,text) to service_role;
