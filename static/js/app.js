let currentCarId=null,lightboxImages=[],lightboxIndex=0,userSettings={dashboard_range:'all',show_vehicles:true,show_records:true,show_cost:true,show_due:true,theme:'dark'};
const PERM_LABELS={can_add_cars:'Add vehicles',can_edit_cars:'Edit vehicles',can_delete_cars:'Delete vehicles',can_add_records:'Add records',can_edit_records:'Edit records',can_delete_records:'Delete records',can_import:'Import CSV',can_export:'Export CSV'};

document.addEventListener('DOMContentLoaded',()=>{
    applyPermVisibility();populateUserMenu();
    document.getElementById('sidebarVersion').textContent='v'+APP_VERSION;
    loadSettings().then(()=>{applyTheme();loadDashboard();loadCars();loadSidebarCars()});
    if(CURRENT_USER.must_change_password)openModal('forceChangePwModal');
});

function applyPermVisibility(){
    document.querySelectorAll('.admin-only').forEach(el=>{el.style.display=CURRENT_USER.role==='admin'?'':'none'});
    Object.keys(PERM_LABELS).forEach(p=>{
        document.querySelectorAll('.perm-'+p).forEach(el=>{el.style.display=USER_PERMS[p]?'':'none'});
    });
}
function hasPerm(p){return USER_PERMS[p]===true}
function populateUserMenu(){
    const i=(CURRENT_USER.display_name||CURRENT_USER.username).split(' ').map(w=>w[0]).join('').slice(0,2);
    document.getElementById('userAvatar').textContent=i;
    document.getElementById('userName').textContent=CURRENT_USER.display_name||CURRENT_USER.username;
    document.getElementById('userRole').textContent=CURRENT_USER.role;
}

