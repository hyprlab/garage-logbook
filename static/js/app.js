/* Garage Logbook: the whole client. Server-rendered shell, data over /api. */

let currentCarId=null,currentView=null,maintSort='date_desc',carsCache=[],pendingRecordId=null;
let lightboxImages=[],lightboxIndex=0;
let userSettings={dashboard_range:'all',show_vehicles:true,show_records:true,show_cost:true,show_due:true,theme:'dark'};
const PERM_LABELS={can_add_cars:'Add vehicles',can_edit_cars:'Edit vehicles',can_delete_cars:'Delete vehicles',can_add_records:'Add records',can_edit_records:'Edit records',can_delete_records:'Delete records',can_import:'Import CSV',can_export:'Export records'};
const RANGE_LABELS={all:'All time',year:'This year',month:'This month'};
const TYPES=['Maintenance','Repair','Upgrade','Inspection'];
const MONTH_DAYS=30.44;
const $=id=>document.getElementById(id);
const ic=(n,c='')=>`<svg class="i ${c}" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const reducedMotion=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;

document.addEventListener('DOMContentLoaded',()=>{
    applyPermVisibility();populateUserMenu();initMenus();
    document.querySelectorAll('[data-vendor-combo]').forEach(initVendorCombo);loadVendors();initPartsForm();
    loadSettings().then(()=>{applyTheme();syncRangeMenu();route();loadSidebarCars()});
    window.addEventListener('hashchange',route);
    if(CURRENT_USER.must_change_password)openModal('forceChangePwModal');
});

// ————— Helpers —————
function esc(s){if(s==null||s==='')return'';const d=document.createElement('div');d.textContent=String(s);return d.innerHTML}
function attr(s){return esc(s).replace(/"/g,'&quot;')}
function formatDate(s,opts){if(!s)return'—';const d=new Date(s+(s.includes('T')?'':'T00:00:00'));return d.toLocaleDateString('en-US',opts||{year:'numeric',month:'short',day:'numeric'})}
function shortDate(s){if(!s)return'—';const d=new Date(s+'T00:00:00'),now=new Date();return d.toLocaleDateString('en-US',d.getFullYear()===now.getFullYear()?{month:'short',day:'numeric'}:{year:'numeric',month:'short',day:'numeric'})}
function n(v){return Number(v).toLocaleString('en-US')}
function money(v,dec=2){return'$'+Number(v||0).toLocaleString('en-US',{minimumFractionDigits:dec,maximumFractionDigits:dec})}
function moneySplit(v){const s=money(v),i=s.lastIndexOf('.');return i<0?s:`${s.slice(0,i)}<small>${s.slice(i)}</small>`}
function moneyAxis(v){return v>=10000?'$'+Math.round(v/1000)+'K':v>=1000?'$'+(v/1000).toFixed(1).replace(/\.0$/,'')+'K':'$'+Math.round(v)}
function plural(k,one,many){return`${n(k)} ${k===1?one:(many||one+'s')}`}
function typeClass(t){return't-'+String(t||'maintenance').toLowerCase()}
function debounce(fn,ms=300){let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms)}}
async function api(url,opts){const r=await fetch(url,opts);if(r.status===401){window.location.href='/login';throw new Error('Signed out')}return r}
async function getJSON(url){const r=await api(url);if(!r.ok)throw new Error('Could not load '+url);return r.json()}
async function errorOf(r,fallback){try{return(await r.json()).error||fallback}catch(e){return fallback}}
function hasPerm(p){return USER_PERMS[p]===true}
function initials(s){return(s||'?').split(/\s+/).map(w=>w[0]).join('').slice(0,2).toUpperCase()}

function applyPermVisibility(){
    document.querySelectorAll('.admin-only').forEach(el=>{if(CURRENT_USER.role!=='admin')el.hidden=true});
    Object.keys(PERM_LABELS).forEach(p=>{document.querySelectorAll('.perm-'+p).forEach(el=>{if(!USER_PERMS[p])el.hidden=true})});
}
function populateUserMenu(){
    const name=CURRENT_USER.display_name||CURRENT_USER.username;
    $('userAvatar').textContent=initials(name);$('userName').textContent=name;$('userRole').textContent=CURRENT_USER.role;
    $('profileAvatar').textContent=initials(name);$('profileName').textContent=name;
    $('profileSub').textContent='@'+CURRENT_USER.username+(CURRENT_USER.role==='admin'?', administrator':', editor');
}

// ————— Routing: every page has an address —————
function route(){
    const h=location.hash.replace(/^#\/?/,'');let m;
    if((m=h.match(/^car\/(\d+)(?:\/record\/(\d+))?$/))){if(m[2])pendingRecordId=+m[2];return showCar(+m[1])}
    showView(h==='garage'?'garage':'dashboard');
}
function go(h){if(location.hash==='#'+h)route();else location.hash=h}
function switchView(v){go(v==='car-detail'&&currentCarId?'car/'+currentCarId:v)}
function showView(v,title){
    const changed=currentView!==v;currentView=v;
    document.querySelectorAll('.view').forEach(el=>el.classList.toggle('is-active',el.id==='view-'+v));
    document.querySelectorAll('.navitem').forEach(b=>b.classList.toggle('is-active',b.dataset.view===v));
    document.querySelectorAll('.topbar-actions').forEach(a=>a.classList.toggle('is-active',a.dataset.for===v));
    if(v!=='car-detail'){currentCarId=null;setActiveSidebarCar(null);selectedIds.clear();$('selBar').hidden=true}
    const titles={dashboard:'Dashboard',garage:'My Garage'};
    $('contextTitle').innerHTML=title||esc(titles[v]);
    document.title=(v==='car-detail'?$('contextTitle').textContent.split('/').pop().trim():titles[v])+' · Garage Logbook';
    if(v==='dashboard')loadDashboard();
    if(v==='garage')loadCars();
    toggleSidebar(false);closeMenus();
    if(changed)window.scrollTo(0,0);
}
function toggleSidebar(open){
    $('sidebar').classList.toggle('is-open',open);$('scrim').hidden=!open;
}

// ————— Theme —————
const darkQuery=matchMedia('(prefers-color-scheme: dark)');
function resolvedTheme(){const t=userSettings.theme||'dark';return t==='system'?(darkQuery.matches?'dark':'light'):t}
function applyTheme(){
    document.documentElement.setAttribute('data-theme',resolvedTheme());
    try{localStorage.setItem('gl-theme',userSettings.theme||'dark')}catch(e){}
    document.querySelectorAll('input[name="theme"]').forEach(r=>{r.checked=r.value===(userSettings.theme||'dark')});
}
darkQuery.addEventListener('change',()=>{if(userSettings.theme==='system')applyTheme()});
function setTheme(t){userSettings.theme=t;applyTheme();saveSettings()}
function toggleTheme(){setTheme(resolvedTheme()==='dark'?'light':'dark')}

// ————— Settings storage —————
async function loadSettings(){try{const r=await api('/api/settings');if(r.ok)userSettings=Object.assign(userSettings,await r.json())}catch(e){}}
async function saveSettings(){
    try{const r=await api('/api/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(userSettings)});if(!r.ok)throw new Error()}
    catch(e){toast('Your settings could not be saved. Check the connection and try again.','error')}
}
function loadSettingsUI(){
    $('settingShowVehicles').checked=userSettings.show_vehicles!==false;
    $('settingShowRecords').checked=userSettings.show_records!==false;
    $('settingShowCost').checked=userSettings.show_cost!==false;
    $('settingShowDue').checked=userSettings.show_due!==false;
    applyTheme();
}
const saveSettingsDebounced=debounce(()=>{
    Object.assign(userSettings,{show_vehicles:$('settingShowVehicles').checked,show_records:$('settingShowRecords').checked,show_cost:$('settingShowCost').checked,show_due:$('settingShowDue').checked});
    saveSettings();if(currentView==='dashboard')loadDashboard();
},250);
function syncRangeMenu(){
    const r=userSettings.dashboard_range||'all';$('rangeLabel').textContent=RANGE_LABELS[r]||'All time';
    document.querySelectorAll('[data-range]').forEach(b=>b.classList.toggle('is-active',b.dataset.range===r));
}

// ————— Menus —————
function initMenus(){
    document.querySelectorAll('.menu').forEach(menu=>{
        const btn=menu.querySelector('.menubtn'),pop=menu.querySelector('.menupop');
        btn.addEventListener('click',e=>{e.stopPropagation();const open=!menu.classList.contains('is-open');closeMenus();menu.classList.toggle('is-open',open);pop.hidden=!open;btn.setAttribute('aria-expanded',open)});
        pop.addEventListener('click',e=>{if(e.target.closest('.menuopt'))closeMenus()});
    });
    document.addEventListener('click',e=>{if(!e.target.closest('.menu'))closeMenus()});
    document.querySelectorAll('[data-range]').forEach(b=>b.addEventListener('click',()=>{
        userSettings.dashboard_range=b.dataset.range;syncRangeMenu();saveSettings();loadDashboard();
    }));
    document.querySelectorAll('[data-sort]').forEach(b=>b.addEventListener('click',()=>{
        maintSort=b.dataset.sort;syncSortMenu();loadMaintenance();
    }));
    syncSortMenu();
}
function syncSortMenu(){
    document.querySelectorAll('[data-sort]').forEach(b=>{const on=b.dataset.sort===maintSort;b.classList.toggle('is-active',on);if(on)$('sortLabel').textContent=b.textContent.trim()});
}
function closeMenus(){document.querySelectorAll('.menu.is-open').forEach(m=>{m.classList.remove('is-open');m.querySelector('.menupop').hidden=true;m.querySelector('.menubtn').setAttribute('aria-expanded','false')})}

// ————— Keyboard —————
document.addEventListener('keydown',e=>{
    const typing=/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)||e.target.isContentEditable;
    if(e.key==='Escape'){
        if($('lightbox').classList.contains('open')){closeLightbox();return}
        if(document.querySelector('.menu.is-open')){closeMenus();return}
        const top=modalStack[modalStack.length-1];
        if(top){
            if(top==='recordPanel'&&recordMode==='edit'&&viewedRecord){cancelRecordForm();return}
            if(top==='settingsModal'&&$('settingsModal').querySelector('.settings-modal').classList.contains('is-showing-pane')&&matchMedia('(max-width: 700px)').matches){settingsBack();return}
            closeModal(top);return;
        }
        if($('sidebar').classList.contains('is-open')){toggleSidebar(false);return}
        if(selectedIds.size&&currentView==='car-detail')clearSelection();
        return;
    }
    if($('lightbox').classList.contains('open')){if(e.key==='ArrowLeft')lightboxPrev();if(e.key==='ArrowRight')lightboxNext();return}
    if(typing||modalStack.length||e.metaKey||e.ctrlKey||e.altKey)return;
    if(e.key==='/'){const s=document.querySelector('.topbar-actions.is-active .search input');if(s){e.preventDefault();s.focus()}}
});

// ————— Dialogs —————
const modalStack=[];
function openModal(id){
    const el=$(id);if(!el||el.classList.contains('is-open'))return;
    clearTimeout(el._closeTimer);el.classList.remove('is-closing');el.classList.add('is-open');
    modalStack.push(id);document.documentElement.style.overflow='hidden';
    toggleSidebar(false);closeMenus();
    if(id==='settingsModal')loadSettingsUI();
}
function closeModal(id){
    if(id==='forceChangePwModal'&&CURRENT_USER.must_change_password)return;
    const el=$(id);if(!el||!el.classList.contains('is-open'))return;
    const i=modalStack.lastIndexOf(id);if(i>=0)modalStack.splice(i,1);
    if(id==='recordPanel'&&/\/record\/\d+$/.test(location.hash))history.replaceState(null,'',location.hash.replace(/\/record\/\d+$/,''));
    const done=()=>{el.classList.remove('is-open','is-closing');if(!modalStack.length)document.documentElement.style.overflow=''};
    if(el.classList.contains('overlay--side')&&!reducedMotion()){el.classList.add('is-closing');el._closeTimer=setTimeout(done,270)}
    else done();
}
// A click that both starts and ends on the backdrop closes the dialog; a text
// selection dragged out of a field does not.
let pressOnBackdrop=null;
document.addEventListener('mousedown',e=>{pressOnBackdrop=e.target.classList&&e.target.classList.contains('overlay')?e.target:null});
document.addEventListener('click',e=>{if(pressOnBackdrop&&e.target===pressOnBackdrop)closeModal(e.target.id);pressOnBackdrop=null});

// ————— Auth —————
async function doLogout(){await fetch('/api/auth/logout',{method:'POST'});window.location.href='/login'}
async function changePassword(){
    const c=$('currentPw').value,nw=$('newPw').value,c2=$('confirmPw').value;
    if(!c||!nw||!c2){toast('Fill in all three password fields.','error');return}
    if(nw!==c2){toast('The new passwords do not match.','error');return}
    if(nw.length<4){toast('The new password needs at least 4 characters.','error');return}
    try{const r=await api('/api/auth/change-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({current_password:c,new_password:nw})});if(!r.ok)throw new Error(await errorOf(r,'The password could not be changed.'));toast('Password updated');['currentPw','newPw','confirmPw'].forEach(id=>$(id).value='')}catch(e){toast(e.message,'error')}
}
async function forceChangePassword(){
    const nw=$('forceNewPw').value,c=$('forceConfirmPw').value;
    if(!nw||!c){toast('Fill in both fields.','error');return}
    if(nw!==c){toast('The passwords do not match.','error');return}
    if(nw.length<4){toast('The password needs at least 4 characters.','error');return}
    try{const r=await api('/api/auth/change-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({current_password:'admin',new_password:nw})});if(!r.ok)throw new Error(await errorOf(r,'The password could not be set.'));CURRENT_USER.must_change_password=0;toast('Password set');closeModal('forceChangePwModal')}catch(e){toast(e.message,'error')}
}

// ————— Vehicles cache, shared by the sidebar, dashboard and forms —————
async function fetchCars(){const cars=await getJSON('/api/cars');carsCache=cars;return cars}
function carName(c){return`${c.year} ${c.make} ${c.model}`}
function carThumb(c,size){return c.image?`<img src="/uploads/cars/${attr(c.image)}" alt="" loading="lazy">`:ic('car')}
function carAlert(c){const rs=c.reminders||[];return rs.some(r=>r.status==='overdue')?'overdue':rs.some(r=>r.status==='due_soon')?'due_soon':null}

async function loadSidebarCars(){
    try{
        const cars=await fetchCars();
        $('navCarCount').textContent=cars.length||'';
        $('sidebarCars').innerHTML=cars.length?cars.map(c=>{
            const due=c.reminders_due||0,alert=carAlert(c);
            return`<li><a class="sideitem" data-car="${c.id}" href="#car/${c.id}" title="${attr(carName(c))}"><span class="sideitem-thumb">${carThumb(c)}</span><span class="sideitem-title">${esc(carName(c))}</span>${due?`<span class="count ${alert==='overdue'?'count--alert':'count--warn'}" title="${plural(due,'reminder')} due">${due}</span>`:''}</a></li>`;
        }).join(''):`<li class="sidelist-empty">No vehicles yet</li>`;
        setActiveSidebarCar(currentCarId);
    }catch(e){console.error(e)}
}
function setActiveSidebarCar(id){document.querySelectorAll('.sideitem').forEach(b=>b.classList.toggle('is-active',id!=null&&String(b.dataset.car)===String(id)))}

// ————— Reminder wording —————
function reminderCountdown(r){
    if(r.interval_type==='time'){
        const rem=r.days_remaining;if(rem==null)return{big:'—',lbl:'no starting point'};
        const a=Math.abs(rem);
        if(rem<=0)return{big:n(a),lbl:a===1?'day overdue':'days overdue'};
        if(a<60)return{big:n(a),lbl:a===1?'day left':'days left'};
        const mo=Math.round(a/MONTH_DAYS);return{big:n(mo),lbl:mo===1?'month left':'months left'};
    }
    const rem=r.miles_remaining;if(rem==null)return{big:'—',lbl:'no starting point'};
    if(rem<=0)return{big:n(Math.abs(rem)),lbl:'miles overdue'};
    return{big:n(rem),lbl:'miles left'};
}
function reminderShort(r){
    if(r.interval_type==='time'){const d=r.days_remaining;if(d==null)return'—';const a=Math.abs(d);return(a<60?plural(a,'day'):Math.round(a/MONTH_DAYS)+' mo')+(d<=0?' over':'')}
    const m=r.miles_remaining;if(m==null)return'—';return n(Math.abs(m))+' mi'+(m<=0?' over':'');
}
function reminderSub(r){
    if(r.interval_type==='time'){
        const mo=Number(r.interval_months)||0,every=`Every ${plural(mo,'month')}`;
        return r.next_due_date?`${every}, next on ${formatDate(r.next_due_date)}`:`${every}. Log a matching record or set a last-done date.`;
    }
    const every=`Every ${n(r.interval_miles)} mi`;
    return r.next_due_odometer!=null?`${every}, next at ${n(r.next_due_odometer)} mi`:`${every}. Log a matching record or set a last-done mileage.`;
}
function meter(r){const f=r.remaining_fraction;if(f==null)return'';const pct=Math.max(2,Math.min(100,Math.round((1-f)*100)));return`<div class="meter"><span style="width:${pct}%"></span></div>`}

// ————— Dashboard —————
async function loadDashboard(){
    const range=userSettings.dashboard_range||'all';
    let s,up,cars;
    try{[s,up,cars]=await Promise.all([getJSON('/api/stats?range='+range),getJSON('/api/reminders/upcoming'),fetchCars()])}
    catch(e){console.error(e);toast('The dashboard could not be loaded. Reload the page to try again.','error');return}
    if(currentView!=='dashboard')return;
    const empty=!cars.length;
    $('dash').hidden=empty;$('dashEmpty').hidden=!empty;
    $('dashAddRecord').hidden=empty||!hasPerm('can_add_records');
    if(empty)return;
    renderKpis(s,up,cars,range);
    renderUpcoming(up);
    renderSpending(s.monthly||[]);
    renderRecent(s.recent_entries||[]);
    renderTypes(s.by_type||[],range);
    renderDashVehicles(cars);
}
function renderKpis(s,up,cars,range){
    const rl=RANGE_LABELS[range].toLowerCase(),over=up.overdue||0,soon=up.due_soon||0,due=over+soon;
    const withDue=cars.filter(c=>c.reminders_due).length;
    const cells=[];
    if(userSettings.show_cost!==false)cells.push(`<div class="kpi"><span class="kpi-label">Spent</span><span class="kpi-value">${moneySplit(s.total_cost)}</span><span class="kpi-note">${range==='all'?'All time':RANGE_LABELS[range]}, across ${plural(s.total_maintenance,'record')}</span></div>`);
    if(userSettings.show_records!==false)cells.push(`<div class="kpi"><span class="kpi-label">Service records</span><span class="kpi-value">${n(s.total_maintenance)}</span><span class="kpi-note">${s.last_service?`Last on <b>${formatDate(s.last_service)}</b>`:`None logged ${range==='all'?'yet':rl}`}</span></div>`);
    if(userSettings.show_vehicles!==false)cells.push(`<button class="kpi" onclick="go('garage')"><span class="kpi-label">Vehicles</span><span class="kpi-value">${n(s.total_cars)}</span><span class="kpi-note">${withDue?`${plural(withDue,'needs','need')} attention`:'All up to date'}</span></button>`);
    if(userSettings.show_due!==false)cells.push(`<button class="kpi ${over?'kpi--alert':soon?'kpi--warn':''}" onclick="document.getElementById('upcomingBlock').scrollIntoView({behavior:'smooth',block:'center'})"><span class="kpi-label">Service due</span><span class="kpi-value">${n(due)}</span><span class="kpi-note">${due?[over&&`<b>${n(over)}</b> overdue`,soon&&`<b>${n(soon)}</b> due soon`].filter(Boolean).join(', '):'Nothing due'}</span></button>`);
    const k=$('kpis');k.hidden=!cells.length;k.style.setProperty('--kpi-n',cells.length||1);k.innerHTML=cells.join('');
}

// Monthly spending: one series, so no legend; the hover gives each month's figures.
let spendData=[];
function renderSpending(months){
    spendData=months;
    const total=months.reduce((a,m)=>a+m.cost,0),active=months.filter(m=>m.count).length;
    $('spendTotal').textContent=money(total,0);
    $('spendSub').textContent=total?`Average ${money(total/12,0)} a month${active?`, ${plural(active,'month')} with service`:''}`:'No costs recorded in the last 12 months';
    drawSpendChart();
}
function niceStep(max){const raw=max/3,p=Math.pow(10,Math.floor(Math.log10(raw||1))),f=raw/p;return(f<=1?1:f<=2?2:f<=2.5?2.5:f<=5?5:10)*p}
function drawSpendChart(){
    const host=$('spendChart');if(!host||!host.offsetWidth)return;
    const months=spendData,W=host.offsetWidth,H=Math.max(220,host.offsetHeight),L=46,B=26,T=8,plotW=W-L,plotH=H-B-T;
    const max=Math.max(...months.map(m=>m.cost),0),step=niceStep(max||100),top=Math.max(step,Math.ceil(max/step)*step);
    const y=v=>T+plotH-(v/top)*plotH,slot=plotW/months.length,bw=Math.min(28,slot*.56);
    let g='';for(let v=0;v<=top+1e-9;v+=step){g+=`<line x1="${L}" x2="${W}" y1="${y(v)}" y2="${y(v)}"/><text x="${L-10}" y="${y(v)+4}" text-anchor="end">${moneyAxis(v)}</text>`}
    let bars='',xs='',hits='';
    months.forEach((m,i)=>{
        const cx=L+slot*i+slot/2,x=cx-bw/2,d=new Date(m.month+'-01T00:00:00');
        // Narrow plots label every other month, counting back from this one.
        const showLbl=slot>=40||(months.length-1-i)%2===0;
        const lbl=showLbl?d.toLocaleDateString('en-US',{month:'short'})+((d.getMonth()===0||i===0)&&slot>=48?` ’${String(d.getFullYear()).slice(2)}`:''):'';
        if(m.cost>0){const h=Math.max(4,(m.cost/top)*plotH),yy=T+plotH-h,r=Math.min(4,bw/2,h);
            bars+=`<path class="bar" data-i="${i}" d="M${x},${T+plotH}V${yy+r}a${r},${r} 0 0 1 ${r},-${r}h${bw-2*r}a${r},${r} 0 0 1 ${r},${r}V${T+plotH}Z"/>`}
        else bars+=`<rect class="bar bar--empty" data-i="${i}" x="${x}" y="${T+plotH-2}" width="${bw}" height="2" rx="1"/>`;
        xs+=`<text x="${cx}" y="${H-6}" text-anchor="middle">${lbl}</text>`;
        hits+=`<rect class="hit" data-i="${i}" x="${L+slot*i}" y="${T}" width="${slot}" height="${plotH+B}"/>`;
    });
    host.innerHTML=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Spending by month for the last 12 months"><g class="grid">${g}</g><g>${bars}</g><g class="xaxis">${xs}</g><g>${hits}</g></svg><div class="chart-tip" hidden></div>`;
    const tip=host.querySelector('.chart-tip'),svg=host.querySelector('svg');
    const show=i=>{const m=months[i],d=new Date(m.month+'-01T00:00:00'),cx=L+slot*i+slot/2,top_=m.cost>0?y(m.cost):T+plotH;
        host.classList.add('is-hovering');svg.querySelectorAll('.bar').forEach(b=>b.classList.toggle('is-hot',+b.dataset.i===i));
        tip.innerHTML=`${d.toLocaleDateString('en-US',{month:'long',year:'numeric'})}<b>${money(m.cost)}</b>${m.count?plural(m.count,'record'):'No records'}`;
        tip.hidden=false;const tw=tip.offsetWidth;tip.style.left=Math.max(tw/2,Math.min(W-tw/2,cx))+'px';tip.style.top=top_+'px'};
    const hide=()=>{host.classList.remove('is-hovering');tip.hidden=true};
    svg.querySelectorAll('.hit').forEach(h=>{h.addEventListener('mouseenter',()=>show(+h.dataset.i));h.addEventListener('click',()=>show(+h.dataset.i))});
    svg.addEventListener('mouseleave',hide);
}
new ResizeObserver(debounce(()=>{if(currentView==='dashboard'&&spendData.length)drawSpendChart()},60)).observe(document.getElementById('spendChart'));

