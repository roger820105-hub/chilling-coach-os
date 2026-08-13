begin;

create or replace function public.create_training_template(
  p_name text, p_description text, p_goal text, p_weeks integer,
  p_creator uuid, p_items jsonb
) returns public.training_templates
language plpgsql security definer set search_path=public as $$
declare t training_templates; item jsonb; ex exercise_library; pos integer:=0;
begin
  if nullif(trim(p_name),'') is null or jsonb_array_length(p_items)=0 then raise exception 'template_name_and_items_required'; end if;
  insert into training_templates(name,description,goal,weeks,created_by)
  values(trim(p_name),p_description,p_goal,greatest(coalesce(p_weeks,1),1),p_creator) returning * into t;
  for item in select * from jsonb_array_elements(p_items) loop
    pos:=pos+1;
    select * into ex from exercise_library where normalized_name=lower(trim(item->>'exerciseName'));
    if ex.id is null then insert into exercise_library(name,category,equipment,created_by)
      values(trim(item->>'exerciseName'),nullif(item->>'category',''),nullif(item->>'equipment',''),p_creator) returning * into ex; end if;
    insert into training_template_items(template_id,week_no,day_no,position,exercise_id,exercise_name,target_sets,target_reps,target_rpe,rest_seconds,note)
    values(t.id,greatest(coalesce((item->>'weekNo')::int,1),1),greatest(coalesce((item->>'dayNo')::int,1),1),pos,ex.id,trim(item->>'exerciseName'),nullif(item->>'sets','')::int,nullif(item->>'reps',''),nullif(item->>'rpe','')::numeric,nullif(item->>'restSeconds','')::int,nullif(item->>'note',''));
  end loop;
  return t;
end $$;

revoke execute on function public.create_training_template(text,text,text,integer,uuid,jsonb) from public,anon,authenticated;
commit;
