/* HOMEBOUND: date-accurate occupancy calendar. No personal tenancy data is exposed. */
const HB_CALENDAR_MONTH_LIMIT = 12;
const hbCalendarState = {
  context: 'student', listingId: null, roomName: null, bedSlot: null,
  month: new Date().toISOString().slice(0,7),
  start: null, end: null, days: [], busy: false, requestId: 0
};
function hbCalDate(year, month, day) {
  return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}
function hbCalNext(date) {
  const t = new Date(`${date}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate()+1);
  return t.toISOString().slice(0,10);
}
function hbCalInRange(date,start,end) { return date>=start && date<end; }
function hbCalBedStatus(bed, date, listingId, roomName) {
  const rows = Array.isArray(window.tenantRecords) ? window.tenantRecords : tenantRecords;
  const tenancies = rows.filter(t => t.listing_id === listingId && t.room_name === roomName && t.bed_slot === bed.id);
  const current = tenancies.find(t => t.start_date <= date &&
    date < hbCalNext(t.status === 'Ended' && t.end_date ? t.end_date : (t.planned_end_date || '2099-12-31')));
  if (current) return {status:'occupied', label:'Occupied'};
  const reserves = typeof hbDemoAdvance !== 'undefined' ? hbDemoAdvance : [];
  if (reserves.some(r => r.listingId===listingId && r.roomName===roomName && r.bedSlot===bed.id &&
      r.status==='Approved' && hbCalInRange(date,r.moveIn,r.moveOut||hbCalNext(r.moveIn))))
    return {status:'reserved', label:'Reserved'};
  if (bed.status==='Unavailable') return {status:'blocked',label:'Unavailable'};
  if (bed.status==='Occupied' && !tenancies.some(t=>t.status==='Active')) return {status:'blocked',label:'Unavailable: check tenancy record'};
  if (bed.status==='Occupied' && tenancies.some(t=>t.status==='Active' && date<t.start_date)) return {status:'available',label:'Available'};
  if (bed.status==='Occupied' && bed.availableFrom && date>bed.availableFrom) return {status:'expected',label:'Expected availability — owner must confirm move-out'};
  if (bed.status==='Occupied') return {status:'occupied',label:'Occupied'};
  return {status:'available',label:'Available'};
}
async function hbCalLoad() {
  const s=hbCalendarState, request=++s.requestId;
  s.busy=true; s.days=[]; hbCalDraw();
  try {
    if(HomeboundStore.configured) {
      const result=await HomeboundStore.calendarDates(s.listingId,s.roomName,s.bedSlot,s.month);
      if(request!==s.requestId) return;
      s.days=Array.isArray(result)?result:[];
    } else {
      const listing=dormsData.find(d=>d.id===s.listingId);
      const room=listing?.rooms.find(r=>r.name===s.roomName);
      const bed=displayBedSlots(room).find(b=>b.id===s.bedSlot);
      if(!bed) throw Error('Bed no longer exists.');
      const [y,m]=s.month.split('-').map(Number), count=new Date(y,m,0).getDate();
      s.days=Array.from({length:count},(_,i)=>{
        const date=hbCalDate(y,m,i+1);
        return {date,...hbCalBedStatus(bed,date,s.listingId,s.roomName)};
      });
    }
  } catch(error) {
    if(request!==s.requestId)return;
    s.days=[];
    const note=document.getElementById('hbCalendarNote');
    if(note)note.textContent=`Could not verify availability: ${error.message}`;
  } finally {
    if(request===s.requestId){s.busy=false;hbCalDraw();}
  }
}
function hbCalOpenOwner(listingId,roomName) {
  const listing=dormsData.find(d=>d.id===listingId), room=listing?.rooms.find(r=>r.name===roomName);
  if(!room)return;
  const select=document.getElementById('hbCalendarOwnerBed');
  select.replaceChildren(...displayBedSlots(room).map(b=>new Option(b.id.replace('bed-','Bed '),b.id)));
  hbCalendarState.context='owner';hbCalendarState.listingId=listingId;
  hbCalendarState.roomName=roomName;hbCalendarState.bedSlot=select.value;
  hbCalendarState.month=localDateISO(new Date()).slice(0,7);
  hbCalendarState.start=null;hbCalendarState.end=null;
  document.getElementById('hbCalendarOwnerTitle').textContent=`${listing.title} · ${roomName}`;
  document.getElementById('hbCalendarOwnerModal').classList.remove('hidden');
  void hbCalLoad();
}
function hbCalOpenStudent(listingId,roomName,bedSlot) {
  hbCalendarState.context='student';hbCalendarState.listingId=listingId;
  hbCalendarState.roomName=roomName;hbCalendarState.bedSlot=bedSlot;
  hbCalendarState.month=localDateISO(new Date()).slice(0,7);
  hbCalendarState.start=null;hbCalendarState.end=null;
  hbCalUpdateDates();void hbCalLoad();
}
function hbCalSelectBed(bedSlot) {
  hbCalendarState.bedSlot=bedSlot;hbCalendarState.start=null;hbCalendarState.end=null;
  hbCalUpdateDates();void hbCalLoad();
}
function hbCalChangeMonth(amount) {
  const [y,m]=hbCalendarState.month.split('-').map(Number);
  const d=new Date(Date.UTC(y,m-1+amount,1));
  const min=localDateISO(new Date()).slice(0,7);
  const max=new Date(Date.UTC(Number(min.slice(0,4)),Number(min.slice(5))-1+HB_CALENDAR_MONTH_LIMIT,1)).toISOString().slice(0,7);
  const next=d.toISOString().slice(0,7);
  if(next<min || next>max)return;
  hbCalendarState.month=next;void hbCalLoad();
}
function hbCalPick(date) {
  const s=hbCalendarState, d=s.days.find(x=>x.date===date);
  if(s.context!=='student'||s.busy||!d||!['available','expected'].includes(d.status)||date<=localDateISO(new Date()))return;
  if(!s.start || s.end || date<=s.start){
    // First click is the precise requested move-in date.
    s.start=date;s.end=null;
  } else {
    // Checkout is exclusive: the second clicked day IS the move-out date.
    // The bed becomes available for another tenancy on that date, after handover.
    s.end=date;
  }
  hbCalUpdateDates();hbCalDraw();
}
function hbCalUpdateDates() {
  const s=hbCalendarState;
  const a=document.getElementById('advanceMoveIn'),b=document.getElementById('advanceMoveOut');
  if(a)a.value=s.start||'';
  if(b)b.value=s.end||'';
  const label=document.getElementById('hbCalendarSelection');
  const moveIn=document.getElementById('hbCalendarMoveInLabel');
  const moveOut=document.getElementById('hbCalendarMoveOutLabel');
  if(moveIn)moveIn.textContent=s.start||'Not selected';
  if(moveOut)moveOut.textContent=s.end||'Not selected';
  if(label)label.textContent=s.start && !s.end ? 'Now select move-out date' : 'Select move-in and move-out date';
}
function hbCalDraw() {
  const s=hbCalendarState;
  const grid=document.getElementById(s.context==='owner'?'hbOwnerCalendarGrid':'hbStudentCalendarGrid');
  if(!grid)return;
  const heading=document.getElementById(s.context==='owner'?'hbOwnerCalendarMonth':'hbStudentCalendarMonth');
  const [y,m]=s.month.split('-').map(Number);
  if(heading)heading.textContent=new Intl.DateTimeFormat('en-US',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(Date.UTC(y,m-1,1)));
  grid.replaceChildren();
  for(const day of ['Su','Mo','Tu','We','Th','Fr','Sa']){
    const h=document.createElement('span');h.className='hb-calendar-weekday';h.textContent=day;grid.append(h);
  }
  const offset=new Date(Date.UTC(y,m-1,1)).getUTCDay();
  for(let i=0;i<offset;i++) {const blank=document.createElement('span');blank.className='hb-calendar-empty';grid.append(blank);}
  if(s.busy){const loading=document.createElement('p');loading.className='hb-calendar-loading';loading.textContent='Checking dates…';grid.append(loading);return;}
  if(!s.days.length){const failed=document.createElement('p');failed.className='hb-calendar-loading';failed.textContent='Availability unavailable. Please retry.';grid.append(failed);return;}
  const today=localDateISO(new Date());
  for(const entry of s.days){
    const b=document.createElement('button');b.type='button';b.textContent=String(Number(entry.date.slice(-2)));
    const between=s.start && s.end && entry.date>s.start && entry.date<s.end;
    const isStart=s.context==='student' && entry.date===s.start;
    const isEnd=s.context==='student' && entry.date===s.end;
    b.className=`hb-calendar-day hb-day-${entry.status}${between?' hb-day-selected':''}${isStart?' hb-day-start':''}${isEnd?' hb-day-end':''}`;
    b.title=`${entry.date}: ${isStart?'Selected move-in':isEnd?'Selected move-out':entry.label||entry.status}`;
    b.setAttribute('aria-label',b.title);
    if(isStart||isEnd){b.setAttribute('aria-pressed','true');b.dataset.selectedDate=isStart?'move-in':'move-out';}
    const selectable=s.context==='student' && ['available','expected'].includes(entry.status)&&entry.date>today;
    b.disabled=!selectable;
    if(selectable)b.addEventListener('click',()=>hbCalPick(entry.date));
    grid.append(b);
  }
  const note=document.getElementById('hbCalendarNote');
  if(note && s.days.length)note.textContent='Dotted green = expected vacancy, subject to owner confirmation.';
}
async function hbCalValidateSelection() {
  const s=hbCalendarState;
  if(!s.start || !s.end || s.end<=s.start)throw Error('Choose both move-in and move-out dates on the calendar.');
  if(s.end>hbCalNext(new Date(Date.now()+365*86400000).toISOString().slice(0,10)))throw Error('Choose a stay within the next year.');
  if(HomeboundStore.configured){
    const result=await HomeboundStore.calendarCheck(s.listingId,s.roomName,s.bedSlot,s.start,s.end);
    if(!result?.available)throw Error(result?.reason||'Some dates are already occupied or reserved.');
  }else{
    for(let d=s.start;d<s.end;d=hbCalNext(d)){
      const listing=dormsData.find(l=>l.id===s.listingId),room=listing?.rooms.find(r=>r.name===s.roomName);
      const bed=displayBedSlots(room).find(b=>b.id===s.bedSlot);
      if(!['available','expected'].includes(hbCalBedStatus(bed,d,s.listingId,s.roomName).status))throw Error('Selected dates include unavailable days.');
    }
  }
  return true;
}

// Refresh the visible calendar after navigating back to Homebound from another tab.
window.addEventListener('focus', () => {
  const ownerOpen=!document.getElementById('hbCalendarOwnerModal')?.classList.contains('hidden');
  const studentOpen=!document.getElementById('modalAdvanceReservation')?.classList.contains('hidden');
  if(ownerOpen||studentOpen)void hbCalLoad();
});