function renderUpcoming(up){
    const all=(up.reminders||[]).filter(x=>x.status!=='no_baseline'),list=all.slice(0,6);
    const over=up.overdue||0,soon=up.due_soon||0;
    $('attnCount').textContent=all.length?(over||soon?[over&&`${n(over)} overdue`,soon&&`${n(soon)} due soon`].filter(Boolean).join(', '):`${plural(all.length,'reminder')}`):'';
    $('upcomingList').innerHTML=list.length?list.map(r=>{const{big,lbl}=reminderCountdown(r);
        return`<button class="attn-item s-${r.status}" onclick="go('car/${r.car_id}')"><span class="dot"></span><span class="attn-title">${esc(r.title)}</span><span class="attn-val">${big}</span><span class="attn-car">${esc(r.car_name)}</span><span class="attn-lbl">${lbl}</span></button>`}).join('')
        :`<div class="empty"><p class="empty-title">Nothing coming up</p><p class="empty-text">Add a reminder on a vehicle's page, such as an oil change every 5,000 miles, and it counts down here.</p></div>`;
}
// Rows on a vehicle's page can be ticked for export, when the user may export.
const canSelect=()=>hasPerm('can_export');
function recordRow(e,showCar){
    const att=(e.images||[]).length,sel=!showCar&&canSelect(),on=sel&&selectedIds.has(e.id);
    const open=showCar?`goToMaintRecord(${e.car_id},${e.id})`:`openMaintDetailById(${e.id})`;
    return`${sel?`<div class="rrow rrow--sel${on?' is-selected':''}" role="button" tabindex="0" data-id="${e.id}" onclick="${open}" onkeydown="if(event.key==='Enter'&&event.target===this)${open}">
        <label class="r-check" onclick="event.stopPropagation()" title="Select"><input type="checkbox" ${on?'checked':''} onchange="toggleRecordSelect(${e.id},this.checked)" aria-label="Select ${attr(e.title)}"></label>`
        :`<button class="rrow" onclick="${open}">`}
        <span class="r-date">${shortDate(e.service_date)}</span>
        <span class="r-main"><span class="r-title">${esc(e.title)}${att?`<span class="r-attach" title="${plural(att,'attachment')}">${ic('paperclip')}${att}</span>`:''}</span><span class="r-sub">${showCar?esc(`${e.year} ${e.make} ${e.model}`):esc(e.parts_vendor||'No vendor')}</span></span>
        <span class="r-type tag ${typeClass(e.maintenance_type)}"><i class="dot"></i>${esc(e.maintenance_type)}</span>
        <span class="r-num r-odo">${e.odometer?n(e.odometer)+' mi':'—'}</span>
        <span class="r-num r-cost">${e.cost!=null&&e.cost!==''?money(e.cost):'—'}</span>
    ${sel?'</div>':'</button>'}`;
}
function recordHead(selectable){return`<div class="rhead">${selectable?`<label class="r-check" title="Select all"><input type="checkbox" id="selectAll" onchange="selectAllRecords(this.checked)" aria-label="Select all records"></label>`:''}<span>Date</span><span>Service</span><span class="r-type">Type</span><span class="r-num r-odo">Odometer</span><span class="r-num">Cost</span></div>`}
function renderRecent(list){
    $('recentActivity').innerHTML=list.length?recordHead()+list.map(e=>recordRow(e,true)).join('')
        :`<div class="empty"><p class="empty-title">No service logged yet</p><p class="empty-text">Records you add appear here, newest first.</p></div>`;
}
function renderTypes(rows,range){
    $('typeRange').textContent=RANGE_LABELS[range];
    const by=Object.fromEntries(rows.map(r=>[r.type,r])),total=rows.reduce((a,r)=>a+r.cost,0);
    if(!rows.length){$('typeBreakdown').innerHTML=`<p class="empty-text" style="padding:6px 0 2px">No records ${range==='all'?'yet':RANGE_LABELS[range].toLowerCase()}.</p>`;return}
    const order=TYPES.filter(t=>by[t]).sort((a,b)=>by[b].cost-by[a].cost);
    $('typeBreakdown').innerHTML=(total?`<div class="split" role="img" aria-label="Share of spending by type">${order.filter(t=>by[t].cost>0).map(t=>`<span class="${typeClass(t)}" style="flex:${by[t].cost}" title="${t}: ${money(by[t].cost)}"></span>`).join('')}</div>`:'')
        +`<div class="legend">${order.map(t=>`<div class="legend-row ${typeClass(t)}"><i class="dot"></i><span>${t}</span><span class="legend-n">${plural(by[t].count,'record')}</span><span class="legend-v">${money(by[t].cost,0)}</span></div>`).join('')}</div>`;
}
function renderDashVehicles(cars){
    $('dashVehicles').innerHTML=cars.map(c=>{const r=(c.reminders||[])[0];
        return`<a class="vrow" href="#car/${c.id}"><span class="vrow-thumb">${carThumb(c)}</span><span class="vrow-main"><span class="vrow-name">${esc(carName(c))}</span><span class="vrow-sub">${c.latest_odometer?n(c.latest_odometer)+' mi':'No mileage yet'}</span></span>${r?`<span class="vrow-next s-${r.status}"><span class="vrow-next-v">${reminderShort(r)}</span><span class="vrow-next-l">${esc(r.title)}</span></span>`:`<span class="vrow-next"><span class="vrow-next-l">No reminders</span></span>`}</a>`}).join('');
}
async function goToMaintRecord(carId,maintId){pendingRecordId=maintId;go('car/'+carId)}

