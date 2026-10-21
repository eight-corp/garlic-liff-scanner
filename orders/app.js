import {departments,statuses,workStatuses,eventNames,esc,number,remaining,orderNumber,today,date,time,quantity} from './model.js';

const auth=window.BusinessAuth;
auth.init(window.BusinessConfig.url,window.BusinessConfig.key);
const $=id=>document.getElementById(id);
const icon=name=>`<svg aria-hidden="true"><use href="./icons.svg#${name}"></use></svg>`;
const badge=status=>`<span class="badge ${esc(status)}">${esc(statuses[status]||workStatuses[status]||status)}</span>`;
const button=(action,text,svg='edit',kind='secondary',extra='')=>`<button type="button" class="${kind}" data-action="${action}" ${extra}>${icon(svg)}${esc(text)}</button>`;
const options=(values,value,empty='選択してください')=>`<option value="">${esc(empty)}</option>`+values.map(v=>`<option value="${esc(v.id)}" ${v.id===value?'selected':''}>${esc(v.label??v.name)}</option>`).join('');
const deptOptions=value=>Object.entries(departments).map(([id,name])=>`<option value="${id}" ${id===value?'selected':''}>${name}</option>`).join('');
const field=(label,name,value='',type='text',extra='')=>`<label>${esc(label)}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
const state={session:null,boot:null,view:'input',master:'products',masterQuery:'',list:{rows:[],total:0},version:0,load:0,detail:null,draft:null,dirty:false,actionDirty:false,progressDrafts:new Map(),detailNotice:'',syncing:false,filters:{
  input:{q:'',department:'',status:'',start:'',end:'',mine:true,open:true,offset:0},
  approval:{q:'',department:'',status:'pending',start:'',end:'',mine:false,open:false,offset:0},
  progress:{q:'',department:'',status:'',start:'',end:'',mine:false,open:true,offset:0},
  search:{q:'',department:'',status:'',start:'',end:'',mine:false,open:false,offset:0}
}};
function notice(text,error=false){$('notice').hidden=!text;$('notice').className=error?'error':'';$('notice').innerHTML=`<span>${esc(text)}</span><button type="button" class="icon-button" data-action="dismiss-notice" title="閉じる" aria-label="通知を閉じる">${icon('close')}</button>`;}
function showError(id,error){const box=$(id);box.hidden=false;box.textContent=error.message||String(error);box.scrollIntoView({block:'nearest'});}
async function rpc(name,args={}){return auth.rpc(name,{p_worker_id:state.session.workerId,...args});}
async function busy(root,fn,errorId){const controls=[...root.querySelectorAll('button,input,select,textarea')].map(el=>[el,el.disabled]);controls.forEach(([el])=>el.disabled=true);root.setAttribute('aria-busy','true');if(errorId)$(errorId).hidden=true;try{return await fn();}catch(error){if(errorId)showError(errorId,error);else notice(error.message,true);return null;}finally{controls.forEach(([el,disabled])=>{if(el.isConnected)el.disabled=disabled;});root.removeAttribute('aria-busy');}}
function capabilities(){return state.boot||{};}
function syncLabel(offline=false){$('sync').classList.toggle('offline',offline);$('sync').textContent=offline?'接続できません':'同期 '+new Date().toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'});}
async function bootstrap(){state.boot=await rpc('orders_bootstrap');state.version=state.boot.version;if(!state.boot.canOperate)state.filters.input.mine=false;}
function listFilters(){const filters={...state.filters[state.view]};if(state.view==='approval')filters.status='pending';if(state.view==='progress')filters.confirmed=true;return filters;}
function filterForm(){const f=state.filters[state.view];return `<form id="filter-form" class="filters">
  <label class="wide">検索<input name="q" type="search" value="${esc(f.q)}" placeholder="注文番号・取引先・納品先・商品" maxlength="120"></label>
  <label>部署<select aria-label="部署" name="department">${options(Object.entries(departments).map(([id,name])=>({id,name})),f.department,'全部署')}</select></label>
  ${state.view==='approval'?'':`<label>状態<select aria-label="状態" name="status">${options(Object.entries(statuses).filter(([id])=>state.view!=='progress'||['confirmed','working','ready','partial','shipped'].includes(id)).map(([id,name])=>({id,name})),f.status,'すべて')}</select></label>`}
  ${field('注文日から','start',f.start,'date')}${field('注文日まで','end',f.end,'date')}
  ${state.view==='input'?`<label class="check"><input type="checkbox" name="mine" ${f.mine?'checked':''}>自分の注文</label>`:''}
  ${state.view!=='approval'?`<label class="check"><input type="checkbox" name="open" ${f.open?'checked':''}>未完了のみ</label>`:''}
  <div class="row filter-actions"><button class="primary" type="submit">${icon('search')}検索</button><button type="button" class="icon-button" data-action="clear-filters" title="絞り込みをクリア" aria-label="絞り込みをクリア">${icon('reset')}</button></div>
  </form>`;}
function renderList(){const titles={input:'注文入力',approval:'注文確定',progress:'進捗入力',search:'過去注文検索'};$('view').innerHTML=`
  <div class="page-heading"><div><h2>${titles[state.view]}</h2><div class="muted">${number(state.list.total)}件</div></div>${state.view==='input'&&capabilities().canOperate?button('new-order','注文を追加','plus','primary'):''}</div>
  ${filterForm()}<div class="table-wrap"><table class="list-table"><thead><tr><th>注文番号</th><th>部署</th><th>取引先</th><th>納品先</th><th>注文日</th><th>出荷希望日</th><th>状態</th><th>出荷済明細</th><th>登録担当者</th><th>更新日時</th></tr></thead><tbody>
  ${state.list.rows.map(o=>`<tr data-order="${o.id}"><td><button type="button" class="order-link" data-action="open-order" data-id="${o.id}" aria-label="${orderNumber(o.order_no)}を開く">${orderNumber(o.order_no)}</button></td><td>${departments[o.department]}</td><td>${esc(o.client_name)}</td><td>${esc(o.delivery_name)}</td><td>${date(o.ordered_on)}</td><td>${date(o.requested_ship_date)}</td><td>${badge(o.progress)}</td><td class="numeric">${o.shipped_item_count} / ${o.item_count}</td><td>${esc(o.creator_name)}</td><td>${time(o.updated_at)}</td></tr>`).join('')}
  </tbody></table>${state.list.rows.length?'':'<div class="empty">該当する注文はありません</div>'}</div>
  <div class="pager"><span>${state.list.total?`${number(state.filters[state.view].offset+1)}–${number(Math.min(state.filters[state.view].offset+50,state.list.total))} / `:''}${number(state.list.total)}件</span><button class="icon-button" type="button" data-action="previous-page" title="前のページ" aria-label="前のページ" ${state.filters[state.view].offset===0?'disabled':''}>${icon('left')}</button><button class="icon-button" type="button" data-action="next-page" title="次のページ" aria-label="次のページ" ${state.filters[state.view].offset+50>=state.list.total?'disabled':''}>${icon('right')}</button></div>`;}
async function loadList(){if(state.view==='master'){renderMaster();return;}const token=++state.load;const filters=listFilters();$('view').setAttribute('aria-busy','true');try{const result=await rpc('orders_list',{p_filters:filters});if(token!==state.load)return;state.list=result;renderList();}catch(error){if(token===state.load)notice(error.message,true);}finally{if(token===state.load)$('view').removeAttribute('aria-busy');}}
function activateView(view){state.view=view;document.querySelectorAll('[data-view]').forEach(el=>{el.classList.toggle('active',el.dataset.view===view);if(el.dataset.view===view)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');});void loadList();}

function orderHeading(){const h=state.detail?.header;$('order-title').textContent=state.draft?(h?orderNumber(h.order_no)+' の変更':'注文を追加'):orderNumber(h.order_no);$('order-subtitle').textContent=state.draft?'':departments[h.department]+' / '+statuses[h.progress];$('order-error').hidden=true;document.querySelector('[data-action="detail-refresh"]').hidden=!!state.draft;}
function newOrder(){if(!capabilities().canOperate)return;state.detail=null;state.draft={id:crypto.randomUUID(),revision:0,header:{department:'dry',client_id:'',delivery_name:'',delivery_address:'',delivery_phone:'',ordered_on:today(),requested_ship_date:today(),client_reference:'',notes:''},items:[{id:crypto.randomUUID(),product_id:'',quantity:'1'}]};state.dirty=false;state.progressDrafts.clear();renderDraft();$('order-dialog').showModal();}
async function openOrder(id){await busy($('view'),async()=>{const data=await rpc('orders_detail',{p_order_id:id});state.detail=data;state.draft=null;state.dirty=false;state.detailNotice='';state.progressDrafts.clear();renderDetail();if(!$('order-dialog').open)$('order-dialog').showModal();});}
function editOrder(){const {header:h,items}=state.detail;if(!canEditOrder())return;state.draft={id:h.id,revision:h.revision,header:{...h},items:items.map(i=>({id:i.id,product_id:i.product_id,quantity:String(i.quantity)}))};state.dirty=false;renderDraft();}
function canEditOrder(){const h=state.detail?.header;return h&&capabilities().canOperate&&['draft','returned'].includes(h.status)&&(h.created_by===state.session.workerId||capabilities().canMaster);}
function renderDraft(){orderHeading();const d=state.draft,h=d.header;const clients=state.boot.clients.filter(c=>c.active||c.id===h.client_id).map(c=>({...c,label:c.code+' '+[c.name,c.store_name].filter(Boolean).join(' ')+(c.active?'':'（無効）')}));$('order-body').innerHTML=`<form id="draft-form" novalidate>
  <div class="form-grid"><label>部署<select aria-label="部署" name="department" data-header="department">${deptOptions(h.department)}</select></label><label>取引先<select aria-label="取引先" name="client_id" data-header="client_id" required>${options(clients,h.client_id)}</select></label>
  ${field('注文日','ordered_on',h.ordered_on,'date','data-header="ordered_on" required')}${field('出荷希望日','requested_ship_date',h.requested_ship_date,'date','data-header="requested_ship_date" required')}
  ${field('納品先','delivery_name',h.delivery_name,'text','data-header="delivery_name" maxlength="160" required')}${field('先方注文番号','client_reference',h.client_reference,'text','data-header="client_reference" maxlength="120"')}
  <label class="full">納品先住所<input name="delivery_address" data-header="delivery_address" value="${esc(h.delivery_address)}" maxlength="500"></label>${field('納品先電話番号','delivery_phone',h.delivery_phone,'tel','data-header="delivery_phone" maxlength="60"')}
  <label class="full">備考<textarea name="notes" data-header="notes" maxlength="4000">${esc(h.notes)}</textarea></label></div>
  <div class="section-heading"><h3>注文明細</h3>${button('add-item','明細追加','plus')}</div>
  <div class="table-wrap"><table class="draft-table"><thead><tr><th>商品・規格</th><th>数量・単位</th><th></th></tr></thead><tbody>${d.items.map(i=>{const selected=state.boot.products.find(p=>p.id===i.product_id);const products=state.boot.products.filter(p=>p.department===h.department&&(p.active||p.id===i.product_id)).map(p=>({...p,label:p.code+' '+p.name+(p.specification?' / '+p.specification:'')+(p.active?'':'（無効）')}));return `<tr data-item="${i.id}"><td><select data-product="${i.id}" aria-label="商品" required>${options(products,i.product_id)}</select>${selected?`<small class="soft-label">${esc(selected.specification)}</small>`:''}</td><td class="quantity-cell"><input class="quantity-input" inputmode="decimal" data-quantity="${i.id}" value="${esc(i.quantity)}" aria-label="注文数量" required><span>${esc(selected?.unit||'')}</span></td><td class="remove"><button type="button" class="icon-button" data-action="remove-item" data-id="${i.id}" title="明細を削除" aria-label="明細を削除">${icon('trash')}</button></td></tr>`;}).join('')}</tbody></table></div>
  <div class="draft-total"><span>明細数 <strong>${d.items.length}件</strong></span><span>${departments[h.department]}</span></div>
  <div class="dialog-actions">${button('close-order','取消','close','secondary left')}<button class="secondary" type="submit" name="intent" value="draft">${icon('save')}下書き保存</button><button class="primary" type="submit" name="intent" value="submit">${icon('send')}承認を依頼</button></div></form>`;}
function definition(label,value,full=false){return `<div${full?' class="full"':''}><dt>${esc(label)}</dt><dd>${esc(value||'—')}</dd></div>`;}
function renderDetail(){state.draft=null;orderHeading();const {header:h,items,shipments,events}=state.detail;const canWork=capabilities().canOperate&&h.status==='confirmed';const shipped=shipments.some(s=>!s.voided_at);$('order-body').innerHTML=`
  ${state.detailNotice?`<div class="saved-notice" role="status">${esc(state.detailNotice)}</div>`:''}
  <div class="row">${badge(h.progress)}${canEditOrder()?button('edit-order','注文を変更','edit'):''}${capabilities().canApprove&&h.status==='pending'?button('approve-order','注文を確定','approve','primary')+button('return-order','差戻し','reset'):''}${capabilities().canApprove&&h.status!=='cancelled'&&!shipped?button('cancel-order','注文取消','close','danger'):''}</div>
  ${h.return_reason?`<div class="error">差戻し理由：${esc(h.return_reason)}</div>`:''}
  <dl class="definition-grid">${definition('部署',departments[h.department])}${definition('取引先',h.client_name)}${definition('登録担当者',h.creator_name)}${definition('注文日',date(h.ordered_on))}${definition('出荷希望日',date(h.requested_ship_date))}${definition('先方注文番号',h.client_reference)}${definition('納品先',h.delivery_name)}${definition('電話番号',h.delivery_phone)}${definition('納品先住所',h.delivery_address)}${definition('備考',h.notes,true)}</dl>
  <div class="section-heading"><h3>注文明細</h3>${canWork&&items.some(i=>i.work_status==='ready'&&remaining(i)>0)?button('ship-order','出荷を登録','truck','primary'):''}</div>
  <div class="table-wrap"><table class="detail-table"><thead><tr><th>商品・規格</th><th>注文数量</th><th>出荷済</th><th>未出荷</th><th>進捗</th></tr></thead><tbody>${items.map(i=>{const rem=remaining(i),pending=state.progressDrafts.get(i.id);return `<tr><td><strong>${esc(i.product_name)}</strong><small>${esc(i.product_code)} ${esc(i.specification)}</small></td><td class="numeric item-quantities">${number(i.quantity)} ${esc(i.unit)}</td><td class="numeric item-quantities">${number(i.shipped_quantity)} ${esc(i.unit)}<div class="meter"><span style="width:${Math.min(100,Number(i.shipped_quantity)/Number(i.quantity)*100)}%"></span></div></td><td class="numeric item-quantities">${number(rem)} ${esc(i.unit)}</td><td class="progress-cell">${rem===0?badge('shipped'):canWork?`<form data-progress="${i.id}"><select name="status" aria-label="${esc(i.product_name)}の進捗">${Object.entries(workStatuses).map(([id,label])=>`<option value="${id}" ${id===(pending?.status||i.work_status)?'selected':''}>${label}</option>`).join('')}</select><div class="row"><input name="note" value="${esc(pending?.note??i.work_note)}" aria-label="${esc(i.product_name)}の作業メモ" maxlength="2000"><button class="icon-button" type="submit" title="進捗を保存" aria-label="${esc(i.product_name)}の進捗を保存">${icon('save')}</button></div></form>`:badge(i.work_status)}${!canWork&&i.work_note?`<small>${esc(i.work_note)}</small>`:''}</td></tr>`;}).join('')}</tbody></table></div>
  <div class="section-heading"><h3>出荷履歴</h3><span class="muted">${shipments.filter(s=>!s.voided_at).length}件</span></div>${shipments.length?shipments.map(s=>`<div class="shipment-entry ${s.voided_at?'voided':''}"><div class="row"><strong>${date(s.shipped_on)}　${esc(s.carrier_name||'配送業者未設定')}</strong>${s.voided_at?badge('cancelled'):capabilities().canApprove?button('void-shipment','出荷取消','reset','secondary',`data-id="${s.id}"`):''}</div><p>${(s.items||[]).map(i=>`${esc(i.product_name)} ${number(i.quantity)}${esc(i.unit)}`).join(' / ')}</p><p>伝票番号：${esc(s.tracking_no||'—')}　${esc(s.worker_name||'')}</p>${s.notes?`<p class="note">${esc(s.notes)}</p>`:''}${s.voided_at?`<p>取消理由：${esc(s.void_reason)}</p>`:''}</div>`).join(''):'<div class="empty">出荷記録はありません</div>'}
  <div class="section-heading"><h3>変更履歴</h3></div><ol class="events">${events.map(e=>`<li><span>${time(e.created_at)}</span><span>${esc(e.worker_name||e.actor_id)}</span><span>${esc(eventNames[e.kind]||e.kind)}${e.detail?.status?'：'+esc(workStatuses[e.detail.status]||e.detail.status):''}${e.detail?.reason?' / '+esc(e.detail.reason):''}${e.detail?.note?' / '+esc(e.detail.note):''}</span></li>`).join('')}</ol>`;}
async function applyDetail(data,text){state.detail=data;state.detailNotice=text;state.draft=null;state.dirty=state.progressDrafts.size>0;renderDetail();await loadList();}
function actionDialog(title,body){$('action-title').textContent=title;$('action-body').innerHTML=body;$('action-error').hidden=true;state.actionDirty=false;$('action-dialog').showModal();}
function decisionDialog(action){const title={approve:'注文を確定',return:'注文を差戻し',cancel:'注文を取消'}[action];actionDialog(title,`<form id="decision-form" data-decision="${action}" novalidate><p>${orderNumber(state.detail.header.order_no)}　${esc(state.detail.header.client_name)}</p>${action==='approve'?'':`<label style="margin-top:14px">理由<textarea name="reason" maxlength="2000" required></textarea></label>`}<div class="dialog-actions">${button('close-action','戻る','left')}<button class="${action==='cancel'?'danger':'primary'}" type="submit">${icon(action==='approve'?'approve':'send')}${title}</button></div></form>`);}
function shipmentDialog(){const items=state.detail.items.filter(i=>i.work_status==='ready'&&remaining(i)>0);if(!items.length)return;actionDialog('出荷を登録',`<form id="shipment-form" data-shipment="${crypto.randomUUID()}" novalidate><div class="form-grid">${field('出荷日','shipped_on',today(),'date','required')}<label>配送業者<select aria-label="配送業者" name="carrier_id">${options(state.boot.carriers.filter(c=>c.active),state.boot.clients.find(c=>c.id===state.detail.header.client_id)?.default_carrier_id||'','未設定')}</select></label>${field('伝票番号','tracking_no','','text','maxlength="120"')}<label class="full">備考<textarea name="notes" maxlength="2000"></textarea></label></div><div class="section-heading"><h3>出荷明細</h3></div><div class="table-wrap"><table class="ship-table"><thead><tr><th></th><th>商品</th><th>残数</th><th>今回出荷</th></tr></thead><tbody>${items.map(i=>`<tr data-ship-item="${i.id}"><td><input type="checkbox" name="include" aria-label="${esc(i.product_name)}を出荷" checked></td><td>${esc(i.product_name)}<small>${esc(i.specification)}</small></td><td class="numeric">${number(remaining(i))} ${esc(i.unit)}</td><td><input class="quantity-input" name="quantity" aria-label="${esc(i.product_name)}の出荷数量" inputmode="decimal" value="${remaining(i)}"></td></tr>`).join('')}</tbody></table></div><div class="dialog-actions">${button('close-action','戻る','left')}<button type="submit" class="primary">${icon('truck')}出荷を登録</button></div></form>`);}
function voidDialog(id){actionDialog('出荷記録を取消',`<form id="void-form" data-shipment="${id}" novalidate><label>取消理由<textarea name="reason" maxlength="2000" required></textarea></label><div class="dialog-actions">${button('close-action','戻る','left')}<button class="danger" type="submit">${icon('reset')}出荷取消</button></div></form>`);}
function closeAction(){if(state.actionDirty&&!confirm('入力中の内容を破棄して閉じますか？'))return;state.actionDirty=false;$('action-dialog').close();}
function closeOrder(){if(state.dirty&&!confirm('未保存の内容を破棄して閉じますか？'))return;state.dirty=false;state.progressDrafts.clear();$('order-dialog').close();}

const masterNames={products:'商品一覧',clients:'取引先一覧',carriers:'配送業者一覧'};
function renderMaster(){
  state.load++;
  const kind=state.master,query=state.masterQuery.toLocaleLowerCase();
  const productNames=ids=>(ids||[]).map(id=>state.boot.products.find(p=>p.id===id)).filter(Boolean).map(p=>p.name).join('、');
  const carrierName=id=>state.boot.carriers.find(c=>c.id===id)?.name||'';
  const rows=state.boot[kind].filter(r=>[r.code,r.name,r.store_name,r.postal_code,r.address,r.specification,departments[r.department],productNames(r.product_ids),carrierName(r.default_carrier_id)].join(' ').toLocaleLowerCase().includes(query));
  const columns=kind==='products'?['JANコード','カテゴリ','商品名','規格','入数','大箱入数']:kind==='clients'?['コード','名称','店舗名','担当者','電話番号','郵便番号','住所','取扱商品','基本の配送業者']:['コード','名称'];
  const values=r=>kind==='products'?[r.code,departments[r.department],r.name,r.specification,r.pack_size==null?'—':number(r.pack_size),r.case_pack_size==null?'—':number(r.case_pack_size)]:kind==='clients'?[r.code,r.name,r.store_name,r.contact_name,r.phone,r.postal_code,r.address,productNames(r.product_ids),carrierName(r.default_carrier_id)]:[r.code,r.name];
  $('view').removeAttribute('aria-busy');
  $('view').innerHTML=`<div class="page-heading"><h2>マスタ</h2>${capabilities().canMaster?button('new-master','追加','plus','primary'):''}</div>
    <div class="segments" role="group" aria-label="マスタの種類">${Object.entries(masterNames).map(([key,label])=>`<button type="button" data-action="master-kind" data-kind="${key}" class="${key===kind?'active':''}" aria-pressed="${key===kind}">${label}</button>`).join('')}</div>
    <form id="master-filter" class="filters"><label class="wide">検索<input type="search" name="q" value="${esc(state.masterQuery)}" placeholder="${kind==='products'?'JANコード・商品名・カテゴリ':kind==='clients'?'名称・店舗名・取扱商品':'コード・名称'}"></label><button type="submit" class="primary">${icon('search')}検索</button></form>
    <div class="table-wrap"><table class="master-table ${kind}"><thead><tr>${columns.map(c=>`<th>${c}</th>`).join('')}<th>有効</th>${capabilities().canMaster?'<th>操作</th>':''}</tr></thead><tbody>${rows.map(r=>`<tr class="${r.active?'':'inactive'}">${values(r).map(v=>`<td>${esc(v)}</td>`).join('')}<td>${r.active?'有効':'無効'}</td>${capabilities().canMaster?`<td><button class="icon-button" type="button" data-action="edit-master" data-id="${r.id}" title="編集" aria-label="${esc([r.name,r.store_name].filter(Boolean).join(' '))}を編集">${icon('edit')}</button></td>`:''}</tr>`).join('')}</tbody></table>${rows.length?'':'<div class="empty">登録がありません</div>'}</div>`;
}
function masterDialog(id){
  if(!capabilities().canMaster)return;
  const kind=state.master;
  const record=state.boot[kind].find(r=>r.id===id)||{id:'',revision:0,code:'',name:'',active:true,department:'dry',specification:'',pack_size:null,case_pack_size:null,store_name:'',contact_name:'',phone:'',postal_code:'',address:'',default_carrier_id:'',product_ids:[]};
  let fields;
  if(kind==='products'){
    fields=`${field('JANコード','code',record.code,'text','required maxlength="40" inputmode="numeric"')}
      <label>カテゴリ<select aria-label="カテゴリ" name="department">${deptOptions(record.department)}</select></label>
      ${field('商品名','name',record.name,'text','required maxlength="160"')}${field('規格','specification',record.specification,'text','maxlength="200"')}
      ${field('入数','pack_size',record.pack_size??'','text','inputmode="numeric" maxlength="6"')}${field('大箱入数','case_pack_size',record.case_pack_size??'','text','inputmode="numeric" maxlength="6"')}`;
  }else{
    fields=`${field('コード','code',record.code,'text','required maxlength="40"')}${field('名称','name',record.name,'text','required maxlength="160"')}`;
    if(kind==='clients'){
      const selected=new Set(record.product_ids||[]);
      const products=state.boot.products.filter(p=>p.active||selected.has(p.id));
      fields+=`${field('店舗名','store_name',record.store_name,'text','maxlength="160"')}${field('担当者','contact_name',record.contact_name,'text','maxlength="100"')}
        ${field('電話番号','phone',record.phone,'tel','maxlength="60"')}${field('郵便番号','postal_code',record.postal_code,'text','inputmode="numeric" maxlength="8" autocomplete="postal-code"')}
        <label class="full">住所<input name="address" value="${esc(record.address)}" maxlength="500"></label>
        <label class="full">基本の配送業者<select name="default_carrier_id" aria-label="基本の配送業者">${options(state.boot.carriers.filter(c=>c.active||c.id===record.default_carrier_id).map(c=>({...c,label:c.name+(c.active?'':'（無効）')})),record.default_carrier_id,'未設定')}</select></label>
        <fieldset class="product-choices full"><legend>取扱商品</legend><label>商品検索<input type="search" id="product-choice-filter" aria-label="取扱商品を検索" placeholder="JANコード・商品名・カテゴリ"></label>
        <div class="product-choice-list">${products.map(p=>`<label class="product-choice" data-product-search="${esc([p.code,p.name,p.specification,departments[p.department]].join(' ').toLocaleLowerCase())}"><input type="checkbox" name="product_ids" value="${p.id}" aria-label="${esc(p.name+'（'+p.code+'）')}" ${selected.has(p.id)?'checked':''}><span><strong>${esc(p.name)}${p.active?'':'（無効）'}</strong><small>${esc([p.code,departments[p.department],p.specification].filter(Boolean).join(' / '))}</small></span></label>`).join('')}${products.length?'':'<div class="empty">登録がありません</div>'}</div><div id="product-choice-empty" class="empty" hidden>該当する商品はありません</div></fieldset>`;
    }
  }
  actionDialog(masterNames[kind]+'・'+(id?'編集':'追加'),`<form id="master-form" data-kind="${kind}" data-id="${record.id}" data-revision="${record.revision}" novalidate><div class="form-grid">${fields}<label class="check"><input name="active" type="checkbox" ${record.active?'checked':''}>有効</label></div><div class="dialog-actions">${button('close-action','取消','close')}<button class="primary" type="submit">${icon('save')}保存</button></div></form>`);
}

document.addEventListener('click',async event=>{
  const nav=event.target.closest('[data-view]');if(nav){activateView(nav.dataset.view);return;}
  const control=event.target.closest('[data-action]');const action=control?.dataset.action;
  if(!action){const row=event.target.closest('tr[data-order]');if(row)void openOrder(row.dataset.order);return;}
  if(action==='dismiss-notice'){notice('');return;}
  if(action==='new-order'){newOrder();return;}
  if(action==='open-order'){void openOrder(control.dataset.id);return;}
  if(action==='close-order'){closeOrder();return;}
  if(action==='close-action'){closeAction();return;}
  if(action==='edit-order'){editOrder();return;}
  if(action==='add-item'){if(state.draft.items.length>=100){showError('order-error',new Error('明細は100行までです。'));return;}state.draft.items.push({id:crypto.randomUUID(),product_id:'',quantity:'1'});state.dirty=true;renderDraft();return;}
  if(action==='remove-item'){state.draft.items=state.draft.items.filter(i=>i.id!==control.dataset.id);state.dirty=true;renderDraft();return;}
  if(action==='approve-order'){decisionDialog('approve');return;}if(action==='return-order'){decisionDialog('return');return;}if(action==='cancel-order'){decisionDialog('cancel');return;}
  if(action==='ship-order'){shipmentDialog();return;}if(action==='void-shipment'){voidDialog(control.dataset.id);return;}
  if(action==='new-master'){masterDialog();return;}if(action==='edit-master'){masterDialog(control.dataset.id);return;}
  if(action==='master-kind'){state.master=control.dataset.kind;state.masterQuery='';renderMaster();return;}
  if(action==='clear-filters'){state.filters[state.view]={q:'',department:'',status:state.view==='approval'?'pending':'',start:'',end:'',mine:false,open:false,offset:0};void loadList();return;}
  if(action==='previous-page'||action==='next-page'){state.filters[state.view].offset+=action==='next-page'?50:-50;void loadList();return;}
  if(action==='detail-refresh'){if(state.dirty&&!confirm('未保存の内容を破棄して更新しますか？'))return;await openOrder(state.detail.header.id);return;}
  if(action==='refresh'){await busy($('view'),async()=>{await bootstrap();await loadList();syncLabel();});return;}
  if(action==='logout'){if(!confirm('ログアウトしますか？'))return;await busy($('view'),async()=>{await auth.logout();location.href='../menu.html?openExternalBrowser=1';});}
});
document.addEventListener('input',event=>{
  if(event.target.id==='product-choice-filter'){
    const query=event.target.value.trim().toLocaleLowerCase();
    const choices=[...document.querySelectorAll('[data-product-search]')];
    choices.forEach(label=>label.hidden=!label.dataset.productSearch.includes(query));
    $('product-choice-empty').hidden=!choices.length||choices.some(label=>!label.hidden);
    return;
  }
  if(event.target.closest('#action-dialog'))state.actionDirty=true;
  if(event.target.dataset.header&&state.draft){const name=event.target.dataset.header;if(!['department','client_id'].includes(name))state.draft.header[name]=event.target.value;state.dirty=true;}
  if(event.target.dataset.quantity&&state.draft){const row=state.draft.items.find(i=>i.id===event.target.dataset.quantity);if(row)row.quantity=event.target.value;state.dirty=true;}
  const progress=event.target.closest('[data-progress]');if(progress){state.progressDrafts.set(progress.dataset.progress,{status:progress.elements.status.value,note:progress.elements.note.value});state.dirty=true;}
});
document.addEventListener('change',event=>{
  const target=event.target;
  if(target.dataset.header==='department'&&state.draft){if(state.draft.items.some(i=>i.product_id)&&!confirm('部署を変更し、商品明細をリセットしますか？')){target.value=state.draft.header.department;return;}state.draft.header.department=target.value;state.draft.items=[{id:crypto.randomUUID(),product_id:'',quantity:'1'}];state.dirty=true;renderDraft();}
  if(target.dataset.header==='client_id'&&state.draft){const client=state.boot.clients.find(c=>c.id===target.value);state.draft.header.client_id=target.value;if(client){state.draft.header.delivery_name=client.store_name||client.name;state.draft.header.delivery_address=[client.postal_code,client.address].filter(Boolean).join(' ');state.draft.header.delivery_phone=client.phone;}state.dirty=true;renderDraft();}
  if(target.dataset.product&&state.draft){state.draft.items.find(i=>i.id===target.dataset.product).product_id=target.value;state.dirty=true;renderDraft();}
  const shipmentRow=target.closest('[data-ship-item]');if(shipmentRow&&target.name==='include')shipmentRow.querySelector('[name="quantity"]').disabled=!target.checked;
});
document.addEventListener('submit',async event=>{
  const form=event.target;event.preventDefault();
  if(form.id==='filter-form'){const values=Object.fromEntries(new FormData(form));if(values.start&&values.end&&values.start>values.end){notice('開始日は終了日以前にしてください。',true);return;}state.filters[state.view]={...state.filters[state.view],...values,mine:values.mine==='on',open:values.open==='on',offset:0};void loadList();return;}
  if(form.id==='master-filter'){state.masterQuery=form.elements.q.value;renderMaster();return;}
  if(form.id==='draft-form'){const submit=event.submitter?.value==='submit';await busy($('order-dialog'),async()=>{const d=state.draft;if(!d.header.client_id||!d.header.delivery_name.trim()||!d.header.ordered_on||!d.header.requested_ship_date)throw new Error('取引先・納品先・注文日・出荷希望日を入力してください。');if(!d.items.length||d.items.some(i=>!i.product_id))throw new Error('商品を選択してください。');const items=d.items.map(i=>({...i,quantity:quantity(i.quantity)}));const data=await rpc('orders_save',{p_order_id:d.id,p_revision:d.revision,p_header:d.header,p_items:items,p_submit:submit});state.progressDrafts.clear();await applyDetail(data,submit?'承認を依頼しました。':'下書きを保存しました。');},'order-error');return;}
  if(form.dataset.progress){await busy($('order-dialog'),async()=>{const data=await rpc('orders_progress',{p_order_id:state.detail.header.id,p_revision:state.detail.header.revision,p_item_id:form.dataset.progress,p_status:form.elements.status.value,p_note:form.elements.note.value});state.progressDrafts.delete(form.dataset.progress);await applyDetail(data,'進捗を保存しました。');},'order-error');return;}
  if(form.id==='master-form'){const values=new FormData(form),data=Object.fromEntries(values);data.active=form.elements.active.checked;if(form.dataset.kind==='clients')data.product_ids=values.getAll('product_ids');if(form.dataset.kind==='products')for(const key of ['pack_size','case_pack_size'])data[key]=String(data[key]??'').normalize('NFKC').trim();await busy($('action-dialog'),async()=>{state.boot=await rpc('orders_save_master',{p_kind:form.dataset.kind,p_id:form.dataset.id||null,p_revision:Number(form.dataset.revision),p_data:data});state.version=state.boot.version;state.actionDirty=false;$('action-dialog').close();renderMaster();notice('マスタを保存しました。');},'action-error');return;}
  if(form.id==='decision-form'){await busy($('action-dialog'),async()=>{const data=await rpc('orders_decide',{p_order_id:state.detail.header.id,p_revision:state.detail.header.revision,p_action:form.dataset.decision,p_reason:form.elements.reason?.value||''});state.actionDirty=false;$('action-dialog').close();await applyDetail(data,'注文の状態を更新しました。');},'action-error');return;}
  if(form.id==='shipment-form'){await busy($('action-dialog'),async()=>{const values={shipped_on:form.elements.shipped_on.value,carrier_id:form.elements.carrier_id.value,tracking_no:form.elements.tracking_no.value,notes:form.elements.notes.value};const items=[...form.querySelectorAll('[data-ship-item]')].filter(row=>row.querySelector('[name="include"]').checked).map(row=>({item_id:row.dataset.shipItem,quantity:quantity(row.querySelector('[name="quantity"]').value)}));if(!items.length)throw new Error('出荷する明細を選択してください。');const data=await rpc('orders_ship',{p_order_id:state.detail.header.id,p_revision:state.detail.header.revision,p_shipment_id:form.dataset.shipment,p_data:{...values,carrier_id:values.carrier_id||null,items}});state.actionDirty=false;$('action-dialog').close();await applyDetail(data,'出荷を登録しました。');},'action-error');return;}
  if(form.id==='void-form'){await busy($('action-dialog'),async()=>{const data=await rpc('orders_void_shipment',{p_order_id:state.detail.header.id,p_revision:state.detail.header.revision,p_shipment_id:form.dataset.shipment,p_reason:form.elements.reason.value});state.actionDirty=false;$('action-dialog').close();await applyDetail(data,'出荷記録を取消しました。');},'action-error');}
});
$('order-dialog').addEventListener('cancel',event=>{event.preventDefault();closeOrder();});
$('action-dialog').addEventListener('cancel',event=>{event.preventDefault();closeAction();});
async function synchronize(){if(!state.session||!state.boot||state.syncing||document.hidden||document.activeElement?.closest('#filter-form,#master-filter'))return;state.syncing=true;try{const result=await rpc('orders_version');const permissionsChanged=['canOperate','canApprove','canMaster'].some(key=>result[key]!==state.boot[key]);if(result.version!==state.version||permissionsChanged){await bootstrap();await loadList();if(state.detail&&$('order-dialog').open&&!state.draft){const fresh=await rpc('orders_detail',{p_order_id:state.detail.header.id});if(fresh.header.revision!==state.detail.header.revision){if(!state.dirty&&!$('action-dialog').open){state.detail=fresh;state.detailNotice='';renderDetail();}else $('order-subtitle').textContent='他の担当者が更新しました';}else if(permissionsChanged){renderDetail();}}}syncLabel();}catch{syncLabel(true);}finally{state.syncing=false;}}
async function start(){try{state.session=await auth.session();if(!state.session){if(!auth.getToken()){location.replace('../menu.html?openExternalBrowser=1');return;}throw new Error('ログインを確認できません。接続を確認してください。');}if(!auth.allows(state.session,'black_garlic_shipping')){location.replace('../menu.html?openExternalBrowser=1');return;}$('worker').textContent=state.session.workerName+' / '+({admin:'管理者',operator:'作業者',viewer:'閲覧者'}[state.session.permissions.black_garlic_shipping]||'');await bootstrap();await loadList();syncLabel();}catch(error){$('view').removeAttribute('aria-busy');$('view').innerHTML=`<div class="connection-error"><p>${esc(error.message)}</p><button type="button" class="secondary" data-action="retry">${icon('refresh')}再試行</button></div>`;syncLabel(true);}}
document.addEventListener('click',event=>{if(event.target.closest('[data-action="retry"]'))void start();});
window.addEventListener('online',()=>void synchronize());
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void synchronize();});
setInterval(()=>void synchronize(),4000);
setInterval(()=>{if(!document.hidden)void auth.session();},240000);
void start();
