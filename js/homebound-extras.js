/* Homebound additions: clearly separated from existing visits, chat and rental logic.
 * In live mode, announcements/reservations are persisted by the accompanying SQL migration.
 * Anonymous student records are accessed using random, private tokens; no public tenancy data is exposed.
 */
let hbGeocodeTimer = null;
let hbGeocodeRequest = 0;
let hbCampusPoint = null;
let hbStudentSearchPoint = null;
const hbPlaceTimers = new Map();
const hbPlaceRequests = new Map();
let hbCurrentAdvanceRoom = null;
let hbAdvanceOwnerRecords = [];
let hbDemoAdvance = [];
let hbDemoAnnouncements = [];
let hbForecastChart = null;
const HB_ADVANCE_KEY = 'homebound-advance-requests-v1';
const HB_GEOCODE_URL = 'https://photon.komoot.io/api/';

function initializeHomeboundExtras() {
    // A private tenant updates link may be opened without landlord authentication.
    const token = new URLSearchParams(location.search).get('tenant-updates');
    if (token && /^[0-9a-f-]{36}$/i.test(token)) {
        document.getElementById('tenantUpdatesView')?.classList.remove('hidden');
        loadTenantUpdates();
    }
    const preferred = document.getElementById('roomPreferredMoveIn');
    if (preferred) preferred.min = localDateISO(new Date());
    loadPublicAnnouncements();
    window.addEventListener('focus',loadPublicAnnouncements);
    setInterval(()=>{if(currentPortal==='student')loadPublicAnnouncements();},45000);
    refreshStudentAdvanceStatuses();
    setInterval(refreshStudentAdvanceStatuses, 30000);
    document.getElementById('holdVisitTime')?.addEventListener('input', syncHourlyVisitSlotStyles);
    setInterval(() => { if (!document.getElementById('modalPreHoldForm')?.classList.contains('hidden')) void refreshVisitSlotAvailability(); }, 12000);
}

// Photon is a demo/public autocomplete endpoint. Keep typed addresses editable and
// replace it with a managed geocoding provider for a high-traffic deployment.
async function hbSearchPlaces(query) {
    const endpoint = new URL(HB_GEOCODE_URL);
    endpoint.searchParams.set('q', query);
    endpoint.searchParams.set('limit','5');
    endpoint.searchParams.set('lat','16.4023');
    endpoint.searchParams.set('lon','120.5960');
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),3000);
    let response;
    try {response=await fetch(endpoint.toString(),{headers:{'Accept':'application/json'},signal:controller.signal});}
    finally{clearTimeout(timeout);}
    if (!response.ok) throw new Error('Address suggestions temporarily unavailable');
    const json = await response.json();
    return (json.features || []).filter(f => f.geometry?.coordinates?.length >= 2 && f.properties?.countrycode === 'PH')
        .map(f => {
            const p=f.properties;
            const title=[p.name,p.street,p.city || p.county,p.state].filter(Boolean).filter((part,i,arr)=>arr.indexOf(part)===i).join(', ');
            return {label:title || 'Place',lat:Number(f.geometry.coordinates[1]),lng:Number(f.geometry.coordinates[0])};
        }).filter(p=>Number.isFinite(p.lat) && Number.isFinite(p.lng));
}
const HB_LOCATION_FALLBACK = ['Irisan, Baguio City','Session Road, Baguio City','Burnham Park, Baguio City',
    'Camp 7, Baguio City','Loakan, Baguio City','Bakakeng, Baguio City','Aurora Hill, Baguio City',
    'University of Baguio, Baguio City','Saint Louis University, Baguio City'];
function hbQueuePlaceSearch(query, containerId, onSelect) {
    clearTimeout(hbPlaceTimers.get(containerId));
    const parent=document.getElementById(containerId);if(!parent)return;
    const needle=String(query||'').trim();
    const request=(hbPlaceRequests.get(containerId)||0)+1;
    hbPlaceRequests.set(containerId,request);
    parent.replaceChildren();
    if(needle.length<2) {parent.classList.add('hidden');return;}
    const local=HB_LOCATION_FALLBACK.filter(x=>x.toLowerCase().includes(needle.toLowerCase()))
        .slice(0,5).map(label=>({label,lat:null,lng:null}));
    const render=(results)=>{
        if(request!==hbPlaceRequests.get(containerId))return;
        parent.replaceChildren();
        for(const place of results) {
            const button=document.createElement('button');button.type='button';
            button.textContent=place.label;button.className='location-option';
            button.addEventListener('click',()=>{parent.classList.add('hidden');onSelect(place);});
            parent.append(button);
        }
        if(!results.length){const p=document.createElement('p');p.className='text-xs text-slate-500 p-2';
            p.textContent='No suggestions yet. You can still type any address.';parent.append(p);}
        parent.classList.remove('hidden');
    };
    // Show offline Baguio suggestions immediately; do not make typing depend on an external API.
    render(local);
    if(needle.length<3)return;
    const timer=setTimeout(async()=>{
        try {
            const online=await hbSearchPlaces(needle);
            if(request!==hbPlaceRequests.get(containerId))return;
            const extras=local.filter(item=>!online.some(p=>p.label.toLowerCase().includes(item.label.toLowerCase())));
            render([...online,...extras].slice(0,7));
        }catch(_){ /* Keep the already displayed offline suggestions. */ }
    },650);
    hbPlaceTimers.set(containerId,timer);
}
function queueStudentLocationSuggestions(value) {
    const input=document.getElementById('filterLocation');
    if(!input)return;
    hbStudentSearchPoint=null;
    document.getElementById('studentSearchRadius')?.classList.add('hidden');
    hbQueuePlaceSearch(value,'studentLocationSuggestions',place=>{
        input.value=place.label;
        if(Number.isFinite(place.lat)&&Number.isFinite(place.lng)) {
            hbStudentSearchPoint={lat:place.lat,lng:place.lng};
            const note=document.getElementById('studentSearchRadius');
            note.textContent='Showing matching listings or properties within ~3 km (straight line).';
            note.classList.remove('hidden');
            if(window.leafletMap?.setView)window.leafletMap.setView([place.lat,place.lng],14);
        }
        applyFilters();
    });
}
function queueListingAddressSuggestions(text) {
    hbQueuePlaceSearch(text,'listingAddressSuggestions', place=>{
        document.getElementById('listingLocation').value=place.label;
        if(Number.isFinite(place.lat)&&Number.isFinite(place.lng)){
            setListingPin(place.lat,place.lng);
            initializeListingPinMap();
            listingPinMap?.setView([place.lat,place.lng],16);
        }
    });
}
function queueCampusSuggestions(text) {
    hbCampusPoint=null;
    document.getElementById('campusDistanceResult').textContent='Select a destination from the suggestions to calculate an estimate.';
    hbQueuePlaceSearch(text.trim().length>=3 ? `${text.trim()}, Baguio` : '', 'campusResults',place=>{
        document.getElementById('campusDestination').value=place.label;
        hbCampusPoint=Number.isFinite(place.lat)&&Number.isFinite(place.lng)?place:null;
        updateCampusDistance();
    });
}
function hbStraightLineKm(a,b) {
    const rad=n=>n*Math.PI/180;
    const R=6371, dLat=rad(b.lat-a.lat), dLon=rad(b.lng-a.lng);
    const h=Math.sin(dLat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLon/2)**2;
    return 2*R*Math.asin(Math.min(1,Math.sqrt(h)));
}
function updateCampusDistance() {
    const output=document.getElementById('campusDistanceResult');
    const dorm=activeDormViewing;
    if (!output) return;
    if (!hbCampusPoint || !Number.isFinite(dorm?.lat) || !Number.isFinite(dorm?.lng)) {
        output.textContent='A property map pin and a selected destination are needed to estimate distance.';return;
    }
    const km=hbStraightLineKm({lat:dorm.lat,lng:dorm.lng},hbCampusPoint);
    const walk=Math.max(1,Math.ceil(km/4.5*60));
    output.textContent=`≈ ${km.toFixed(1)} km in a straight line • about ${walk} min at normal walking pace (actual routes and hills differ).`;
}

