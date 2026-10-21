export const departments={dry:'乾燥にんにく',black:'黒にんにく',processed:'にんにく加工品'};
export const statuses={draft:'下書き',pending:'承認待ち',returned:'差戻し',confirmed:'未着手',working:'作業中',ready:'出荷準備完了',partial:'一部出荷',shipped:'出荷済み',cancelled:'取消'};
export const workStatuses={unstarted:'未着手',working:'作業中',ready:'出荷準備完了'};
export const eventNames={created:'注文作成',saved:'注文変更',submitted:'承認依頼',approved:'注文確定',returned:'差戻し',cancelled:'注文取消',progress:'進捗更新',shipped:'出荷登録',shipment_voided:'出荷取消'};
export const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const number=value=>Number(value??0).toLocaleString('ja-JP',{maximumFractionDigits:3});
export const remaining=item=>Math.round((Number(item.quantity)-Number(item.shipped_quantity??0))*1000)/1000;
export const orderNumber=value=>'J-'+String(value).padStart(6,'0');
export const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
export const date=value=>value?String(value).slice(0,10).replaceAll('-','/'):'—';
export const time=value=>value?new Date(value).toLocaleString('ja-JP',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'—';
export function quantity(value){const text=String(value).normalize('NFKC').replaceAll(',','').trim();if(!/^\d+(\.\d{1,3})?$/.test(text)||Number(text)<=0||Number(text)>99999999999.999)throw new Error('数量は0より大きい数値（小数3桁まで）で入力してください。');return Number(text);}