// ————— My Garage —————
async function loadCars(){
    const q=$('carSearch').value.trim();
    let cars;try{cars=await getJSON('/api/cars?q='+encodeURIComponent(q))}catch(e){console.error(e);return}
    const grid=$('carGrid');
    if(!cars.length){grid.innerHTML=q?`<div class="empty" style="grid-column:1/-1"><p class="empty-title">No vehicles match “${esc(q)}”</p><p class="empty-text">Search looks at the year, make, model and VIN.</p></div>`
        :`<div class="empty empty--page" style="grid-column:1/-1"><img src="/static/garage-logbook_logo.svg" alt=""><h2 class="empty-title">Your garage is empty</h2><p class="empty-text">Add a vehicle to start logging its service history.</p>${hasPerm('can_add_cars')?`<button class="btn btn--primary" onclick="openCarModal()">${ic('plus')}Add a vehicle</button>`:''}</div>`;return}
    const isAdmin=CURRENT_USER.role==='admin';
    grid.innerHTML=cars.map(car=>{
        const alert=carAlert(car),due=car.reminders_due||0,rs=car.reminders||[],more=(car.reminders_total||0)-rs.length;
        return`<article class="bay" onclick="go('car/${car.id}')" onkeydown="if(event.key==='Enter')go('car/${car.id}')" tabindex="0" aria-label="${attr(carName(car))}">
            <div class="bay-photo">${car.image?`<img src="/uploads/cars/${attr(car.image)}" alt="" loading="lazy">`:`<div class="photo-empty">${ic('car')}</div>`}
                ${due?`<span class="bay-flag"><span class="chip ${alert==='overdue'?'chip--red':'chip--amber'}">${alert==='overdue'?'Overdue':'Due soon'}</span></span>`:''}
            </div>
            <div class="bay-actions">${hasPerm('can_edit_cars')?`<button class="iconbtn iconbtn--sm" onclick="event.stopPropagation();openCarModal(${car.id})" aria-label="Edit vehicle" title="Edit vehicle">${ic('edit')}</button>`:''}${hasPerm('can_delete_cars')?`<button class="iconbtn iconbtn--sm iconbtn--danger" onclick="event.stopPropagation();deleteCar(${car.id})" aria-label="Delete vehicle" title="Delete vehicle">${ic('delete')}</button>`:''}</div>
            <div class="bay-body">
                <div><h3 class="bay-name">${esc(carName(car))}</h3>${isAdmin&&car.owner_name?`<p class="bay-owner">${esc(car.owner_name)}</p>`:''}</div>
                <div class="bay-stats">
                    <div><div class="bay-stat-v">${car.latest_odometer?n(car.latest_odometer):'—'}</div><div class="bay-stat-l">Miles</div></div>
                    <div><div class="bay-stat-v">${n(car.maintenance_count)}</div><div class="bay-stat-l">Records</div></div>
                    <div><div class="bay-stat-v">${money(car.total_cost,0)}</div><div class="bay-stat-l">Spent</div></div>
                </div>
                <div class="bay-rems">${rs.length?rs.map(r=>`<div class="bay-rem s-${r.status}"><span class="bay-rem-name">${esc(r.title)}</span><span class="bay-rem-val">${reminderShort(r)}</span>${meter(r)}</div>`).join('')+(more>0?`<span class="bay-more">${plural(more,'more reminder')}</span>`:''):`<span class="bay-none">No reminders set</span>`}</div>
            </div>
        </article>`}).join('');
}
const debouncedSearchCars=debounce(()=>loadCars());

