-- Register the planned black-garlic shipping application so permissions can
-- be assigned before the application itself is implemented.
begin;

insert into business_private.apps (app_id, app_name, migrated, display_order)
values ('black_garlic_shipping', '黒にんにく出荷管理', false, 3)
on conflict (app_id) do update
set app_name = excluded.app_name,
    display_order = excluded.display_order;

update business_private.apps
set display_order = case app_id
  when 'garlic_fridge' then 1
  when 'black_garlic' then 2
  when 'black_garlic_shipping' then 3
  when 'garlic_drying' then 4
  when 'frozen_ingredients' then 5
  when 'rice_shipping' then 6
  else display_order
end
where app_id in (
  'garlic_fridge',
  'black_garlic',
  'black_garlic_shipping',
  'garlic_drying',
  'frozen_ingredients',
  'rice_shipping'
);

commit;