function updateRoomMoveInHint() {
    const input=document.getElementById('roomPreferredMoveIn'),out=document.getElementById('roomMoveInHint');
    const room=activeDormViewing?.rooms[selectedRoomIndex];
    if(!input||!out||!room)return;
    input.min=localDateISO(new Date());
    const date=input.value;
    if(!date){out.textContent='Future vacancies are based on the owner’s expected move-out date.';return;}
    const open=displayBedSlots(room).some(b=>b.status==='Available'&&!b.reservedFor);
    const later=displayBedSlots(room).some(b=>b.status==='Occupied'&&b.availableFrom&&b.availableFrom<date&&!b.reservedFor);
    out.textContent=open?'At least one bed is currently available.':later?'An occupied bed may become available by your chosen date. You can request it below.':
        'No bed is currently published as available for that date.';
}
// Only confirmed visits block a property-wide hour. Personal data is never exposed.
let hbBookedVisitSlots = new Set();
let hbVisitSlotRequestSerial = 0;
let hbVisitSlotRefreshing = false;

async function refreshVisitSlotAvailability() {
    const box = document.getElementById('hourVisitSlots');
    const date = document.getElementById('holdVisitDate')?.value;
    const propertyId = activeDormViewing?.id;
    if (!box || !date || !propertyId) return;
    const current = ++hbVisitSlotRequestSerial;
    hbVisitSlotRefreshing = true;
    let succeeded = false;
    box.setAttribute('aria-busy', 'true');
    const status = document.getElementById('hourVisitSlotStatus');
    if (status) status.textContent = 'Checking available visitation hours…';
    syncHourlyVisitSlotStyles();
    try {
        let booked;
        if (HomeboundStore.configured) {
            booked = await HomeboundStore.bookedVisitSlots(propertyId, date);
        } else {
            booked = (typeof visitationsList !== 'undefined' ? visitationsList : [])
                .filter(h => (h.dormId || h.listing_id) === propertyId &&
                    (h.visitDate || h.visit_date) === date && h.status === 'Confirmed Visit')
                .map(h => String(h.visitTime || h.visit_time || '').slice(0,5));
        }
        if (current !== hbVisitSlotRequestSerial || date !== document.getElementById('holdVisitDate')?.value || propertyId !== activeDormViewing?.id) return;
        hbBookedVisitSlots = new Set(booked);
        const time = document.getElementById('holdVisitTime');
        if (hbBookedVisitSlots.has(time?.value)) time.value = '';
        succeeded = true;
        if (status) status.textContent = 'Booked hours are disabled. They reopen when the owner marks the visit completed.';
    } catch (err) {
        if (current !== hbVisitSlotRequestSerial) return;
        hbBookedVisitSlots = new Set();
        if (status) status.textContent = 'Could not check the schedule. Please try again.';
        console.warn('Visitation availability could not be loaded:', err);
        // Do not advertise unverified times as available.
        return;
    } finally {
        if (current === hbVisitSlotRequestSerial) {
            hbVisitSlotRefreshing = !succeeded;
            if (succeeded) box.removeAttribute('aria-busy');
            syncHourlyVisitSlotStyles();
        }
    }
}
function renderHourlyVisitSlots() {
    const box = document.getElementById('hourVisitSlots');
    if (!box) return;
    const date = document.getElementById('holdVisitDate');
    if (date && !date.dataset.slotRefreshBound) {
        date.addEventListener('change', () => { document.getElementById('holdVisitTime').value = ''; void refreshVisitSlotAvailability(); });
        date.dataset.slotRefreshBound = '1';
    }
    box.innerHTML = Array.from({length:12}, (_, i) => {
        const start = i + 8;
        const val = `${String(start).padStart(2,'0')}:00`;
        const label = `${start===12?12:start>12?start-12:start}:00 ${start>=12?'PM':'AM'}–${start+1===12?12:start+1>12?start+1-12:start+1}:00 ${start+1>=12?'PM':'AM'}`;
        return `<button type="button" data-visit-start="${val}" onclick="chooseHourlyVisitSlot('${val}')" class="hour-slot" aria-pressed="false">${label}</button>`;
    }).join('');
    let status = document.getElementById('hourVisitSlotStatus');
    if (!status) {
        status = document.createElement('p');
        status.id = 'hourVisitSlotStatus';
        status.className = 'text-xs text-slate-500 mt-2';
        status.setAttribute('role', 'status');
        box.after(status);
    }
    hbBookedVisitSlots = new Set();
    hbVisitSlotRefreshing = true;
    syncHourlyVisitSlotStyles();
    void refreshVisitSlotAvailability();
}
function chooseHourlyVisitSlot(value) {
    if (hbVisitSlotRefreshing || hbBookedVisitSlots.has(value)) return;
    document.getElementById('holdVisitTime').value = value;
    syncHourlyVisitSlotStyles();
}
function syncHourlyVisitSlotStyles() {
    const selected = document.getElementById('holdVisitTime')?.value;
    document.querySelectorAll('[data-visit-start]').forEach(button => {
        const booked = hbBookedVisitSlots.has(button.dataset.visitStart);
        const disabled = booked || hbVisitSlotRefreshing;
        const active = !disabled && button.dataset.visitStart === selected;
        button.disabled = disabled;
        button.classList.toggle('selected', active);
        button.classList.toggle('opacity-45', disabled);
        button.classList.toggle('cursor-not-allowed', disabled);
        button.setAttribute('aria-pressed', String(active));
        button.setAttribute('aria-label', `${button.textContent} — ${booked ? 'Booked' : hbVisitSlotRefreshing ? 'Checking availability' : 'Available'}`);
        button.title = booked ? 'Already booked for a confirmed visit' : (hbVisitSlotRefreshing ? 'Checking availability' : 'Available');
        let tag = button.querySelector('.visit-slot-booked');
        if (booked && !tag) {
            tag = document.createElement('span');
            tag.className = 'visit-slot-booked block text-[10px]';
            tag.textContent = 'Booked';
            button.appendChild(tag);
        } else if (!booked && tag) tag.remove();
    });
}

