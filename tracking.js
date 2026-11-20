import { firebaseConfig } from './firebase-config.js';
const $ = id => document.getElementById(id);
const stationForm = $('stationForm'), trackingForm = $('trackingForm');
const statuses = ['已下單','備貨中','已出貨','已到集運站','集運中','已送達','已取消'];
const stationSchema = [
  ['name','集運站名稱','text',true], ['recipient','收件人','text'],
  ['phone','聯絡電話','tel'], ['address','集運站地址','text'],
  ['memberCode','會員／入庫識別碼','text'], ['notes','備註','text']
];
const trackingSchema = [
  ['status','訂單狀態',statuses,true], ['website','下單網站','text',true],
  ['item','項目／商品','text',true], ['orderNo','訂單編號','text',true],
  ['amount','訂單總金額','number',true], ['currency','幣別',['TWD','CNY','USD','KRW','JPY','THB','HKD'],true],
  ['orderDate','下單日期','date',true], ['shipDate','送貨日期（出貨日）','date'],
  ['arrivalDate','送達日期（實際到貨日）','date'],
  ['payment','支付方式',['信用卡','銀行轉帳','貨到付款','預付款','電子支付','其他'],true],
  ['stationId','集運站',[]], ['trackingNo','物流單號','text'], ['notes','備註','text']
];
function fields(schema, container) {
  for (const [name,title,type,required] of schema) {
    const label=document.createElement('label'); label.append(title+(required?' *':''));
    const input=document.createElement(Array.isArray(type)?'select':'input');
    input.name=name; input.required=!!required;
    if (Array.isArray(type)) { for (const value of type) input.add(new Option(value,value)); }
    else input.type=type;
    if (type==='number') { input.min='0'; input.step='0.01'; }
    if (type==='text'||type==='tel') input.maxLength=name==='name'?120:1000;
    label.append(input); $(container).append(label);
  }
}
fields(stationSchema,'stationFields'); fields(trackingSchema,'trackingFields');
for (const s of statuses) $('trackingFilter').add(new Option(s,s));
let user=null, db, api, stations=[], records=[], stationEdit=null, trackingEdit=null, stops=[];
function panel(view) {
  for(const [id,name] of [['hub','hub'],['ordersPanel','orders'],['trackingPanel','tracking']]) $(id).hidden=view!==name;
  $('crumb').hidden=view==='hub'; $('crumbTitle').textContent=view==='orders'?'訂單管理':'訂單追蹤'; window.scrollTo(0,0);
    }