// ————— Vehicle add and edit —————
function photoPrompt(){return`${ic('image')}<b>Add a photo</b><small>Shown on the vehicle's page and in the sidebar</small>`}
async function openCarModal(id){
    const f=$('carForm');f.reset();f.car_id.value='';
    const p=$('carImagePreview');p.classList.remove('has-preview');p.innerHTML=photoPrompt();
    $('carModalTitle').textContent=id?'Edit vehicle':'Add vehicle';$('carSubmitBtn').textContent=id?'Save changes':'Add vehicle';
    if(id){
        try{const c=await getJSON('/api/cars/'+id);f.car_id.value=c.id;f.year.value=c.year;f.make.value=c.make;f.model.value=c.model;f.vin.value=c.vin||'';f.purchase_date.value=c.purchase_date||'';
            if(c.image){p.classList.add('has-preview');p.innerHTML=`<img src="/uploads/cars/${attr(c.image)}" alt="">`}}
        catch(e){toast('That vehicle could not be loaded.','error');return}
    }
    openModal('carModal');setTimeout(()=>f.year.focus({preventScroll:true}),330);
}
async function submitCar(e){
    e.preventDefault();const f=e.target,id=f.car_id.value,b=$('carSubmitBtn'),label=b.textContent;
    b.disabled=true;b.textContent='Saving…';
    try{
        const r=await api(id?'/api/cars/'+id:'/api/cars',{method:id?'PUT':'POST',body:new FormData(f)});
        if(!r.ok)throw new Error(await errorOf(r,'The vehicle could not be saved.'));
        const car=await r.json();closeModal('carModal');await loadSidebarCars();
        if(id){toast('Vehicle updated');if(currentCarId==id)showCar(+id);else route()}
        else{toast('Vehicle added');go('car/'+car.id)}
    }catch(err){toast(err.message,'error')}finally{b.disabled=false;b.textContent=label}
}
async function deleteCar(id){
    const c=carsCache.find(x=>x.id===id),name=c?carName(c):'this vehicle';
    if(!confirm(`Delete ${name} and all of its records? This cannot be undone.`))return;
    try{const r=await api('/api/cars/'+id,{method:'DELETE'});if(!r.ok)throw new Error();toast('Vehicle deleted');await loadSidebarCars();if(currentCarId==id)go('garage');else route()}
    catch(e){toast('The vehicle could not be deleted.','error')}
}
function deleteCurrentCar(){if(currentCarId)deleteCar(currentCarId)}

// ————— Vehicle page —————
async function showCar(id){
    const changing=currentCarId!==id;currentCarId=id;
    let car;try{car=await getJSON('/api/cars/'+id)}catch(e){toast('That vehicle was not found.','error');go('dashboard');return}
    if(changing){$('maintSearch').value='';$('maintenanceList').innerHTML='';$('remindersList').innerHTML='';selectedIds.clear();maintEntries=[];updateSelectionUI()}
    renderCarHero(car);
    showView('car-detail',`<a class="crumb" href="#garage">My Garage</a><span class="crumb-sep">/</span><span>${esc(carName(car))}</span>`);
    currentCarId=id;setActiveSidebarCar(id);
    loadMaintenance();loadReminders();
}
function renderCarHero(car){
    const owner=CURRENT_USER.role==='admin'&&carsCache.find(c=>c.id===car.id)?.owner_name;
    $('carDetailHero').innerHTML=`
        <div class="car-photo">${car.image?`<img src="/uploads/cars/${attr(car.image)}" alt="" onclick="openLightbox(['/uploads/cars/${attr(car.image)}'],0)">`:`<div class="photo-empty">${ic('car')}</div>`}</div>
        <div class="car-info">
            <div><h2 class="car-name">${esc(carName(car))}</h2>
                <div class="car-meta">${car.vin?`<span title="VIN">${ic('tag')}<span class="vin">${esc(car.vin)}</span></span>`:''}${car.purchase_date?`<span>${ic('calendar')}Owned since ${formatDate(car.purchase_date,{month:'long',year:'numeric'})}</span>`:''}${owner?`<span>${ic('account')}${esc(owner)}</span>`:''}</div>
            </div>
            <div class="panel kpis car-stats" id="carStats"></div>
        </div>`;
}
function renderCarStats(entries){
    const el=$('carStats');if(!el)return;
    const odo=Math.max(0,...entries.map(e=>+e.odometer||0)),spent=entries.reduce((a,e)=>a+(+e.cost||0),0);
    const last=entries.map(e=>e.service_date).sort().pop();
    el.innerHTML=`<div class="kpi"><span class="kpi-label">Odometer</span><span class="kpi-value">${odo?n(odo):'—'}</span><span class="kpi-note">${odo?'Miles':'No mileage logged'}</span></div>
        <div class="kpi"><span class="kpi-label">Records</span><span class="kpi-value">${n(entries.length)}</span><span class="kpi-note">${last?'Last on '+formatDate(last):'None yet'}</span></div>
        <div class="kpi"><span class="kpi-label">Spent</span><span class="kpi-value">${moneySplit(spent)}</span><span class="kpi-note">All time</span></div>
        <div class="kpi"><span class="kpi-label">Average</span><span class="kpi-value">${entries.length?money(spent/entries.length,0):'—'}</span><span class="kpi-note">Per record</span></div>`;
}
let maintEntries=[];
async function loadMaintenance(){
    if(!currentCarId)return;const carId=currentCarId,q=$('maintSearch').value.trim();
    let entries;try{entries=await getJSON(`/api/cars/${carId}/maintenance?q=${encodeURIComponent(q)}&sort=${maintSort}`)}catch(e){console.error(e);return}
    if(carId!==currentCarId)return;
    maintEntries=entries;
    if(!q)renderCarStats(entries);
    $('recordsCount').textContent=q?`${plural(entries.length,'match','matches')}`:(entries.length?plural(entries.length,'record'):'');
    $('maintenanceList').closest('.records-panel').classList.toggle('is-selectable',canSelect());
    $('maintenanceList').innerHTML=entries.length?recordHead(canSelect())+entries.map(e=>recordRow(e,false)).join('')
        :q?`<div class="empty"><p class="empty-title">No records match “${esc(q)}”</p><p class="empty-text">Search looks at the title, vendor, notes and parts.</p></div>`
          :`<div class="empty"><p class="empty-title">No records yet</p><p class="empty-text">Log the first service, repair or upgrade for this vehicle.</p>${hasPerm('can_add_records')?`<button class="btn btn--primary" onclick="openRecordPanel()">${ic('plus')}Add record</button>`:''}</div>`;
    // A record deleted since it was ticked drops out of the selection.
    if(!q){const ids=new Set(entries.map(e=>e.id));selectedIds.forEach(id=>{if(!ids.has(id))selectedIds.delete(id)})}
    updateSelectionUI();
    if(pendingRecordId){const e=entries.find(x=>x.id===pendingRecordId);pendingRecordId=null;if(e)openMaintDetail(e)}
}

// ————— Selecting records, and exporting them as a PDF —————
const selectedIds=new Set();
function toggleRecordSelect(id,on){if(on)selectedIds.add(id);else selectedIds.delete(id);updateSelectionUI()}
function selectAllRecords(on){maintEntries.forEach(e=>on?selectedIds.add(e.id):selectedIds.delete(e.id));updateSelectionUI()}
function clearSelection(){selectedIds.clear();updateSelectionUI()}
function updateSelectionUI(){
    const n=selectedIds.size,shown=maintEntries.length,shownSel=maintEntries.filter(e=>selectedIds.has(e.id)).length;
    document.querySelectorAll('#maintenanceList .rrow--sel').forEach(r=>{const on=selectedIds.has(+r.dataset.id);r.classList.toggle('is-selected',on);const c=r.querySelector('input');if(c)c.checked=on});
    const all=$('selectAll');if(all){all.checked=shown>0&&shownSel===shown;all.indeterminate=shownSel>0&&shownSel<shown}
    $('selBar').hidden=!n||currentView!=='car-detail';
    $('selCount').innerHTML=`${n}<span class="selbar-noun"> ${n===1?'record':'records'}</span> selected`;
    const btn=$('selAllBtn');btn.hidden=shownSel===shown;btn.textContent=`Select all ${n&&shown?shown:''}`.trim();
    if(!$('selExportBtn').disabled)$('selExportLabel').textContent=n>1?`Export ${n} PDFs`:'Export PDF';
}
// The vehicle's whole history, combined into one PDF.
function exportAllPdf(){if(currentCarId)downloadExport(`/api/cars/${currentCarId}/export.pdf?sort=${maintSort}`,null,'Preparing the PDF…')}
// One PDF per chosen record. Several arrive together in a zip, because
// browsers block a page that starts many downloads at once.
function exportRecordPdfs(ids,btn,carId){
    carId=carId||currentCarId;if(!carId||!ids.length)return;
    downloadExport(`/api/cars/${carId}/export-records?ids=${ids.join(',')}&sort=${maintSort}`,btn,
        ids.length>1?`Preparing ${ids.length} PDFs…`:'Preparing the PDF…',ids.length>1?`${ids.length} PDFs saved in one zip file`:null);
}
// Fetches the file rather than navigating to it, so the button can show that
// it is working and a failure is reported instead of replacing the page.
async function downloadExport(url,btn,busy,done){
    const label=btn&&btn.innerHTML;
    if(btn){btn.disabled=true;(btn.querySelector('span')||btn).textContent='Preparing…'}else toast(busy);
    try{
        const r=await api(url);
        if(!r.ok)throw new Error(await errorOf(r,'The export could not be created.'));
        const blob=await r.blob(),m=/filename="([^"]+)"/.exec(r.headers.get('Content-Disposition')||'');
        const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=m?m[1]:'export';
        document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),10000);
        if(done)toast(done);
    }catch(e){toast(e.message,'error')}
    finally{if(btn){btn.disabled=false;btn.innerHTML=label;updateSelectionUI()}}
}
const debouncedSearchMaintenance=debounce(()=>loadMaintenance());
function exportCarCSV(){if(currentCarId)window.location.href='/api/cars/'+currentCarId+'/export'}
function openImportForCar(){openSettings('import',currentCarId)}