// Public expected availability exposes only a date, not private tenant data.
function nextExpectedAvailability(dorm,room) {
    const today=localDateISO(new Date());
    const dates=displayBedSlots(room).filter(b=>b.status==='Occupied' && !b.reservedFor && /^\d{4}-\d{2}-\d{2}$/.test(b.availableFrom||'') && b.availableFrom>=today)
        .map(b=>b.availableFrom).sort();
    return dates[0] || null;
}
function roomAvailableOnDate(dorm,room,moveIn) {
    if (!moveIn) return true;
    if (displayBedSlots(room).some(b=>b.status==='Available' && !b.reservedFor)) return true;
    return displayBedSlots(room).some(b=>b.status==='Occupied' && !b.reservedFor && b.availableFrom && b.availableFrom<moveIn);
}
function showExpectedBedAvailability(room) {
    const box=document.getElementById('roomExpectedAvailability');if(!box)return;
    const date=nextExpectedAvailability(activeDormViewing,room);
    const reserved=displayBedSlots(room).filter(b=>b.reservedFor).map(b=>b.reservedFor).sort()[0];
    box.textContent=reserved?`A bed has an approved advance reservation for ${reserved}.`:
        date?`Upcoming vacancy expected after ${date} (subject to confirmation).`:
            'No future vacancy date published for this room.';
    updateCampusDistance();
}

