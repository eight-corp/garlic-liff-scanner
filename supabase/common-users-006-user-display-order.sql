begin;

create or replace function public.business_admin_reorder_users(p_worker_ids jsonb)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,business_private
as $$
declare
  v_actor text:=business_private.require_admin();
  v_total integer;
  v_distinct integer;
  v_enabled integer;
begin
  perform pg_advisory_xact_lock(20260910,1);
  if p_worker_ids is null or jsonb_typeof(p_worker_ids)<>'array' then
    raise exception '表示順の形式が不正です。';
  end if;

  select count(*),count(distinct worker_id)
  into v_total,v_distinct
  from jsonb_array_elements_text(p_worker_ids) as item(worker_id);

  select count(*) into v_enabled from business_private.users where enabled;
  if v_total<>v_distinct or v_total<>v_enabled or exists(
    select 1
    from jsonb_array_elements_text(p_worker_ids) as item(worker_id)
    left join business_private.users u on u.worker_id=item.worker_id and u.enabled
    where u.worker_id is null
  ) then
    raise exception '有効ユーザーの一覧が最新ではありません。再読み込みしてから操作してください。';
  end if;

  update public.workers w
  set display_order=ordered.position*10
  from (
    select worker_id,ordinality::integer as position
    from jsonb_array_elements_text(p_worker_ids) with ordinality as item(worker_id,ordinality)
  ) ordered
  where w.worker_id=ordered.worker_id;

  insert into business_private.audit(actor_id,action,detail)
  values(v_actor,'reorder_users',jsonb_build_object('workerIds',p_worker_ids));
  return jsonb_build_object('ok',true);
end;
$$;

revoke all on function public.business_admin_reorder_users(jsonb) from public,anon,authenticated;
grant execute on function public.business_admin_reorder_users(jsonb) to anon,authenticated;

commit;