// ————— Record detail —————
function openMaintDetailById(id){const e=maintEntries.find(x=>x.id===id);if(e)openMaintDetail(e)}
// ————— A record: viewed in the slide-in panel, which turns into its form to edit —————
let recordMode=null,viewedRecord=null;   // recordMode: 'view', 'add' or 'edit'
function setRecordMode(mode){
    recordMode=mode;
    $('recordView').hidden=mode!=='view';$('recordForm').hidden=mode==='view';
    $('recordBack').hidden=!(mode==='edit'&&viewedRecord);
    const body=(mode==='view'?$('recordView'):$('recordForm')).querySelector('.modal-body');
    body.scrollTop=0;body.classList.remove('is-entering');void body.offsetWidth;body.classList.add('is-entering');
}
function openMaintDetail(e){
    viewedRecord=e;renderRecordView(e);setRecordMode('view');openModal('recordPanel');
    history.replaceState(null,'',`#car/${e.car_id}/record/${e.id}`);
}
function renderRecordView(e){
    const images=(e.images||[]).filter(i=>i.file_type!=='document'),docs=(e.images||[]).filter(i=>i.file_type==='document');
    const urls=images.map(i=>'/uploads/maintenance/'+i.filename),car=carsCache.find(c=>c.id===e.car_id);
    $('recordPanelTitle').textContent='Service record';
    const cell=(l,v)=>`<div class="detail-cell"><span class="l">${l}</span><span class="v">${v}</span></div>`;
    $('viewMaintContent').innerHTML=`
        <div class="record-head">
            <div class="detail-type ${typeClass(e.maintenance_type)}"><i class="dot"></i>${esc(e.maintenance_type)}${car?`<span class="detail-car">${esc(carName(car))}</span>`:''}</div>
            <h3 class="record-title">${esc(e.title)}</h3>
        </div>
        <div class="detail-grid">${cell('Date',formatDate(e.service_date))}${cell('Odometer',e.odometer?n(e.odometer)+' mi':'—')}${cell('Cost',e.cost!=null&&e.cost!==''?money(e.cost):'—')}${cell('Vendor',esc(e.parts_vendor)||'—')}</div>
        ${partsTable(e)}
        ${e.notes?`<section><h4 class="detail-label">Notes</h4><p class="detail-notes">${esc(e.notes)}</p></section>`:''}
        ${docs.length?`<section><h4 class="detail-label">Receipts and documents</h4><div class="docs">${docs.map(d=>`<a href="/uploads/maintenance/${attr(d.filename)}" target="_blank" rel="noopener" class="doc-link">${ic('file')}<span>${esc(d.original_name||'Document.pdf')}</span></a>`).join('')}</div></section>`:''}
        ${images.length?`<section><h4 class="detail-label">Photos</h4><div class="gallery">${images.map((img,idx)=>`<img src="${attr(urls[idx])}" alt="" loading="lazy" data-idx="${idx}">`).join('')}</div></section>`:''}
        ${!e.notes&&!(e.parts||[]).length&&e.labor==null&&!docs.length&&!images.length?`<p class="record-empty">No parts, notes, photos or receipts on this record.${hasPerm('can_edit_records')?' Edit it to add some.':''}</p>`:''}
        ${e.created_at?`<p class="record-meta">Logged ${formatDate(e.created_at.slice(0,10))}</p>`:''}`;
    $('viewMaintContent').querySelectorAll('.gallery img').forEach(img=>img.addEventListener('click',()=>openLightbox(urls,+img.dataset.idx)));
    let btns='';
    if(hasPerm('can_delete_records'))btns+=`<button class="btn btn--danger btn--sm" onclick="deleteMaintenance(${e.id})" aria-label="Delete record" title="Delete record">${ic('delete')}<span class="btn-label">Delete</span></button>`;
    btns+='<span class="spacer"></span>';
    if(hasPerm('can_export'))btns+=`<button class="btn btn--ghost btn--sm" onclick="exportRecordPdfs([${e.id}],this,${e.car_id})" aria-label="Export PDF" title="Export PDF">${ic('file')}<span class="btn-label">Export PDF</span></button>`;
    if(hasPerm('can_add_records'))btns+=`<button class="btn btn--ghost btn--sm" onclick="duplicateMaintenance(${e.id},this)" aria-label="Duplicate record" title="Duplicate record">${ic('copy')}<span class="btn-label">Duplicate</span></button>`;
    if(hasPerm('can_edit_records'))btns+=`<button class="btn btn--primary btn--sm" onclick="openRecordPanel(viewedRecord)">${ic('edit')}Edit</button>`;
    $('viewMaintActions').innerHTML=btns;
}
// The parts on a record, as a short invoice: each part with its vendor, then
// shipping and tax when there are any, then the total.
function partsTable(e){
    const parts=e.parts||[];if(!parts.length&&e.labor==null)return'';
    const amt=v=>v!=null&&v!==''?money(v):'—',sub=parts.reduce((a,p)=>a+(+p.cost||0),0);
    const extras=[['Labor',e.labor],['Shipping',e.shipping],['Tax',e.tax]].filter(x=>x[1]!=null);
    const sum=(l,v,cls='')=>`<div class="pt-sum${cls}"><span>${l}</span><span>${v}</span></div>`;
    const title=parts.length?`Parts${e.labor!=null?' and labor':''} <span class="detail-count">${parts.length}</span>`:'Labor';
    return`<section><h4 class="detail-label">${title}</h4><div class="pt">
        ${parts.map(p=>`<div class="pt-row"><span class="pt-name">${esc(p.name)}${p.vendor?`<small>${esc(p.vendor)}</small>`:''}</span><span class="pt-cost">${amt(p.cost)}</span></div>`).join('')}
        ${parts.length&&extras.length?sum('Parts',money(sub)):''}${extras.map(([l,v])=>sum(l,money(v))).join('')}
        ${sum('Total',amt(e.cost),' pt-total')}
    </div></section>`;
}
// The record as it is now, after a save: from the list if it is showing,
// otherwise from the vehicle's full list (a search may be hiding it).
async function freshRecord(carId,id){
    await loadMaintenance();
    return maintEntries.find(x=>x.id===id)||(await getJSON(`/api/cars/${carId}/maintenance`)).find(x=>x.id===id);
}
function afterRecordChange(){loadMaintenance();loadReminders();loadSidebarCars();if(currentView==='dashboard')loadDashboard()}
async function deleteMaintenance(id){
    if(!confirm('Delete this record and its attachments? This cannot be undone.'))return;
    try{const r=await api('/api/maintenance/'+id,{method:'DELETE'});if(!r.ok)throw new Error();toast('Record deleted');viewedRecord=null;closeModal('recordPanel');afterRecordChange()}
    catch(e){toast('The record could not be deleted.','error')}
}
// The copy opens in the form, since a copy is nearly always made to be changed.
async function duplicateMaintenance(id,btn){
    if(btn)btn.disabled=true;
    try{const r=await api('/api/maintenance/'+id+'/duplicate',{method:'POST'});if(!r.ok)throw new Error(await errorOf(r,'The record could not be duplicated.'));
        const copy=await r.json(),fresh=await freshRecord(copy.car_id,copy.id);afterRecordChange();
        toast('Record duplicated');if(fresh){viewedRecord=fresh;history.replaceState(null,'',`#car/${fresh.car_id}/record/${fresh.id}`);openRecordPanel(fresh)}}
    catch(e){toast(e.message,'error')}finally{if(btn)btn.disabled=false}
}

// ————— Record form: the slideout, for adding and editing —————
let recordEditId=null;
// Without a record, a blank form to add one; with one, that record to edit.
async function openRecordPanel(rec){
    const f=$('recordForm'),editing=!!(rec&&rec.id);
    if(!carsCache.length)await fetchCars().catch(()=>{});
    if(!carsCache.length){toast('Add a vehicle first, then log records against it.','error');openCarModal();return}
    if(!editing)viewedRecord=null;
    f.reset();recordEditId=editing?rec.id:null;f.maint_id.value=recordEditId||'';
    $('galleryThumbs').innerHTML='';$('recordDocList').innerHTML='';
    $('partsList').innerHTML='';(editing?rec.parts||[]:[]).forEach(p=>addPartRow(p));
    const hasLabor=editing&&rec.labor!=null;$('laborRow').hidden=!hasLabor;$('laborAdd').hidden=hasLabor;
    const sel=$('recordCar');
    sel.innerHTML=carsCache.map(c=>`<option value="${c.id}">${esc(carName(c))}</option>`).join('');
    sel.value=String(editing?rec.car_id:(currentCarId||carsCache[0].id));
    sel.disabled=editing;
    $('recordPanelTitle').textContent=editing?'Edit record':'Add service record';
    $('recordSubmitBtn').textContent=editing?'Save changes':'Save record';
    $('attachTitle').textContent=editing?'Add attachments':'Attachments';
    if(editing){
        f.title.value=rec.title;f.service_date.value=rec.service_date;f.odometer.value=rec.odometer??'';
        f.parts_vendor.value=rec.parts_vendor||'';f.cost.value=rec.cost??'';f.notes.value=rec.notes||'';
        const amt=v=>v!=null&&v!==''?(+v).toFixed(2):'';['labor','shipping','tax'].forEach(k=>f[k].value=amt(rec[k]));
        const ty=f.querySelector(`[name="maintenance_type"][value="${rec.maintenance_type}"]`);if(ty)ty.checked=true;
        $('maintResetBlock').classList.add('hidden');maintResetReminders=[];
    }else{
        f.service_date.valueAsDate=new Date();
        loadMaintResetOptions(+sel.value);
    }
    updatePartsTotals();
    const wasOpen=$('recordPanel').classList.contains('is-open');
    setRecordMode(editing?'edit':'add');openModal('recordPanel');
    setTimeout(()=>f.title.focus({preventScroll:true}),wasOpen?40:330);
}
// Cancel: back to the record when editing one that was open, else close.
function cancelRecordForm(){
    if(recordMode==='edit'&&viewedRecord){renderRecordView(viewedRecord);setRecordMode('view')}
    else closeModal('recordPanel');
}
function onRecordCarChange(){loadMaintResetOptions(+$('recordCar').value)}
function openEditMaintModal(id){const e=maintEntries.find(x=>x.id===id);if(e)openRecordPanel(e)}
async function submitRecord(e){
    e.preventDefault();const f=e.target,b=$('recordSubmitBtn'),label=b.textContent,carId=+$('recordCar').value,editId=recordEditId;
    const unnamed=[...$('partsList').children].find(row=>{const p=readPartRow(row);return!p.name&&(p.vendor||p.cost!=='')});
    if(unnamed){toast('Each part needs a name.','error');unnamed.querySelector('[data-k="name"]').focus();return}
    f.parts.value=JSON.stringify(readParts());
    b.disabled=true;b.textContent='Saving…';
    try{
        const r=editId?await api('/api/maintenance/'+editId,{method:'PUT',body:new FormData(f)})
                      :await api('/api/cars/'+carId+'/maintenance',{method:'POST',body:new FormData(f)});
        if(!r.ok)throw new Error(await errorOf(r,'The record could not be saved.'));
        toast(editId?'Record updated':'Record saved');
        if(editId){   // back to the record, as it now reads
            const fresh=await freshRecord(carId,editId);afterRecordChange();
            if(fresh)openMaintDetail(fresh);else closeModal('recordPanel');
        }else{
            closeModal('recordPanel');
            if(currentView==='car-detail'&&currentCarId!==carId)go('car/'+carId);else afterRecordChange();
        }
    }catch(err){toast(err.message,'error')}finally{b.disabled=false;b.textContent=label}
}