function openAdvanceReservationForm() {
    const dorm=activeDormViewing,room=dorm?.rooms[selectedRoomIndex];
    if(!dorm || !room) return;
    hbCurrentAdvanceRoom={listingId:dorm.id,roomName:room.name};
    document.getElementById('advanceReservationRoom').textContent=`${dorm.title} • ${room.name}`;
    const beds=displayBedSlots(room).filter(b=>b.status!=='Unavailable');
    const select=document.getElementById('advanceBedSlot');
    select.replaceChildren(...beds.map(b=>new Option(b.id.replace('bed-','Bed '),b.id)));
    if(!beds.length){showToast('No reservable beds in this room.','error');return;}
    select.onchange=()=>hbCalSelectBed(select.value);
    document.getElementById('advanceReservationHint').textContent='Owner approval is required.';
    document.getElementById('modalAdvanceReservation').classList.remove('hidden');
    hbCalOpenStudent(dorm.id,room.name,select.value);
}
async function submitAdvanceReservation(event) {
    event.preventDefault();
    const listing=dormsData.find(d=>d.id===hbCurrentAdvanceRoom?.listingId);
    const room=listing?.rooms.find(r=>r.name===hbCurrentAdvanceRoom?.roomName);
    const bed=displayBedSlots(room).find(b=>b.id===document.getElementById('advanceBedSlot').value);
    if(!listing||!room||!bed)return;
    const btn=event.target.querySelector('[type=submit]');btn.disabled=true;
    try {
        await hbCalValidateSelection();
        let chat={};try{chat=JSON.parse(localStorage.getItem('homebound-chat-'+listing.id)||'{}')||{};}catch(_){}
        const payload={listingId:listing.id,roomName:room.name,bedSlot:bed.id,
          moveIn:hbCalendarState.start,moveOut:hbCalendarState.end,
          studentName:document.getElementById('advanceName').value.trim(),
          phone:document.getElementById('advancePhone').value.trim(),
          email:document.getElementById('advanceEmail').value.trim(),token:crypto.randomUUID(),
          chatToken:chat.token||crypto.randomUUID(),conversationId:chat.id||null};
        const result=HomeboundStore.configured ? await HomeboundStore.createAdvanceReservation(payload)
          : {id:crypto.randomUUID(),status:'Pending'};
        let records=[];try{records=JSON.parse(localStorage.getItem(HB_ADVANCE_KEY)||'[]');}catch(_){}
        if(result.conversationId){
          localStorage.setItem('homebound-chat-'+listing.id,JSON.stringify({
             id:result.conversationId,token:payload.chatToken,seenOwnerIds:chat.seenOwnerIds||[]
          }));
        }
        records.push({id:result.id,token:payload.token,listingId:listing.id,title:listing.title,
            conversationId:result.conversationId||null,
            roomName:room.name,bedSlot:bed.id,moveIn:payload.moveIn,moveOut:payload.moveOut,status:'Pending'});
        if(!HomeboundStore.configured){
          let conversation=demoConversations.find(c=>c.id===payload.conversationId);
          if(!conversation){conversation={id:crypto.randomUUID(),listingId:listing.id,updatedAt:new Date().toISOString(),messages:[]};demoConversations.unshift(conversation);}
          conversation.messages.push({id:crypto.randomUUID(),sender:'student',body:`Advance reservation requested: ${room.name}, ${bed.id} (move-in ${payload.moveIn}, move-out ${payload.moveOut}).`,created_at:new Date().toISOString()});
          const rec=records[records.length-1];rec.conversationId=conversation.id;
          localStorage.setItem('homebound-chat-'+listing.id,JSON.stringify({id:conversation.id,token:payload.chatToken,seenOwnerIds:[]}));
          hbDemoAdvance.push({...payload,id:result.id,conversationId:conversation.id,status:'Pending'});
        }
        localStorage.setItem(HB_ADVANCE_KEY,JSON.stringify(records.slice(-30)));
        closeModal('modalAdvanceReservation');
        // Show an explicit success confirmation; submission is not an approved booking.
        document.getElementById('hbReservationSentModal')?.classList.remove('hidden');
        if(typeof pollStudentInbox==='function')pollStudentInbox();
        refreshStudentAdvanceStatuses();
    }catch(err){showToast(`Advance reservation could not be sent: ${err.message}`,'error');}
    finally{btn.disabled=false;}
}
// Private, browser-scoped advance request status cards inside the corresponding
// student conversation. No reservation details are exposed to other students.
let hbStudentAdvanceRecords = [];
function renderAdvanceChatStatuses() {
    const box=document.getElementById('liveChatMessages');
    if(!box) return;
    box.querySelectorAll('[data-hb-advance-notice]').forEach(node=>node.remove());
    if (!studentChatListingId || document.getElementById('liveChatDrawer')?.classList.contains('hidden')) return;
    const relevant=hbStudentAdvanceRecords.filter(r=>r.listingId===studentChatListingId);
    for(const record of relevant.slice(-8)) {
        const card=document.createElement('div');
        card.dataset.hbAdvanceNotice='true';
        card.className='hb-advance-chat-card';
        const heading=document.createElement('strong');
        heading.className='block text-xs text-slate-900';
        heading.textContent=`Advance reservation · ${record.status || 'Pending'}`;
        const details=document.createElement('p');
        details.className='text-xs text-slate-600 mt-1';
        details.textContent=`${record.roomName}${record.moveIn ? ' · Move-in: '+record.moveIn+' · Move-out: '+(record.moveOut||'date not recorded') : ''}`;
        const context=document.createElement('p');
        context.className='text-[11px] text-slate-500 mt-1';
        context.textContent=record.status==='Approved' ? (record.activated ? 'Rental started. Payment tracking is active.' : 'Approved. Rent starts when your scheduled tenancy activates.')
            : record.status==='Alternative Offered' ? `Owner offers ${record.offeredStart} to ${record.offeredEnd} checkout.${record.offerMessage?' '+record.offerMessage:''}`
            : record.status==='Declined' ? 'Request declined. You can message the owner for other dates.'
            : record.status==='Fulfilled' ? 'Your scheduled rental has started.'
            : 'Awaiting owner review.';
        if(record.status==='Alternative Offered') {
          const actions=document.createElement('div');actions.className='flex gap-2 mt-2';
          for(const [accept,label] of [[true,'Accept dates'],[false,'Decline offer']]){
            const button=document.createElement('button');button.type='button';button.textContent=label;
            button.className='text-xs font-semibold px-3 py-1.5 rounded-lg border border-brand-300 hover:bg-brand-50';
            button.addEventListener('click',()=>respondAdvanceOffer(record.id,accept));actions.append(button);
          }
          card.append(actions);
        }
        card.append(heading,details,context);
        box.append(card);
    }
    if(relevant.length) box.scrollTop=box.scrollHeight;
}
async function refreshStudentAdvanceStatuses() {
    let records=[];
    try {records=JSON.parse(localStorage.getItem(HB_ADVANCE_KEY)||'[]');} catch(_) {}
    if(!Array.isArray(records)) records=[];
    for(const r of records) {
        if(!r?.id || !r?.token) continue;
        try {
            const data=HomeboundStore.configured ? await HomeboundStore.getAdvanceStatus(r.id,r.token)
                : hbDemoAdvance.find(p=>p.id===r.id);
            if(data?.status){
              r.status=data.status;r.offeredStart=data.offered_start||data.offeredStart||null;r.offeredEnd=data.offered_end||data.offeredEnd||null;
              r.offerMessage=data.offer_message||data.offerMessage||'';r.activated=Boolean(data.activated||data.activated_tenancy_id);
              if(data.move_in_date)r.moveIn=data.move_in_date;
              if(data.move_out_date)r.moveOut=data.move_out_date;
              if(data.conversation_id)r.conversationId=data.conversation_id;
            }
        }catch(err){ console.warn('Advance request status temporarily unavailable',err.message); }
    }
    // Older browser records predate listingId; recover it from the saved title.
    for(const r of records) {
        if(!r.listingId && r.title) r.listingId=dormsData.find(d=>d.title===r.title)?.id||null;
    }
    hbStudentAdvanceRecords=records.slice(-30);
    localStorage.setItem(HB_ADVANCE_KEY,JSON.stringify(hbStudentAdvanceRecords));
    renderAdvanceChatStatuses();
    if(typeof renderStudentInbox==='function') renderStudentInbox();
}
async function respondAdvanceOffer(id,accept) {
    const record=hbStudentAdvanceRecords.find(r=>r.id===id);
    if(!record)return;
    try {
      if(HomeboundStore.configured) await HomeboundStore.respondReservationOffer(id,record.token,accept);
      else {
        const item=hbDemoAdvance.find(r=>r.id===id);
        if(!item||item.status!=='Alternative Offered')throw Error('This offer is no longer available.');
        if(accept){item.moveIn=item.offeredStart;item.moveOut=item.offeredEnd;item.status='Pending';}
        else item.status='Declined';
        const c=demoConversations.find(c=>c.id===item.conversationId);
        c?.messages.push({id:crypto.randomUUID(),sender:'student',body:accept?'I accept the offered dates. Please review my updated request.':'I decline the offered dates.',created_at:new Date().toISOString()});
      }
      await refreshStudentAdvanceStatuses();await refreshStudentChat();
      showToast(accept?'New dates sent for owner review.':'Offer declined.','success');
    }catch(e){showToast(`Could not respond: ${e.message}`,'error');}
}
async function loadAdvanceReservations() {
    const list=document.getElementById('advanceOwnerList');if(!list)return;
    try {
        hbAdvanceOwnerRecords=HomeboundStore.configured ? (activeOwner?await HomeboundStore.listAdvanceReservations():[]) : hbDemoAdvance;
        const pending=hbAdvanceOwnerRecords.filter(r=>r.status==='Pending').length;
        const badge=document.getElementById('badgeReservationCount');if(badge)badge.textContent=pending;
        list.innerHTML=hbAdvanceOwnerRecords.length ? hbAdvanceOwnerRecords.map(r=>{
            const status=r.status||'Pending';
            const name=r.student_name||r.studentName;
            const listing=r.listing_id||r.listingId;
            const room=r.room_name||r.roomName;
            const slot=r.bed_slot||r.bedSlot;
            const start=r.move_in_date||r.moveIn;
            const end=r.move_out_date||r.moveOut;
            return `<div class="rounded-xl border border-slate-200 p-3 flex flex-wrap items-center justify-between gap-3">
                <div class="min-w-0"><strong class="text-sm">${escHtml(name)}</strong> <span class="text-xs text-slate-500">· ${escHtml(status)}</span>
                <p class="text-xs text-slate-600 mt-1">${escHtml(lookupPropertyName(listing))} · ${escHtml(room)} / ${escHtml(slot)}</p>
                <p class="text-xs text-slate-600">${escHtml(start)} → ${escHtml(end)} checkout${r.activated_tenancy_id?' · Rental active':''}</p>
                ${status==='Alternative Offered'?`<p class="text-xs text-amber-700">Offered: ${escHtml(r.offered_start||r.offeredStart)} → ${escHtml(r.offered_end||r.offeredEnd)} · Awaiting student</p>`:''}
                ${status==='Approved'?`<p class="text-xs text-brand-700">Scheduled rental · ${formatPeso(r.monthly_rent||r.monthlyRent)} / month · due day ${escHtml(r.due_day||r.dueDay)}</p>`:''}</div>
                <div class="flex gap-2 items-center">${status==='Pending'?`
                   <button type="button" class="simple-icon-btn" title="Approve and set rent terms" aria-label="Approve and set rent terms" onclick="openReservationReview('${escHtml(r.id)}','Approved')"><i class="fa-solid fa-check"></i></button>
                   <button type="button" class="simple-icon-btn" title="Offer different dates" aria-label="Offer different dates" onclick="openReservationReview('${escHtml(r.id)}','Alternative Offered')"><i class="fa-solid fa-calendar-plus"></i></button>
                   <button type="button" class="simple-icon-btn" title="Decline" aria-label="Decline" onclick="reviewAdvanceReservation('${escHtml(r.id)}','Declined')"><i class="fa-solid fa-xmark"></i></button>`:
                   status==='Declined'?`<button type="button" class="simple-icon-btn" title="Offer new dates" aria-label="Offer new dates" onclick="openReservationReview('${escHtml(r.id)}','Alternative Offered')"><i class="fa-solid fa-calendar-plus"></i></button>`:
                   status==='Approved' && !r.monthly_rent?`<button type="button" class="simple-icon-btn" title="Set missing rent terms" aria-label="Set missing rent terms" onclick="openReservationReview('${escHtml(r.id)}','Finalize Rent')"><i class="fa-solid fa-file-invoice-dollar"></i></button>`:
                   status==='Approved' && !r.activated_tenancy_id?`<button type="button" class="simple-icon-btn" title="Cancel reservation" aria-label="Cancel reservation" onclick="reviewAdvanceReservation('${escHtml(r.id)}','Cancelled')"><i class="fa-solid fa-ban"></i></button>`:''}</div>
            </div>`;
        }).join('') : '<p class="text-slate-500 text-xs">No reservation requests yet.</p>';
    }catch(e){list.textContent=`Could not load requests: ${e.message}`;}
}
function openReservationReview(id,action) {
    const record=hbAdvanceOwnerRecords.find(r=>r.id===id);if(!record)return;
    document.getElementById('reservationReviewId').value=id;
    document.getElementById('reservationReviewAction').value=action;
    const isApproval=action==='Approved'||action==='Finalize Rent';
    document.getElementById('reservationReviewTitle').textContent=action==='Finalize Rent'?'Complete rent details':isApproval?'Approve and schedule rental':'Offer alternative dates';
    document.getElementById('reservationReviewSummary').textContent=`${record.student_name||record.studentName} · ${record.room_name||record.roomName} · ${record.move_in_date||record.moveIn} to ${record.move_out_date||record.moveOut}`;
    document.getElementById('reservationApprovalFields').classList.toggle('hidden',!isApproval);
    document.getElementById('reservationOfferFields').classList.toggle('hidden',isApproval);
    document.getElementById('reservationMonthlyRent').value=record.monthly_rent||'';
    document.getElementById('reservationDueDay').value=Number((record.move_in_date||record.moveIn||'').slice(-2))||1;
    const today=localDateISO(new Date());
    document.getElementById('reservationOfferStart').min=today;
    document.getElementById('reservationOfferEnd').min=today;
    document.getElementById('reservationOfferStart').value='';document.getElementById('reservationOfferEnd').value='';
    document.getElementById('reservationOfferNote').value='';
    document.getElementById('reservationReviewSubmit').textContent=action==='Finalize Rent'?'Save rent terms':isApproval?'Approve and schedule':'Send date offer';
    document.getElementById('modalReservationReview').classList.remove('hidden');
}
async function submitReservationReview(event) {
  event.preventDefault();const action=document.getElementById('reservationReviewAction').value;
  const id=document.getElementById('reservationReviewId').value;
  const payload={id,action,monthlyRent:['Approved','Finalize Rent'].includes(action)?Number(document.getElementById('reservationMonthlyRent').value):null,
    dueDay:['Approved','Finalize Rent'].includes(action)?Number(document.getElementById('reservationDueDay').value):null,
    offerStart:document.getElementById('reservationOfferStart').value,
    offerEnd:document.getElementById('reservationOfferEnd').value,note:document.getElementById('reservationOfferNote').value.trim()};
  if(['Approved','Finalize Rent'].includes(action)&&(!payload.monthlyRent||!Number.isInteger(payload.dueDay)||payload.dueDay<1||payload.dueDay>31)){
    showToast('Enter monthly rent and a due day from 1–31.','error');return;
  }
  if(action==='Alternative Offered'&&(!payload.offerStart||!payload.offerEnd||payload.offerEnd<=payload.offerStart)){
    showToast('Choose a new move-in and later checkout date.','error');return;
  }
  const button=document.getElementById('reservationReviewSubmit');button.disabled=true;
  try {
    await reviewAdvanceReservation(id,action,payload);
    closeModal('modalReservationReview');
  }catch(_){/* Review function already displays the error. */}
  finally{button.disabled=false;}
}
async function reviewAdvanceReservation(id,status,payload={}) {
  if(!['Approved','Declined','Cancelled','Alternative Offered','Finalize Rent'].includes(status))return;
  if(['Declined','Cancelled'].includes(status)&&!confirm(`${status==='Declined'?'Decline':'Cancel'} this request?`))return;
  try {
    if(HomeboundStore.configured){
      const changed=status==='Finalize Rent' ? await HomeboundStore.finalizeReservationRent(id,payload.monthlyRent,payload.dueDay)
        : await HomeboundStore.reviewReservation({id,action:status,...payload});
      if(!changed)throw Error('Reservation is no longer pending. Refresh.');
    }else{
      const item=hbDemoAdvance.find(r=>r.id===id);
      if(!item || !((item.status==='Pending'&&status!=='Cancelled')||(item.status==='Declined'&&status==='Alternative Offered')||(item.status==='Approved'&&['Cancelled','Finalize Rent'].includes(status))))throw Error('Cannot review this request.');
      if(status==='Finalize Rent'){item.monthlyRent=payload.monthlyRent;item.dueDay=payload.dueDay;}
      if(status==='Approved'){
        for(let d=item.moveIn;d<item.moveOut;d=hbCalNext(d)){
          const room=dormsData.find(x=>x.id===item.listingId)?.rooms.find(r=>r.name===item.roomName);
          const bed=displayBedSlots(room).find(b=>b.id===item.bedSlot);
          if(!bed||!['available','expected'].includes(hbCalBedStatus(bed,d,item.listingId,item.roomName).status))throw Error('Dates are no longer available.');
        }
        item.monthlyRent=payload.monthlyRent;item.dueDay=payload.dueDay;
      }
      if(status==='Alternative Offered'){
        item.offeredStart=payload.offerStart;item.offeredEnd=payload.offerEnd;item.offerMessage=payload.note;
      }
      if(status!=='Finalize Rent') item.status=status;
      const c=demoConversations.find(c=>c.id===item.conversationId);
      if(c){c.messages.push({id:crypto.randomUUID(),sender:'owner',body:status==='Approved'?'Reservation approved. Rent terms recorded for your scheduled move-in.':status==='Alternative Offered'?`Alternative dates offered: ${payload.offerStart} to ${payload.offerEnd}. ${payload.note||''}`:`Reservation ${status.toLowerCase()}.`,created_at:new Date().toISOString()});c.updatedAt=new Date().toISOString();}
      const room=dormsData.find(x=>x.id===item.listingId)?.rooms.find(r=>r.name===item.roomName);
      const bed=room&&displayBedSlots(room).find(b=>b.id===item.bedSlot);
      if(bed){if(status==='Approved')bed.reservedFor=item.moveIn;else if(status!=='Finalize Rent')delete bed.reservedFor;}
    }
    await loadAdvanceReservations();refreshListingViews();refreshStudentAdvanceStatuses();
    if(typeof loadOwnerInbox==='function'&&currentPortal==='owner')await loadOwnerInbox();
    showToast(status==='Alternative Offered'?'Alternative dates sent in chat.':`Reservation ${status.toLowerCase()}.`,'success');
  }catch(e){showToast(`Could not review: ${e.message}`,'error');throw e;}
}

