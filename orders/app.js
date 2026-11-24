import {departments,statuses,workStatuses,eventNames,esc,number,remaining,orderNumber,today,date,time,quantity,matchesOrderChoice,packedQuantity,formatPackedQuantity} from './model.js?v=20261124-column-filters';

const auth=window.BusinessAuth;
auth.init(window.BusinessConfig.url,window.BusinessConfig.key);
const $=id=>document.getElementById(id);
const icon=name=>`<svg aria-hidden="true"><use href="./icons.svg?v=20261124-column-filters#${name}"></use></svg>`;
const badge=status=>`<span class="badge ${esc(status)}">${esc(statuses[status]||workStatuses[status]||status)}</span>`;
const button=(action,text,svg='edit',kind='secondary',extra='')=>`<button type="button" class="${kind}" data-action="${action}" ${extra}>${icon(svg)}${esc(text)}</button>`;
const options=(values,value,empty='選択してください')=>`<option value="">${esc(empty)}</option>`+values.map(v=>`<option value="${esc(v.id)}" ${v.id===value?'selected':''}>${esc(v.label??v.name)}</option>`).join('');
const deptOptions=value=>Object.entries(departments).map(([id,name])=>`<option value="${id}" ${id===value?'selected':''}>${name}</option>`).join('');
const field=(label,name,value='',type='text',extra='')=>`<label>${esc(label)}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
const entryMasterLabels={clients:'取引先',deliveries:'納品先',products:'商品'};
const pickerButton=(kind,itemId='',disabled=false)=>`<button type="button" class="icon-button choice-search" data-action="open-entry-picker" data-kind="${kind}" data-id="${esc(itemId)}" title="${entryMasterLabels[kind]}を検索・追加" aria-label="${entryMasterLabels[kind]}を検索・追加" ${disabled?'disabled':''}>${icon('search')}</button>`;
let entryPicker=null;
const maxAttachments=5;
let previewUrl='';
const progressColumns=[
  ['order_no','注文番号'],['department','カテゴリ',departments],['client_name','取引先'],['delivery_name','納品先'],
  ['ordered_on','注文日'],['requested_ship_date','出荷希望日'],['progress','状態',statuses],
  ['shipment_progress','出荷済明細'],['creator_name','登録担当者'],['updated_at','更新日時']
];
let columnMenu=null,columnRefresh=0;
const state={session:null,boot:null,view:'input',master:'products',masterQuery:'',list:{rows:[],total:0},version:0,load:0,detail:null,draft:null,entryDraft:null,entryDirty:false,entrySaving:false,dirty:false,actionDirty:false,progressDrafts:new Map(),detailNotice:'',syncing:false,filters:{
  approval:{q:'',department:'',status:'pending',start:'',end:'',mine:false,open:false,offset:0},
  progress:{columns:{},offset:0},
  search:{q:'',department:'',status:'',start:'',end:'',mine:false,open:false,offset:0}
}};
function notice(text,error=false,warning=false){$('notice').hidden=!text;$('notice').className=error?'error':warning?'warning':'';$('notice').innerHTML=`<span>${esc(text)}</span><button type="button" class="icon-button" data-action="dismiss-notice" title="閉じる" aria-label="通知を閉じる">${icon('close')}</button>`;}
function showError(id,error){const box=$(id);box.hidden=false;box.textContent=error.message||String(error);box.scrollIntoView({block:'nearest'});}
async function rpc(name,args={}){return auth.rpc(name,{p_worker_id:state.session.workerId,...args});}
async function busy(root,fn,errorId){const controls=[...root.querySelectorAll('button,input,select,textarea')].map(el=>[el,el.disabled]);controls.forEach(([el])=>el.disabled=true);root.setAttribute('aria-busy','true');if(errorId)$(errorId).hidden=true;try{return await fn();}catch(error){if(errorId)showError(errorId,error);else notice(error.message,true);return null;}finally{controls.forEach(([el,disabled])=>{if(el.isConnected)el.disabled=disabled;});root.removeAttribute('aria-busy');}}
function capabilities(){return state.boot||{};}
function syncLabel(offline=false){$('sync').classList.toggle('offline',offline);$('sync').textContent=offline?'接続できません':'同期 '+new Date().toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'});}
async function bootstrap(){state.boot=await rpc('orders_bootstrap');state.version=state.boot.version;document.querySelector('[data-view="input"]').disabled=!state.boot.canOperate;refreshPackTotals('entry-form',state.entryDraft);refreshPackTotals('draft-form',state.draft);}
const columnText=(value,text)=>String(value).normalize('NFKC').toLowerCase().includes(text.normalize('NFKC').trim().toLowerCase());
const selectedColumnValue=(filter,value)=>filter.include?filter.include.includes(value):!filter.exclude?.includes(value);
function listFilters(){
  const filters={...state.filters[state.view]};
  if(state.view==='approval')filters.status='pending';
  if(state.view==='progress')filters.columns=Object.fromEntries(progressColumns.flatMap(([key,,choices])=>{
    const filter=filters.columns[key];
    if(!filter)return [];
    if(choices&&filter.text)return [[key,{include:Object.entries(choices).filter(([id,label])=>selectedColumnValue(filter,id)&&columnText(label,filter.text)).map(([id])=>id)}]];
    return [[key,filter]];
  }));
  return filters;
}
function filterForm(){const f=state.filters[state.view];return `<form id="filter-form" class="filters">
  <label class="wide">検索<input name="q" type="search" value="${esc(f.q)}" placeholder="注文番号・取引先・納品先・商品" maxlength="120"></label>
  <label>カテゴリ<select aria-label="カテゴリ" name="department">${options(Object.entries(departments).map(([id,name])=>({id,name})),f.department,'全カテゴリ')}</select></label>
  ${state.view==='approval'?'':`<label>状態<select aria-label="状態" name="status">${options(Object.entries(statuses).map(([id,name])=>({id,name})),f.status,'すべて')}</select></label>`}
  ${field('注文日から','start',f.start,'date')}${field('注文日まで','end',f.end,'date')}
  ${state.view!=='approval'?`<label class="check"><input type="checkbox" name="open" ${f.open?'checked':''}>未完了のみ</label>`:''}
  <div class="row filter-actions"><button class="primary" type="submit">${icon('search')}検索</button><button type="button" class="icon-button" data-action="clear-filters" title="絞り込みをクリア" aria-label="絞り込みをクリア">${icon('reset')}</button></div>
  </form>`;}
function listRows(){
  return state.list.rows.map(o=>`<tr data-order="${o.id}"><td><button type="button" class="order-link" data-action="open-order" data-id="${o.id}" aria-label="${orderNumber(o.order_no)}を開く">${orderNumber(o.order_no)}</button></td><td>${departments[o.department]}</td><td>${esc(o.client_name)}</td><td>${esc(o.delivery_name)}</td><td>${date(o.ordered_on)}</td><td>${date(o.requested_ship_date)}</td><td>${badge(o.progress)}</td><td class="numeric">${o.shipped_item_count} / ${o.item_count}</td><td>${esc(o.creator_name)}</td><td>${state.view==='progress'?time(o.updated_at,'Asia/Tokyo'):time(o.updated_at)}</td></tr>`).join('');
}
function renderList(){
  const progress=state.view==='progress',titles={approval:'注文確定',progress:'進捗一覧',search:'過去注文検索'};
  if(!progress||!$('progress-column-table')){
    $('view').innerHTML=`<div class="page-heading"><div><h2>${titles[state.view]}</h2><div id="order-list-count" class="muted"></div></div>
      ${progress?button('clear-filters','絞り込み解除','reset'):''}</div>
    ${progress?'':filterForm()}<div class="table-wrap"><table class="list-table" ${progress?'id="progress-column-table"':''}><thead><tr>
      ${progressColumns.map(([key,label])=>progress?`<th scope="col"><div class="progress-column-heading"><span>${label}</span><button type="button" class="column-filter-toggle" data-action="column-filter" data-column="${key}" aria-expanded="false" aria-controls="progress-column-menu" title="${label}を絞り込む" aria-label="${label}を絞り込む">${icon('filter')}</button></div></th>`:`<th>${label}</th>`).join('')}
    </tr></thead><tbody id="order-list-rows"></tbody></table><div id="order-list-empty" class="empty" hidden>該当する注文はありません</div></div>
    <div class="pager"><span id="order-list-page"></span><button class="icon-button" type="button" data-action="previous-page" title="前のページ" aria-label="前のページ">${icon('left')}</button><button class="icon-button" type="button" data-action="next-page" title="次のページ" aria-label="次のページ">${icon('right')}</button></div>`;
  }
  const offset=state.filters[state.view].offset,total=state.list.total;
  $('order-list-count').textContent=number(total)+'件';
  $('order-list-rows').innerHTML=listRows();
  $('order-list-empty').hidden=state.list.rows.length>0;
  $('order-list-page').textContent=total?`${number(offset+1)}–${number(Math.min(offset+50,total))} / ${number(total)}件`:'0件';
  $('view').querySelector('[data-action="previous-page"]').disabled=offset===0;
  $('view').querySelector('[data-action="next-page"]').disabled=offset+50>=total;
  if(progress)updateColumnIndicators();
}
function updateColumnIndicators(){
  const table=$('progress-column-table');
  if(!table)return;
  const filters=state.filters.progress.columns;
  table.querySelectorAll('[data-column]').forEach(el=>{
    el.classList.toggle('filtered',!!filters[el.dataset.column]);
    el.setAttribute('aria-expanded',String(columnMenu?.key===el.dataset.column&&$('progress-column-menu').matches(':popover-open')));
  });
  $('view').querySelector('[data-action="clear-filters"]').disabled=!Object.keys(filters).length;
}
function placeColumnMenu(){
  if(!columnMenu)return;
  const menu=$('progress-column-menu'),container=columnMenu.trigger.closest('.table-wrap');
  if(!container||!columnMenu.trigger.isConnected){menu.hidePopover();return;}
  const rect=columnMenu.trigger.getBoundingClientRect(),wrap=container.getBoundingClientRect();
  const viewport=window.visualViewport,x=viewport?.offsetLeft??0,y=viewport?.offsetTop??0,w=viewport?.width??innerWidth,h=viewport?.height??innerHeight;
  if(rect.right<Math.max(x,wrap.left)||rect.left>Math.min(x+w,wrap.right)||rect.bottom<y||rect.top>y+h){menu.hidePopover();return;}
  const width=Math.min(250,w-16),below=y+h-rect.bottom-12,above=rect.top-y-12,up=below<210&&above>below;
  const maxHeight=Math.min(330,Math.max(up?above:below,90));
  Object.assign(menu.style,{width:width+'px',left:Math.min(Math.max(rect.left,x+8),x+w-width-8)+'px',maxHeight:maxHeight+'px',
    top:up?'auto':Math.max(y+8,Math.min(rect.bottom+4,y+h-98))+'px',
    bottom:up?Math.max(innerHeight-rect.top+4,innerHeight-y-h+8)+'px':'auto'});
}
function refreshColumnChecks(menu){
  const filter=state.filters.progress.columns[menu.key]||{};
  const all=$('progress-column-all');
  all.checked=!filter.include&&!filter.exclude?.length;
  all.indeterminate=!!(filter.include?.length||filter.exclude?.length);
  $('progress-column-options').querySelectorAll('input').forEach(el=>el.checked=selectedColumnValue(filter,el.value));
}
async function loadColumnChoices(menu){
  const request=++menu.request,term=state.filters.progress.columns[menu.key]?.text||'',list=$('progress-column-options');
  try{
    let entries;
    if(menu.choices)entries=Object.entries(menu.choices).filter(([,label])=>columnText(label,term));
    else{
      const result=await rpc('orders_list',{p_filters:{facet:menu.key,facet_text:term}});
      entries=result.values.map(value=>[value,value]);
    }
    if(columnMenu!==menu||request!==menu.request||!$('progress-column-menu').matches(':popover-open'))return;
    menu.loadedTerm=term;
    list.innerHTML=entries.slice(0,120).map(([value,label])=>`<label class="check"><input type="checkbox" data-column-value value="${esc(value)}"><span>${esc(label||'（空白）')}</span></label>`).join('')
      +(entries.length===0?'<p class="muted">一致する候補がありません</p>':entries.length>120?'<p class="muted">先頭120件</p>':'');
    refreshColumnChecks(menu);
  }catch(error){if(columnMenu===menu&&request===menu.request&&$('progress-column-menu').matches(':popover-open'))list.textContent=error.message;}
}
function openColumnMenu(trigger){
  const popover=$('progress-column-menu');
  if(columnMenu?.trigger===trigger&&popover.matches(':popover-open')){popover.hidePopover();return;}
  const [key,label,choices]=progressColumns.find(([key])=>key===trigger.dataset.column);
  const menu=columnMenu={key,label,choices,trigger,request:0};
  $('progress-column-title').textContent=label;
  const input=$('progress-column-text');
  input.value=state.filters.progress.columns[key]?.text||'';
  input.setAttribute('aria-label',label+'を文字で絞り込む');
  $('progress-column-options').textContent='読み込み中…';
  if(!popover.matches(':popover-open'))popover.showPopover({source:trigger});
  placeColumnMenu();updateColumnIndicators();refreshColumnChecks(menu);void loadColumnChoices(menu);
}
function changeColumnFilter(menu,filter,typing=false){
  const f=state.filters.progress;
  if(filter.text?.trim()||filter.include||filter.exclude?.length)f.columns[menu.key]=filter;
  else delete f.columns[menu.key];
  f.offset=0;state.load++;updateColumnIndicators();refreshColumnChecks(menu);
  clearTimeout(columnRefresh);
  if(typing){
    menu.request++;
    columnRefresh=setTimeout(()=>{if(state.view==='progress')void loadList();if(columnMenu===menu)void loadColumnChoices(menu);},180);
  }else{void loadList();if(menu.loadedTerm!==(filter.text||''))void loadColumnChoices(menu);}
}
async function loadList(){if(state.view==='input'){state.load++;$('view').removeAttribute('aria-busy');if(!$('entry-form')||!capabilities().canOperate)renderInput();return;}if(state.view==='master'){renderMaster();return;}const token=++state.load;const filters=listFilters();$('view').setAttribute('aria-busy','true');try{const result=await rpc('orders_list',{p_filters:filters});if(token!==state.load)return;state.list=result;renderList();}catch(error){if(token===state.load)notice(error.message,true);}finally{if(token===state.load)$('view').removeAttribute('aria-busy');}}
function activateView(view){if(!state.boot||state.entrySaving)return;if($('progress-column-menu').matches(':popover-open'))$('progress-column-menu').hidePopover();clearTimeout(columnRefresh);state.view=view;document.querySelectorAll('[data-view]').forEach(el=>{el.classList.toggle('active',el.dataset.view===view);if(el.dataset.view===view)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');});return loadList();}

function orderHeading(){const h=state.detail?.header;$('order-title').textContent=state.draft?(h?orderNumber(h.order_no)+' の変更':'注文を追加'):orderNumber(h.order_no);$('order-subtitle').textContent=state.draft?'':departments[h.department]+' / '+statuses[h.progress];$('order-error').hidden=true;document.querySelector('[data-action="detail-refresh"]').hidden=!!state.draft;}
function newDraft(){return {id:crypto.randomUUID(),revision:0,header:{department:'dry',client_id:'',delivery_id:'',delivery_name:'',delivery_address:'',delivery_phone:'',requested_ship_date:today(),notes:''},items:[{id:crypto.randomUUID(),product_id:'',quantity:'1'}],attachments:[]};}
function setDelivery(header,delivery){header.delivery_id=delivery?.id||'';header.delivery_name=delivery?.name||'';header.delivery_address=[delivery?.postal_code,delivery?.address].filter(Boolean).join(' ');header.delivery_phone=delivery?.phone||'';}
function deliverySelect(draft,inline){
  const h=draft.header,client=state.boot.clients.find(c=>c.id===h.client_id),saved=inline?null:state.detail?.header;
  const deliveries=(client?.deliveries||[]).filter(d=>d.active);
  const savedAvailable=saved?.client_id===h.client_id&&!!saved.delivery_name;
  const useSaved=savedAvailable&&['delivery_id','delivery_name','delivery_address','delivery_phone'].every(key=>(h[key]||'')===(saved[key]||''));
  const values=deliveries.map(d=>({id:d.id,label:d.name}));
  if(savedAvailable)values.unshift({id:'__saved__',label:'保存済み：'+saved.delivery_name});
  return `<div class="choice-field"><label>納品先名<select aria-label="納品先名" name="delivery_id" data-header="delivery_id" required ${!values.length?'disabled':''}>${options(values,useSaved?'__saved__':h.delivery_id||'',!client?'取引先を選択してください':!values.length?'納品先が未登録です':'選択してください')}</select></label>${pickerButton('deliveries','',!client)}</div>`;
}
function renderInput(){
  state.load++;
  $('view').removeAttribute('aria-busy');
  $('view').innerHTML='<div class="page-heading"><h2>注文入力</h2></div>'+(capabilities().canOperate?'<section class="order-entry"><div id="entry-error" class="error" role="alert" hidden></div><div id="entry-body"></div></section>':'<div class="empty">注文入力の権限がありません</div>');
  if(capabilities().canOperate){state.entryDraft??=newDraft();renderDraft('entry-body');}
}
function draftContext(element){
  const inline=!!element.closest('#entry-body');
  return {inline,draft:inline?state.entryDraft:state.draft,target:inline?'entry-body':'order-body',error:inline?'entry-error':'order-error',markDirty(){if(inline)state.entryDirty=true;else state.dirty=true;}};
}
async function openOrder(id){await busy($('view'),async()=>{const data=await rpc('orders_detail',{p_order_id:id});state.detail=data;state.draft=null;state.dirty=false;state.detailNotice='';state.progressDrafts.clear();renderDetail();if(!$('order-dialog').open)$('order-dialog').showModal();});}
function editOrder(){const {header:h,items,attachments}=state.detail;if(!canEditOrder())return;state.draft={id:h.id,revision:h.revision,header:{...h},items:items.map(i=>({id:i.id,product_id:i.product_id,quantity:String(i.quantity)})),attachments:[...(attachments||[])]};state.dirty=false;renderDraft();}
function canEditOrder(){const h=state.detail?.header;return h&&capabilities().canOperate&&['draft','returned'].includes(h.status)&&(h.created_by===state.session.workerId||capabilities().canMaster);}
function refreshPackTotals(formId,draft){
  const form=$(formId);
  if(!form||!draft)return;
  const products=new Map(state.boot.products.map(p=>[p.id,p]));
  const setText=(el,text)=>{if(el.textContent!==text)el.textContent=text;};
  let sum=0n,complete=draft.items.length>0,hasProduct=false;
  const rows=form.querySelectorAll('tr[data-item]');
  draft.items.forEach((item,index)=>{
    const pack=products.get(item.product_id)?.pack_size??null;
    const total=packedQuantity(item.quantity,pack);
    hasProduct||=Boolean(item.product_id);
    if(total===null)complete=false;else sum+=total;
    setText(rows[index].querySelector('[data-pack-size]'),pack===null?(item.product_id?'未設定':'—'):number(pack));
    setText(rows[index].querySelector('[data-line-total]'),total===null?'—':formatPackedQuantity(total));
  });
  setText(form.querySelector('[data-pack-total]'),complete?formatPackedQuantity(sum):hasProduct?'未確定':'—');
}
function renderDraft(target='order-body'){const inline=target==='entry-body';if(!inline)orderHeading();const d=inline?state.entryDraft:state.draft,h=d.header;const clients=state.boot.clients.filter(c=>c.active||c.id===h.client_id).map(c=>({...c,label:[c.name,c.store_name].filter(Boolean).join(' ')+(c.active?'':'（無効）')}));$(target).innerHTML=`<form id="${inline?'entry-form':'draft-form'}" novalidate>
  <div class="form-grid"><label>カテゴリ<select aria-label="カテゴリ" name="department" data-header="department">${deptOptions(h.department)}</select></label><div class="choice-field"><label>取引先名<select aria-label="取引先名" name="client_id" data-header="client_id" required>${options(clients,h.client_id)}</select></label>${pickerButton('clients')}</div>
  ${field('出荷希望日','requested_ship_date',h.requested_ship_date,'date','data-header="requested_ship_date" required')}
  ${deliverySelect(d,inline)}
  <label class="full">備考<textarea name="notes" aria-label="備考" data-header="notes" maxlength="4000">${esc(h.notes)}</textarea></label></div>
  <div class="section-heading"><h3>注文明細</h3>${button('add-item','明細追加','plus')}</div>
  <div class="table-wrap"><table class="draft-table"><thead><tr><th>品名</th><th>数量</th><th class="numeric">入数</th><th class="numeric">合計数</th><th></th></tr></thead><tbody>${d.items.map(i=>{const products=state.boot.products.filter(p=>p.department===h.department&&(p.active||p.id===i.product_id)).map(p=>({...p,label:p.name+(p.specification?' / '+p.specification:'')+(p.active?'':'（無効）')}));return `<tr data-item="${i.id}"><td><div class="choice-field"><select data-product="${i.id}" aria-label="品名" required>${options(products,i.product_id)}</select>${pickerButton('products',i.id)}</div></td><td class="quantity-cell"><span class="draft-mobile-label" aria-hidden="true">数量</span><input class="quantity-input" inputmode="decimal" data-quantity="${i.id}" value="${esc(i.quantity)}" aria-label="数量" required></td><td class="numeric pack-cell"><span class="draft-mobile-label">入数</span><span data-pack-size></span></td><td class="numeric pack-cell"><span class="draft-mobile-label">合計数</span><strong data-line-total></strong></td><td class="remove"><button type="button" class="icon-button" data-action="remove-item" data-id="${i.id}" title="明細を削除" aria-label="明細を削除">${icon('trash')}</button></td></tr>`;}).join('')}</tbody></table></div>
  <div class="draft-total"><span>明細数 <strong>${d.items.length}件</strong></span><span>合計数 <output data-pack-total aria-label="全明細の合計数">—</output></span></div>
  ${attachmentSection(d.attachments,true)}
  <div class="dialog-actions">${inline?button('clear-entry','クリア','reset','secondary left'):button('close-order','取消','close','secondary left')}<button class="secondary" type="submit" name="intent" value="draft">${icon('save')}下書き保存</button><button class="primary" type="submit" name="intent" value="submit">${icon('send')}承認を依頼</button></div></form>`;
  refreshPackTotals(inline?'entry-form':'draft-form',d);
}
function definition(label,value,full=false){return `<div${full?' class="full"':''}><dt>${esc(label)}</dt><dd>${esc(value||'—')}</dd></div>`;}
function attachmentSection(attachments=[],editable=false){
  if(!editable&&!attachments.length)return '';
  return `<section class="order-attachments"><div class="section-heading"><h3>添付画像</h3>${editable?`<input type="file" data-attachment-files accept="image/*" multiple hidden>${button('attach-images','画像を追加','plus','secondary',attachments.length>=maxAttachments?'disabled':'')}`:''}</div>
    ${attachments.length?`<ul class="attachment-list">${attachments.map(a=>`<li>${button('preview-attachment',a.name,'search','secondary',`data-id="${esc(a.id)}" title="元画像を表示" aria-label="${esc(a.name)}の元画像を表示"`)}${editable?`<button type="button" class="icon-button" data-action="remove-attachment" data-id="${esc(a.id)}" aria-label="${esc(a.name)}を取り除く" title="添付を外す">${icon('trash')}</button>`:''}</li>`).join('')}</ul>`:''}</section>`;
}
async function prepareAttachment(file){
  if(file.size>20*1024*1024||file.type==='image/svg+xml')throw new Error('1枚20 MB以内の写真またはスクリーンショットを選択してください。');
  let source;
  try{source=await createImageBitmap(file);}catch{throw new Error('画像を開けません。JPEGまたはPNGで添付してください。');}
  try{
    const canvas=document.createElement('canvas'),paint=canvas.getContext('2d',{alpha:false});
    let scale=Math.min(1,2000/Math.max(source.width,source.height));
    for(let attempt=0;attempt<4;attempt++){
      canvas.width=Math.max(1,Math.round(source.width*scale));
      canvas.height=Math.max(1,Math.round(source.height*scale));
      paint.fillStyle='#fff';paint.fillRect(0,0,canvas.width,canvas.height);paint.drawImage(source,0,0,canvas.width,canvas.height);
      const data=canvas.toDataURL('image/jpeg',0.88).split(',')[1];
      if(data&&data.length<=1000000)return {id:crypto.randomUUID(),name:Array.from(file.name.trim()).slice(0,160).join('')||'添付画像.jpg',data};
      scale*=.78;
    }
    throw new Error('添付画像を縮小できませんでした。');
  }finally{source.close();}
}
async function previewAttachment(control){
  const ctx=control.closest('#entry-form,#draft-form')?draftContext(control):null;
  const id=control.dataset.id,orderId=ctx?.draft.id||state.detail.header.id;
  const cached=ctx?.draft.attachments.find(a=>a.id===id);
  const root=ctx?.inline?$('entry-body'):$('order-dialog');
  await busy(root,async()=>{
    const a=cached?.data?cached:await rpc('orders_attachment',{p_order_id:orderId,p_attachment_id:id});
    const bytes=Uint8Array.from(atob(a.data),char=>char.charCodeAt(0));
    previewUrl=URL.createObjectURL(new Blob([bytes],{type:'image/jpeg'}));
    const dialog=$('image-dialog');
    $('image-title').textContent=cached?.data?'添付画像':'保存した注文画像';
    dialog.querySelector('.image-body').innerHTML=`<img class="attachment-preview" src="${previewUrl}" alt="${esc(a.name)}">`;
    dialog.showModal();
  },ctx?.error||'order-error');
}
function renderDetail(){state.draft=null;orderHeading();const {header:h,items,shipments,events}=state.detail;const canWork=capabilities().canOperate&&h.status==='confirmed';const shipped=shipments.some(s=>!s.voided_at);$('order-body').innerHTML=`
  ${state.detailNotice?`<div class="saved-notice" role="status">${esc(state.detailNotice)}</div>`:''}
  <div class="row">${badge(h.progress)}${canEditOrder()?button('edit-order','注文を変更','edit'):''}${capabilities().canApprove&&h.status==='pending'?button('approve-order','注文を確定','approve','primary')+button('return-order','差戻し','reset'):''}${capabilities().canApprove&&h.status!=='cancelled'&&!shipped?button('cancel-order','注文取消','close','danger'):''}</div>
  ${h.return_reason?`<div class="error">差戻し理由：${esc(h.return_reason)}</div>`:''}
  <dl class="definition-grid">${definition('カテゴリ',departments[h.department])}${definition('取引先名',h.client_name)}${definition('登録担当者',h.creator_name)}${definition('注文日',date(h.ordered_on))}${definition('出荷希望日',date(h.requested_ship_date))}${definition('納品先名',h.delivery_name)}${h.planned_carrier_name?definition('配送業者',h.planned_carrier_name):''}${definition('備考',h.notes,true)}</dl>
  <div class="section-heading"><h3>注文明細</h3>${canWork&&items.some(i=>i.work_status==='ready'&&remaining(i)>0)?button('ship-order','出荷を登録','truck','primary'):''}</div>
  <div class="table-wrap"><table class="detail-table"><thead><tr><th>商品・規格</th><th>注文数量</th><th>出荷済</th><th>未出荷</th><th>進捗</th></tr></thead><tbody>${items.map(i=>{const rem=remaining(i),pending=state.progressDrafts.get(i.id);return `<tr><td><strong>${esc(i.product_name)}</strong><small>${esc(i.product_code)} ${esc(i.specification)}</small></td><td class="numeric item-quantities">${number(i.quantity)} ${esc(i.unit)}</td><td class="numeric item-quantities">${number(i.shipped_quantity)} ${esc(i.unit)}<div class="meter"><span style="width:${Math.min(100,Number(i.shipped_quantity)/Number(i.quantity)*100)}%"></span></div></td><td class="numeric item-quantities">${number(rem)} ${esc(i.unit)}</td><td class="progress-cell">${rem===0?badge('shipped'):canWork?`<form data-progress="${i.id}"><select name="status" aria-label="${esc(i.product_name)}の進捗">${Object.entries(workStatuses).map(([id,label])=>`<option value="${id}" ${id===(pending?.status||i.work_status)?'selected':''}>${label}</option>`).join('')}</select><div class="row"><input name="note" value="${esc(pending?.note??i.work_note)}" aria-label="${esc(i.product_name)}の作業メモ" maxlength="2000"><button class="icon-button" type="submit" title="進捗を保存" aria-label="${esc(i.product_name)}の進捗を保存">${icon('save')}</button></div></form>`:badge(i.work_status)}${!canWork&&i.work_note?`<small>${esc(i.work_note)}</small>`:''}</td></tr>`;}).join('')}</tbody></table></div>
  ${attachmentSection(state.detail.attachments)}
  <div class="section-heading"><h3>出荷履歴</h3><span class="muted">${shipments.filter(s=>!s.voided_at).length}件</span></div>${shipments.length?shipments.map(s=>`<div class="shipment-entry ${s.voided_at?'voided':''}"><div class="row"><strong>${date(s.shipped_on)}　${esc(s.carrier_name||'配送業者未設定')}</strong>${s.voided_at?badge('cancelled'):capabilities().canApprove?button('void-shipment','出荷取消','reset','secondary',`data-id="${s.id}"`):''}</div><p>${(s.items||[]).map(i=>`${esc(i.product_name)} ${number(i.quantity)}${esc(i.unit)}`).join(' / ')}</p><p>伝票番号：${esc(s.tracking_no||'—')}　${esc(s.worker_name||'')}</p>${s.notes?`<p class="note">${esc(s.notes)}</p>`:''}${s.voided_at?`<p>取消理由：${esc(s.void_reason)}</p>`:''}</div>`).join(''):'<div class="empty">出荷記録はありません</div>'}
  <div class="section-heading"><h3>変更履歴</h3></div><ol class="events">${events.map(e=>`<li><span>${time(e.created_at)}</span><span>${esc(e.worker_name||e.actor_id)}</span><span>${esc(eventNames[e.kind]||e.kind)}${e.detail?.status?'：'+esc(workStatuses[e.detail.status]||e.detail.status):''}${e.detail?.reason?' / '+esc(e.detail.reason):''}${e.detail?.note?' / '+esc(e.detail.note):''}</span></li>`).join('')}</ol>`;}
async function applyDetail(data,text){state.detail=data;state.detailNotice=text;state.draft=null;state.dirty=state.progressDrafts.size>0;renderDetail();await loadList();}
function actionDialog(title,body){$('action-title').textContent=title;$('action-body').innerHTML=body;$('action-error').hidden=true;state.actionDirty=false;if(!$('action-dialog').open)$('action-dialog').showModal();}
function carrierSelect(id){return `<label>配送業者<select aria-label="配送業者" name="carrier_id">${options(state.boot.carriers.filter(c=>c.active),id,'未設定')}</select></label>`;}
function clientCarrier(){return state.boot.clients.find(c=>c.id===state.detail.header.client_id)?.default_carrier_id||'';}
function decisionDialog(action){const title={approve:'注文を確定',return:'注文を差戻し',cancel:'注文を取消'}[action];actionDialog(title,`<form id="decision-form" data-decision="${action}" novalidate><p>${orderNumber(state.detail.header.order_no)}　${esc(state.detail.header.client_name)}</p>${action==='approve'?`<div class="approval-carrier">${carrierSelect(clientCarrier())}${button('toggle-new-carrier','配送業者を追加','plus','secondary','aria-expanded="false" aria-controls="new-carrier"')}</div><div id="new-carrier" hidden>${field('新しい配送業者名','new_carrier_name','','text','disabled maxlength="160"')}</div>`:`<label>理由<textarea name="reason" maxlength="2000" required></textarea></label>`}<div class="dialog-actions">${button('close-action','戻る','left')}<button class="${action==='cancel'?'danger':'primary'}" type="submit">${icon(action==='approve'?'approve':'send')}${title}</button></div></form>`);}
function shipmentDialog(){const items=state.detail.items.filter(i=>i.work_status==='ready'&&remaining(i)>0);if(!items.length)return;actionDialog('出荷を登録',`<form id="shipment-form" data-shipment="${crypto.randomUUID()}" novalidate><div class="form-grid">${field('出荷日','shipped_on',today(),'date','required')}${carrierSelect(state.detail.header.planned_carrier_id||clientCarrier())}${field('伝票番号','tracking_no','','text','maxlength="120"')}<label class="full">備考<textarea name="notes" maxlength="2000"></textarea></label></div><div class="section-heading"><h3>出荷明細</h3></div><div class="table-wrap"><table class="ship-table"><thead><tr><th></th><th>商品</th><th>残数</th><th>今回出荷</th></tr></thead><tbody>${items.map(i=>`<tr data-ship-item="${i.id}"><td><input type="checkbox" name="include" aria-label="${esc(i.product_name)}を出荷" checked></td><td>${esc(i.product_name)}<small>${esc(i.specification)}</small></td><td class="numeric">${number(remaining(i))} ${esc(i.unit)}</td><td><input class="quantity-input" name="quantity" aria-label="${esc(i.product_name)}の出荷数量" inputmode="decimal" value="${remaining(i)}"></td></tr>`).join('')}</tbody></table></div><div class="dialog-actions">${button('close-action','戻る','left')}<button type="submit" class="primary">${icon('truck')}出荷を登録</button></div></form>`);}
function voidDialog(id){actionDialog('出荷記録を取消',`<form id="void-form" data-shipment="${id}" novalidate><label>取消理由<textarea name="reason" maxlength="2000" required></textarea></label><div class="dialog-actions">${button('close-action','戻る','left')}<button class="danger" type="submit">${icon('reset')}出荷取消</button></div></form>`);}
function closeAction(){if($('action-dialog').getAttribute('aria-busy')==='true'||(state.actionDirty&&!confirm('入力中の内容を破棄して閉じますか？')))return;state.actionDirty=false;entryPicker=null;$('action-dialog').close();}
function closeOrder(){if($('order-dialog').getAttribute('aria-busy')==='true'||(state.dirty&&!confirm('未保存の内容を破棄して閉じますか？')))return;state.dirty=false;state.progressDrafts.clear();$('order-dialog').close();}

const masterNames={products:'商品一覧',clients:'取引先一覧',carriers:'配送業者一覧'};
function pickerChoices({kind,ctx}){
  const h=ctx.draft.header;
  if(kind==='clients')return state.boot.clients.filter(c=>c.active).map(c=>({...c,label:[c.name,c.store_name].filter(Boolean).join(' '),meta:c.code.startsWith('C-')&&c.code.length===38?'':c.code}));
  if(kind==='deliveries')return (state.boot.clients.find(c=>c.id===h.client_id)?.deliveries||[]).filter(d=>d.active).map(d=>({...d,label:d.name}));
  return state.boot.products.filter(p=>p.active&&p.department===h.department).map(p=>({...p,label:p.name,meta:[p.specification,p.code].filter(Boolean).join(' / ')}));
}
function renderPickerResults(){
  const matches=pickerChoices(entryPicker).filter(choice=>matchesOrderChoice(entryPicker.query,[choice.label,choice.meta]));
  $('entry-choice-count').textContent=matches.length+'件';
  $('entry-choice-results').innerHTML=matches.length?matches.map(choice=>`<li><button type="button" data-action="choose-entry-master" data-id="${esc(choice.id)}"><strong>${esc(choice.label)}</strong>${choice.meta?`<small>${esc(choice.meta)}</small>`:''}</button></li>`).join(''):'<li class="empty">該当する候補はありません</li>';
}
function renderEntryPicker(){
  const {kind,query}=entryPicker,label=entryMasterLabels[kind];
  actionDialog(label+'を選択',`<label>${label}を検索<input id="entry-choice-search" type="search" value="${esc(query)}" maxlength="160" autocomplete="off" placeholder="${kind==='clients'?'名称・店舗名・コード':kind==='deliveries'?'納品先名':'商品名・規格・JANコード'}"></label>
    <p id="entry-choice-count" class="muted choice-count" role="status"></p><ul id="entry-choice-results" class="choice-results"></ul>
    <div class="dialog-actions">${button('close-action','閉じる','close')}${button('add-entry-master',label+'を新規追加','plus','primary',kind==='deliveries'&&!state.boot.clients.some(c=>c.id===entryPicker.ctx.draft.header.client_id&&c.active)?'disabled':'')}</div>`);
  renderPickerResults();
  $('entry-choice-search').focus();
}
function selectEntryMaster(id){
  const {kind,ctx,itemId}=entryPicker,h=ctx.draft.header;
  const choice=pickerChoices(entryPicker).find(row=>row.id===id);
  if(!choice)throw new Error('候補が変更されました。選択し直してください。');
  if(kind==='clients'){
    if(h.client_id!==id){h.client_id=id;setDelivery(h,choice.deliveries.find(d=>d.active));}
  }else if(kind==='deliveries')setDelivery(h,choice);
  else ctx.draft.items.find(item=>item.id===itemId).product_id=id;
  ctx.markDirty();state.actionDirty=false;entryPicker=null;$('action-dialog').close();renderDraft(ctx.target);
  $(ctx.target).querySelector(`[data-action="open-entry-picker"][data-kind="${kind}"][data-id="${CSS.escape(itemId)}"]`)?.focus();
}
function entryMasterDialog(){
  const {kind,query,ctx}=entryPicker,label=entryMasterLabels[kind];
  const name=query.trim();
  const jan=/^[0-9]+$/.test(name.normalize('NFKC'))?name.normalize('NFKC').slice(0,40):'';
  const fields=kind==='products'?productFields({department:ctx.draft.header.department,name:jan?'':name,code:jan},true)
    :field(kind==='clients'?'取引先名':'納品先名','name',name,'text','required maxlength="160"');
  actionDialog(label+'を新規追加',`<form id="entry-master-form" data-kind="${kind}" data-id="${crypto.randomUUID()}"><div class="form-grid">${fields}</div><div class="dialog-actions">${button('back-entry-picker','検索に戻る','left','secondary left')}<button class="primary" type="submit">${icon('save')}追加して選択</button></div></form>`);
  updateJanWarning($('entry-master-form'));
  $('entry-master-form').elements.name.focus();
}
function productFields(record,lockCategory=false){
  return `${lockCategory?`<div class="read-field"><span>カテゴリ</span><output>${esc(departments[record.department])}</output></div>`:`<label>カテゴリ<select aria-label="カテゴリ" name="department">${deptOptions(record.department)}</select></label>`}
    ${field('商品名','name',record.name,'text','required maxlength="160"')}${field('規格','specification',record.specification,'text','maxlength="200"')}
    ${field('入数','pack_size',record.pack_size??'','text','inputmode="numeric" maxlength="6"')}${field('大箱入数','case_pack_size',record.case_pack_size??'','text','inputmode="numeric" maxlength="6"')}
    ${field('バンド','band_box_count',record.band_box_count??'','text','inputmode="numeric" maxlength="6" title="1個口にバンド掛けできる箱数"')}
    ${field('JANコード','code',record.code,'text','maxlength="40" inputmode="numeric"')}
    <div id="jan-warning" class="warning full" role="status" hidden></div>
    <label class="full">備考<textarea name="notes" maxlength="2000">${esc(record.notes||'')}</textarea></label>`;
}
function renderMaster(){
  state.load++;
  const kind=state.master,query=state.masterQuery.toLocaleLowerCase();
  const productNames=ids=>(ids||[]).map(id=>state.boot.products.find(p=>p.id===id)).filter(Boolean).map(p=>p.name).join('、');
  const carrierName=id=>state.boot.carriers.find(c=>c.id===id)?.name||'';
  const deliveryNames=r=>(r.deliveries||[]).filter(d=>d.active).map(d=>d.name).join('、');
  const rows=state.boot[kind].filter(r=>[r.code,r.name,r.store_name,r.postal_code,r.address,r.specification,r.notes,departments[r.department],productNames(r.product_ids),carrierName(r.default_carrier_id),...(r.deliveries||[]).filter(d=>d.active).map(d=>[d.name,d.postal_code,d.address,d.phone].join(' '))].join(' ').toLocaleLowerCase().includes(query));
  const columns=kind==='products'?['カテゴリ','商品名','規格','入数','大箱入数','バンド','JANコード','備考']:kind==='clients'?['コード','名称','店舗名','担当者','電話番号','郵便番号','住所','納品先','取扱商品','基本の配送業者']:['コード','名称'];
  const values=r=>kind==='products'?[departments[r.department],r.name,r.specification,r.pack_size==null?'—':number(r.pack_size),r.case_pack_size==null?'—':number(r.case_pack_size),r.band_box_count==null?'—':number(r.band_box_count),r.code,r.notes]:kind==='clients'?[r.code,r.name,r.store_name,r.contact_name,r.phone,r.postal_code,r.address,deliveryNames(r),productNames(r.product_ids),carrierName(r.default_carrier_id)]:[r.code,r.name];
  $('view').removeAttribute('aria-busy');
  $('view').innerHTML=`<div class="page-heading"><h2>マスタ</h2>${capabilities().canMaster?button('new-master','追加','plus','primary'):''}</div>
    <div class="segments" role="group" aria-label="マスタの種類">${Object.entries(masterNames).map(([key,label])=>`<button type="button" data-action="master-kind" data-kind="${key}" class="${key===kind?'active':''}" aria-pressed="${key===kind}">${label}</button>`).join('')}</div>
    <form id="master-filter" class="filters"><label class="wide">検索<input type="search" name="q" value="${esc(state.masterQuery)}" placeholder="${kind==='products'?'JANコード・商品名・カテゴリ':kind==='clients'?'名称・店舗名・納品先・取扱商品':'コード・名称'}"></label><button type="submit" class="primary">${icon('search')}検索</button></form>
    <div class="table-wrap"><table class="master-table ${kind}"><thead><tr>${columns.map(c=>`<th>${c}</th>`).join('')}<th>有効</th>${capabilities().canMaster?'<th>操作</th>':''}</tr></thead><tbody>${rows.map(r=>`<tr class="${r.active?'':'inactive'}">${values(r).map(v=>`<td>${esc(v)}</td>`).join('')}<td>${r.active?'有効':'無効'}</td>${capabilities().canMaster?`<td><button class="icon-button" type="button" data-action="edit-master" data-id="${r.id}" title="編集" aria-label="${esc([r.name,r.store_name].filter(Boolean).join(' '))}を編集">${icon('edit')}</button></td>`:''}</tr>`).join('')}</tbody></table>${rows.length?'':'<div class="empty">登録がありません</div>'}</div>`;
}
function deliveryRow(delivery={id:crypto.randomUUID(),name:'',postal_code:'',address:'',phone:'',active:true}){
  return `<div class="delivery-row" data-delivery="${esc(delivery.id)}">
    ${field('納品先名','destination_name',delivery.name,'text','aria-label="納品先名" maxlength="160" required')}${field('納品先郵便番号','destination_postal',delivery.postal_code,'text','aria-label="納品先郵便番号" inputmode="numeric" maxlength="8"')}
    <label class="full">住所<input name="destination_address" aria-label="納品先の住所" value="${esc(delivery.address)}" maxlength="500"></label>
    ${field('納品先電話番号','destination_phone',delivery.phone,'tel','aria-label="納品先の電話番号" maxlength="60"')}
    <div class="row"><label class="check"><input type="checkbox" name="destination_active" ${delivery.active?'checked':''}>有効</label><button type="button" class="icon-button" data-action="remove-delivery" title="納品先を削除" aria-label="納品先を削除">${icon('trash')}</button></div></div>`;
}
function clientDeliveryFields(record){
  return `<div class="read-field"><span>納品先名</span><output aria-label="取引先の納品先名">${esc([record.name,record.store_name].filter(Boolean).join(' '))}</output></div>
    <div class="read-field"><span>郵便番号</span><output aria-label="取引先の納品先郵便番号">${esc(record.postal_code)}</output></div>
    <div class="read-field full"><span>住所</span><output aria-label="取引先の納品先住所">${esc(record.address)}</output></div>
    <div class="read-field"><span>電話番号</span><output aria-label="取引先の納品先電話番号">${esc(record.phone)}</output></div>`;
}
function updateJanWarning(form){
  if(form?.dataset.kind!=='products')return;
  const code=form.elements.code.value.trim();
  const duplicates=state.boot.products.filter(p=>code&&p.id!==form.dataset.id&&p.code===code);
  const warning=$('jan-warning');warning.hidden=!duplicates.length;
  warning.textContent=duplicates.length?`JANコードが「${duplicates.map(p=>p.name).join('、')}」と重複しています。`:'';
}
function masterDialog(id){
  if(!capabilities().canMaster)return;
  const kind=state.master;
  const record=state.boot[kind].find(r=>r.id===id)||{id:'',revision:0,code:'',name:'',active:true,department:'dry',specification:'',pack_size:null,case_pack_size:null,store_name:'',contact_name:'',phone:'',postal_code:'',address:'',default_carrier_id:'',product_ids:[],deliveries:[]};
  let fields;
  if(kind==='products'){
    fields=productFields(record);
  }else{
    fields=`${field('コード','code',record.code,'text','required maxlength="40"')}${field('名称','name',record.name,'text','required maxlength="160"')}`;
    if(kind==='clients'){
      const selected=new Set(record.product_ids||[]);
      const products=state.boot.products.filter(p=>p.active||selected.has(p.id));
      fields+=`${field('店舗名','store_name',record.store_name,'text','maxlength="160"')}${field('担当者','contact_name',record.contact_name,'text','maxlength="100"')}
        ${field('電話番号','phone',record.phone,'tel','maxlength="60"')}${field('郵便番号','postal_code',record.postal_code,'text','inputmode="numeric" maxlength="8" autocomplete="postal-code"')}
        <label class="full">住所<input name="address" value="${esc(record.address)}" maxlength="500"></label>
        <label class="full">基本の配送業者<select name="default_carrier_id" aria-label="基本の配送業者">${options(state.boot.carriers.filter(c=>c.active||c.id===record.default_carrier_id).map(c=>({...c,label:c.name+(c.active?'':'（無効）')})),record.default_carrier_id,'未設定')}</select></label>
        <section class="delivery-editor full" aria-label="納品先一覧"><div class="section-heading"><h3>納品先</h3>${button('add-delivery','納品先を追加','plus')}</div><div id="client-delivery" class="delivery-row">${clientDeliveryFields(record)}</div><div id="delivery-rows">${(record.deliveries||[]).filter(d=>!d.is_client&&d.id!==record.id).map(deliveryRow).join('')}</div></section>
        <fieldset class="product-choices full"><legend>取扱商品</legend><label>商品検索<input type="search" id="product-choice-filter" aria-label="取扱商品を検索" placeholder="JANコード・商品名・カテゴリ"></label>
        <div class="product-choice-list">${products.map(p=>`<label class="product-choice" data-product-search="${esc([p.code,p.name,p.specification,departments[p.department]].join(' ').toLocaleLowerCase())}"><input type="checkbox" name="product_ids" value="${p.id}" aria-label="${esc(p.name+'（'+p.code+'）')}" ${selected.has(p.id)?'checked':''}><span><strong>${esc(p.name)}${p.active?'':'（無効）'}</strong><small>${esc([p.code,departments[p.department],p.specification].filter(Boolean).join(' / '))}</small></span></label>`).join('')}${products.length?'':'<div class="empty">登録がありません</div>'}</div><div id="product-choice-empty" class="empty" hidden>該当する商品はありません</div></fieldset>`;
    }
  }
  actionDialog(masterNames[kind]+'・'+(id?'編集':'追加'),`<form id="master-form" data-kind="${kind}" data-id="${record.id}" data-revision="${record.revision}" novalidate><div class="form-grid">${fields}<label class="check"><input name="active" type="checkbox" ${record.active?'checked':''}>有効</label></div><div class="dialog-actions">${button('close-action','取消','close')}<button class="primary" type="submit">${icon('save')}保存</button></div></form>`);
  updateJanWarning($('master-form'));
}

document.addEventListener('click',async event=>{
  const nav=event.target.closest('[data-view]');if(nav){activateView(nav.dataset.view);return;}
  const control=event.target.closest('[data-action]');const action=control?.dataset.action;
  if(!action){const row=event.target.closest('tr[data-order]');if(row)void openOrder(row.dataset.order);return;}
  if(action==='dismiss-notice'){notice('');return;}
  if(action==='clear-entry'){if(state.entryDirty&&!confirm('入力中の内容をクリアしますか？'))return;state.entryDraft=newDraft();state.entryDirty=false;renderInput();return;}
  if(action==='open-order'){void openOrder(control.dataset.id);return;}
  if(action==='close-order'){closeOrder();return;}
  if(action==='close-action'){closeAction();return;}
  if(action==='edit-order'){editOrder();return;}
  if(action==='open-entry-picker'){const ctx=draftContext(control);if(!capabilities().canOperate||!ctx.draft)return;entryPicker={kind:control.dataset.kind,itemId:control.dataset.id,ctx,query:''};renderEntryPicker();return;}
  if(action==='choose-entry-master'){try{selectEntryMaster(control.dataset.id);}catch(error){showError('action-error',error);}return;}
  if(action==='add-entry-master'){entryMasterDialog();return;}
  if(action==='back-entry-picker'){if(!state.actionDirty||confirm('入力中の内容を破棄しますか？'))renderEntryPicker();return;}
  if(action==='add-item'){const ctx=draftContext(control);if(ctx.draft.items.length>=100){showError(ctx.error,new Error('明細は100行までです。'));return;}ctx.draft.items.push({id:crypto.randomUUID(),product_id:'',quantity:'1'});ctx.markDirty();renderDraft(ctx.target);return;}
  if(action==='remove-item'){const ctx=draftContext(control);ctx.draft.items=ctx.draft.items.filter(i=>i.id!==control.dataset.id);ctx.markDirty();renderDraft(ctx.target);return;}
  if(action==='attach-images'){control.closest('form').querySelector('[data-attachment-files]').click();return;}
  if(action==='close-image'){$('image-dialog').close();return;}
  if(action==='remove-attachment'){const ctx=draftContext(control);ctx.draft.attachments=ctx.draft.attachments.filter(a=>a.id!==control.dataset.id);ctx.markDirty();renderDraft(ctx.target);return;}
  if(action==='preview-attachment'){await previewAttachment(control);return;}
  if(action==='approve-order'){decisionDialog('approve');return;}if(action==='return-order'){decisionDialog('return');return;}if(action==='cancel-order'){decisionDialog('cancel');return;}
  if(action==='toggle-new-carrier'){
    const form=control.form,fields=$('new-carrier'),active=fields.hidden;
    fields.hidden=!active;form.elements.carrier_id.disabled=active;form.elements.new_carrier_name.disabled=!active;
    control.setAttribute('aria-expanded',String(active));control.innerHTML=icon(active?'close':'plus')+(active?'新規追加を取消':'配送業者を追加');
    if(active)form.elements.new_carrier_name.focus();return;
  }
  if(action==='ship-order'){shipmentDialog();return;}if(action==='void-shipment'){voidDialog(control.dataset.id);return;}
  if(action==='new-master'){masterDialog();return;}if(action==='edit-master'){masterDialog(control.dataset.id);return;}
  if(action==='add-delivery'){if(document.querySelectorAll('[data-delivery]').length>=100){showError('action-error',new Error('納品先は100件までです。'));return;}$('delivery-rows').insertAdjacentHTML('beforeend',deliveryRow());state.actionDirty=true;return;}
  if(action==='remove-delivery'){control.closest('[data-delivery]').remove();state.actionDirty=true;return;}
  if(action==='master-kind'){state.master=control.dataset.kind;state.masterQuery='';renderMaster();return;}
  if(action==='column-filter'){openColumnMenu(control);return;}
  if(action==='clear-column-filter'&&columnMenu){
    $('progress-column-text').value='';changeColumnFilter(columnMenu,{});return;
  }
  if(action==='clear-filters'){
    if(state.view==='progress'){
      $('progress-column-menu').hidePopover();clearTimeout(columnRefresh);state.filters.progress={columns:{},offset:0};
    }else state.filters[state.view]={q:'',department:'',status:state.view==='approval'?'pending':'',start:'',end:'',mine:false,open:false,offset:0};
    void loadList();return;
  }
  if(action==='previous-page'||action==='next-page'){state.filters[state.view].offset+=action==='next-page'?50:-50;void loadList();return;}
  if(action==='detail-refresh'){if(state.dirty&&!confirm('未保存の内容を破棄して更新しますか？'))return;await openOrder(state.detail.header.id);return;}
  if(action==='refresh'){if(state.entrySaving)return;await busy($('view'),async()=>{await bootstrap();await loadList();if(state.view==='input'&&capabilities().canOperate)renderInput();syncLabel();});return;}
  if(action==='logout'){if(!confirm('ログアウトしますか？'))return;await busy($('view'),async()=>{await auth.logout();location.href='../menu.html?openExternalBrowser=1';});}
});
document.addEventListener('input',event=>{
  if(event.target.id==='progress-column-text'&&columnMenu){
    changeColumnFilter(columnMenu,{...state.filters.progress.columns[columnMenu.key],text:event.target.value},true);return;
  }
  if(event.target.id==='entry-choice-search'){entryPicker.query=event.target.value;renderPickerResults();return;}
  const masterForm=event.target.closest('#master-form,#entry-master-form');
  if(masterForm?.dataset.kind==='products'&&event.target.name==='code')updateJanWarning(masterForm);
  if(masterForm?.id==='master-form'&&masterForm.dataset.kind==='clients'&&['name','store_name','postal_code','address','phone'].includes(event.target.name)){
    $('client-delivery').innerHTML=clientDeliveryFields(Object.fromEntries(new FormData(masterForm)));
  }
  if(event.target.id==='product-choice-filter'){
    const query=event.target.value.trim().toLocaleLowerCase();
    const choices=[...document.querySelectorAll('[data-product-search]')];
    choices.forEach(label=>label.hidden=!label.dataset.productSearch.includes(query));
    $('product-choice-empty').hidden=!choices.length||choices.some(label=>!label.hidden);
    return;
  }
  if(event.target.closest('#action-dialog'))state.actionDirty=true;
  const ctx=draftContext(event.target);
  if(event.target.dataset.header&&ctx.draft){const name=event.target.dataset.header;if(!['department','client_id','delivery_id'].includes(name))ctx.draft.header[name]=event.target.value;ctx.markDirty();}
  if(event.target.dataset.quantity&&ctx.draft){const row=ctx.draft.items.find(i=>i.id===event.target.dataset.quantity);if(row)row.quantity=event.target.value;ctx.markDirty();refreshPackTotals(ctx.inline?'entry-form':'draft-form',ctx.draft);}
  const progress=event.target.closest('[data-progress]');if(progress){state.progressDrafts.set(progress.dataset.progress,{status:progress.elements.status.value,note:progress.elements.note.value});state.dirty=true;}
});
document.addEventListener('change',async event=>{
  const target=event.target;
  if(columnMenu&&(target.id==='progress-column-all'||target.hasAttribute('data-column-value'))){
    const filter={...state.filters.progress.columns[columnMenu.key]};
    if(target.id==='progress-column-all'){
      delete filter.exclude;delete filter.include;
      if(!target.checked)filter.include=[];
    }else{
      const mode=filter.include?'include':'exclude',values=new Set(filter[mode]);
      if(target.checked===(mode==='include'))values.add(target.value);else values.delete(target.value);
      filter[mode]=[...values];
    }
    changeColumnFilter(columnMenu,filter);return;
  }
  const ctx=draftContext(target),draft=ctx.draft;
  if(target.matches('[data-attachment-files]')){
    const files=Array.from(target.files);target.value='';
    if(!files.length)return;
    if(ctx.inline)state.entrySaving=true;
    try{await busy(ctx.inline?$(ctx.target):$('order-dialog'),async()=>{
      if(draft.attachments.length+files.length>maxAttachments)throw new Error('添付画像は1件の注文につき5枚までです。');
      const attachments=[];
      for(const file of files)attachments.push(await prepareAttachment(file));
      draft.attachments.push(...attachments);ctx.markDirty();renderDraft(ctx.target);
      $(ctx.target).querySelector('[data-action="attach-images"]')?.focus();
    },ctx.error);}finally{if(ctx.inline)state.entrySaving=false;}
    return;
  }
  if(target.dataset.header==='department'&&draft){if(draft.items.some(i=>i.product_id)&&!confirm('カテゴリを変更し、商品明細をリセットしますか？')){target.value=draft.header.department;return;}draft.header.department=target.value;draft.items=[{id:crypto.randomUUID(),product_id:'',quantity:'1'}];ctx.markDirty();renderDraft(ctx.target);}
  if(target.dataset.header==='client_id'&&draft){const client=state.boot.clients.find(c=>c.id===target.value);draft.header.client_id=target.value;const deliveries=(client?.deliveries||[]).filter(d=>d.active);setDelivery(draft.header,deliveries[0]);ctx.markDirty();renderDraft(ctx.target);}
  if(target.dataset.header==='delivery_id'&&draft){if(target.value==='__saved__'){const saved=state.detail.header;for(const key of ['delivery_id','delivery_name','delivery_address','delivery_phone'])draft.header[key]=saved[key]||'';}else{const client=state.boot.clients.find(c=>c.id===draft.header.client_id);setDelivery(draft.header,client?.deliveries?.find(d=>d.id===target.value&&d.active));}ctx.markDirty();renderDraft(ctx.target);}
  if(target.dataset.product&&draft){draft.items.find(i=>i.id===target.dataset.product).product_id=target.value;ctx.markDirty();renderDraft(ctx.target);}
  const shipmentRow=target.closest('[data-ship-item]');if(shipmentRow&&target.name==='include')shipmentRow.querySelector('[name="quantity"]').disabled=!target.checked;
});
document.addEventListener('submit',async event=>{
  const form=event.target;event.preventDefault();
  if(form.id==='entry-master-form'){
    const {kind,ctx}=entryPicker,data=Object.fromEntries(new FormData(form));
    if(kind==='clients')data.code='C-'+form.dataset.id;
    if(kind==='deliveries')data.client_id=ctx.draft.header.client_id;
    if(kind==='products'){
      data.department=ctx.draft.header.department;
      for(const key of ['pack_size','case_pack_size','band_box_count'])data[key]=data[key].normalize('NFKC').trim();
    }
    await busy($('action-dialog'),async()=>{
      state.boot=await rpc('orders_create_entry_master',{p_kind:kind,p_id:form.dataset.id,p_data:data});state.version=state.boot.version;
      const warnings=state.boot.warnings||[];
      selectEntryMaster(form.dataset.id);
      notice([entryMasterLabels[kind]+'をマスタに追加し、選択しました。',...warnings].join(' '),false,!!warnings.length);
    },'action-error');return;
  }
  if(form.id==='filter-form'){const values=Object.fromEntries(new FormData(form));if(values.start&&values.end&&values.start>values.end){notice('開始日は終了日以前にしてください。',true);return;}state.filters[state.view]={...state.filters[state.view],...values,mine:values.mine==='on',open:values.open==='on',offset:0};void loadList();return;}
  if(form.id==='master-filter'){state.masterQuery=form.elements.q.value;renderMaster();return;}
  if(form.id==='draft-form'||form.id==='entry-form'){
    const ctx=draftContext(form),submit=event.submitter?.value==='submit';
    if(ctx.inline&&state.entrySaving)return;
    if(ctx.inline)state.entrySaving=true;
    try{await busy(ctx.inline?$('entry-body'):$('order-dialog'),async()=>{
      const d=ctx.draft;
      if(!d.header.client_id||!d.header.delivery_name.trim()||!d.header.requested_ship_date)throw new Error('取引先名・納品先名・出荷希望日を入力してください。');
      if(!d.items.length||d.items.some(i=>!i.product_id))throw new Error('商品を選択してください。');
      const items=d.items.map(i=>({...i,quantity:quantity(i.quantity)}));
      const attachments=d.attachments.map(({id,name,data})=>data?{id,name,data}:{id});
      const data=await rpc('orders_save',{p_order_id:d.id,p_revision:d.revision,p_header:{...d.header,attachments},p_items:items,p_submit:submit});
      state.progressDrafts.clear();
      if(ctx.inline){state.entryDraft=null;state.entryDirty=false;if(state.view==='input')renderInput();}
      await applyDetail(data,submit?'承認を依頼しました。':'下書きを保存しました。');
      if(ctx.inline&&!$('order-dialog').open)$('order-dialog').showModal();
    },ctx.error);}finally{if(ctx.inline)state.entrySaving=false;}
    return;
  }
  if(form.dataset.progress){await busy($('order-dialog'),async()=>{const data=await rpc('orders_progress',{p_order_id:state.detail.header.id,p_revision:state.detail.header.revision,p_item_id:form.dataset.progress,p_status:form.elements.status.value,p_note:form.elements.note.value});state.progressDrafts.delete(form.dataset.progress);await applyDetail(data,'進捗を保存しました。');},'order-error');return;}
  if(form.id==='master-form'){const values=new FormData(form),data=Object.fromEntries(values);data.active=form.elements.active.checked;if(form.dataset.kind==='clients'){data.product_ids=values.getAll('product_ids');data.deliveries=[...form.querySelectorAll('[data-delivery]')].map(row=>({id:row.dataset.delivery,name:row.querySelector('[name="destination_name"]').value,postal_code:row.querySelector('[name="destination_postal"]').value,address:row.querySelector('[name="destination_address"]').value,phone:row.querySelector('[name="destination_phone"]').value,active:row.querySelector('[name="destination_active"]').checked}));for(const key of ['destination_name','destination_postal','destination_address','destination_phone','destination_active'])delete data[key];}if(form.dataset.kind==='products')for(const key of ['pack_size','case_pack_size','band_box_count'])data[key]=String(data[key]??'').normalize('NFKC').trim();await busy($('action-dialog'),async()=>{state.boot=await rpc('orders_save_master',{p_kind:form.dataset.kind,p_id:form.dataset.id||null,p_revision:Number(form.dataset.revision),p_data:data});state.version=state.boot.version;state.actionDirty=false;$('action-dialog').close();renderMaster();notice(['マスタを保存しました。',...(state.boot.warnings||[])].join(' '),false,!!state.boot.warnings?.length);},'action-error');return;}
  if(form.id==='decision-form'){
    const action=form.dataset.decision,params={p_order_id:state.detail.header.id,p_revision:state.detail.header.revision};
    const newCarrier=action==='approve'&&!$('new-carrier').hidden;
    await busy($('action-dialog'),async()=>{
      const data=action==='approve'?await rpc('orders_approve',{...params,p_carrier_id:newCarrier?null:form.elements.carrier_id.value||null,p_new_carrier_name:newCarrier?form.elements.new_carrier_name.value:null})
        :await rpc('orders_decide',{...params,p_action:action,p_reason:form.elements.reason.value});
      if(newCarrier)await bootstrap().catch(()=>{});
      state.actionDirty=false;$('action-dialog').close();await applyDetail(data,action==='approve'?'注文を確定しました。':'注文の状態を更新しました。');
    },'action-error');return;
  }
  if(form.id==='shipment-form'){await busy($('action-dialog'),async()=>{const values={shipped_on:form.elements.shipped_on.value,carrier_id:form.elements.carrier_id.value,tracking_no:form.elements.tracking_no.value,notes:form.elements.notes.value};const items=[...form.querySelectorAll('[data-ship-item]')].filter(row=>row.querySelector('[name="include"]').checked).map(row=>({item_id:row.dataset.shipItem,quantity:quantity(row.querySelector('[name="quantity"]').value)}));if(!items.length)throw new Error('出荷する明細を選択してください。');const data=await rpc('orders_ship',{p_order_id:state.detail.header.id,p_revision:state.detail.header.revision,p_shipment_id:form.dataset.shipment,p_data:{...values,carrier_id:values.carrier_id||null,items}});state.actionDirty=false;$('action-dialog').close();await applyDetail(data,'出荷を登録しました。');},'action-error');return;}
  if(form.id==='void-form'){await busy($('action-dialog'),async()=>{const data=await rpc('orders_void_shipment',{p_order_id:state.detail.header.id,p_revision:state.detail.header.revision,p_shipment_id:form.dataset.shipment,p_reason:form.elements.reason.value});state.actionDirty=false;$('action-dialog').close();await applyDetail(data,'出荷記録を取消しました。');},'action-error');}
});
$('order-dialog').addEventListener('cancel',event=>{event.preventDefault();closeOrder();});
$('progress-column-menu').addEventListener('toggle',()=>{if(!$('progress-column-menu').matches(':popover-open'))columnMenu=null;updateColumnIndicators();});
document.addEventListener('scroll',event=>{if(columnMenu&&$('progress-column-menu').matches(':popover-open')&&!$('progress-column-menu').contains(event.target))placeColumnMenu();},true);
window.addEventListener('resize',placeColumnMenu);
window.visualViewport?.addEventListener('resize',placeColumnMenu);
window.visualViewport?.addEventListener('scroll',placeColumnMenu);
$('action-dialog').addEventListener('cancel',event=>{event.preventDefault();closeAction();});
$('image-dialog').addEventListener('close',()=>{if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl='';}$('image-dialog').querySelector('.image-body').replaceChildren();});
$('image-dialog').addEventListener('click',event=>{
  if(event.target!==event.currentTarget)return;
  const rect=event.currentTarget.getBoundingClientRect();
  if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)event.currentTarget.close();
});
async function synchronize(){if(!state.session||!state.boot||state.syncing||document.hidden||document.activeElement?.closest('#filter-form,#master-filter'))return;state.syncing=true;try{const result=await rpc('orders_version');const permissionsChanged=['canOperate','canApprove','canMaster'].some(key=>result[key]!==state.boot[key]);if(result.version!==state.version||permissionsChanged){await bootstrap();await loadList();if(state.detail&&$('order-dialog').open&&!state.draft){const fresh=await rpc('orders_detail',{p_order_id:state.detail.header.id});if(fresh.header.revision!==state.detail.header.revision){if(!state.dirty&&!$('action-dialog').open){state.detail=fresh;state.detailNotice='';renderDetail();}else $('order-subtitle').textContent='他の担当者が更新しました';}else if(permissionsChanged){renderDetail();}}}syncLabel();}catch{syncLabel(true);}finally{state.syncing=false;}}
async function start(){try{state.session=await auth.session();if(!state.session){if(!auth.getToken()){location.replace('../menu.html?openExternalBrowser=1');return;}throw new Error('ログインを確認できません。接続を確認してください。');}if(!auth.allows(state.session,'black_garlic_shipping')){location.replace('../menu.html?openExternalBrowser=1');return;}$('worker').textContent=state.session.workerName+' / '+({admin:'管理者',operator:'作業者',viewer:'閲覧者'}[state.session.permissions.black_garlic_shipping]||'');await bootstrap();await activateView(capabilities().canOperate?'input':'search');syncLabel();}catch(error){$('view').removeAttribute('aria-busy');$('view').innerHTML=`<div class="connection-error"><p>${esc(error.message)}</p><button type="button" class="secondary" data-action="retry">${icon('refresh')}再試行</button></div>`;syncLabel(true);}}
document.addEventListener('click',event=>{if(event.target.closest('[data-action="retry"]'))void start();});
window.addEventListener('online',()=>void synchronize());
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void synchronize();});
setInterval(()=>void synchronize(),4000);
setInterval(()=>{if(!document.hidden)void auth.session();},240000);
void start();