// ————— Parts on the record form —————
// Rows are plain inputs without names; on save they go to the server as one
// JSON list in the hidden "parts" field. Blank rows are dropped.
function addPartRow(p,focus){
    const list=$('partsList'),rows=list.children,prev=rows.length?readPartRow(rows[rows.length-1]).vendor:'';
    // A new line starts with the vendor of the one above it, or the record's.
    const vendor=p?p.vendor||'':prev||$('recordForm').parts_vendor.value.trim();
    list.insertAdjacentHTML('beforeend',`<div class="part-row">
        <input type="text" class="input" data-k="name" maxlength="200" placeholder="Part" aria-label="Part" autocomplete="off" value="${attr(p?p.name:'')}">
        <div class="combo"><input type="text" class="input" data-k="vendor" maxlength="100" placeholder="Vendor" aria-label="Vendor" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" value="${attr(vendor)}"><div class="combo-menu" role="listbox"></div></div>
        <span class="affix"><span class="affix-pre">$</span><input type="number" data-k="cost" min="0" step="0.01" placeholder="0.00" aria-label="Cost" value="${p&&p.cost!=null?(+p.cost).toFixed(2):''}"></span>
        <button type="button" class="iconbtn iconbtn--sm iconbtn--danger" onclick="removePartRow(this)" aria-label="Remove part" title="Remove part">${ic('close')}</button>
    </div>`);
    const row=list.lastElementChild;initVendorCombo(row.querySelector('[data-k="vendor"]'));
    updatePartsTotals();
    if(focus)row.querySelector('[data-k="name"]').focus();
    return row;
}
function removePartRow(btn){
    const row=btn.closest('.part-row'),next=row.nextElementSibling||row.previousElementSibling;row.remove();updatePartsTotals();
    (next?next.querySelector('[data-k="name"]'):document.querySelector('.parts-add')).focus();
}
function readPartRow(row){const v=k=>row.querySelector(`[data-k="${k}"]`).value.trim();return{name:v('name'),vendor:v('vendor'),cost:v('cost')}}
function readParts(){return[...$('partsList').children].map(readPartRow).filter(p=>p.name||p.vendor||p.cost!=='')}
// With parts, Cost is theirs plus shipping and tax, and stops being typed in.
// Labor is one amount, not a line: shown once asked for, or when the record has it.
function showLabor(on){
    const f=$('recordForm');$('laborRow').hidden=!on;$('laborAdd').hidden=on;
    if(!on)f.labor.value='';
    updatePartsTotals();
    if(on)f.labor.focus();else document.getElementById('laborAdd').focus();
}
// With parts or labor, Cost is theirs plus shipping and tax, and stops being typed in.
function updatePartsTotals(){
    const f=$('recordForm'),rows=$('partsList').children.length>0,labor=!$('laborRow').hidden,has=rows||labor;
    const sub=readParts().reduce((a,p)=>a+(+p.cost||0),0);
    const total=sub+['labor','shipping','tax'].reduce((a,k)=>a+(+f[k].value||0),0);
    $('partsCols').hidden=!rows;$('partsSubtotalRow').hidden=!rows;$('partsSum').hidden=!has;$('partsHint').hidden=has;
    $('partsSubtotal').textContent=money(sub);$('partsTotal').textContent=money(total);
    f.cost.readOnly=has;f.cost.tabIndex=has?-1:0;f.cost.closest('.affix').classList.toggle('is-derived',has);$('costHint').hidden=!has;
    if(has)f.cost.value=total.toFixed(2);
}
function initPartsForm(){
    const list=$('partsList'),f=$('recordForm');
    list.addEventListener('input',updatePartsTotals);
    ['labor','shipping','tax'].forEach(k=>f[k].addEventListener('input',updatePartsTotals));
    // Enter in a part line goes to a new line instead of saving the record.
    list.addEventListener('keydown',e=>{
        if(e.key!=='Enter'||e.defaultPrevented||!e.target.matches('input'))return;
        e.preventDefault();const row=e.target.closest('.part-row');
        if(row===list.lastElementChild){if(readPartRow(row).name)addPartRow(null,true)}
        else row.nextElementSibling.querySelector('[data-k="name"]').focus();
    });
}

// Counters to restart from the record being logged, rather than relying on the
// title matching.
let maintResetReminders=[];
async function loadMaintResetOptions(carId){
    maintResetReminders=[];const block=$('maintResetBlock'),list=$('maintResetList');
    block.classList.add('hidden');list.innerHTML='';if(!carId)return;
    try{const r=await api(`/api/cars/${carId}/reminders`);if(!r.ok)return;const rs=await r.json();if(+$('recordCar').value!==carId||recordEditId)return;maintResetReminders=rs}catch(e){return}
    if(!maintResetReminders.length)return;
    block.classList.remove('hidden');renderMaintResetOptions();
}
function renderMaintResetOptions(){
    const list=$('maintResetList');if(!list||!maintResetReminders.length)return;
    const f=$('recordForm'),odo=(f.odometer.value||'').trim(),sd=f.service_date.value;
    const ticked=new Set([...list.querySelectorAll('input:checked')].map(i=>i.value));
    list.innerHTML=maintResetReminders.map(r=>{
        const time=r.interval_type==='time',val=time?sd:odo;
        const to=val?(time?`from ${formatDate(val)}`:`from ${n(val)} mi`):(time?'Set a service date first':'Enter an odometer first');
        return`<label class="reset-row${val?'':' disabled'}"><input type="checkbox" name="reset_reminders" value="${r.id}"${val?'':' disabled'}${val&&ticked.has(String(r.id))?' checked':''}><span class="reset-name">${esc(r.title)}</span><span class="reset-to">${to}</span></label>`;
    }).join('');
}

// ————— Reminders —————
async function loadReminders(){
    if(!currentCarId)return;const carId=currentCarId;
    let list;try{list=await getJSON(`/api/cars/${carId}/reminders`)}catch(e){console.error(e);return}
    if(carId!==currentCarId)return;
    $('remindersList').innerHTML=list.length?list.map(r=>{const{big,lbl}=reminderCountdown(r);
        return`<div class="rem s-${r.status}">
            <div class="rem-title"><span>${esc(r.title)}</span>${r.status==='overdue'?'<span class="chip chip--red">Overdue</span>':r.status==='due_soon'?'<span class="chip chip--amber">Due soon</span>':''}</div>
            <div class="rem-sub">${reminderSub(r)}</div>
            <div class="rem-val">${big}</div><div class="rem-lbl">${lbl}</div>
            ${meter(r)}
            <div class="rem-actions">${hasPerm('can_edit_records')?`<button class="iconbtn iconbtn--sm" title="Edit reminder" aria-label="Edit reminder" data-rem='${attr(JSON.stringify(r))}' onclick="openReminderModal(JSON.parse(this.dataset.rem))">${ic('edit')}</button>`:''}${hasPerm('can_delete_records')?`<button class="iconbtn iconbtn--sm iconbtn--danger" title="Delete reminder" aria-label="Delete reminder" onclick="deleteReminder(${r.id})">${ic('delete')}</button>`:''}</div>
        </div>`}).join('')
        :`<div class="empty"><p class="empty-title">No reminders</p><p class="empty-text">Count down to the next service by mileage, like every 5,000 miles, or by time, like every 24 months.</p></div>`;
}
// Fields for the inactive mode are disabled so they neither block validation
// while hidden nor get posted; on an edit that leaves their stored values alone.
function setReminderMode(isTime){
    const f=$('reminderForm');
    f.querySelectorAll('[data-mode]').forEach(g=>{const on=(g.dataset.mode==='time')===isTime;g.classList.toggle('hidden',!on);g.querySelectorAll('input').forEach(i=>{i.disabled=!on})});
    f.querySelector(`[name="interval_mode"][value="${isTime?'time':'miles'}"]`).checked=true;
}
function reminderBody(form){
    const b=Object.fromEntries(new FormData(form).entries());
    b.interval_type=b.interval_mode==='time'?'time':'miles';delete b.id;delete b.interval_mode;return b;
}
function openReminderModal(r){
    const f=$('reminderForm');f.reset();f.id.value=r?r.id:'';
    $('reminderModalTitle').textContent=r?'Edit reminder':'Add reminder';$('reminderSubmitBtn').textContent=r?'Save changes':'Add reminder';
    if(r){f.title.value=r.title;f.interval_miles.value=r.interval_miles||'';f.interval_months.value=r.interval_months||'';
        f.last_done_odometer.value=r.last_done_odometer==null?'':r.last_done_odometer;f.last_done_date.value=r.last_done_date||'';f.notes.value=r.notes||''}
    setReminderMode(!!r&&r.interval_type==='time');
    openModal('reminderModal');setTimeout(()=>f.title.focus(),60);
}
async function submitReminder(e){
    e.preventDefault();const f=e.target,id=f.id.value,b=$('reminderSubmitBtn'),label=b.textContent;
    if(!id&&!currentCarId)return;
    b.disabled=true;b.textContent='Saving…';
    try{
        const r=await api(id?'/api/reminders/'+id:`/api/cars/${currentCarId}/reminders`,{method:id?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(reminderBody(f))});
        if(!r.ok)throw new Error(await errorOf(r,'The reminder could not be saved.'));
        toast(id?'Reminder updated':'Reminder added');closeModal('reminderModal');loadReminders();loadSidebarCars();
    }catch(err){toast(err.message,'error')}finally{b.disabled=false;b.textContent=label}
}
async function deleteReminder(id){
    if(!confirm('Delete this reminder?'))return;
    try{const r=await api('/api/reminders/'+id,{method:'DELETE'});if(!r.ok)throw new Error();toast('Reminder deleted');loadReminders();loadSidebarCars()}
    catch(e){toast('The reminder could not be deleted.','error')}
}

// ————— Settings window —————
let settingsSection='dashboard';
function openSettings(section,importCarId){
    const modal=$('settingsModal').querySelector('.settings-modal');
    openModal('settingsModal');
    if(section){switchSettingsTab(section,importCarId)}
    else{const visible=[...document.querySelectorAll('.settings-navitem')].filter(b=>!b.hidden).map(b=>b.dataset.section);
        switchSettingsTab(visible.includes(settingsSection)?settingsSection:'dashboard');modal.classList.remove('is-showing-pane')}
}
function switchSettingsTab(tab,importCarId){
    settingsSection=tab;
    document.querySelectorAll('.settings-navitem').forEach(b=>{const on=b.dataset.section===tab;b.classList.toggle('is-active',on);b.setAttribute('aria-selected',on)});
    let title='';
    document.querySelectorAll('.settings-pane').forEach(p=>{const on=p.dataset.pane===tab;p.classList.toggle('is-active',on);if(on){title=p.dataset.title;p.scrollTop=0}});
    $('settingsSectionTitle').textContent=title;
    $('settingsModal').querySelector('.settings-modal').classList.add('is-showing-pane');
    if(tab==='users')loadUsers();
    if(tab==='vendors')loadVendorsSettings();
    if(tab==='import'){importLoadCars(importCarId);importGoToStep(1)}
    if(tab==='about')markCurrentRelease();
}
function settingsBack(){$('settingsModal').querySelector('.settings-modal').classList.remove('is-showing-pane')}