// Optional announcement photo, saved with its notice in the existing text RPC.
// This marker is internal to Homebound and is never interpreted as HTML.
let hbAnnouncementPhotoUrl = null;
const HB_ANNOUNCEMENT_IMAGE_MARKER = /(?:\n\n)?\[HB_ANNOUNCEMENT_IMAGE:(https:\/\/[^\]\s]+)\]\s*$/;
function hbAnnouncementParts(raw) {
    const body=String(raw || '');
    const match=body.match(HB_ANNOUNCEMENT_IMAGE_MARKER);
    const text=match ? body.slice(0,match.index) : body;
    const src=match && typeof safeImageUrl === 'function' ? safeImageUrl(match[1]) : null;
    const image=src && src !== FALLBACK_IMAGE
        ? `<a href="${src}" target="_blank" rel="noopener noreferrer" aria-label="View announcement photo"><img src="${src}" alt="Announcement photo" loading="lazy" class="mt-3 max-h-64 w-auto max-w-full rounded-lg border border-slate-200 object-contain" onerror="onImageLoadError(this)"></a>` : '';
    return {text:escHtml(text), image};
}
function previewAnnouncementPhoto(input) {
    const file=input?.files?.[0];
    if(!file){clearAnnouncementPhoto();return;}
    if(!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size<1 || file.size>5*1024*1024){
        showToast('Choose a nonempty JPG, PNG or WebP image up to 5 MB.','error');
        clearAnnouncementPhoto();return;
    }
    if(hbAnnouncementPhotoUrl) URL.revokeObjectURL(hbAnnouncementPhotoUrl);
    hbAnnouncementPhotoUrl=URL.createObjectURL(file);
    document.getElementById('announcementPhotoThumb').src=hbAnnouncementPhotoUrl;
    document.getElementById('announcementPhotoName').textContent=file.name;
    document.getElementById('announcementPhotoPreview').classList.remove('hidden');
}
function clearAnnouncementPhoto() {
    const input=document.getElementById('announcementPhotoFile');
    if(input)input.value='';
    if(hbAnnouncementPhotoUrl)URL.revokeObjectURL(hbAnnouncementPhotoUrl);
    hbAnnouncementPhotoUrl=null;
    document.getElementById('announcementPhotoPreview')?.classList.add('hidden');
    const thumb=document.getElementById('announcementPhotoThumb');
    if(thumb)thumb.removeAttribute('src');
}
function hbAnnouncementMessageHtml(body, className='text-sm text-slate-700 mt-1') {
    const parts=hbAnnouncementParts(body);
    return `<p class="${className} whitespace-pre-wrap">${parts.text}</p>${parts.image}`;
}