$('showOrders').onclick=()=>panel('orders'); $('showTracking').onclick=()=>panel('tracking'); $('backHub').onclick=()=>panel('hub');
function notice(id,text) { $(id).textContent=text; }
function fail(id,e) { notice(id,e.code==='permission-denied'?'沒有存取權限，請發布包含 stations 與 tracking 的新版 Firestore 規則。':'操作失敗：'+(e.message||e)); }
function collection(name) { return api.collection(db,'users',user.uid,name); }
function doc(name,id) { return api.doc(db,'users',user.uid,name,id); }
function values(schema,form) { return Object.fromEntries(schema.map(([k])=>[k,form.elements[k].value.trim()])); }
function today() { return new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10); }
function resetTracking() { trackingEdit=null;trackingForm.reset();trackingForm.elements.orderDate.value=today();$('trackingTitle').textContent='新增追蹤訂單';stationOptions(''); }
function resetStation() { stationEdit=null;stationForm.reset();$('saveStation').textContent='儲存集運站'; }
$('cancelStation').onclick=resetStation; $('cancelTracking').onclick=resetTracking;
function selectedStation() { return stations.find(s=>s.id===trackingForm.elements.stationId.value); }
function stationDetail() {
  const s=selectedStation() || (trackingEdit && records.find(r=>r.id===trackingEdit)?.stationSnapshot);
  $('stationDetail').textContent=s?.name?[s.name,s.recipient,s.phone,s.address,s.memberCode].filter(Boolean).join(' · '):'';
}
trackingForm.elements.stationId.onchange=stationDetail;
function stationOptions(selected=trackingForm.elements.stationId.value) {
  const select=trackingForm.elements.stationId;select.replaceChildren(new Option('不使用集運／直送',''));
  for (const s of stations) select.add(new Option(s.name,s.id));
  if (selected && !stations.some(s=>s.id===selected)) {
    const old=records.find(r=>r.id===trackingEdit);
    select.add(new Option((old?.stationName||'原集運站')+'（已移除）',selected));
  }
  select.value=selected;stationDetail();
}
function button(text,action) { const b=document.createElement('button');b.type='button';b.textContent=text;b.onclick=action;return b; }
function renderStations() {
  $('stationList').replaceChildren();
  for (const s of stations) {
    const li=document.createElement('li'); const name=document.createElement('strong');name.textContent=s.name;
    const detail=document.createElement('p');detail.textContent=[s.recipient,s.phone,s.address,s.memberCode,s.notes].filter(Boolean).join(' · ');
    li.append(name,detail,button('編輯',()=>{stationEdit=s.id;for(const [k]of stationSchema)stationForm.elements[k].value=s[k]||'';$('saveStation').textContent='更新集運站';stationForm.scrollIntoView({behavior:'smooth'});}),button('移除',async()=>{
      if(!confirm('移除集運站？既有追蹤訂單的集運站資訊會保留。'))return;
      try{await api.deleteDoc(doc('stations',s.id));if(stationEdit===s.id)resetStation();}catch(e){fail('stationMessage',e);}
    })); $('stationList').append(li);
  }
  stationOptions();
}
function renderRecords() {
  const query=$('trackingSearch').value.toLowerCase(),status=$('trackingFilter').value;
  const list=records.filter(r=>(!status||r.status===status)&&[r.website,r.item,r.orderNo,r.stationName,r.trackingNo].some(v=>String(v||'').toLowerCase().includes(query)));
  $('hubTracking').textContent=records.length+' 筆追蹤 · '+records.filter(r=>!['已送達','已取消'].includes(r.status)).length+' 筆進行中';
  $('trackingRows').replaceChildren();$('trackingEmpty').hidden=!!list.length;
  for(const r of list){
    const tr=document.createElement('tr');
    for(const value of [r.status,r.website+' ／ '+r.item,r.orderNo,r.amount.toLocaleString('zh-TW')+' '+r.currency,r.orderDate,r.shipDate,r.arrivalDate,r.payment,(r.stationName||'直送')+' ／ '+(r.trackingNo||'')]){const td=tr.insertCell();td.textContent=value;}
    tr.cells[0].replaceChildren(Object.assign(document.createElement('span'),{className:'badge',textContent:r.status}));tr.cells[0].firstChild.dataset.s=r.status;
    tr.insertCell().append(button('編輯',()=>{trackingEdit=r.id;stationOptions(r.stationId);for(const [k]of trackingSchema)trackingForm.elements[k].value=r[k]??'';stationDetail();$('trackingTitle').textContent='編輯追蹤訂單';trackingForm.scrollIntoView({behavior:'smooth'});}),button('刪除',async()=>{
      if(!confirm('確定刪除追蹤訂單 '+r.orderNo+'？'))return;
      try{await api.deleteDoc(doc('tracking',r.id));if(trackingEdit===r.id)resetTracking();}catch(e){fail('trackingMessage',e);}
    }));$('trackingRows').append(tr);
  }
}
$('trackingSearch').oninput=renderRecords;$('trackingFilter').onchange=renderRecords;
stationForm.onsubmit=async e=>{
  e.preventDefault();if(!user)return;
  const d=values(stationSchema,stationForm);if(!d.name)return notice('stationMessage','請輸入集運站名稱。');
  $('saveStation').disabled=true;notice('stationMessage','正在儲存集運站…');
  try{if(stationEdit)await api.updateDoc(doc('stations',stationEdit),{...d,updatedAt:api.serverTimestamp()});else await api.addDoc(collection('stations'),{...d,createdAt:api.serverTimestamp(),updatedAt:api.serverTimestamp()});resetStation();notice('stationMessage','集運站已儲存。');}catch(e){fail('stationMessage',e);}finally{$('saveStation').disabled=false;}
};
trackingForm.onsubmit=async e=>{
  e.preventDefault();if(!user)return;
  const d=values(trackingSchema,trackingForm);d.amount=Number(d.amount);
  if(!d.website||!d.item||!d.orderNo||!d.orderDate||!Number.isFinite(d.amount)||d.amount<0)return notice('trackingMessage','請填寫必填欄位與有效金額。');
  if((d.shipDate&&d.shipDate<d.orderDate)||(d.arrivalDate&&d.arrivalDate<(d.shipDate||d.orderDate)))return notice('trackingMessage','請確認日期順序：下單日期、送貨日期、送達日期。');
  const station=selectedStation(),old=records.find(r=>r.id===trackingEdit);
  d.stationSnapshot=station?values(stationSchema,{elements:Object.fromEntries(stationSchema.map(([k])=>[k,{value:station[k]||''}]))}):(d.stationId?old?.stationSnapshot||{}:{});
  d.stationName=d.stationSnapshot.name||'';d.updatedAt=api.serverTimestamp();
  $('saveTracking').disabled=true;notice('trackingMessage','正在儲存追蹤訂單…');
  try{if(trackingEdit)await api.updateDoc(doc('tracking',trackingEdit),d);else await api.addDoc(collection('tracking'),{...d,createdAt:api.serverTimestamp()});resetTracking();notice('trackingMessage','追蹤訂單已儲存。');}catch(e){fail('trackingMessage',e);}finally{$('saveTracking').disabled=false;}
};
async function start(){
  if(!firebaseConfig.apiKey||!firebaseConfig.projectId)return;
  try{
    const [app,auth,firestore]=await Promise.all([import('https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js'),import('https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js'),import('https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js')]);
    api=firestore;const instance=app.getApps().length?app.getApp():app.initializeApp(firebaseConfig);db=api.getFirestore(instance);
    auth.onAuthStateChanged(auth.getAuth(instance),u=>{
      stops.forEach(stop=>stop());stops=[];user=u;stations=[];records=[];resetStation();resetTracking();renderStations();renderRecords();panel('hub');
      if(!u){notice('stationMessage','請先登入。');notice('trackingMessage','請先登入。');return;}
      notice('stationMessage','正在載入集運站…');notice('trackingMessage','正在載入追蹤訂單…');
      stops.push(api.onSnapshot(api.query(collection('stations'),api.orderBy('createdAt','desc')),s=>{stations=s.docs.map(d=>({...d.data(),id:d.id}));renderStations();notice('stationMessage','已同步 '+stations.length+' 個集運站。');},e=>fail('stationMessage',e)));
      stops.push(api.onSnapshot(api.query(collection('tracking'),api.orderBy('createdAt','desc')),s=>{records=s.docs.map(d=>({...d.data(),id:d.id}));renderRecords();notice('trackingMessage','已同步 '+records.length+' 筆追蹤訂單。');},e=>fail('trackingMessage',e)));
    });
  }catch(e){fail('trackingMessage',e);}
}
resetTracking();start();