// ————— Users —————
async function loadUsers(){
    if(CURRENT_USER.role!=='admin')return;
    try{const users=await getJSON('/api/users');
        $('usersList').innerHTML=users.map(u=>{const self=u.id===CURRENT_USER.id;
            return`<div class="manage-item"><span class="avatar avatar--${u.role}">${initials(u.display_name||u.username)}</span>
                <div class="manage-meta"><span class="manage-title">${esc(u.display_name||u.username)}${self?'<span class="chip">You</span>':''}</span><span class="manage-sub">@${esc(u.username)}, ${u.role==='admin'?'Admin':'Editor'}</span></div>
                <div class="manage-actions"><button class="iconbtn iconbtn--sm" onclick="openEditUser(${u.id})" aria-label="Edit user" title="Edit user">${ic('edit')}</button>${!self?`<button class="iconbtn iconbtn--sm iconbtn--danger" onclick="deleteUser(${u.id},'${attr(u.username)}')" aria-label="Delete user" title="Delete user">${ic('delete')}</button>`:''}</div></div>`}).join('');
    }catch(e){console.error(e)}
}
function buildPermGrid(prefix,perms){
    $(prefix+'PermGrid').innerHTML=Object.entries(PERM_LABELS).map(([k,label])=>`<label class="row-set"><span class="row-set-text"><span class="row-set-title">${label}</span></span><span class="switch"><input type="checkbox" id="${prefix}Perm_${k}" ${perms[k]?'checked':''}><span></span></span></label>`).join('');
}
function getPermsFromGrid(prefix){const perms={};Object.keys(PERM_LABELS).forEach(k=>{const cb=$(prefix+'Perm_'+k);perms[k]=cb?cb.checked:false});return perms}
function togglePermPanel(prefix){
    const role=$(prefix+'Role').value,panel=$(prefix+'PermPanel');panel.hidden=role!=='editor';
    if(role==='editor')buildPermGrid(prefix,prefix==='new'?{can_add_cars:true,can_edit_cars:true,can_delete_cars:true,can_add_records:true,can_edit_records:true,can_delete_records:true,can_import:false,can_export:true}:getPermsFromGrid(prefix));
}
document.addEventListener('DOMContentLoaded',()=>{if(CURRENT_USER.role==='admin')togglePermPanel('new')});
async function submitNewUser(){
    const u=$('newUsername').value.trim(),d=$('newDisplayName').value.trim(),p=$('newPassword').value,r=$('newRole').value;
    if(!u||!p){toast('A username and password are required.','error');return}
    try{const res=await api('/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,display_name:d,password:p,role:r,permissions:r==='editor'?getPermsFromGrid('new'):{}})});
        if(!res.ok)throw new Error(await errorOf(res,'The user could not be added.'));
        toast('User added');closeModal('addUserModal');['newUsername','newDisplayName','newPassword'].forEach(id=>$(id).value='');loadUsers()}
    catch(e){toast(e.message,'error')}
}
async function openEditUser(uid){
    try{const users=await getJSON('/api/users'),u=users.find(x=>x.id===uid);if(!u)return;
        $('editUserId').value=u.id;$('editUsername').value=u.username;$('editDisplayName').value=u.display_name||'';$('editRole').value=u.role;$('editPassword').value='';
        $('editPermPanel').hidden=u.role!=='editor';if(u.role==='editor')buildPermGrid('edit',u.effective_permissions||{});
        openModal('editUserModal')}catch(e){toast('That user could not be loaded.','error')}
}
async function submitEditUser(){
    const id=$('editUserId').value,role=$('editRole').value,pw=$('editPassword').value;
    const body={display_name:$('editDisplayName').value.trim(),role,permissions:role==='editor'?getPermsFromGrid('edit'):{}};if(pw)body.password=pw;
    try{const r=await api('/api/users/'+id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw new Error(await errorOf(r,'The user could not be saved.'));toast('User updated');closeModal('editUserModal');loadUsers()}
    catch(e){toast(e.message,'error')}
}
async function deleteUser(id,un){
    if(!confirm(`Delete the user “${un}”? Their vehicles and records are deleted with them.`))return;
    try{const r=await api('/api/users/'+id,{method:'DELETE'});if(!r.ok)throw new Error(await errorOf(r,'The user could not be deleted.'));toast('User deleted');loadUsers()}
    catch(e){toast(e.message,'error')}
}

// ————— CSV import —————
let csvFile=null,csvHeaders=[],importPreviewData=null,importTargetCarId=null;
function importGoToStep(s){for(let i=1;i<=4;i++){$('importStep'+i).style.display='none';$('importStep'+i+'Indicator').classList.remove('active','done')}$('importStep'+s).style.display='';$('importStep'+s+'Indicator').classList.add('active');for(let i=1;i<s;i++)$('importStep'+i+'Indicator').classList.add('done')}
async function importLoadCars(preselect){
    const sel=$('importCarSelect'),cv=preselect?String(preselect):sel.value;
    try{const cars=await fetchCars();sel.innerHTML='<option value="">Choose a vehicle</option>'+cars.map(c=>`<option value="${c.id}">${esc(carName(c))}</option>`).join('');if(cv)sel.value=cv}catch(e){}
    $('importNextStep1').disabled=!(sel.value&&csvFile);
}
function onCsvFileSelected(input){
    const info=$('csvFileInfo'),btn=$('importNextStep1');
    if(input.files&&input.files[0]){csvFile=input.files[0];info.style.display='block';info.innerHTML=`<span class="file-name">${esc(csvFile.name)}</span>, ${(csvFile.size/1024).toFixed(1)} KB`;
        const reader=new FileReader();reader.onload=e=>{const t=e.target.result;csvHeaders=parseCSVLine(t.split(/\r?\n/)[0]);const rc=t.split(/\r?\n/).filter(l=>l.trim()).length-1;info.innerHTML+=`, ${plural(csvHeaders.length,'column')}, ${plural(rc,'row')}`};reader.readAsText(csvFile);
        btn.disabled=!$('importCarSelect').value}
    else{csvFile=null;csvHeaders=[];info.style.display='none';btn.disabled=true}
}
document.addEventListener('change',e=>{if(e.target.id==='importCarSelect')$('importNextStep1').disabled=!(e.target.value&&csvFile)});
function parseCSVLine(l){const r=[];let c='',q=false;for(let i=0;i<l.length;i++){const ch=l[i];if(q){if(ch==='"'&&l[i+1]==='"'){c+='"';i++}else if(ch==='"')q=false;else c+=ch}else{if(ch==='"')q=true;else if(ch===','){r.push(c.trim());c=''}else c+=ch}}r.push(c.trim());return r}
function importGoToMapping(){if(!csvFile||!$('importCarSelect').value)return;importTargetCarId=$('importCarSelect').value;buildMappingUI();importGoToStep(2)}
function buildMappingUI(){
    const fields=[{key:'title',label:'Title',hint:'What was done',required:true},{key:'maintenance_type',label:'Type',hint:'Maintenance, Repair, Upgrade or Inspection'},{key:'service_date',label:'Service date',hint:'For example 2024-05-31',required:true},{key:'odometer',label:'Odometer',hint:'Mileage'},{key:'parts_vendor',label:'Vendor',hint:'Shop or parts supplier'},{key:'cost',label:'Cost',hint:'Amount paid'},{key:'notes',label:'Notes',hint:'Anything else'}];
    $('mappingGrid').innerHTML=fields.map(f=>{const opts=csvHeaders.map(h=>`<option value="${attr(h)}" ${isAutoMatch(h,f.key)?'selected':''}>${esc(h)}</option>`).join('');
        return`<div class="mapping-row"><div class="mapping-field-label"><span>${f.label}${f.required?' <span class="req">*</span>':''}</span><span class="field-hint">${f.hint}</span></div><div class="mapping-arrow">${ic('arrow')}</div><div class="field"><select class="mapping-select" data-field="${f.key}"><option value="">Skip</option>${opts}</select></div></div>`}).join('');
}
function isAutoMatch(h,k){const nn=h.toLowerCase().replace(/[_\-\s]+/g,'');const m={title:['title','name','description','summary'],maintenance_type:['type','maintenancetype','category'],service_date:['date','servicedate'],odometer:['odometer','mileage','miles','odo'],parts_vendor:['vendor','partsvendor','supplier','shop'],cost:['cost','price','amount','total'],notes:['notes','comment','comments','memo']};return(m[k]||[]).some(x=>nn===x||nn.includes(x))}
function getMapping(){const m={};document.querySelectorAll('.mapping-select').forEach(s=>{if(s.value)m[s.value]=s.dataset.field});return m}
async function importRunDryRun(){
    const m=getMapping(),mv=Object.values(m);
    if(!mv.includes('title')){toast('Choose the column that holds the title.','error');return}
    if(!mv.includes('service_date')){toast('Choose the column that holds the service date.','error');return}
    const btn=$('importNextStep2');btn.disabled=true;btn.textContent='Checking…';
    try{const fd=new FormData();fd.append('file',csvFile);fd.append('mapping',JSON.stringify(m));fd.append('car_id',importTargetCarId);
        const r=await api('/api/import/preview',{method:'POST',body:fd});const d=await r.json();if(!r.ok)throw new Error(d.error);
        importPreviewData=d;renderDryRunPreview(d);importGoToStep(3)}
    catch(e){toast(e.message,'error')}finally{btn.disabled=false;btn.textContent='Preview import'}
}
function renderDryRunPreview(d){
    const inv=d.row_count-d.valid_count;
    $('importSummary').innerHTML=`<div class="import-summary-stat"><span class="val">${n(d.row_count)}</span><span class="lbl">Rows</span></div><div class="import-summary-stat good"><span class="val">${n(d.valid_count)}</span><span class="lbl">Ready to import</span></div>${inv?`<div class="import-summary-stat bad"><span class="val">${n(inv)}</span><span class="lbl">With problems</span></div>`:''}`;
    const eb=$('importErrors');
    if(d.errors.length){eb.style.display='';$('importErrorCount').textContent=plural(d.errors.length,'warning');$('importErrorsList').innerHTML=d.errors.map(e=>esc(e)).join('<br>')}else eb.style.display='none';
    $('importPreviewHead').innerHTML=['','Row','Title','Type','Date','Odometer','Vendor','Cost','Problems'].map(c=>`<th>${c}</th>`).join('');
    $('importPreviewBody').innerHTML=d.preview_rows.map(r=>`<tr class="${r._valid?'row-valid':'row-invalid'}"><td><span class="row-status ${r._valid?'valid':'invalid'}"></span></td><td>${r._row_num}</td><td>${esc(r.title)||'—'}</td><td>${esc(r.maintenance_type)}</td><td>${r.service_date||'—'}</td><td>${r.odometer!=null?n(r.odometer):'—'}</td><td>${esc(r.parts_vendor)||'—'}</td><td>${r.cost!=null?money(r.cost):'—'}</td><td>${r._errors.length?`<span class="cell-error">${esc(r._errors.join('; '))}</span>`:''}</td></tr>`).join('');
    const cb=$('importCommitBtn');cb.disabled=d.valid_count===0;cb.textContent=d.valid_count?`Import ${plural(d.valid_count,'record')}`:'Nothing to import';
}
async function importCommit(){
    if(!importPreviewData||!importPreviewData.valid_count)return;const btn=$('importCommitBtn');btn.disabled=true;btn.textContent='Importing…';
    try{const r=await api('/api/import/commit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({car_id:importTargetCarId,rows:importPreviewData.preview_rows})});const d=await r.json();if(!r.ok)throw new Error(d.error);
        $('importDoneMsg').textContent=`${plural(d.imported,'record')} imported.${d.skipped?' '+plural(d.skipped,'row')+' skipped.':''}`;importGoToStep(4);loadSidebarCars();if(currentView==='dashboard')loadDashboard();if(currentCarId==importTargetCarId)afterRecordChange()}
    catch(e){toast(e.message,'error');btn.disabled=false;btn.textContent='Try again'}
}
function importReset(){csvFile=null;csvHeaders=[];importPreviewData=null;importTargetCarId=null;$('csvFileInput').value='';$('csvFileInfo').style.display='none';$('importNextStep1').disabled=true;importLoadCars();importGoToStep(1)}
function importViewCar(){if(importTargetCarId){closeModal('settingsModal');go('car/'+importTargetCarId)}}

// ————— File previews —————
function previewFile(input,pid){const p=$(pid);if(input.files&&input.files[0]){const r=new FileReader();r.onload=e=>{p.classList.add('has-preview');p.innerHTML=`<img src="${e.target.result}" alt="">`};r.readAsDataURL(input.files[0])}}
function previewGallery(input){const c=$('galleryThumbs');c.innerHTML='';if(input.files)Array.from(input.files).forEach(f=>{const r=new FileReader();r.onload=e=>{const img=document.createElement('img');img.src=e.target.result;img.alt='';c.appendChild(img)};r.readAsDataURL(f)})}
function previewDocuments(input,listId){const c=$(listId);c.innerHTML='';if(input.files)Array.from(input.files).forEach(f=>{c.innerHTML+=`<div class="doc-item">${ic('file')}${esc(f.name)}</div>`})}

// ————— Lightbox —————
function openLightbox(imgs,idx){lightboxImages=imgs;lightboxIndex=idx;$('lightboxImg').src=imgs[idx];$('lightbox').classList.add('open');document.querySelectorAll('.lightbox-nav').forEach(b=>b.hidden=imgs.length<2)}
function closeLightbox(){$('lightbox').classList.remove('open')}
function lightboxPrev(){lightboxIndex=(lightboxIndex-1+lightboxImages.length)%lightboxImages.length;$('lightboxImg').src=lightboxImages[lightboxIndex]}
function lightboxNext(){lightboxIndex=(lightboxIndex+1)%lightboxImages.length;$('lightboxImg').src=lightboxImages[lightboxIndex]}

// ————— Toasts —————
function toast(msg,type='success'){
    const c=$('toastContainer'),el=document.createElement('div');el.className='toast'+(type==='error'?' error':'');el.textContent=msg;c.appendChild(el);
    setTimeout(()=>{el.classList.add('is-leaving');setTimeout(()=>el.remove(),260)},type==='error'?5000:2800);
}

// ————— Vendors —————
// A saved list per user, offered on the record's Vendor field. Records keep the
// vendor as plain text, so the field still takes anything typed.
let vendorList=[];
// Same matching rule as vendor_key() in app.py: case, accents, spacing and
// punctuation are ignored and '&' reads as 'and'.
function vendorKey(s){return(s||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/&/g,'and').replace(/[^\p{L}\p{N}]/gu,'')}
async function loadVendors(){try{const r=await api('/api/vendors');if(r.ok)vendorList=await r.json()}catch(e){}return vendorList}
function sortVendors(){vendorList.sort((a,b)=>a.name.localeCompare(b.name,undefined,{sensitivity:'base'}))}
async function createVendor(name){
    name=name.replace(/\s+/g,' ').trim();if(!name)return null;
    const r=await api('/api/vendors',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})});
    const d=await r.json();if(!r.ok)throw new Error(d.error||'The vendor could not be saved.');
    if(!vendorList.some(v=>v.id===d.id)){vendorList.push(d);sortVendors()}
    return{vendor:d,created:r.status===201};
}
function initVendorCombo(input){
    const menu=input.parentElement.querySelector('.combo-menu');let active=-1,items=[];
    const isOpen=()=>menu.classList.contains('open');
    const close=()=>{menu.classList.remove('open');input.setAttribute('aria-expanded','false');active=-1};
    const highlight=()=>{menu.querySelectorAll('.combo-item').forEach((el,i)=>el.classList.toggle('active',i===active));const el=menu.querySelectorAll('.combo-item')[active];if(el)el.scrollIntoView({block:'nearest'})};
    // filtering=false (focus, click, arrow keys) lists every vendor when the
    // field already holds a saved one, so switching vendors needs no clearing.
    const render=(filtering=true)=>{
        const typed=input.value.replace(/\s+/g,' ').trim(),q=vendorKey(typed);
        const saved=q&&vendorList.some(v=>vendorKey(v.name)===q),f=filtering||!saved?q:'';
        items=vendorList.filter(v=>!f||vendorKey(v.name).includes(f)).map(v=>({type:'pick',name:v.name}));
        if(q&&!saved)items.push({type:'add',name:typed});
        let html=items.map((it,i)=>it.type==='pick'?`<div class="combo-item" role="option" data-i="${i}">${esc(it.name)}</div>`:`<div class="combo-item combo-add" role="option" data-i="${i}">${ic('plus')}Add “${esc(it.name)}” to vendors</div>`).join('');
        if(!items.length)html=`<div class="combo-empty">No saved vendors yet. Type a name to add one.</div>`;
        menu.innerHTML=html;active=q&&items.length?Math.max(0,items.findIndex(it=>it.type==='pick'&&vendorKey(it.name)===q)):-1;highlight();
        menu.classList.add('open');input.setAttribute('aria-expanded','true');
    };
    const choose=async i=>{const it=items[i];if(!it)return;
        if(it.type==='pick'){input.value=it.name;close();return}
        try{const res=await createVendor(it.name);input.value=res.vendor.name;close();toast(res.created?'Vendor added':'Vendor already saved')}catch(e){toast(e.message,'error')}};
    input.addEventListener('focus',()=>render(false));
    input.addEventListener('click',()=>{if(!isOpen())render(false)});
    input.addEventListener('input',()=>render());
    input.addEventListener('blur',close);
    input.addEventListener('keydown',e=>{
        if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();if(!isOpen()){render(false);return}if(!items.length)return;active=e.key==='ArrowDown'?(active+1)%items.length:(active<=0?items.length-1:active-1);highlight()}
        else if(e.key==='Enter'&&isOpen()&&active>=0){e.preventDefault();choose(active)}
        else if(e.key==='Escape'&&isOpen()){e.stopPropagation();e.preventDefault();close()}
        else if(e.key==='Tab')close();
    },true);
    // mousedown, not click: keeps focus in the input so blur does not close the menu first.
    menu.addEventListener('mousedown',e=>{e.preventDefault();const el=e.target.closest('.combo-item');if(el)choose(+el.dataset.i)});
}
async function loadVendorsSettings(){await loadVendors();renderVendorsSettings()}
function renderVendorsSettings(){
    $('vendorsList').innerHTML=vendorList.length?vendorList.map(v=>`<div class="manage-item" data-id="${v.id}"><div class="manage-meta"><span class="manage-title">${esc(v.name)}</span></div><div class="manage-actions"><button class="iconbtn iconbtn--sm" onclick="editVendor(${v.id})" aria-label="Rename" title="Rename">${ic('edit')}</button><button class="iconbtn iconbtn--sm iconbtn--danger" onclick="deleteVendor(${v.id})" aria-label="Remove" title="Remove">${ic('delete')}</button></div></div>`).join('')
        :'<div class="manage-empty">No saved vendors yet. Add one above, or from the Vendor field on a record.</div>';
}
function editVendor(id){
    const v=vendorList.find(x=>x.id===id),row=document.querySelector(`.manage-item[data-id="${id}"]`);if(!v||!row)return;
    row.innerHTML=`<input type="text" class="input manage-edit" maxlength="100" value="${attr(v.name)}" aria-label="Vendor name"><button class="btn btn--sm btn--primary">Save</button><button class="btn btn--sm btn--ghost">Cancel</button>`;
    const inp=row.querySelector('input'),[save,cancel]=row.querySelectorAll('button');
    save.onclick=()=>saveVendorName(id,inp.value);cancel.onclick=renderVendorsSettings;
    inp.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();saveVendorName(id,inp.value)}else if(e.key==='Escape'){e.stopPropagation();renderVendorsSettings()}});
    inp.focus();inp.select();
}
async function saveVendorName(id,name){
    const v=vendorList.find(x=>x.id===id);name=name.replace(/\s+/g,' ').trim();if(!v)return;if(name===v.name){renderVendorsSettings();return}
    try{const r=await api('/api/vendors/'+id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})});const d=await r.json();if(!r.ok)throw new Error(d.error||'The vendor could not be renamed.');v.name=d.name;sortVendors();renderVendorsSettings();toast('Vendor renamed')}
    catch(e){toast(e.message,'error')}
}
async function settingsAddVendor(e){
    e.preventDefault();const inp=$('newVendorName');if(!inp.value.trim())return;
    try{const res=await createVendor(inp.value);inp.value='';renderVendorsSettings();toast(res.created?'Vendor added':'Vendor already saved')}catch(err){toast(err.message,'error')}
}
async function deleteVendor(id){
    const v=vendorList.find(x=>x.id===id);if(!v||!confirm(`Remove “${v.name}” from saved vendors? Records that use it keep the name.`))return;
    try{const r=await api('/api/vendors/'+id,{method:'DELETE'});if(!r.ok)throw new Error(await errorOf(r,'The vendor could not be removed.'));vendorList=vendorList.filter(x=>x.id!==id);renderVendorsSettings();toast('Vendor removed')}
    catch(e){toast(e.message,'error')}
}