// Tenant announcements are readable only by a private tenancy token.
async function loadTenantAnnouncements() {
    const list=document.getElementById('ownerAnnouncements'),audience=document.getElementById('announcementAudience');
    if (!list || !audience) return;
    const selected=audience.value;
    audience.innerHTML='<option value="all">All active tenants</option>'+getOwnerListings().map(d=>`<option value="${escHtml(d.id)}">${escHtml(d.title)}</option>`).join('');
    audience.value=[...audience.options].some(o=>o.value===selected)?selected:'all';
    syncAnnouncementVisibility();
    const tenantSelect=document.getElementById('announcementTenantSelect');
    if(tenantSelect){const prev=tenantSelect.value;tenantSelect.innerHTML='<option value="">Choose active tenant</option>'+tenantRecords.filter(t=>t.status==='Active').map(t=>`<option value="${escHtml(t.id)}">${escHtml(t.tenant_name)} · ${escHtml(lookupPropertyName(t.listing_id))}</option>`).join('');tenantSelect.value=prev;}
    try {
        const records=HomeboundStore.configured ? activeOwner ? await HomeboundStore.listAnnouncements():[] : hbDemoAnnouncements;
        list.innerHTML=records.length ? records.map(a=>`<div class="rounded-xl border border-slate-200 p-3"><strong>${escHtml(a.title)}</strong>
            ${hbAnnouncementMessageHtml(a.body)}<p class="text-xs text-slate-500 mt-2">${escHtml(a.created_at?new Date(a.created_at).toLocaleString():new Date().toLocaleString())} · ${a.listing_id?escHtml(lookupPropertyName(a.listing_id)):'All active tenants'}</p></div>`).join('') : '<p class="text-xs text-slate-500">No announcements yet.</p>';
    }catch(e){list.textContent=`Could not load announcements: ${e.message}`;}
}
async function submitTenantAnnouncement(event) {
    event.preventDefault();
    const title=document.getElementById('announcementTitle').value.trim(),body=document.getElementById('announcementBody').value.trim();
    const audience=document.getElementById('announcementAudience').value;
    const isPublic=audience==='all'&&Boolean(document.getElementById('announcementPublic')?.checked);
    if(!title || !body)return;
    const button=event.target.querySelector('[type=submit]');
    const file=document.getElementById('announcementPhotoFile')?.files?.[0] || null;
    if(file && (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size<1 || file.size>5*1024*1024)) {
        showToast('Choose a nonempty JPG, PNG or WebP image up to 5 MB.','error');return;
    }
    button.disabled=true;
    const originalButtonText=button.textContent;
    try {
        let announcementBody=body;
        if(file){
            if(HomeboundStore.configured){
                button.textContent='Uploading photo…';
                const photoUrl=await HomeboundStore.uploadImage(file);
                announcementBody+=`\n\n[HB_ANNOUNCEMENT_IMAGE:${photoUrl}]`;
            }else{
                // Demo mode can preview, but not preserve an image without online storage.
                showToast('Sign in with Supabase to publish a photo. Text-only notices work in demo mode.','error');return;
            }
        }
        if(announcementBody.length>1500){
            showToast('Message is too long with the photo link. Shorten the text and try again.','error');return;
        }
        button.textContent='Publishing…';
        if(HomeboundStore.configured) await HomeboundStore.publishAnnouncement(audience==='all'?null:audience,title,announcementBody,isPublic);
        else hbDemoAnnouncements.unshift({id:crypto.randomUUID(),listing_id:audience==='all'?null:audience,
            targets:tenantRecords.filter(t=>t.status==='Active' && (audience==='all'||t.listing_id===audience)).map(t=>t.announcement_token),
            is_public:isPublic,title,body:announcementBody,created_at:new Date().toISOString()});
        event.target.reset();clearAnnouncementPhoto();document.getElementById('announcementPublic').checked=true;
        syncAnnouncementVisibility();await loadTenantAnnouncements();await loadPublicAnnouncements();
        showToast(isPublic?'Announcement posted to the Community Updates board.':'Private tenant announcement published.','success');
    }catch(e){showToast(`Announcement failed: ${e.message}`,'error');}
    finally{button.disabled=false;button.textContent=originalButtonText;}
}
function syncAnnouncementVisibility() {
    const publicOption=document.getElementById('publicAnnouncementOption');
    const checkbox=document.getElementById('announcementPublic');
    const universal=document.getElementById('announcementAudience')?.value==='all';
    const wasHidden=Boolean(publicOption?.classList.contains('hidden'));
    if(publicOption)publicOption.classList.toggle('hidden',!universal);
    if(checkbox && !universal) checkbox.checked=false;
    else if(checkbox && universal && wasHidden) checkbox.checked=true;
}
function copySelectedTenantUpdatesLink() {
    const id=document.getElementById('announcementTenantSelect')?.value;
    if(!id) {showToast('Select an active tenant first.','error');return;}
    copyTenantUpdatesLink(id);
}
// Public announcements are visible to students; record read-state locally per device.
const HB_PUBLIC_ANNOUNCEMENT_SEEN = 'homebound-public-announcement-last-seen-v1';
let hbLatestPublicNoticeDate = '';
function hbMarkPublicAnnouncementsRead() {
    if (!hbLatestPublicNoticeDate) return;
    try { localStorage.setItem(HB_PUBLIC_ANNOUNCEMENT_SEEN, hbLatestPublicNoticeDate); }
    catch (_) { /* Local storage may be disabled. */ }
    document.getElementById('announcementUnreadBadge')?.classList.add('hidden');
}
function hbUpdateAnnouncementBadge(records) {
    const badge = document.getElementById('announcementUnreadBadge');
    if (!badge) return;
    hbLatestPublicNoticeDate = records.length ? String(records[0].created_at || '') : '';
    let seen = '';
    try { seen = localStorage.getItem(HB_PUBLIC_ANNOUNCEMENT_SEEN) || ''; }
    catch (_) { /* Treat as not seen. */ }
    const unread = records.filter(r => String(r.created_at || '') > seen).length;
    const panelIsOpen = !document.getElementById('studentAnnouncementSection')?.classList.contains('hidden');
    if (panelIsOpen && currentPortal === 'student') {
        hbMarkPublicAnnouncementsRead();
        return;
    }
    badge.textContent = String(Math.min(unread, 99));
    badge.classList.toggle('hidden', currentPortal !== 'student' || unread === 0);
}
async function loadPublicAnnouncements() {
    const feed=document.getElementById('publicAnnouncementFeed');
    if(!feed) return;
    const headline=document.getElementById('publicAnnouncementHeadline');
    try {
        const response=HomeboundStore.configured
            ? await HomeboundStore.publicAnnouncements()
            : hbDemoAnnouncements.filter(a=>a.is_public);
        // Supabase RPC may return a JSON array or a serialized JSON value.
        const records=typeof response==='string' ? JSON.parse(response) : response;
        if(!Array.isArray(records)) throw new Error('Unexpected public announcements response');
        records.sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')));
        hbUpdateAnnouncementBadge(records);
        if(headline) headline.textContent=records.length
            ? `${records.length} public update${records.length===1?'':'s'}`
            : 'No public announcements yet';
        feed.innerHTML=records.length ? records.slice(0,10).map(a=>
            `<article class="hb-notice"><div class="flex items-start justify-between gap-2"><strong class="text-slate-900">${escHtml(a.title)}</strong><time class="text-[11px] text-slate-500 shrink-0">${a.created_at?escHtml(new Date(a.created_at).toLocaleDateString('en-PH')):''}</time></div>${hbAnnouncementMessageHtml(a.body,'text-slate-700 mt-2')}</article>`
        ).join(''):'<p class="text-slate-500 text-xs">The landlord has not published a public notice yet.</p>';
    } catch(err) {
        console.warn('Community Updates could not load:',err);
        if(headline)headline.textContent='Unable to load updates';
        feed.innerHTML='<p class="text-xs text-amber-800">Updates could not be loaded. Check your connection or whether the latest Supabase SQL migration was applied.</p>';
    }
}
function copyTenantUpdatesLink(tenancyId) {
    const tenant=tenantRecords.find(t=>t.id===tenancyId);
    if(!tenant?.announcement_token) {showToast('Tenant access link not available. Refresh tenant records after applying the SQL migration.','error');return;}
    const url=new URL(location.href);
    url.searchParams.set('tenant-updates',tenant.announcement_token);
    url.hash='';
    if(navigator.clipboard?.writeText) navigator.clipboard.writeText(url.toString())
        .then(()=>showToast('Private tenant update link copied. Share it only with this tenant.','success'))
        .catch(()=>prompt('Copy private tenant updates link',url.toString()));
    else prompt('Copy private tenant updates link',url.toString());
}
async function loadTenantUpdates() {
    const box=document.getElementById('tenantUpdatesList');if(!box)return;
    const token=new URLSearchParams(location.search).get('tenant-updates');
    try {
        if(!token || !/^[a-f\d-]{36}$/i.test(token))throw new Error('Invalid tenant link');
        const records=HomeboundStore.configured?await HomeboundStore.tenantAnnouncements(token):
            hbDemoAnnouncements.filter(a=>(a.targets||[]).includes(token));
        box.innerHTML=records.length?records.map(a=>`<article class="border rounded-xl p-4"><h3 class="font-bold">${escHtml(a.title)}</h3>
          ${hbAnnouncementMessageHtml(a.body,'text-sm text-slate-700 mt-2')}<p class="text-xs text-slate-500 mt-2">${escHtml(new Date(a.created_at).toLocaleString())}</p></article>`).join('')
            : '<p class="text-sm text-slate-500">No announcements for this tenancy yet.</p>';
    }catch(e){box.textContent=`Cannot show updates: ${e.message}`;}
}
function closeTenantUpdates() {
    document.getElementById('tenantUpdatesView')?.classList.add('hidden');
    const url=new URL(location.href);url.searchParams.delete('tenant-updates');history.replaceState(null,'',url.pathname+url.search+url.hash);
}
async function editPlannedEndDate(tenancyId) {
    const t=tenantRecords.find(t=>t.id===tenancyId && t.status==='Active');if(!t)return;
    const value=prompt('Expected move-out date (YYYY-MM-DD). Leave blank to clear the estimate.',t.planned_end_date||'');
    if(value===null)return;
    if(value && (!/^\d{4}-\d{2}-\d{2}$/.test(value)||value<currentPhilippineDate())) {showToast('Enter a valid future date.','error');return;}
    try {
        if(HomeboundStore.configured) {await HomeboundStore.setPlannedEndDate(t.id,value||null);await Promise.all([loadListings(),loadOwnerRentData()]);}
        else {
            t.planned_end_date=value||null;
            const room=dormsData.find(d=>d.id===t.listing_id)?.rooms.find(r=>r.name===t.room_name);
            const bed=room?.beds.find(b=>b.id===t.bed_slot);
            if(bed){if(value)bed.availableFrom=value;else delete bed.availableFrom;}
            renderAdminTables();refreshListingViews();
        }
        showToast('Expected move-out date updated. This is not an automatic tenancy end.','success');
    }catch(e){showToast(`Could not save date: ${e.message}`,'error');}
}