function switchView(v){
    document.querySelectorAll('.view').forEach(el=>el.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
    document.getElementById('view-'+v).classList.add('active');
    const nb=document.querySelector(`.nav-btn[data-view="${v}"]`);if(nb)nb.classList.add('active');
    if(v==='dashboard')loadDashboard();if(v==='garage')loadCars();
    if(v!=='car-detail')setActiveSidebarCar(null);
    document.getElementById('sidebar').classList.remove('open');
}
function toggleSidebar(){document.getElementById('sidebar').classList.toggle('open')}

// Theme
function applyTheme(){
    const t=userSettings.theme||'dark';
    document.documentElement.setAttribute('data-theme',t);
    const sel=document.getElementById('settingTheme');if(sel)sel.value=t;
}

// Settings tabs
function switchSettingsTab(tab){
    document.querySelectorAll('.settings-tab').forEach(t=>t.classList.remove('active'));
    document.querySelectorAll('.settings-tab-content').forEach(c=>c.classList.remove('active'));
    const tabBtn=document.querySelector(`.settings-tab[onclick*="'${tab}'"]`);
    if(tabBtn)tabBtn.classList.add('active');
    const content=document.getElementById('settingsTab-'+tab);
    if(content)content.classList.add('active');
    if(tab==='users')loadUsers();
    if(tab==='import'){importLoadCars();importGoToStep(1)}
}

// Auth
async function doLogout(){await fetch('/api/auth/logout',{method:'POST'});window.location.href='/login'}
async function changePassword(){
    const c=document.getElementById('currentPw').value,n=document.getElementById('newPw').value,c2=document.getElementById('confirmPw').value;
    if(!c||!n||!c2){toast('Fill all fields','error');return}
    if(n!==c2){toast('New passwords do not match','error');return}
    if(n.length<4){toast('Min 4 characters','error');return}
    try{const r=await fetch('/api/auth/change-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({current_password:c,new_password:n})});const d=await r.json();if(!r.ok)throw new Error(d.error);toast('Password updated','success');['currentPw','newPw','confirmPw'].forEach(id=>document.getElementById(id).value='')}catch(e){toast(e.message,'error')}
}
async function forceChangePassword(){
    const n=document.getElementById('forceNewPw').value,c=document.getElementById('forceConfirmPw').value;
    if(!n||!c){toast('Fill both fields','error');return}
    if(n!==c){toast('Passwords do not match','error');return}
    if(n.length<4){toast('Min 4 characters','error');return}
    try{const r=await fetch('/api/auth/change-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({current_password:'admin',new_password:n})});const d=await r.json();if(!r.ok)throw new Error(d.error);CURRENT_USER.must_change_password=0;toast('Password updated!','success');closeModal('forceChangePwModal')}catch(e){toast(e.message,'error')}
}

// Settings
async function loadSettings(){try{const r=await fetch('/api/settings');userSettings=await r.json()}catch(e){}}
function loadSettingsUI(){
    document.getElementById('settingRange').value=userSettings.dashboard_range||'all';
    document.getElementById('settingShowVehicles').checked=userSettings.show_vehicles!==false;
    document.getElementById('settingShowRecords').checked=userSettings.show_records!==false;
    document.getElementById('settingShowCost').checked=userSettings.show_cost!==false;
    document.getElementById('settingShowDue').checked=userSettings.show_due!==false;
    document.getElementById('settingThemeDark').checked=(userSettings.theme||'dark')==='dark';
}
const saveSettingsDebounced=debounce(async()=>{
    userSettings={dashboard_range:document.getElementById('settingRange').value,show_vehicles:document.getElementById('settingShowVehicles').checked,show_records:document.getElementById('settingShowRecords').checked,show_cost:document.getElementById('settingShowCost').checked,show_due:document.getElementById('settingShowDue').checked,theme:document.getElementById('settingThemeDark').checked?'dark':'light'};
    applyTheme();
    try{await fetch('/api/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(userSettings)});toast('Saved','success');loadDashboard()}catch(e){toast('Failed','error')}
},500);

function debounce(fn,ms=300){let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms)}}
const debouncedSearchCars=debounce(()=>loadCars());
const debouncedSearchMaintenance=debounce(()=>loadMaintenance());

// Dashboard
async function loadDashboard(){
    try{
        const range=userSettings.dashboard_range||'all';
        const r=await fetch('/api/stats?range='+range);if(r.status===401){window.location.href='/login';return}
        const d=await r.json();
        const cards=document.getElementById('statsGrid').querySelectorAll('.stat-card');
        if(cards[0])cards[0].style.display=userSettings.show_vehicles!==false?'':'none';
        if(cards[1])cards[1].style.display=userSettings.show_records!==false?'':'none';
        if(cards[2])cards[2].style.display=userSettings.show_cost!==false?'':'none';
        if(cards[3])cards[3].style.display=userSettings.show_due!==false?'':'none';
        document.getElementById('statCars').textContent=d.total_cars;
        document.getElementById('statMaintenance').textContent=d.total_maintenance;
        document.getElementById('statCost').textContent='$'+d.total_cost.toLocaleString('en-US',{minimumFractionDigits:2});
        loadUpcoming();
        const c=document.getElementById('recentActivity');
        if(!d.recent_entries.length){c.innerHTML='<p class="empty-text">No records yet.</p>';return}
        c.innerHTML=d.recent_entries.map(e=>`
            <div class="recent-item" onclick="goToMaintRecord(${e.car_id},${e.id})">
                <span class="recent-badge badge-${e.maintenance_type.toLowerCase()}">${e.maintenance_type}</span>
                <div class="recent-info"><div class="recent-title">${esc(e.title)}</div><div class="recent-sub">${e.year} ${esc(e.make)} ${esc(e.model)} · ${formatDate(e.service_date)}</div></div>
                ${e.cost?`<span class="recent-cost">$${Number(e.cost).toFixed(2)}</span>`:''}
            </div>`).join('');
    }catch(e){console.error(e)}
}
async function goToMaintRecord(carId,maintId){
    currentCarId=carId;
    try{const cr=await fetch('/api/cars/'+carId);const car=await cr.json();
    document.getElementById('carDetailTitle').textContent=`${car.year} ${car.make} ${car.model}`;
    renderCarHero(car);switchView('car-detail');await loadMaintenance();
    const mr=await fetch('/api/cars/'+carId+'/maintenance');const entries=await mr.json();
    const entry=entries.find(e=>e.id===maintId);if(entry)openMaintDetail(entry)}catch(e){toast('Failed','error')}
}

// Cars
async function loadCars(){
    const q=document.getElementById('carSearch')?.value||'';
    try{const r=await fetch('/api/cars?q='+encodeURIComponent(q));if(r.status===401){window.location.href='/login';return}
    const cars=await r.json();const grid=document.getElementById('carGrid');
    if(!cars.length){grid.innerHTML=q?'<p class="empty-text">No match.</p>':'<p class="empty-text">No vehicles yet.</p>';return}
    const isAdmin=CURRENT_USER.role==='admin';
    grid.innerHTML=cars.map(car=>`
        <div class="car-card" onclick="openCarDetail(${car.id})">
            <div class="car-card-img">${car.image?`<img src="/uploads/cars/${car.image}" alt="">`:'<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M5 17h14M5 17a2 2 0 01-2-2V7a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2"/><circle cx="7.5" cy="17" r="2.5"/><circle cx="16.5" cy="17" r="2.5"/></svg>'}</div>
            <div class="car-card-body">
                <div class="car-card-name">${car.year} ${esc(car.make)} ${esc(car.model)}</div>
                ${isAdmin&&car.owner_name?`<div class="car-card-owner">${esc(car.owner_name)}</div>`:''}
                ${car.vin?`<div class="car-card-vin">${esc(car.vin)}</div>`:''}
                <div class="car-card-stats"><span>${car.maintenance_count} records</span><span>$${Number(car.total_cost).toFixed(0)}</span>${car.latest_odometer?`<span>${Number(car.latest_odometer).toLocaleString()} mi</span>`:''}</div>
                ${carCardReminders(car)}
            </div>
            ${hasPerm('can_edit_cars')||hasPerm('can_delete_cars')?`<div class="car-card-actions">${hasPerm('can_edit_cars')?`<button class="btn btn-sm btn-ghost" onclick="event.stopPropagation();openEditCarModal(${car.id})">Edit</button>`:''}${hasPerm('can_delete_cars')?`<button class="btn btn-sm btn-danger" onclick="event.stopPropagation();deleteCar(${car.id},'${esc(car.year)} ${esc(car.make)} ${esc(car.model)}')">Delete</button>`:''}</div>`:''}
        </div>`).join('')}catch(e){console.error(e)}
}
async function submitCar(e){e.preventDefault();const b=document.getElementById('addCarBtn');b.disabled=true;b.textContent='Adding…';try{const r=await fetch('/api/cars',{method:'POST',body:new FormData(e.target)});if(!r.ok){let m='Failed';try{m=(await r.json()).error}catch(x){}throw new Error(m)}toast('Added!','success');e.target.reset();resetPreview('carImagePreview');closeModal('addCarModal');loadCars();loadSidebarCars();loadDashboard()}catch(e){toast(e.message,'error')}finally{b.disabled=false;b.textContent='Add Vehicle'}}
async function openEditCarModal(id){try{const r=await fetch('/api/cars/'+id);const c=await r.json();document.getElementById('editCarId').value=c.id;document.getElementById('editCarYear').value=c.year;document.getElementById('editCarMake').value=c.make;document.getElementById('editCarModel').value=c.model;document.getElementById('editCarVin').value=c.vin||'';document.getElementById('editCarPurchaseDate').value=c.purchase_date||'';const p=document.getElementById('editCarImagePreview');if(c.image){p.classList.add('has-preview');p.innerHTML=`<img src="/uploads/cars/${c.image}" alt="">`}else{p.classList.remove('has-preview');p.innerHTML='<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg><span>Change photo</span>'}openModal('editCarModal')}catch(e){toast('Failed','error')}}
async function submitEditCar(e){e.preventDefault();const id=document.getElementById('editCarId').value;try{const r=await fetch('/api/cars/'+id,{method:'PUT',body:new FormData(e.target)});if(!r.ok){let m='Failed';try{m=(await r.json()).error}catch(x){}throw new Error(m)}toast('Updated','success');closeModal('editCarModal');loadCars();loadSidebarCars();if(currentCarId==id)openCarDetail(parseInt(id))}catch(e){toast(e.message,'error')}}
async function deleteCar(id,name){if(!confirm(`Delete "${name}"?`))return;try{await fetch('/api/cars/'+id,{method:'DELETE'});toast('Deleted','success');loadCars();loadSidebarCars();loadDashboard();if(currentCarId==id)switchView('garage')}catch(e){toast('Failed','error')}}

async function openCarDetail(carId){currentCarId=carId;try{const r=await fetch('/api/cars/'+carId);const car=await r.json();document.getElementById('carDetailTitle').textContent=`${car.year} ${car.make} ${car.model}`;renderCarHero(car);switchView('car-detail');setActiveSidebarCar(carId);loadMaintenance();loadReminders()}catch(e){toast('Failed','error')}}
function renderCarHero(car){document.getElementById('carDetailHero').innerHTML=`${car.image?`<img src="/uploads/cars/${car.image}" alt="">`:'<div class="placeholder-img"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M5 17h14M5 17a2 2 0 01-2-2V7a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2"/><circle cx="7.5" cy="17" r="2.5"/><circle cx="16.5" cy="17" r="2.5"/></svg></div>'}<div class="detail-meta"><div class="detail-meta-row"><div class="detail-meta-item"><span class="label">Year</span><span class="value">${car.year}</span></div><div class="detail-meta-item"><span class="label">Make</span><span class="value">${esc(car.make)}</span></div><div class="detail-meta-item"><span class="label">Model</span><span class="value">${esc(car.model)}</span></div></div><div class="detail-meta-row">${car.vin?`<div class="detail-meta-item"><span class="label">VIN</span><span class="value mono">${esc(car.vin)}</span></div>`:''}${car.purchase_date?`<div class="detail-meta-item"><span class="label">Purchased</span><span class="value">${formatDate(car.purchase_date)}</span></div>`:''}</div></div>`}
function exportCarCSV(){if(currentCarId)window.location.href='/api/cars/'+currentCarId+'/export'}
function openImportForCar(){openModal('settingsModal');switchSettingsTab('import');setTimeout(()=>{document.getElementById('importCarSelect').value=currentCarId},200)}

// Maintenance
async function loadMaintenance(){if(!currentCarId)return;const q=document.getElementById('maintSearch')?.value||'';const s=document.getElementById('maintSort')?.value||'date_desc';try{const r=await fetch(`/api/cars/${currentCarId}/maintenance?q=${encodeURIComponent(q)}&sort=${s}`);const entries=await r.json();const list=document.getElementById('maintenanceList');if(!entries.length){list.innerHTML=q?'<p class="empty-text">No match.</p>':'<p class="empty-text">No records yet.</p>';return}list.innerHTML=entries.map(e=>`<div class="maint-card" onclick='openMaintDetail(${JSON.stringify(e).replace(/'/g,"&#39;")})'><div class="maint-type-dot ${e.maintenance_type.toLowerCase()}"></div><div class="maint-title-col"><div class="maint-title">${esc(e.title)}</div><div class="maint-subtitle">${e.maintenance_type} · ${formatDate(e.service_date)}</div></div><div class="maint-meta-col">${e.odometer?`<div class="maint-meta-item"><div class="val">${Number(e.odometer).toLocaleString()}</div><div class="lbl">Miles</div></div>`:''}${e.cost?`<div class="maint-meta-item"><div class="val" style="color:var(--green)">$${Number(e.cost).toFixed(2)}</div><div class="lbl">Cost</div></div>`:''}</div></div>`).join('')}catch(e){console.error(e)}}

function openMaintDetail(e){
    const images=(e.images||[]).filter(i=>i.file_type!=='document');
    const docs=(e.images||[]).filter(i=>i.file_type==='document');
    document.getElementById('viewMaintTitle').textContent=e.title;
    document.getElementById('viewMaintContent').innerHTML=`<div class="view-maint-details"><div class="detail-item"><span class="lbl">Type</span><span class="val">${e.maintenance_type}</span></div><div class="detail-item"><span class="lbl">Date</span><span class="val">${formatDate(e.service_date)}</span></div>${e.odometer?`<div class="detail-item"><span class="lbl">Odometer</span><span class="val">${Number(e.odometer).toLocaleString()} mi</span></div>`:''}${e.parts_vendor?`<div class="detail-item"><span class="lbl">Vendor</span><span class="val">${esc(e.parts_vendor)}</span></div>`:''}${e.cost!=null?`<div class="detail-item"><span class="lbl">Cost</span><span class="val">$${Number(e.cost).toFixed(2)}</span></div>`:''}</div>${e.notes?`<div class="view-maint-notes">${esc(e.notes)}</div>`:''}${images.length?`<div class="view-maint-gallery">${images.map((img,idx)=>`<img src="/uploads/maintenance/${img.filename}" alt="" onclick="event.stopPropagation();openLightbox(${JSON.stringify(images.map(i=>'/uploads/maintenance/'+i.filename)).replace(/"/g,'&quot;')},${idx})">`).join('')}</div>`:''}${docs.length?`<div class="view-maint-docs"><div class="view-maint-docs-title">Documents</div>${docs.map(d=>`<a href="/uploads/maintenance/${d.filename}" target="_blank" class="doc-link"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>${esc(d.original_name||'Document.pdf')}</a>`).join('')}</div>`:''}`;
    let btns='';
    if(hasPerm('can_delete_records'))btns+=`<button class="btn btn-danger btn-sm" onclick="deleteMaintenance(${e.id})">Delete</button>`;
    if(hasPerm('can_add_records'))btns+=`<button class="btn btn-ghost btn-sm" onclick="duplicateMaintenance(${e.id})">Duplicate</button>`;
    if(hasPerm('can_edit_records'))btns+=`<button class="btn btn-primary btn-sm" onclick="closeModal('viewMaintModal');openEditMaintModal(${e.id})">Edit</button>`;
    if(!btns)btns=`<button class="btn btn-ghost" onclick="closeModal('viewMaintModal')">Close</button>`;
    document.getElementById('viewMaintActions').innerHTML=btns;
    openModal('viewMaintModal');
}

function openAddMaintenanceModal(){document.getElementById('addMaintForm').reset();document.getElementById('galleryThumbs').innerHTML='';document.getElementById('addDocList').innerHTML='';resetPreview('maintGalleryPreview');document.querySelector('#addMaintForm [name="service_date"]').valueAsDate=new Date();openModal('addMaintModal')}

async function submitMaintenance(e){e.preventDefault();if(!currentCarId)return;const b=document.getElementById('addMaintBtn');b.disabled=true;b.textContent='Saving…';try{const r=await fetch('/api/cars/'+currentCarId+'/maintenance',{method:'POST',body:new FormData(e.target)});if(!r.ok){let m='Failed';try{m=(await r.json()).error}catch(x){}throw new Error(m)}toast('Saved!','success');closeModal('addMaintModal');loadMaintenance();loadDashboard()}catch(e){toast(e.message,'error')}finally{b.disabled=false;b.textContent='Save'}}

async function openEditMaintModal(id){try{const r=await fetch('/api/cars/'+currentCarId+'/maintenance');const entries=await r.json();const e=entries.find(x=>x.id===id);if(!e)return toast('Not found','error');document.getElementById('editMaintId').value=e.id;document.getElementById('editMaintTitle').value=e.title;document.getElementById('editMaintDate').value=e.service_date;document.getElementById('editMaintOdo').value=e.odometer||'';document.getElementById('editMaintVendor').value=e.parts_vendor||'';document.getElementById('editMaintCost').value=e.cost||'';document.getElementById('editMaintNotes').value=e.notes||'';if(e.maintenance_type==='Maintenance')document.getElementById('editMaintTypeMaint').checked=true;else if(e.maintenance_type==='Repair')document.getElementById('editMaintTypeRepair').checked=true;else if(e.maintenance_type==='Upgrade')document.getElementById('editMaintTypeUpgrade').checked=true;else if(e.maintenance_type==='Inspection')document.getElementById('editMaintTypeInspection').checked=true;openModal('editMaintModal')}catch(e){toast('Failed','error')}}

async function submitEditMaintenance(e){e.preventDefault();const id=document.getElementById('editMaintId').value;try{const r=await fetch('/api/maintenance/'+id,{method:'PUT',body:new FormData(e.target)});if(!r.ok){let m='Failed';try{m=(await r.json()).error}catch(x){}throw new Error(m)}toast('Updated','success');closeModal('editMaintModal');loadMaintenance();loadDashboard()}catch(e){toast(e.message,'error')}}
async function deleteMaintenance(id){if(!confirm('Delete?'))return;try{await fetch('/api/maintenance/'+id,{method:'DELETE'});toast('Deleted','success');closeModal('viewMaintModal');loadMaintenance();loadDashboard()}catch(e){toast('Failed','error')}}
async function duplicateMaintenance(id){try{const r=await fetch('/api/maintenance/'+id+'/duplicate',{method:'POST'});if(!r.ok){let m='Failed';try{m=(await r.json()).error}catch(x){}throw new Error(m)}toast('Duplicated','success');closeModal('viewMaintModal');loadMaintenance();loadDashboard()}catch(e){toast(e.message,'error')}}

// Users
async function loadUsers(){if(CURRENT_USER.role!=='admin')return;try{const r=await fetch('/api/users');const users=await r.json();document.getElementById('usersList').innerHTML=users.map(u=>{const i=(u.display_name||u.username).split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();const self=u.id===CURRENT_USER.id;return`<div class="user-card"><div class="user-card-avatar role-${u.role}">${i}</div><div class="user-card-info"><div class="user-card-name">${esc(u.display_name||u.username)} ${self?'<span style="color:var(--text-muted);font-size:0.65rem">(you)</span>':''}</div><div class="user-card-meta">@${esc(u.username)} · ${u.role}</div></div><span class="role-badge ${u.role}">${u.role}</span><div class="user-card-actions"><button class="btn btn-sm btn-ghost" onclick="openEditUser(${u.id})">Edit</button>${!self?`<button class="btn btn-sm btn-danger" onclick="deleteUser(${u.id},'${esc(u.username)}')">Delete</button>`:''}</div></div>`}).join('')}catch(e){console.error(e)}}

function buildPermGrid(prefix,perms){
    const grid=document.getElementById(prefix+'PermGrid');
    grid.innerHTML=Object.entries(PERM_LABELS).map(([k,label])=>`<div class="setting-row"><label>${label}</label><label class="toggle"><input type="checkbox" id="${prefix}Perm_${k}" ${perms[k]?'checked':''}><span class="toggle-slider"></span></label></div>`).join('');
}
function getPermsFromGrid(prefix){
    const perms={};Object.keys(PERM_LABELS).forEach(k=>{const cb=document.getElementById(prefix+'Perm_'+k);perms[k]=cb?cb.checked:false});return perms;
}
function togglePermPanel(prefix){
    const role=document.getElementById(prefix+'Role').value;
    const panel=document.getElementById(prefix+'PermPanel');
    panel.style.display=role==='editor'?'':'none';
    if(role==='editor'){
        const perms=prefix==='new'?{can_add_cars:true,can_edit_cars:true,can_delete_cars:true,can_add_records:true,can_edit_records:true,can_delete_records:true,can_import:false,can_export:true}:getPermsFromGrid(prefix);
        buildPermGrid(prefix,perms);
    }
}

async function submitNewUser(){
    const u=document.getElementById('newUsername').value.trim(),d=document.getElementById('newDisplayName').value.trim(),p=document.getElementById('newPassword').value,r=document.getElementById('newRole').value;
    if(!u||!p){toast('Required','error');return}
    const perms=r==='editor'?getPermsFromGrid('new'):{};
    try{const res=await fetch('/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,display_name:d,password:p,role:r,permissions:perms})});const data=await res.json();if(!res.ok)throw new Error(data.error);toast('Created','success');closeModal('addUserModal');document.getElementById('newUsername').value='';document.getElementById('newDisplayName').value='';document.getElementById('newPassword').value='';loadUsers()}catch(e){toast(e.message,'error')}
}
async function openEditUser(uid){
    try{const r=await fetch('/api/users');const users=await r.json();const u=users.find(x=>x.id===uid);if(!u)return;
    document.getElementById('editUserId').value=u.id;document.getElementById('editUsername').value=u.username;document.getElementById('editDisplayName').value=u.display_name||'';document.getElementById('editRole').value=u.role;document.getElementById('editPassword').value='';
    const panel=document.getElementById('editPermPanel');
    if(u.role==='editor'){panel.style.display='';buildPermGrid('edit',u.effective_permissions||{})}else{panel.style.display='none'}
    openModal('editUserModal')}catch(e){toast('Failed','error')}
}
async function submitEditUser(){
    const id=document.getElementById('editUserId').value,dn=document.getElementById('editDisplayName').value.trim(),role=document.getElementById('editRole').value,pw=document.getElementById('editPassword').value;
    const perms=role==='editor'?getPermsFromGrid('edit'):{};
    const body={display_name:dn,role,permissions:perms};if(pw)body.password=pw;
    try{const r=await fetch('/api/users/'+id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw new Error(d.error);toast('Updated','success');closeModal('editUserModal');loadUsers()}catch(e){toast(e.message,'error')}
}
async function deleteUser(id,un){if(!confirm(`Delete "${un}"?`))return;try{const r=await fetch('/api/users/'+id,{method:'DELETE'});const d=await r.json();if(!r.ok)throw new Error(d.error);toast('Deleted','success');loadUsers()}catch(e){toast(e.message,'error')}}

// CSV Import
let csvFile=null,csvHeaders=[],importPreviewData=null,importTargetCarId=null;
function importGoToStep(s){for(let i=1;i<=4;i++){document.getElementById('importStep'+i).style.display='none';document.getElementById('importStep'+i+'Indicator').classList.remove('active','done')}document.getElementById('importStep'+s).style.display='';document.getElementById('importStep'+s+'Indicator').classList.add('active');for(let i=1;i<s;i++)document.getElementById('importStep'+i+'Indicator').classList.add('done')}
function importLoadCars(){fetch('/api/cars').then(r=>r.json()).then(cars=>{const sel=document.getElementById('importCarSelect');const cv=sel.value;sel.innerHTML='<option value="">— Select —</option>';cars.forEach(c=>{sel.innerHTML+=`<option value="${c.id}">${c.year} ${esc(c.make)} ${esc(c.model)}</option>`});if(cv)sel.value=cv})}
function onCsvFileSelected(input){const info=document.getElementById('csvFileInfo'),btn=document.getElementById('importNextStep1');if(input.files&&input.files[0]){csvFile=input.files[0];info.style.display='flex';info.innerHTML=`<span class="file-name">${esc(csvFile.name)}</span> (${(csvFile.size/1024).toFixed(1)} KB)`;const reader=new FileReader();reader.onload=e=>{const t=e.target.result;csvHeaders=parseCSVLine(t.split(/\r?\n/)[0]);const rc=t.split(/\r?\n/).filter(l=>l.trim()).length-1;info.innerHTML+=` · ${csvHeaders.length} cols · ${rc} rows`};reader.readAsText(csvFile);btn.disabled=!document.getElementById('importCarSelect').value}else{csvFile=null;csvHeaders=[];info.style.display='none';btn.disabled=true}}
document.addEventListener('change',e=>{if(e.target.id==='importCarSelect'){const btn=document.getElementById('importNextStep1');if(btn)btn.disabled=!(e.target.value&&csvFile)}});
function parseCSVLine(l){const r=[];let c='',q=false;for(let i=0;i<l.length;i++){const ch=l[i];if(q){if(ch==='"'&&l[i+1]==='"'){c+='"';i++}else if(ch==='"')q=false;else c+=ch}else{if(ch==='"')q=true;else if(ch===','){r.push(c.trim());c=''}else c+=ch}}r.push(c.trim());return r}
function importGoToMapping(){if(!csvFile||!document.getElementById('importCarSelect').value)return;importTargetCarId=document.getElementById('importCarSelect').value;buildMappingUI();importGoToStep(2)}
function buildMappingUI(){const g=document.getElementById('mappingGrid');const fields=[{key:'title',label:'Title',hint:'Summary',required:true},{key:'maintenance_type',label:'Type',hint:'Repair/Maintenance/Upgrade/Inspection'},{key:'service_date',label:'Service Date',hint:'YYYY-MM-DD',required:true},{key:'odometer',label:'Odometer',hint:'Mileage'},{key:'parts_vendor',label:'Vendor',hint:'Source'},{key:'cost',label:'Cost',hint:'Amount'},{key:'notes',label:'Notes',hint:'Details'}];g.innerHTML=fields.map(f=>{const opts=csvHeaders.map(h=>`<option value="${esc(h)}" ${isAutoMatch(h,f.key)?'selected':''}>${esc(h)}</option>`).join('');return`<div class="mapping-row ${f.required?'required':''}"><div class="mapping-field-label">${f.required?'<span class="req-dot"></span>':'<span style="width:6px"></span>'}<span>${f.label}</span><span class="field-hint">${f.hint}</span></div><div class="mapping-arrow"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg></div><select class="mapping-select" data-field="${f.key}"><option value="">— Skip —</option>${opts}</select></div>`}).join('')}
function isAutoMatch(h,k){const n=h.toLowerCase().replace(/[_\-\s]+/g,'');const m={title:['title','name','description','summary'],maintenance_type:['type','maintenancetype','category'],service_date:['date','servicedate'],odometer:['odometer','mileage','miles','odo'],parts_vendor:['vendor','partsvendor','supplier','shop'],cost:['cost','price','amount','total'],notes:['notes','comment','comments','memo']};return(m[k]||[]).some(x=>n===x||n.includes(x))}
function getMapping(){const m={};document.querySelectorAll('.mapping-select').forEach(s=>{if(s.value)m[s.value]=s.dataset.field});return m}
async function importRunDryRun(){const m=getMapping();const mv=Object.values(m);if(!mv.includes('title')){toast('Map Title','error');return}if(!mv.includes('service_date')){toast('Map Date','error');return}const btn=document.getElementById('importNextStep2');btn.disabled=true;btn.textContent='…';try{const fd=new FormData();fd.append('file',csvFile);fd.append('mapping',JSON.stringify(m));fd.append('car_id',importTargetCarId);const r=await fetch('/api/import/preview',{method:'POST',body:fd});const d=await r.json();if(!r.ok)throw new Error(d.error);importPreviewData=d;renderDryRunPreview(d);importGoToStep(3)}catch(e){toast(e.message,'error')}finally{btn.disabled=false;btn.textContent='Preview →'}}
function renderDryRunPreview(d){const s=document.getElementById('importSummary');const inv=d.row_count-d.valid_count;s.innerHTML=`<div class="import-summary-stat"><span class="val">${d.row_count}</span><span class="lbl">Total</span></div><div class="import-summary-stat good"><span class="val">${d.valid_count}</span><span class="lbl">Valid</span></div>${inv?`<div class="import-summary-stat bad"><span class="val">${inv}</span><span class="lbl">Invalid</span></div>`:''}`;const eb=document.getElementById('importErrors');if(d.errors.length){eb.style.display='';document.getElementById('importErrorCount').textContent=d.errors.length+' warning(s)';document.getElementById('importErrorsList').innerHTML=d.errors.map(e=>esc(e)).join('<br>')}else eb.style.display='none';const h=document.getElementById('importPreviewHead'),b=document.getElementById('importPreviewBody');h.innerHTML=['','Row','Title','Type','Date','Odo','Vendor','Cost','Issues'].map(c=>`<th>${c}</th>`).join('');b.innerHTML=d.preview_rows.map(r=>`<tr class="${r._valid?'row-valid':'row-invalid'}"><td><span class="row-status ${r._valid?'valid':'invalid'}"></span></td><td>${r._row_num}</td><td>${esc(r.title)||'—'}</td><td>${esc(r.maintenance_type)}</td><td>${r.service_date||'—'}</td><td>${r.odometer!=null?Number(r.odometer).toLocaleString():'—'}</td><td>${esc(r.parts_vendor)||'—'}</td><td>${r.cost!=null?'$'+Number(r.cost).toFixed(2):'—'}</td><td>${r._errors.length?`<span class="cell-error">${esc(r._errors.join('; '))}</span>`:'✓'}</td></tr>`).join('');const cb=document.getElementById('importCommitBtn');cb.disabled=d.valid_count===0;cb.innerHTML=d.valid_count?`Import ${d.valid_count}`:'None'}
async function importCommit(){if(!importPreviewData||!importPreviewData.valid_count)return;const btn=document.getElementById('importCommitBtn');btn.disabled=true;btn.innerHTML='…';try{const r=await fetch('/api/import/commit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({car_id:importTargetCarId,rows:importPreviewData.preview_rows})});const d=await r.json();if(!r.ok)throw new Error(d.error);document.getElementById('importDoneMsg').textContent=`Imported ${d.imported}.${d.skipped?' '+d.skipped+' skipped.':''}`;importGoToStep(4);loadDashboard()}catch(e){toast(e.message,'error');btn.disabled=false;btn.innerHTML='Retry'}}
function importReset(){csvFile=null;csvHeaders=[];importPreviewData=null;importTargetCarId=null;document.getElementById('csvFileInput').value='';document.getElementById('csvFileInfo').style.display='none';document.getElementById('importNextStep1').disabled=true;importLoadCars();importGoToStep(1)}
function importViewCar(){if(importTargetCarId){closeModal('settingsModal');openCarDetail(parseInt(importTargetCarId))}}

// Modals
function openModal(id){
    document.getElementById(id).classList.add('open');document.body.style.overflow='hidden';
    if(id==='settingsModal')loadSettingsUI();
}
function closeModal(id){if(id==='forceChangePwModal'&&CURRENT_USER.must_change_password)return;document.getElementById(id).classList.remove('open');document.body.style.overflow=''}
document.addEventListener('click',e=>{if(e.target.classList.contains('modal-overlay')){if(e.target.id==='forceChangePwModal')return;e.target.classList.remove('open');document.body.style.overflow=''}});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){document.querySelectorAll('.modal-overlay.open').forEach(m=>{if(m.id==='forceChangePwModal')return;m.classList.remove('open')});closeLightbox();document.body.style.overflow=''}});

// File Previews
function previewFile(input,pid){const p=document.getElementById(pid);if(input.files&&input.files[0]){const r=new FileReader();r.onload=e=>{p.classList.add('has-preview');p.innerHTML=`<img src="${e.target.result}" alt="">`};r.readAsDataURL(input.files[0])}}
function resetPreview(id){const p=document.getElementById(id);if(!p)return;p.classList.remove('has-preview');p.innerHTML='<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg><span>Upload</span>'}
function previewGallery(input){const c=document.getElementById('galleryThumbs');c.innerHTML='';if(input.files)Array.from(input.files).forEach(f=>{const r=new FileReader();r.onload=e=>{const img=document.createElement('img');img.src=e.target.result;img.className='gallery-thumb';c.appendChild(img)};r.readAsDataURL(f)})}
function previewDocuments(input,listId){const c=document.getElementById(listId);c.innerHTML='';if(input.files)Array.from(input.files).forEach(f=>{c.innerHTML+=`<div class="doc-item"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>${esc(f.name)}</div>`})}

// Lightbox
function openLightbox(imgs,idx){lightboxImages=imgs;lightboxIndex=idx;document.getElementById('lightboxImg').src=imgs[idx];document.getElementById('lightbox').classList.add('open');document.body.style.overflow='hidden'}
function closeLightbox(){document.getElementById('lightbox').classList.remove('open');document.body.style.overflow=''}
function lightboxPrev(){lightboxIndex=(lightboxIndex-1+lightboxImages.length)%lightboxImages.length;document.getElementById('lightboxImg').src=lightboxImages[lightboxIndex]}
function lightboxNext(){lightboxIndex=(lightboxIndex+1)%lightboxImages.length;document.getElementById('lightboxImg').src=lightboxImages[lightboxIndex]}

function toast(msg,type='success'){const c=document.getElementById('toastContainer'),el=document.createElement('div');el.className='toast '+type;el.textContent=msg;c.appendChild(el);setTimeout(()=>el.remove(),3500)}
function esc(s){if(!s)return'';const d=document.createElement('div');d.textContent=s;return d.innerHTML}
function formatDate(s){if(!s)return'—';const d=new Date(s+(s.includes('T')?'':'T00:00:00'));return d.toLocaleDateString('en-US',{year:'numeric',month:'short',day:'numeric'})}

// ── Service Reminders ──────────────────────────────
function reminderCard(r,showCar){
    const n=v=>Number(v).toLocaleString();
    const pct=(r.miles_remaining==null||!r.interval_miles)?0:Math.max(0,Math.min(100,Math.round((1-r.miles_remaining/r.interval_miles)*100)));
    let big,lbl;
    if(r.miles_remaining==null){big='—';lbl='no baseline'}
    else if(r.miles_remaining<=0){big=n(Math.abs(r.miles_remaining));lbl='miles overdue'}
    else{big=n(r.miles_remaining);lbl='miles to go'}
    const sub=r.next_due_odometer!=null
        ?`Every ${n(r.interval_miles)} mi · next at ${n(r.next_due_odometer)} mi`
        :`Every ${n(r.interval_miles)} mi · add a service record or a last-done mileage`;
    return `<div class="reminder-card ${r.status}">
        <div class="reminder-main">
            ${showCar&&r.car_name?`<div class="reminder-car">${esc(r.car_name)}</div>`:''}
            <div class="reminder-title">${esc(r.title)}${r.status==='overdue'?'<span class="reminder-badge">Overdue</span>':''}</div>
            <div class="reminder-sub">${sub}</div>
            ${r.miles_remaining!=null?`<div class="reminder-bar"><span style="width:${pct}%"></span></div>`:''}
        </div>
        <div class="reminder-meta"><div class="reminder-remaining">${big}</div><div class="reminder-lbl">${lbl}</div></div>
        ${showCar?'':`<div class="reminder-actions">
            ${hasPerm('can_edit_records')?`<button class="btn btn-sm btn-ghost" title="Edit" onclick='openEditReminderModal(${JSON.stringify(r).replace(/'/g,"&#39;")})'><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4z"/></svg></button>`:''}
            ${hasPerm('can_delete_records')?`<button class="btn btn-sm btn-ghost" title="Delete" onclick="deleteReminder(${r.id})"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg></button>`:''}
        </div>`}
    </div>`;
}
async function loadReminders(){
    if(!currentCarId)return;
    try{
        const r=await fetch(`/api/cars/${currentCarId}/reminders`);const list=await r.json();
        const el=document.getElementById('remindersList');
        el.innerHTML=list.length?list.map(x=>reminderCard(x,false)).join(''):'<p class="empty-text">No reminders yet.</p>';
    }catch(e){console.error(e)}
}
function openAddReminderModal(){document.getElementById('addReminderForm').reset();openModal('addReminderModal')}
async function submitReminder(e){
    e.preventDefault();if(!currentCarId)return;
    const b=document.getElementById('addReminderBtn');b.disabled=true;b.textContent='Saving…';
    try{
        const body=Object.fromEntries(new FormData(e.target).entries());
        const r=await fetch(`/api/cars/${currentCarId}/reminders`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
        if(!r.ok){let m='Failed';try{m=(await r.json()).error}catch(x){}throw new Error(m)}
        toast('Reminder added','success');closeModal('addReminderModal');loadReminders()
    }catch(e){toast(e.message,'error')}finally{b.disabled=false;b.textContent='Save'}
}
function openEditReminderModal(r){
    const f=document.getElementById('editReminderForm');f.reset();
    document.getElementById('editReminderId').value=r.id;
    f.title.value=r.title;f.interval_miles.value=r.interval_miles;
    f.last_done_odometer.value=r.last_done_odometer==null?'':r.last_done_odometer;
    f.notes.value=r.notes||'';
    openModal('editReminderModal');
}
async function submitEditReminder(e){
    e.preventDefault();
    const id=document.getElementById('editReminderId').value;
    try{
        const body=Object.fromEntries(new FormData(e.target).entries());delete body.id;
        const r=await fetch('/api/reminders/'+id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
        if(!r.ok){let m='Failed';try{m=(await r.json()).error}catch(x){}throw new Error(m)}
        toast('Reminder updated','success');closeModal('editReminderModal');loadReminders()
    }catch(e){toast(e.message,'error')}
}
async function deleteReminder(id){
    if(!confirm('Delete this reminder?'))return;
    try{
        const r=await fetch('/api/reminders/'+id,{method:'DELETE'});
        if(!r.ok)throw new Error('Failed');
        toast('Deleted','success');loadReminders()
    }catch(e){toast('Failed','error')}
}
async function loadUpcoming(){
    try{
        const r=await fetch('/api/reminders/upcoming');const d=await r.json();
        const due=(d.overdue||0)+(d.due_soon||0);
        const s=document.getElementById('statDue');if(s)s.textContent=due;
        const el=document.getElementById('upcomingList');if(!el)return;
        const list=(d.reminders||[]).filter(x=>x.status!=='no_baseline').slice(0,8);
        el.innerHTML=list.length?list.map(x=>reminderCard(x,true)).join(''):'<p class="empty-text">Nothing due. Add reminders from a vehicle page.</p>';
    }catch(e){console.error(e)}
}

// ── Sidebar vehicle list ───────────────────────────
async function loadSidebarCars(){
    // deliberately not reusing loadCars(): that one honours the garage search
    // box and early-returns on no matches, which would blank the sidebar.
    try{
        const r=await fetch('/api/cars');if(!r.ok)return;
        const cars=await r.json();
        const el=document.getElementById('sidebarCars');if(!el)return;
        el.innerHTML=cars.map(c=>{
            const name=`${c.year} ${c.make} ${c.model}`;
            return `<button class="nav-car" data-car="${c.id}" onclick="openCarDetail(${c.id})" title="${esc(name)}"><span class="nav-car-name">${esc(name)}</span></button>`;
        }).join('');
        setActiveSidebarCar(currentCarId);
    }catch(e){console.error(e)}
}
function setActiveSidebarCar(id){
    document.querySelectorAll('.nav-car').forEach(b=>b.classList.toggle('active',id!=null&&String(b.dataset.car)===String(id)));
}

function carCardReminders(car){
    const rs=car.reminders||[];
    if(!rs.length)return '';
    const more=(car.reminders_total||0)-rs.length;
    const rows=rs.map(r=>{
        const n=Math.abs(r.miles_remaining).toLocaleString();
        const txt=r.miles_remaining<=0?`${n} mi overdue`:`${n} mi`;
        return `<div class="car-card-rem ${r.status}"><span class="car-card-rem-name">${esc(r.title)}</span><span class="car-card-rem-val">${txt}</span></div>`;
    }).join('');
    return `<div class="car-card-rems"><div class="car-card-rems-hd">Upcoming Service</div>${rows}${more>0?`<div class="car-card-rem-more">+${more} more</div>`:''}</div>`;
}
