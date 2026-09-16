alter table public.frozen_ingredient_materials
add column if not exists note text;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'frozen_ingredient_materials_note_length_check'
  ) then
    alter table public.frozen_ingredient_materials
    add constraint frozen_ingredient_materials_note_length_check
    check (note is null or char_length(note) <= 200);
  end if;
end $$;

comment on column public.frozen_ingredient_materials.note is '品目備考';