function setAnalyticsView() {
    // Analytics is now one owner-only workspace; retain this function for compatibility.
    document.querySelectorAll('#tabContentAnalytics [data-analytics-view]')
        .forEach(block => block.classList.remove('hidden'));
    requestAnimationFrame(() => {
        reportCharts.forEach(chart => { try { chart.resize(); } catch (_) {} });
        try { hbForecastChart?.resize(); } catch (_) {}
    });
}

function renderHomeboundForecast() {
    const rows=document.getElementById('forecastMonthlyRows');
    if(!rows)return;
    const period=homeboundAnalyticsMonths();
    if(!period.valid){rows.innerHTML='';hbForecastChart?.destroy();hbForecastChart=null;return;}
    const now=new Date();
    const thisMonth=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
    let selected=period.months;
    if(period.mode==='all'){
        // Keep the existing historical plus six-month forward outlook for All data.
        selected=Array.from({length:12},(_,i)=>{
            const d=new Date(now.getFullYear(),now.getMonth()-5+i,1);
            return {key:`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`,label:d.toLocaleString('en-PH',{month:'short',year:'numeric'})};
        });
    }
    const months=selected.map(m=>{
        const [y,mo]=m.key.split('-').map(Number);
        const lastDay=new Date(y,mo,0).getDate();
        return {...m,first:`${m.key}-01`,last:`${m.key}-${String(lastDay).padStart(2,'0')}`,future:m.key>thisMonth};
    });
    const payments=getPaymentViewRecords();
    const historical=months.map(m=>m.future?null:payments.filter(p=>String(p.dueDate).startsWith(m.key))
        .reduce((n,p)=>n+Number(p.amount||0),0));
    const projected=months.map(m=>!m.future?null:tenantRecords.filter(t=>
        t.status==='Active'&&t.start_date<=m.last&&(!t.planned_end_date||t.planned_end_date>=m.first))
        .reduce((sum,t)=>sum+Number(t.monthly_rent||0),0));
    rows.innerHTML=months.map((m,i)=>`<tr class="border-b border-slate-100"><td class="p-2 whitespace-nowrap">${escHtml(m.label)}</td><td class="p-2">${historical[i]===null?'—':escHtml(formatPeso(historical[i]))}</td><td class="p-2">${projected[i]===null?'—':escHtml(formatPeso(projected[i]))}</td><td class="p-2 text-slate-500">${m.future?'Estimate from active agreements':'Recorded dues, not received income'}</td></tr>`).join('');
    if(!window.Chart)return;
    hbForecastChart?.destroy();
    const canvas=document.getElementById('chartRentMonthly');if(!canvas)return;
    hbForecastChart=new Chart(canvas,{
        type:'bar',data:{labels:months.map(m=>m.label),datasets:[
            {label:'Recorded rent dues (₱)',data:historical,backgroundColor:'#059669'},
            {label:'Projected contractual rent (₱)',data:projected,backgroundColor:'#60a5fa'}]},
        options:{responsive:true,maintainAspectRatio:false,animation:false,plugins:{
            tooltip:{callbacks:{label:ctx=>`${ctx.dataset.label}: ${formatPeso(ctx.parsed.y)}`}}},
            scales:{y:{beginAtZero:true,ticks:{callback:val=>`₱${Number(val).toLocaleString()}`}}}}
    });
}