// ————— About —————
function markCurrentRelease(){
    document.querySelectorAll('.changelog-version').forEach(el=>{if(el.textContent.trim()===APP_VERSION&&!el.querySelector('.chip'))el.insertAdjacentHTML('beforeend',' <span class="chip chip--accent">Installed</span>')});
}
// The hero's animated sine-wave gradient, drawn only while it is on screen and
// never under reduced motion.
(function aboutHero(){
    const canvas=document.querySelector('.about-hero-bg');
    if(!canvas||reducedMotion()||!('IntersectionObserver' in window))return;
    const W=200,H=120,rand=(a,b)=>a+Math.random()*(b-a);
    const hsl=(h,s,l)=>{h/=360;const a=s*Math.min(l,1-l),f=k=>{k=(k+h*12)%12;return Math.round((l-a*Math.max(-1,Math.min(k-3,9-k,1)))*255)};return[f(0),f(8),f(4)]};
    // A triadic palette from a random base hue: every visit differs and none clash.
    const base=Math.random()*360,rgb=[0,120,240].map(d=>(base+d+rand(-8,8)+360)%360).sort(()=>Math.random()-.5).map(h=>hsl(h,1,.55));
    const rot=Math.random()*Math.PI*2,w={f1:rand(2.2,4),f2:rand(5,8),a1:rand(.16,.28),a2:rand(.06,.12),s1:rand(.05,.12)*(Math.random()<.5?1:-1),s2:rand(.06,.14)*(Math.random()<.5?1:-1),ph:Math.random()*Math.PI*2,c:Math.cos(rot),s:Math.sin(rot)};
    canvas.width=W;canvas.height=H;const cx=canvas.getContext('2d'),img=cx.createImageData(W,H),d=img.data,M=Math.max(W,H);
    let running=false,start=0;
    const paint=t=>{const p1=t*w.s1,p2=t*w.s2+w.ph;
        for(let y=0;y<H;y++)for(let x=0;x<W;x++){const X=x-W/2,Y=y-H/2,rx=X*w.c-Y*w.s,ry=X*w.s+Y*w.c,nx=(rx+M/2)/M,ny=(ry+M/2)/M;
            const g=Math.min(.9999,Math.max(0,ny+Math.sin(nx*w.f1+p1)*w.a1+Math.sin(nx*w.f2+p2)*w.a2)),seg=g*(rgb.length-1),lo=Math.floor(seg),f=seg-lo,c0=rgb[lo],c1=rgb[Math.min(lo+1,rgb.length-1)],o=(y*W+x)*4;
            d[o]=c0[0]+(c1[0]-c0[0])*f;d[o+1]=c0[1]+(c1[1]-c0[1])*f;d[o+2]=c0[2]+(c1[2]-c0[2])*f;d[o+3]=255}
        cx.putImageData(img,0,0)};
    const frame=now=>{if(!running)return;paint((now-start)/1000);requestAnimationFrame(frame)};
    new IntersectionObserver(es=>{const vis=es[0].isIntersecting;if(vis&&!running){running=true;start=performance.now();requestAnimationFrame(frame)}else if(!vis)running=false}).observe(canvas);
})();
