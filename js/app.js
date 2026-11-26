/* Homebound application: original UI functions retained and extended. */
/* App state. Sample records are used only in demo mode. */
let currentPortal = 'student';
let activeUserHold = null; // Selected hold in the details modal (legacy compatibility).
let studentHolds = []; // Multiple independent holds per student browser.
let hiddenHoldStatuses = {}; // Dismiss only the status that the student has seen.
let holdStatusPollBusy = false;
let holdStatusTimer = null;
let activeDormViewing = null;
let selectedRoomIndex = 0;
let dormsData = JSON.parse(JSON.stringify(sampleDormsData));
let activeOwner = null;
let demoOwnerAuthenticated = false;
let editingListingId = null;
let expandedOwnerListingId = null; // Only one property inventory card is open at a time.
let roomEditorSerial = 0;
let studentChatListingId = null;
let studentChatToken = null;
let studentConversationId = null;
let demoConversations = [];
let ownerConversations = [];
let ownerConversationId = null;
let ownerHolds = [];
// Local sample rooms can already show '2 beds left' without tenant identities.
// Preserve that sample occupancy while assigning additional demo renters.
const samplePreExistingOccupancy = Object.fromEntries(sampleDormsData.flatMap(d =>
    d.rooms.map(r => {
        const total = /bedspace|beds?/i.test(r.capacity) ? Number((r.capacity.match(/\d+/) || [1])[0]) : 1;
        const matched = String(r.status).match(/(\d+)\s+beds?\s+left/i);
        return [JSON.stringify([d.id,r.name]), matched ? Math.max(0,total-Number(matched[1])) : 0];
    })));
let tenantRecords = []; // Owner-confirmed rentals, never created by a student hold alone.
let rentRecords = []; // Generated monthly due dates, paid/unpaid records.
const expandedTenantPaymentHistory = new Set(); // Keep history open across payment refreshes.
let pendingRentalHoldId = null;
let ownerRentLoadInProgress = false;
let liveChatRefreshTimer = null;
let ownerRefreshTimer = null;
let aiContext = null;
let reportCharts = [];
const imageTypes = ['image/jpeg', 'image/png', 'image/webp'];
const FALLBACK_IMAGE = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22800%22 height=%22500%22 viewBox=%220 0 800 500%22%3E%3Crect width=%22800%22 height=%22500%22 fill=%22%23e2e8f0%22/%3E%3Cpath d=%22M280 305l85-95 72 77 46-44 95 101H280Z%22 fill=%22%2394a3b8%22/%3E%3Ccircle cx=%22390%22 cy=%22175%22 r=%2230%22 fill=%22%2394a3b8%22/%3E%3Ctext x=%22400%22 y=%22415%22 text-anchor=%22middle%22 fill=%22%23475569%22 font-size=%2224%22 font-family=%22sans-serif%22%3EPhoto not available%3C/text%3E%3C/svg%3E';
let studentInboxTimer = null;
let studentInboxRecords = [];
let studentInboxBusy = false;
function onImageLoadError(image) {
    image.onerror = null;
    image.src = FALLBACK_IMAGE;
}
function displayBedSlots(room) {
    if (Array.isArray(room?.beds) && room.beds.length) return room.beds;
    const fallback = /bedspace|beds?/i.test(String(room?.capacity || ''))
        ? Number((String(room?.capacity || '').match(/\d+/) || [1])[0]) : 1;
    const total = Math.max(1, Math.min(100, Number(room?.totalCapacity) || fallback));
    const match = String(room?.status || '').match(/(\d+)\s+beds?\s+left/i);
    const available = match ? Math.min(total, Number(match[1])) : isRoomAvailable(room?.status ?? 'Available') ? total : 0;
    return Array.from({length:total}, (_, i) => ({
        id: `bed-${i+1}`, status: i < available ? 'Available' : 'Unavailable'
    }));
}
function syncBedCountStatus(room) {
    const beds = displayBedSlots(room);
    room.totalCapacity = beds.length;
    room.beds = beds;
    const free = beds.filter(b => b.status === 'Available').length;
    room.status = free ? `Available (${free} ${free===1?'bed':'beds'} left)` : 'Full / Occupied';
    return free;
}
function bedActionParams(...values) {
    return values.map(x => escHtml(JSON.stringify(x))).join(',');
}

const ROOM_AMENITIES = ['Wi-Fi', 'Aircon', 'Study Desk', 'Private Bathroom', 'Shared Bathroom',
    'Laundry Area', 'Kitchen', 'CCTV / Security', 'Personal Locker', 'Parking'];

function escHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
}
function safeImageUrl(value) {
    try {
        const url = new URL(String(value || ''), window.location.href);
        if (url.protocol === 'https:' || (url.protocol === 'blob:' && url.origin === window.location.origin) || (['localhost','127.0.0.1'].includes(url.hostname) && url.protocol === 'http:') || /^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(String(value || ''))) {
            return escHtml(url.href);
        }
    } catch (_) { /* use fallback */ }
    return FALLBACK_IMAGE;
}
function isRoomAvailable(status) {
    return /available/i.test(String(status)) && !/unavailable/i.test(String(status));
}
function validListingId(id) {
    return /^[a-zA-Z0-9-]{1,64}$/.test(String(id));
}
function refreshListingViews() {
    applyFilters();
    if (currentPortal === 'owner') renderAdminListings();
    reconcileOpenListingEditor();
    if (activeDormViewing) {
        const newer = dormsData.find(d => d.id === activeDormViewing.id);
        if (!newer) {
            activeDormViewing = null;
            closeModal('modalBedspaceViewer');
        } else {
            activeDormViewing = newer;
            selectedRoomIndex = Math.min(selectedRoomIndex, newer.rooms.length - 1);
            if (selectedRoomIndex >= 0) {
                renderRoomDetails();
                renderRoomSelectorList();
            }
        }
    }
}
async function loadListings() {
    if (!HomeboundStore.configured) return;
    try {
        const loaded = await HomeboundStore.list();
        dormsData = loaded;
        dormsData.forEach(d => d.rooms.forEach(syncBedCountStatus));
        document.getElementById('connectionStatus').textContent = 'Supabase connected';
        document.getElementById('listingSourceText').textContent = 'Live property listings updated by approved landlords';
        refreshListingViews();
    } catch (err) {
        document.getElementById('connectionStatus').textContent = 'Supabase error';
        showToast(`Could not load Supabase listings: ${err.message}`, 'error');
        // Never pass off sample listings as live information when the connection fails.
    }
}
/* ==========================================================================
   INITIALIZATION & MAP INTEGRATION
   ========================================================================== */

let leafletMap = null;
let mapMarkers = [];
let listingPinMap = null;
let listingPinMarker = null;
let listingDraftCoordinates = null;

document.addEventListener('error', event => {
    if (event.target instanceof HTMLImageElement) onImageLoadError(event.target);
}, true);

window.onload = async function() {
    // Map assets are hosted by third parties: initialize asynchronously so a blocked CDN
    // cannot prevent listings, holds, or messages from loading.
    void retryHomeboundMap();
    renderListingsGrid(dormsData);
    renderAdminTables();
    if (window.Chart) initAnalyticsCharts();

    restoreActiveHold();
    holdStatusTimer = setInterval(refreshActiveHold, 15000);
    window.addEventListener('focus', refreshActiveHold);
    updateAIAssistant();
    refreshDashboardStats();
    const status = document.getElementById('connectionStatus');
    // Poll token-scoped student messages because anonymous clients cannot subscribe
    // directly to private chat tables. Also checks conversations after page reload.
    dormsData.forEach(d => d.rooms.forEach(syncBedCountStatus));
    pollStudentInbox();
    initializeHomeboundExtras();
    studentInboxTimer = setInterval(pollStudentInbox, 12000);
    window.addEventListener('focus', pollStudentInbox);
    if (!HomeboundStore.configured) {
        status.textContent = 'Local preview';
        return;
    }

    // Do not show fabricated "live" listings while network data is loading.
    dormsData = [];
    refreshListingViews();
    status.textContent = 'Connecting to Supabase…';
    await loadListings();
    try {
        activeOwner = await HomeboundStore.currentOwner();
        if (activeOwner) await loadOwnerData();
        HomeboundStore.subscribe(kind => {
            if (kind === 'listings') loadListings();
            else if (kind === 'messages') { if (currentPortal === 'owner') loadOwnerInbox(); refreshStudentChat(); }
            else if (kind === 'holds') { if (currentPortal === 'owner') loadOwnerHolds(); refreshActiveHold(); }
            else if (kind === 'tenancies' || kind === 'payments') { if (activeOwner) loadOwnerRentData(); }
            else if (kind === 'announcements' && activeOwner) loadTenantAnnouncements();
            else if (kind === 'advance_reservations' && activeOwner) loadAdvanceReservations();
        });
    } catch (err) {
        showToast(`Supabase authorization error: ${err.message}`, 'error');
    }
};

// Make Leaflet resilient to a blocked CDN; JS and CSS are both necessary.
let homeboundMapRetry = null;
let homeboundMapTileLayer = null;
const HOMEBOUND_MAP_CENTER = [16.4023, 120.5960];
// Standard OpenStreetMap street tiles. The website MUST send its origin as a
// Referer for this public service; index.html uses strict-origin-when-cross-origin.
// Follow https://operations.osmfoundation.org/policies/tiles/ for fair use.
// Do not cycle through alternate public servers to evade an access denial.
const HOMEBOUND_TILE_SOURCES = [
    {
        url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        options: {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
            maxZoom: 19,
            // No subdomains, query-string cache busting, proxying or referer masking.
            referrerPolicy: 'strict-origin-when-cross-origin'
        }
    }
];
let homeboundTileSourceIndex = 0;

function loadMapAsset(url, type, timeoutMs = 4500) {
    return new Promise(resolve => {
        const asset = document.createElement(type === 'style' ? 'link' : 'script');
        let done = false;
        const finish = ok => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            if (!ok) asset.remove();
            resolve(ok);
        };
        if (type === 'style') { asset.rel = 'stylesheet'; asset.href = url; }
        else { asset.src = url; asset.async = true; }
        asset.onload = () => finish(true);
        asset.onerror = () => finish(false);
        const timer = setTimeout(() => finish(false), timeoutMs);
        document.head.appendChild(asset);
    });
}
async function loadHomeboundMapLibrary() {
    if (!window.L?.map) {
        const urls = [
            'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js',
            'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js',
            'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
        ];
        for (const url of urls) {
            if (window.L?.map) break;
            await loadMapAsset(url, 'script');
        }
    }
    if (!window.L?.map) return false;
    // The original stylesheet is in index.html, but may be blocked independently.
    if (!document.querySelector('link[data-homebound-leaflet-style]')) {
        for (const url of [
            'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css',
            'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css',
            'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
        ]) {
            if (await loadMapAsset(url, 'style')) {
                // Identify the successfully loaded backup for future retries.
                const links = [...document.querySelectorAll('link[rel="stylesheet"]')];
                const link = links.find(l => l.href === url);
                link?.setAttribute('data-homebound-leaflet-style', 'true');
                break;
            }
        }
    }
    return true;
}
function homeboundMapStatus(message='') {
    const el=document.getElementById('mapStatus');
    const msg=document.getElementById('mapStatusText');
    if (!el || !msg) return;
    msg.textContent=message;
    el.classList.toggle('hidden',!message);
}
async function retryHomeboundMap() {
    if (homeboundMapRetry) return homeboundMapRetry;
    homeboundMapStatus('Loading map of Baguio…');
    homeboundMapRetry = (async () => {
        try {
            const loaded = await loadHomeboundMapLibrary();
            if (!loaded) throw new Error('Could not load the map library. Check your internet connection, then try Retry map.');
            if (!leafletMap) initLeafletMap();
            else {
                leafletMap.invalidateSize();
                updateMapMarkers(dormsData);
                // Refresh the standard street-map tiles if retry is requested.
                if (homeboundMapTileLayer) chooseHomeboundTiles(leafletMap, homeboundTileSourceIndex);
            }
            setTimeout(() => leafletMap?.invalidateSize(), 250);
        } catch (err) {
            homeboundMapStatus(err?.message || 'Map is temporarily unavailable.');
        } finally {
            homeboundMapRetry = null;
        }
    })();
    return homeboundMapRetry;
}
function chooseHomeboundTiles(map, sourceIndex = 0) {
    if (!map || !window.L?.tileLayer) return;

    // Keep different tile layers for the student map and owner's location picker.
    // Removing the old layer prevents a previous 403 image from remaining visible.
    if (map._homeboundBaseTiles) {
        map.off('unload', map._homeboundBaseCleanup);
        map.removeLayer(map._homeboundBaseTiles);
    }
    const source = HOMEBOUND_TILE_SOURCES[sourceIndex];
    if (!source) return;
    const layer = L.tileLayer(source.url, {
        ...source.options,
        // Avoid requesting an unnecessary crossOrigin image mode.
        updateWhenIdle: true,
        keepBuffer: 2
    });
    map._homeboundBaseTiles = layer;
    if (map === leafletMap) homeboundMapTileLayer = layer;

    let errors = 0;
    let finished = false;
    const isCurrent = () => map._homeboundBaseTiles === layer && map.hasLayer(layer);
    const timeout = setTimeout(() => {
        if (!finished && isCurrent()) failed();
    }, 9000);
    function failed() {
        if (finished || !isCurrent()) return;
        finished = true;
        clearTimeout(timeout);
        if (sourceIndex + 1 < HOMEBOUND_TILE_SOURCES.length) {
            homeboundMapStatus('Trying another map provider…');
            map.removeLayer(layer);
            chooseHomeboundTiles(map, sourceIndex + 1);
        } else if (map === leafletMap) {
            homeboundMapStatus('Street map tiles could not load. Check browser Network for 403 errors and verify the site sends its Referer. Your property pins are still saved.');
        } else {
            const status = document.getElementById('listingPinStatus');
            if (status) status.textContent = 'Map background unavailable. Try reopening the listing editor.';
        }
    }
    layer.on('tileerror', () => { if (++errors >= 3) failed(); });
    layer.on('load', () => {
        if (finished || !isCurrent()) return;
        finished = true;
        clearTimeout(timeout);
        if (map === leafletMap) homeboundMapStatus('');
    });
    layer.addTo(map);
}
async function loadHomeboundChartLibrary() {
    if(window.Chart)return true;
    const urls=[
      'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.7/chart.umd.min.js',
      'https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js'
    ];
    for(const url of urls){
      if(window.Chart)return true;
      const success=await new Promise(resolve=>{
        const script=document.createElement('script');script.src=url;
        script.onload=()=>resolve(Boolean(window.Chart));script.onerror=()=>resolve(false);
        document.head.appendChild(script);
      });
      if(success)return true;
    }
    return Boolean(window.Chart);
}
function initLeafletMap() {
    if (leafletMap) return;
    const node = document.getElementById('map');
    if (!node || !window.L?.map) throw new Error('Map container or Leaflet library is missing.');
    leafletMap = L.map(node, {scrollWheelZoom:false}).setView(HOMEBOUND_MAP_CENTER,13);
    chooseHomeboundTiles(leafletMap, homeboundTileSourceIndex);
    updateMapMarkers(dormsData);
    setTimeout(() => leafletMap?.invalidateSize(), 200);
}
function updateMapMarkers(items) {
    if (!leafletMap) return;
    mapMarkers.forEach(marker => leafletMap.removeLayer(marker));
    mapMarkers=[];
    items.forEach(item => {
        const lat=item.lat==null?NaN:Number(item.lat),lng=item.lng==null?NaN:Number(item.lng);
        if(!Number.isFinite(lat)||!Number.isFinite(lng)||lat < -90||lat>90||lng < -180||lng>180)return;
        const marker=L.marker([lat,lng],{title:item.title,alt:`View ${item.title}`}).addTo(leafletMap);
        marker.bindTooltip(escHtml(item.title),{direction:'top'});
        marker.on('click',()=>openBedspaceViewer(item.id));
        mapMarkers.push(marker);
    });
    const count=document.getElementById('mapPinCount');
    const baguioPins=items.filter(d=>d.lat!=null&&d.lng!=null&&
        Number.isFinite(Number(d.lat))&&Number.isFinite(Number(d.lng))&&
        Math.abs(Number(d.lat)-16.4023)<0.27&&Math.abs(Number(d.lng)-120.5960)<0.27).length;
    if(count)count.textContent=baguioPins?`${baguioPins} Baguio ${baguioPins===1?'pin':'pins'} · click to inspect`:
        'No Baguio pins yet — add a listing and pin its location in the owner editor.';
}

function initializeListingPinMap() {
    const container = document.getElementById('listingPinMap');
    if (!container) return;
    if (!window.L) {
        document.getElementById('listingPinStatus').textContent = 'Map unavailable. Check internet connection, close and reopen this form to retry.';
        loadHomeboundMapLibrary().then(loaded => { if (loaded && !document.getElementById('modalListingEditor').classList.contains('hidden')) initializeListingPinMap(); });
        return;
    }
    if (!listingPinMap) {
        listingPinMap = L.map(container).setView([16.4023, 120.5960], 13);
        chooseHomeboundTiles(listingPinMap);
        listingPinMap.on('click', e => setListingPin(e.latlng.lat,e.latlng.lng));
    }
    setTimeout(() => {
        listingPinMap.invalidateSize();
        if (listingDraftCoordinates) listingPinMap.setView([listingDraftCoordinates.lat,listingDraftCoordinates.lng],16);
        else listingPinMap.setView([16.4023,120.5960],13);
    }, 100);
}
function setListingPin(lat,lng) {
    lat=Number(lat);lng=Number(lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return;
    listingDraftCoordinates={lat,lng};
    if (listingPinMap) {
        if (!listingPinMarker) {
            listingPinMarker=L.marker([lat,lng],{draggable:true,title:'Drag to refine property location'}).addTo(listingPinMap);
            listingPinMarker.on('dragend', () => {
                const point=listingPinMarker.getLatLng();
                setListingPin(point.lat,point.lng);
            });
        } else listingPinMarker.setLatLng([lat,lng]);
    }
    document.getElementById('listingPinStatus').textContent=`Pinned at ${lat.toFixed(6)}, ${lng.toFixed(6)} · drag marker to adjust`;
}
function clearListingPin() {
    listingDraftCoordinates=null;
    if (listingPinMap && listingPinMarker) listingPinMap.removeLayer(listingPinMarker);
    listingPinMarker=null;
    const label=document.getElementById('listingPinStatus');
    if (label) label.textContent='No location pinned yet. Click the map to add one.';
}

function switchPortal(targetPortal) {
    if (targetPortal === 'owner') {
        if ((HomeboundStore.configured && !activeOwner) || (!HomeboundStore.configured && !demoOwnerAuthenticated)) {
            attemptOwnerLogin(); return;
        }
        document.getElementById('studentPortalView').classList.add('hidden');
        document.getElementById('ownerPortalView').classList.remove('hidden');
        document.getElementById('btnPortalStudent').className = 'px-3.5 py-1.5 rounded-lg text-xs font-semibold text-slate-500 hover:text-slate-900 transition flex items-center space-x-1.5';
        document.getElementById('btnPortalOwner').className = 'px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-900 text-white shadow-sm transition flex items-center space-x-1.5';
        currentPortal = 'owner';
        closeHomeboundToolPanels();
        document.getElementById('studentToolAnnouncement')?.classList.add('hidden');
        closeLiveChat();
        renderAdminListings();
        loadOwnerData();
        refreshDashboardStats();
    } else {
        document.getElementById('ownerPortalView').classList.add('hidden');
        document.getElementById('studentPortalView').classList.remove('hidden');
        document.getElementById('btnPortalStudent').className = 'px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-white text-slate-900 shadow-sm transition flex items-center space-x-1.5';
        document.getElementById('btnPortalOwner').className = 'px-3.5 py-1.5 rounded-lg text-xs font-semibold text-slate-500 hover:text-slate-900 transition flex items-center space-x-1.5';
        currentPortal = 'student';
        document.getElementById('studentToolAnnouncement')?.classList.remove('hidden');
        setTimeout(() => leafletMap?.invalidateSize(), 80);
    }
    updateAIAssistant();
    renderStudentInbox();
    refreshHoldBanner();
    if (targetPortal === 'student') {pollStudentInbox();refreshActiveHold();if (typeof loadPublicAnnouncements === 'function') void loadPublicAnnouncements();}
}

function attemptOwnerLogin() {
    if (currentPortal === 'owner') return;
    if ((HomeboundStore.configured && activeOwner) || (!HomeboundStore.configured && demoOwnerAuthenticated)) {
        switchPortal('owner');
        return;
    }
    const live = HomeboundStore.configured;
    document.getElementById('ownerEmailRow').classList.toggle('hidden', !live);
    document.getElementById('ownerEmail').required = live;
    document.getElementById('ownerPasswordLabel').textContent = live ? 'Account Password' : 'Demo Passcode';
    document.getElementById('ownerAuthHint').textContent = live
        ? 'Log in with a Supabase Auth account approved in the landlords table.'
        : 'Demo code: admin123 (not used in Supabase mode).';
    document.getElementById('adminPasscode').value = '';
    document.getElementById('modalOwnerAuth').classList.remove('hidden');
}

async function verifyOwnerPasscode(event) {
    if (event) event.preventDefault();
    const pass = document.getElementById('adminPasscode').value;
    const submit = document.getElementById('ownerLoginSubmit');
    if (!HomeboundStore.configured) {
        if (pass === 'admin123') {
            demoOwnerAuthenticated = true;
            closeModal('modalOwnerAuth');
            switchPortal('owner');
        } else {
            showToast('Invalid demo passcode.', 'error');
        }
        return;
    }
    const email = document.getElementById('ownerEmail').value.trim();
    if (!email || !pass) { showToast('Enter your landlord email and password.', 'error'); return; }
    submit.disabled = true;
    submit.textContent = 'Authenticating...';
    try {
        activeOwner = await HomeboundStore.login(email, pass);
        closeModal('modalOwnerAuth');
        switchPortal('owner');
    } catch (err) {
        showToast(`Landlord sign-in failed: ${err.message}`, 'error');
    } finally {
        submit.disabled = false;
        submit.textContent = 'Authenticate';
    }
}

async function logoutOwner() {
    if (HomeboundStore.configured) {
        try { await HomeboundStore.logout(); }
        catch (err) { showToast(`Sign-out failed: ${err.message}`, 'error'); return; }
        activeOwner = null;
    } else {
        demoOwnerAuthenticated = false;
    }
    switchPortal('student');
    showToast('Signed out of the landlord portal.', 'info');
}

function renderListingsGrid(items) {
    const container = document.getElementById('listingsGrid');
    document.getElementById('listingCount').innerText = items.length;

    if (items.length === 0) {
        container.innerHTML = `
            <div class="col-span-full text-center py-12 bg-white rounded-2xl border border-slate-200">
                <i class="fa-solid fa-house-circle-xmark text-4xl text-slate-300 mb-2"></i>
                <h3 class="font-bold text-slate-700">No properties found</h3>
                <p class="text-xs text-slate-400">Try relaxing your search location or price range filters.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = items.map(dorm => `
        <div class="bg-white rounded-2xl overflow-hidden border border-slate-200/80 shadow-sm hover:shadow-md transition group flex flex-col">
            <!-- Image Header -->
            <div class="relative h-48 overflow-hidden bg-slate-100">
                <img src="${safeImageUrl(dorm.mainImage)}" alt="${escHtml(dorm.title)}" class="w-full h-full object-cover group-hover:scale-105 transition duration-300">
                <div class="absolute top-3 left-3 flex flex-col space-y-1">
                    <span class="bg-slate-900/80 backdrop-blur-md text-white text-[10px] font-bold px-2.5 py-1 rounded-lg">
                        ${escHtml(dorm.type)}
                    </span>
                    <span class="bg-brand-600/90 text-white text-[10px] font-bold px-2.5 py-1 rounded-lg shadow-sm">
                        ${escHtml(dorm.rooms.some(r => isRoomAvailable(r.status)) ? 'Available' : dorm.rooms.some(r=>nextExpectedAvailability(dorm,r)) ? 'Upcoming vacancy' : 'Full / Occupied')}
                    </span>
                </div>
                <div class="absolute bottom-2 right-2 bg-slate-900/70 text-white text-[10px] px-2 py-0.5 rounded backdrop-blur-sm">
                    <i class="fa-solid fa-clock mr-1"></i>${escHtml(dorm.lastUpdated)}
                </div>
            </div>

            <!-- Card Body -->
            <div class="p-5 flex-1 flex flex-col justify-between space-y-4">
                <div class="space-y-2">
                    <div class="flex items-center text-xs text-brand-700 font-bold">
                        <i class="fa-solid fa-location-dot mr-1"></i> ${escHtml(dorm.locationZone)} • <span class="text-slate-500 font-normal ml-1">${escHtml(dorm.distance)}</span>
                    </div>
                    <h3 class="font-bold text-slate-900 text-base leading-snug hover:text-brand-600 cursor-pointer" onclick="openBedspaceViewer('${validListingId(dorm.id) ? dorm.id : ''}')">
                        ${escHtml(dorm.title)}
                    </h3>
                    
                    <div class="text-xs text-slate-500 line-clamp-1">
                        Owner: <strong class="text-slate-700">${escHtml(dorm.ownerName)}</strong>
                    </div>
                </div>

                <!-- Price & Action CTA -->
                <div class="pt-3 border-t border-slate-100 flex items-center justify-between">
                    <div>
                        <span class="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">Price Range</span>
                        <span class="text-base font-extrabold text-slate-900">${escHtml(dorm.priceRangeStr)}</span>
                    </div>
                    <button onclick="openBedspaceViewer('${validListingId(dorm.id) ? dorm.id : ''}')" class="bg-brand-600 hover:bg-brand-700 text-white text-xs font-bold px-3.5 py-2 rounded-xl transition flex items-center shadow-md shadow-brand-600/20">
                        <span>Inspect Rooms</span>
                        <i class="fa-solid fa-arrow-right ml-1.5 text-[10px]"></i>
                    </button>
                </div>
            </div>
        </div>
    `).join('');
}

function applyFilters() {
    const query = document.getElementById('filterLocation').value.trim().toLocaleLowerCase();
    const priceRange = document.getElementById('filterPriceRange').value;
    const tokens = query.split(/\s+/).filter(Boolean);
    const selectedPoint = typeof hbStudentSearchPoint !== 'undefined' ? hbStudentSearchPoint : null;
    const filtered = dormsData.filter(d => {
        const searchable = `${d.locationZone || ''} ${d.distance || ''} ${d.title || ''}`.toLocaleLowerCase();
        const localPart=query.includes(', baguio city') ? query.split(',')[0].trim() : '';
        const textMatch=tokens.every(token=>searchable.includes(token)) || (localPart && searchable.includes(localPart));
        const hasPin=d.lat!=null && d.lng!=null && Number.isFinite(Number(d.lat)) && Number.isFinite(Number(d.lng));
        const nearby=selectedPoint && hasPin && hbStraightLineKm({lat:Number(d.lat),lng:Number(d.lng)},selectedPoint)<=3;
        if (!nearby && !textMatch) return false;
        if (priceRange !== 'ALL') {
            const [min,max] = priceRange.split('-').map(Number);
            if (d.maxPrice < min || d.minPrice > max) return false;
        }
        return true;
    });
    renderListingsGrid(filtered);
    updateMapMarkers(filtered);
}

function resetFilters() {
    document.getElementById('filterLocation').value = '';
    document.getElementById('filterPriceRange').value = 'ALL';
    if (typeof hbStudentSearchPoint !== 'undefined') hbStudentSearchPoint = null;
    document.getElementById('studentLocationSuggestions')?.classList.add('hidden');
    document.getElementById('studentSearchRadius')?.classList.add('hidden');
    applyFilters();
}

function openBedspaceViewer(dormId) {
    const dorm = dormsData.find(d => d.id === dormId);
    if (!dorm) return;

    activeDormViewing = dorm;
    selectedRoomIndex = 0;

    document.getElementById('modalDormTitle').innerText = dorm.title;
    document.getElementById('modalDormSub').innerText = dorm.locationZone;

    renderRoomDetails();
    renderRoomSelectorList();

    document.getElementById('modalBedspaceViewer').classList.remove('hidden');
    document.getElementById('modalBedspaceViewer').classList.toggle('chat-side-open', !document.getElementById('liveChatDrawer').classList.contains('hidden'));
}

function renderRoomDetails() {
    const room = activeDormViewing?.rooms[selectedRoomIndex];
    if (!room) return;
    document.getElementById('modalRoomName').innerText = room.name;
    document.getElementById('modalRoomPrice').innerText = `₱${Number(room.price).toLocaleString()} / mo`;
    document.getElementById('modalRoomCap').innerText = `${displayBedSlots(room).filter(b=>b.status==='Available').length} / ${displayBedSlots(room).length} beds available`;
    document.getElementById('modalRoomTypeTag').innerText = activeDormViewing.type;
    document.getElementById('modalRoomDesc').textContent = room.note ? `${room.note} • Status: ${room.status}` : `Room status: ${room.status}`;
    document.getElementById('modalPropertyNote').textContent = activeDormViewing.note || '';
    document.getElementById('modalOwnerName').textContent = activeDormViewing.ownerName || 'Property manager';
    const ownerPhoneLink = document.getElementById('modalOwnerPhone');
    const phone = String(activeDormViewing.ownerPhone || '').trim();
    ownerPhoneLink.textContent = phone || 'Contact owner through chat';
    ownerPhoneLink.href = /^\+?[0-9()\s-]{7,35}$/.test(phone) ? `tel:${phone.replace(/[^+\d]/g, '')}` : '#';
    showExpectedBedAvailability(room);
    updateRoomMoveInHint();
    document.getElementById('roomActiveImage').src = safeImageUrl(room.images[0]).replaceAll('&amp;', '&');
    const thumbsContainer = document.getElementById('roomThumbnails');
    thumbsContainer.innerHTML = room.images.map((img, idx) => `
        <img src="${safeImageUrl(img)}" alt="Room image ${idx + 1}" onclick="switchRoomImageByIndex(${idx})"
        class="w-16 h-12 rounded-lg object-cover cursor-pointer border-2 hover:border-brand-500 transition ${idx === 0 ? 'border-brand-600' : 'border-transparent'}">
    `).join('');
    const amContainer = document.getElementById('modalRoomAmenities');
    amContainer.innerHTML = room.amenities.map(am => `
        <span class="bg-slate-200 text-slate-800 text-[10px] font-semibold px-2 py-0.5 rounded-md"><i class="fa-solid fa-check text-brand-600 mr-1"></i>${escHtml(am)}</span>
    `).join('');
}

function switchRoomImageByIndex(index) {
    const image = activeDormViewing?.rooms[selectedRoomIndex]?.images[index];
    if (image) switchRoomImage(image);
}

function switchRoomImage(imgUrl) {
    document.getElementById('roomActiveImage').src = safeImageUrl(imgUrl).replaceAll('&amp;', '&');
}

function renderRoomSelectorList() {
    const container = document.getElementById('roomSelectorList');
    container.innerHTML = activeDormViewing.rooms.map((rm, idx) => `
        <div onclick="selectRoomIndex(${idx})" class="p-3 rounded-xl border cursor-pointer transition ${idx === selectedRoomIndex ? 'border-brand-600 bg-brand-50/50 shadow-sm' : 'border-slate-200 bg-white hover:border-slate-300'}">
            <div class="flex items-center justify-between font-bold text-slate-900 mb-1">
                <span class="text-xs">${escHtml(rm.name)}</span>
                <span class="text-brand-700 text-xs">₱${rm.price}</span>
            </div>
            <div class="text-[10px] text-slate-500 flex justify-between">
                <span>${escHtml(rm.capacity)}</span>
                <span class="font-semibold text-brand-600">${escHtml(rm.status)}</span>
            </div>
        </div>
    `).join('');
}

function selectRoomIndex(idx) {
    selectedRoomIndex = idx;
    renderRoomDetails();
    renderRoomSelectorList();
}

/* ==========================================================================
   24-HOUR HOLD & VISITATION WORKFLOW
   ========================================================================== */
function normalizeVisitTimeInput(input) {
    const raw=String(input.value || '').trim();
    let hour,minute;
    const withColon=raw.match(/^(\d{1,2}):(\d{2})$/);
    const digits=raw.match(/^(\d{3,4})$/);
    if (withColon) { hour=Number(withColon[1]);minute=Number(withColon[2]); }
    else if (digits) { hour=Number(raw.slice(0,-2));minute=Number(raw.slice(-2)); }
    else return false;
    if (!Number.isInteger(hour) || hour>23 || !Number.isInteger(minute) || minute>59) return false;
    input.value=`${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`;
    return true;
}


function openPreHoldForm() {
    if (!isRoomAvailable(activeDormViewing?.rooms[selectedRoomIndex]?.status)) {
        showToast('This room is currently occupied or unavailable.', 'error'); return;
    }
    const date = document.getElementById('holdVisitDate');
    date.min = localDateISO(new Date());
    if (!date.value || date.value < date.min) date.value = date.min;
    document.getElementById('holdVisitTime').value = '10:00';
    renderHourlyVisitSlots();
    closeModal('modalBedspaceViewer');
    closeLiveChat();
    document.getElementById('modalPreHoldForm').classList.remove('hidden');
}

async function submitHoldRequest(e) {
    e.preventDefault();
    if (!activeDormViewing?.rooms[selectedRoomIndex]) return;
    const form = e.target;
    const button = form.querySelector('button[type="submit"]');
    const name = document.getElementById('holdStudentName').value.trim();
    const phone = document.getElementById('holdStudentPhone').value.trim();
    const email = document.getElementById('holdStudentEmail').value.trim();
    const visitDate = document.getElementById('holdVisitDate').value;
    const visitTimeInput = document.getElementById('holdVisitTime');
    if (!normalizeVisitTimeInput(visitTimeInput)) {
        showToast('Enter a valid visitation time (HH:MM, such as 09:30).', 'error'); return;
    }
    const visitTime = visitTimeInput.value;
    if (typeof hbVisitSlotRefreshing !== 'undefined' && (hbVisitSlotRefreshing || !visitTime)) {
        showToast('Choose an available visitation hour after the schedule loads.', 'error');
        return;
    }
    // Server-side validation also prevents a race when another owner action confirms this hour.
    if (typeof hbBookedVisitSlots !== 'undefined' && hbBookedVisitSlots.has(visitTime)) {
        showToast('This visitation hour has already been booked. Choose another available time.', 'error');
        await refreshVisitSlotAvailability();
        return;
    }
    if (!name || !phone || !email || !visitDate || visitDate < localDateISO(new Date())) {
        showToast('Please complete the visitation form with today or a future date.', 'error'); return;
    }
    if (visitTime < '08:00' || visitTime > '19:00' || !visitTime.endsWith(':00')) {
        showToast('Choose a one-hour window starting at 08:00 through 19:00.', 'error'); return;
    }
    const room = activeDormViewing.rooms[selectedRoomIndex];
    const token = crypto.randomUUID();
    let previousChat = {};
    try { previousChat = JSON.parse(localStorage.getItem(`homebound-chat-${activeDormViewing.id}`) || '{}') || {}; }
    catch (_) { previousChat = {}; }
    const payload = { dormId: activeDormViewing.id, dormTitle: activeDormViewing.title,
        roomName: room.name, studentName: name, phone, email, visitDate, visitTime,
        token, chatToken: previousChat.token || crypto.randomUUID(),
        conversationId: previousChat.id || null,
        timestamp: new Date().toISOString(), status: 'Pending Approval' };
    button.disabled = true;
    button.textContent = 'Submitting…';
    try {
        if (HomeboundStore.configured) {
            const result = await HomeboundStore.createHold(payload);
            payload.id = result.id;
            payload.conversationId = result.conversationId;
        } else {
            payload.id = crypto.randomUUID();
            let conv = demoConversations.find(c => c.id === payload.conversationId);
            if (!conv) {
                payload.conversationId = crypto.randomUUID();
                conv = { id:payload.conversationId, listingId:payload.dormId,
                    updatedAt:new Date().toISOString(), messages:[] };
                demoConversations.unshift(conv);
            }
            visitationsList.unshift({ id: payload.id, ...payload, studentPhone: phone,
                studentEmail: email, visitSlot: formatVisitTime(visitTime), status: 'Pending Approval' });
        }
        studentHolds.unshift(payload);
        activeUserHold = payload;
        // New requests are always shown, even if previous status alerts were dismissed.
        saveStudentHolds();
        localStorage.setItem('homebound-chat-'+payload.dormId, JSON.stringify({
            id:payload.conversationId, token:payload.chatToken,
            seenOwnerIds:previousChat.seenOwnerIds || []
        }));
        pollStudentInbox();
        refreshHoldBanner();
        if (currentPortal === 'owner') await loadOwnerData();
        else renderAdminTables();
        closeModal('modalPreHoldForm');
        document.getElementById('modalHoldConfirmation').classList.remove('hidden');
        showToast('Your hold request has been submitted.', 'success');
    } catch (err) {
        showToast(`Unable to submit hold request: ${err.message}`, 'error');
        if (typeof refreshVisitSlotAvailability === 'function') void refreshVisitSlotAvailability();
    } finally {
        button.disabled = false;
        button.textContent = 'Submit Hold Request';
    }
}

async function openHoldStatusModal(holdId = null) {
    if (!studentHolds.length) { showToast('You have no hold requests yet.', 'info'); return; }
    if (holdId) activeUserHold=studentHolds.find(h=>h.id===holdId) || activeUserHold;
    else activeUserHold=studentHolds.find(h=>h.id===activeUserHold?.id) || studentHolds[0];
    await refreshActiveHold();
    renderStudentHoldList();
    document.getElementById('modalHoldConfirmation').classList.remove('hidden');
}
function selectStudentHold(id) {
    activeUserHold=studentHolds.find(h=>h.id===id) || activeUserHold;
    renderStudentHoldList();
}
async function revokeActiveHold() {
    const hold=activeUserHold;
    if (!hold || !['Pending Approval','Confirmed Visit'].includes(hold.status)) return;
    try {
        if (HomeboundStore.configured) {
            const updated = await HomeboundStore.cancelHold(hold.id, hold.token);
            if (!updated) throw new Error('This request is no longer cancellable. Refresh its status.');
        } else {
            const found = visitationsList.find(v => v.id === hold.id);
            if (found) found.status = 'Cancelled by Student';
        }
        hold.status='Cancelled by Student';
        hold.statusUpdatedAt=new Date().toISOString();
        saveStudentHolds();
        refreshHoldBanner();
        renderStudentHoldList();
        if (currentPortal === 'owner') await loadOwnerData();
        renderAdminTables();
        showToast('Selected hold request cancelled.', 'success');
    } catch (err) { showToast(`Could not cancel request: ${err.message}`, 'error'); }
}

/* ==========================================================================
   INTEGRATED LIVE CHAT & AI FLOATING ASSISTANT
   ========================================================================== */

function openChatFromModal() {
    if (!activeDormViewing) return;
    // Keep the room preview open, so a student can refer to room details while chatting.
    openLiveChat(activeDormViewing.ownerName);
    document.getElementById('modalBedspaceViewer').classList.add('chat-side-open');
}

async function openLiveChat(ownerName) {
    const dorm = activeDormViewing;
    if (!dorm) { showToast('Select a property before messaging its owner.', 'info'); return; }
    studentChatListingId = dorm.id;
    document.getElementById('chatOwnerTitle').textContent = ownerName || dorm.ownerName || 'Property Owner';
    document.getElementById('chatOwnerAvatar').textContent = (ownerName || dorm.ownerName || 'O')[0];
    closeHomeboundToolPanels();
    document.getElementById('liveChatDrawer').classList.remove('hidden');
    document.getElementById('modalBedspaceViewer').classList.add('chat-side-open');
    let saved;
    try { saved = JSON.parse(localStorage.getItem(`homebound-chat-${dorm.id}`) || 'null'); }
    catch (_) { saved = null; }
    studentChatToken = saved?.token || crypto.randomUUID();
    studentConversationId = saved?.id || null;
    if (!HomeboundStore.configured) {
        const current = demoConversations.find(c => c.id === studentConversationId);
        if (!current) studentConversationId = null;
    }
    await refreshStudentChat();
    clearInterval(liveChatRefreshTimer);
    if (HomeboundStore.configured) liveChatRefreshTimer = setInterval(refreshStudentChat, 7000);
}

function closeLiveChat() {
    document.getElementById('liveChatDrawer').classList.add('hidden');
    document.getElementById('modalBedspaceViewer').classList.remove('chat-side-open');
    clearInterval(liveChatRefreshTimer);
    liveChatRefreshTimer = null;
}

async function sendLiveChatMessage(messageOverride) {
    const input = document.getElementById('liveChatInput');
    const msg = typeof messageOverride === 'string' ? messageOverride.trim() : input.value.trim();
    if (!msg || !studentChatListingId) return;
    if (msg.length > 2000) { showToast('Keep your message under 2000 characters.', 'error'); return; }
    input.disabled = true;
    try {
        if (HomeboundStore.configured) {
            studentConversationId = await HomeboundStore.studentSend(
                studentChatListingId, studentConversationId, studentChatToken, msg);
        } else {
            let conversation = demoConversations.find(c => c.id === studentConversationId);
            if (!conversation) {
                studentConversationId = crypto.randomUUID();
                conversation = { id: studentConversationId, listingId: studentChatListingId,
                    updatedAt: new Date().toISOString(), messages: [] };
                demoConversations.unshift(conversation);
            }
            conversation.messages.push({ id: crypto.randomUUID(), sender: 'student', body: msg,
                created_at: new Date().toISOString() });
            conversation.updatedAt = new Date().toISOString();
        }
        const chatKey = `homebound-chat-${studentChatListingId}`;
        let oldChat = {};
        try { oldChat = JSON.parse(localStorage.getItem(chatKey) || '{}') || {}; } catch (_) {}
        localStorage.setItem(chatKey, JSON.stringify({ id:studentConversationId,
            token:studentChatToken, seenOwnerIds:oldChat.seenOwnerIds || [] }));
        pollStudentInbox();
        input.value = '';
        await refreshStudentChat();
        if (currentPortal === 'owner') await loadOwnerInbox();
    } catch (err) { showToast(`Message not sent: ${err.message}`, 'error'); }
    finally { input.disabled = false; input.focus(); }
}

function sendQuickMessage(txt) { sendLiveChatMessage(txt); }

// Image links travel inside the existing chat body; the student RPC already returns body.
// Uploaded images use the existing public listing-images bucket (do not attach private documents).
const HB_CHAT_IMAGE_RE = /\n?\[HB_IMAGE:([^\]\r\n]+)\]$/;
function renderHomeboundChatBody(value) {
    const message = String(value || '');
    const match = message.match(HB_CHAT_IMAGE_RE);
    if (!match) return `<span class="whitespace-pre-wrap">${escHtml(message)}</span>`;
    const caption = message.slice(0, match.index).trim();
    // safeImageUrl strictly allows images over HTTPS or browser-managed local previews.
    const imageSrc = safeImageUrl(match[1]).replaceAll('&amp;', '&');
    if (imageSrc === FALLBACK_IMAGE) return `<span class="whitespace-pre-wrap">${escHtml(message)}</span>`;
    return `${caption ? `<p class="whitespace-pre-wrap mb-2">${escHtml(caption)}</p>` : ''}<a href="${escHtml(imageSrc)}" target="_blank" rel="noopener noreferrer" title="Open attached image"><img src="${escHtml(imageSrc)}" loading="lazy" alt="Photo shared by property owner" class="block max-w-full max-h-56 rounded-lg border border-slate-200 object-contain bg-white"></a>`;
}
function appendChatMessage(txt, sender, targetId = 'liveChatMessages') {
    const box = document.getElementById(targetId);
    const mine = targetId === 'ownerChatMessages' ? sender === 'owner' : sender === 'student';
    box.insertAdjacentHTML('beforeend', `<div class="flex ${mine ? 'justify-end' : 'justify-start'}">
      <div class="${mine ? 'bg-brand-600 text-white' : 'bg-white text-slate-800 border border-slate-200'} p-2.5 rounded-2xl max-w-[85%] shadow-sm break-words text-xs">${renderHomeboundChatBody(txt)}</div></div>`);
    box.scrollTop = box.scrollHeight;
}

function toggleAIChat() {
    const win=document.getElementById('aiAssistantWindow');
    const opening=win.classList.contains('hidden');
    closeHomeboundToolPanels();
    if (opening) {
        win.classList.remove('hidden');
        if (window.innerWidth < 960) closeLiveChat();
    }
    syncHomeboundToolButtons();
}

function sendAIPrompt(promptText) {
    appendAIMessage(promptText, 'user');
    processAIResponse(promptText);
}

function sendCustomAIPrompt() {
    const input = document.getElementById('aiInput');
    const text = input.value.trim();
    if (!text) return;
    appendAIMessage(text, 'user');
    input.value = '';
    processAIResponse(text);
}

function appendAIMessage(txt, sender) {
    const body = document.getElementById('aiChatBody');
    const isUser = sender === 'user';

    if (isUser) {
        body.innerHTML += `
            <div class="flex justify-end">
                <div class="bg-brand-600 text-white p-2.5 rounded-2xl rounded-tr-none max-w-[80%] shadow-sm">
                    ${escHtml(txt)}
                </div>
            </div>
        `;
    } else {
        body.innerHTML += `
            <div class="flex items-start space-x-2">
                <div class="w-6 h-6 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center font-bold text-[10px] shrink-0">AI</div>
                <div class="bg-white p-3 rounded-2xl rounded-tl-none border border-slate-200 shadow-sm text-slate-700 space-y-2 max-w-[85%]">
                    ${txt}
                </div>
            </div>
        `;
    }
    body.scrollTop = body.scrollHeight;
}

function processAIResponse(query) {
    const requestPortal = currentPortal;
    setTimeout(() => {
        if (requestPortal === 'owner') {
            const mine = getOwnerListings();
            const rooms = mine.flatMap(d => d.rooms);
            const available = rooms.filter(r => isRoomAvailable(r.status));
            const pending = getOwnerHoldList().filter(h => h.status === 'Pending Approval');
            const waiting = ownerConversations.length;
            const q = query.toLowerCase();
            const actions = [];
            if (/visit|hold|request|approve/.test(q)) actions.push(`${pending.length} hold request(s) are awaiting review. Confirm or decline them in the Visitations tab.`);
            if (/message|chat|inquir|response/.test(q)) actions.push(`You have ${waiting} student conversation(s) listed in the Messages tab. Answer recent inquiries promptly.`);
            if (/pric|rent|revenue|budget/.test(q)) {
                const prices = rooms.map(r => Number(r.price)).filter(Number.isFinite);
                if (prices.length) actions.push(`Your average listed room rate is ₱${Math.round(prices.reduce((a,b)=>a+b,0)/prices.length).toLocaleString()}. Compare rates and amenities before changing prices.`);
            }
            if (/occup|vacan|avail|listing|room/.test(q)) actions.push(`${available.length} of ${rooms.length} rooms are marked available. Check statuses regularly and add clear photos for vacant rooms.`);
            if (!actions.length) actions.push(`You manage ${mine.length} listings. Review availability, respond to ${waiting} conversations, and check the Analytics tab for property-specific recommendations.`);
            appendAIMessage(`<strong class="block mb-1">Landlord management suggestions</strong><p>${escHtml(actions.join(' '))}</p>`, 'ai');
            return;
        }
        const q = query.toLowerCase();
        const budget = q.match(/(?:₱|php\s*)?(\d{1,3}(?:,\d{3})+|\d{3,6})/i);
        const maxBudget = budget ? Number(budget[1].replaceAll(',','')) : null;
        let matching = dormsData.filter(d => d.rooms.some(r => isRoomAvailable(r.status)));
        if (maxBudget && /under|below|budget|up to|max|less/.test(q))
            matching = matching.filter(d => d.minPrice <= maxBudget);
        if (/aircon|wifi|wi-fi|study|bathroom|laundry/.test(q)) {
            const terms = q.match(/aircon|wifi|wi-fi|study|bathroom|laundry/g) || [];
            matching = matching.filter(d => d.rooms.some(r => terms.every(t => (r.amenities || []).some(a => a.toLowerCase().replace(/[- ]/g,'').includes(t.replace(/[- ]/g,''))))));
        }
        const locationQuery = q.match(/(?:near|in|around|at)\s+([\w\s-]{2,50})/);
        if (locationQuery) {
            const loc = locationQuery[1].replace(/\b(with|under|below|for)\b.*$/,'').trim();
            const zoned = matching.filter(d => `${d.locationZone} ${d.distance}`.toLowerCase().includes(loc));
            if (zoned.length) matching = zoned;
        }
        matching.sort((a,b) => a.minPrice-b.minPrice);
        if (!matching.length) { appendAIMessage('<p>No currently available listings match those criteria. Try another budget or location.</p>', 'ai'); return; }
        const options = matching.slice(0,3).map(d => `<div class="p-2 border border-slate-200 rounded-lg bg-white">
          <strong class="block">${escHtml(d.title)}</strong><span class="block text-brand-700 font-semibold">${escHtml(d.priceRangeStr)}</span>
          <span class="block text-slate-500">${escHtml(d.locationZone)}</span>
          <button onclick="openBedspaceViewer('${validListingId(d.id) ? d.id : ''}')" class="mt-1 text-brand-700 font-bold underline">Inspect rooms</button></div>`).join('');
        appendAIMessage(`<p class="mb-2">Here are ${matching.length > 3 ? 'three of the' : ''} matching available properties:</p>${options}`, 'ai');
    }, 350);
}

/* ==========================================================================
   ADMIN / OWNER DASHBOARD MANAGEMENT & SMS PAYMENT TRACKER
   ========================================================================== */

/* ===========================================================================
   TENANT ASSIGNMENTS & MONTHLY RENT SCHEDULES
   Owner alone confirms a rental; student hold requests do not create tenants.
   The backend uses an atomic RPC to prevent room/bedspace overbooking.
   =========================================================================== */
function formatPeso(amount) {
    return `₱${Number(amount || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function currentPhilippineDate() {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map(p => [p.type, p.value]));
    return `${values.year}-${values.month}-${values.day}`;
}
function rentalRoomCapacity(room) {
    return displayBedSlots(room).length;
}
function activeTenantCount(listingId, roomName) {
    return tenantRecords.filter(t => t.status === 'Active' &&
        t.listing_id === listingId && t.room_name === roomName).length;
}
function availableRentalSlots(listingId,room) {
    return displayBedSlots(room).filter(b => b.status==='Available').length;
}
function assignedRentStatus(record) {
    return record.paid_at ? 'Paid' : String(record.due_date) < currentPhilippineDate() ? 'Overdue' : 'Pending';
}
function getPaymentViewRecords() {
    return rentRecords.map(payment => {
        const tenant = tenantRecords.find(t => t.id === payment.tenancy_id);
        if (!tenant) return null;
        return {
            id: payment.id, tenantId: tenant.id, tenantName: tenant.tenant_name,
            phone: tenant.tenant_phone, email: tenant.tenant_email,
            unitName: `${lookupPropertyName(tenant.listing_id)} — ${tenant.room_name}`,
            amount: Number(payment.amount_due), dueDate: payment.due_date,
            status: assignedRentStatus(payment), paidAt: payment.paid_at
        };
    }).filter(Boolean).sort((a,b) => b.dueDate.localeCompare(a.dueDate));
}
function toggleTenantPaymentHistory(tenancyId) {
    if (expandedTenantPaymentHistory.has(tenancyId)) expandedTenantPaymentHistory.delete(tenancyId);
    else expandedTenantPaymentHistory.add(tenancyId);
    renderRentTracker();
}
function renderRentTracker() {
    const body = document.getElementById('adminPaymentsTable');
    if (!body) return;

    // The record index is preserved for the existing reminder and payment functions.
    const all = getPaymentViewRecords();
    const indexed = all.map((payment, index) => ({ payment, index }));
    const byTenant = new Map();
    for (const item of indexed) {
        if (!byTenant.has(item.payment.tenantId)) byTenant.set(item.payment.tenantId, []);
        byTenant.get(item.payment.tenantId).push(item);
    }
    const filter = document.getElementById('paymentStatusFilter')?.value || 'all';
    const tenancyFilter = document.getElementById('tenancyStatusFilter')?.value || 'all';
    const tenants = tenantRecords
        // Do not discard ended tenancies: they are permanent historical records.
        .filter(tenant => tenancyFilter === 'all' || String(tenant.status).toLowerCase() === tenancyFilter)
        .filter(tenant => filter === 'all' || (byTenant.get(tenant.id) || [])
            .some(({ payment }) => payment.status.toLowerCase() === filter))
        .sort((a, b) => Number(b.status === 'Active') - Number(a.status === 'Active') ||
            String(b.end_date || b.start_date || '').localeCompare(String(a.end_date || a.start_date || '')) ||
            String(a.tenant_name).localeCompare(String(b.tenant_name)));

    function pickDue(items) {
        const matching = filter === 'all' ? items : items.filter(({ payment }) =>
            payment.status.toLowerCase() === filter);
        // Prioritize the oldest outstanding balance. Otherwise show the next
        // upcoming due, or the most recent paid installment.
        const overdue = matching.filter(({ payment }) => payment.status === 'Overdue')
            .sort((a, b) => a.payment.dueDate.localeCompare(b.payment.dueDate));
        if (overdue.length) return overdue[0];
        const pending = matching.filter(({ payment }) => payment.status === 'Pending')
            .sort((a, b) => a.payment.dueDate.localeCompare(b.payment.dueDate));
        if (pending.length) return pending[0];
        return matching.find(({ payment }) => payment.status === 'Paid') || null;
    }
    function statusBadge(status) {
        return `<span class="payment-status-text text-slate-700">${escHtml(status)}</span>`;
    }
    function tenancyBadge(tenant) {
        const ended = tenant.status === 'Ended';
        return `<span class="inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${ended ? 'bg-slate-200 text-slate-700' : 'bg-brand-100 text-brand-800'}">${ended ? 'Ended' : 'Active'}</span>`;
    }
    function tenureLength(tenant) {
        if (!tenant.start_date || (tenant.status === 'Ended' && !tenant.end_date)) return 'Not available';
        const start = Date.parse(`${tenant.start_date}T00:00:00Z`);
        const end = Date.parse(`${tenant.status === 'Ended' ? tenant.end_date : currentPhilippineDate()}T00:00:00Z`);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 'Not available';
        const days = Math.round((end - start) / 86400000);
        return `${days} day${days === 1 ? '' : 's'}`;
    }
    function paymentActions(item) {
        if (!item) return '';
        const { payment, index } = item;
        return `${payment.status !== 'Paid' ? `<button type="button" onclick="previewRentReminder(${index})" class="simple-icon-btn" title="Preview rent reminder" aria-label="Preview rent reminder"><i class="fa-solid fa-bell"></i></button>` : ''}
                <button type="button" onclick="togglePaymentStatus(${index})" class="simple-icon-btn" title="${payment.status === 'Paid' ? 'Undo paid status' : 'Mark as paid'}" aria-label="${payment.status === 'Paid' ? 'Undo paid status' : 'Mark as paid'}"><i class="fa-solid fa-${payment.status === 'Paid' ? 'rotate-left' : 'check'}"></i></button>`;
    }

    body.innerHTML = tenants.length ? tenants.map(tenant => {
        const items = byTenant.get(tenant.id) || [];
        const focus = pickDue(items);
        const due = focus?.payment;
        const open = expandedTenantPaymentHistory.has(tenant.id);
        const overdueCount = items.filter(({ payment }) => payment.status === 'Overdue').length;
        const endButton = tenant.status === 'Active'
            ? `<button type="button" onclick="endTenantAssignment('${escHtml(tenant.id)}')" class="simple-icon-btn text-rose-700" title="End tenancy" aria-label="End tenancy"><i class="fa-solid fa-door-open"></i></button>` : '';
        const historyButton = `<button type="button" aria-expanded="${open}" aria-controls="tenant-history-${escHtml(tenant.id)}" onclick="toggleTenantPaymentHistory('${escHtml(tenant.id)}')" class="simple-icon-btn" title="${open ? 'Hide record' : `View record (${items.length} dues)`}" aria-label="${open ? 'Hide record' : 'View record'}"><i class="fa-solid fa-${open ? 'chevron-up' : 'file-lines'}"></i></button>`;
        const history = open ? `<tr id="tenant-history-${escHtml(tenant.id)}" class="bg-slate-50">
            <td colspan="7" class="px-4 py-3">
                <div class="mb-3 rounded-lg border border-slate-200 bg-white p-3">
                    <p class="text-[11px] font-bold text-slate-800 mb-2">Tenancy record — ${escHtml(tenant.tenant_name)} ${tenancyBadge(tenant)}</p>
                    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-2 text-[11px] text-slate-700">
                        <div><strong>Start date:</strong> ${escHtml(tenant.start_date || 'Not recorded')}</div>
                        <div><strong>End date:</strong> ${escHtml(tenant.end_date || (tenant.status === 'Active' ? 'Ongoing' : 'Not recorded'))}</div>
                        <div><strong>Expected move-out:</strong> ${escHtml(tenant.planned_end_date || 'Not specified')}</div>
                        <div><strong>Tenancy length:</strong> ${escHtml(tenureLength(tenant))}</div>
                        <div><strong>Assigned bed:</strong> ${escHtml(tenant.bed_slot || 'Not recorded')}</div>
                        <div><strong>Monthly due day:</strong> ${escHtml(tenant.due_day || 'Not recorded')}</div>
                        <div><strong>Rent:</strong> ${escHtml(formatPeso(tenant.monthly_rent))}</div>
                        <div><strong>Phone:</strong> ${escHtml(tenant.tenant_phone || 'Not recorded')}</div>
                        <div><strong>Email:</strong> ${escHtml(tenant.tenant_email || 'Not recorded')}</div>
                        <div><strong>Recorded payments:</strong> ${items.length}</div>
                    </div>
                </div>
                <p class="text-[11px] font-bold text-slate-700 mb-2">Monthly payment history</p>
                <div class="overflow-x-auto"><table class="w-full text-xs text-left">
                    <thead><tr class="text-slate-500 border-b border-slate-200">
                        <th class="p-2">Due Date</th><th class="p-2">Amount</th>
                        <th class="p-2">Status</th><th class="p-2 text-right">Actions</th>
                    </tr></thead><tbody>${items.map(item => `<tr class="border-b border-slate-100">
                        <td class="p-2 whitespace-nowrap">${escHtml(item.payment.dueDate)}</td>
                        <td class="p-2 whitespace-nowrap font-semibold">${escHtml(formatPeso(item.payment.amount))}</td>
                        <td class="p-2">${statusBadge(item.payment.status)}</td>
                        <td class="p-2"><div class="flex flex-wrap justify-end gap-1.5">${paymentActions(item)}</div></td>
                    </tr>`).join('')}</tbody></table></div>
            </td>
        </tr>` : '';
        return `<tr class="hover:bg-slate-50 align-top">
            <td class="p-3"><strong class="block text-slate-900">${escHtml(tenant.tenant_name)}</strong>
                <span class="block text-slate-500 my-1">${escHtml(tenant.tenant_phone || '')}</span>
                ${tenancyBadge(tenant)}</td>
            <td class="p-3">${escHtml(lookupPropertyName(tenant.listing_id))}
                <span class="block text-brand-700">${escHtml(tenant.room_name)}</span>
                <span class="block text-[10px] text-slate-500">Bed: ${escHtml(tenant.bed_slot || 'Not recorded')}</span>
                <span class="block text-[10px] text-slate-500">Started: ${escHtml(tenant.start_date || 'Not recorded')}</span>
                ${tenant.status === 'Ended' ? `<span class="block text-[10px] font-semibold text-slate-600">Ended: ${escHtml(tenant.end_date || 'Not recorded')}</span>` : ''}</td>
            <td class="p-3 font-semibold whitespace-nowrap">${escHtml(formatPeso(tenant.monthly_rent))}</td>
            <td class="p-3 whitespace-nowrap text-slate-600">${escHtml(tenant.status==='Ended' ? (tenant.end_date || 'Ended') : (tenant.planned_end_date || 'Not recorded'))}</td>
            <td class="p-3 whitespace-nowrap">${due ? escHtml(due.dueDate) : 'No due generated'}
                ${overdueCount > 1 && filter === 'all' ? `<span class="block text-[10px] text-rose-600">${overdueCount} overdue dues</span>` : ''}</td>
            <td class="p-3">${due ? statusBadge(due.status) : '<span class="text-slate-400">—</span>'}</td>
            <td class="p-3"><div class="flex flex-wrap justify-end gap-1.5">
                ${paymentActions(focus)}${historyButton}${endButton}
            </div></td>
        </tr>${history}`;
    }).join('') : `<tr><td colspan="7" class="p-6 text-center text-slate-500">${filter === 'all'
        ? 'No tenancy records match the selected filters. Assign a tenant from My Property Listings.'
        : 'No tenancy records match the selected payment and tenancy filters.'}</td></tr>`;

    const active = tenantRecords.filter(tenant => tenant.status === 'Active');
    const ended = tenantRecords.filter(tenant => tenant.status === 'Ended');
    const unpaid = all.filter(payment => payment.status !== 'Paid');
    const overdue = all.filter(payment => payment.status === 'Overdue');
    const paid = all.filter(payment => payment.status === 'Paid');
    const blocks = [
        ['Active / Ended', `${active.length} / ${ended.length}`, 'Current / archived tenancies'],
        ['Unpaid Dues', formatPeso(unpaid.reduce((sum, payment) => sum + payment.amount, 0)), 'Pending and overdue'],
        ['Overdue Dues', formatPeso(overdue.reduce((sum, payment) => sum + payment.amount, 0)), `${overdue.length} overdue records`]
    ];
    document.getElementById('rentTrackerSummary').innerHTML = blocks.map(([title, value, detail]) => `
        <div class="bg-slate-50 border border-slate-200 rounded-xl p-3">
          <p class="text-[10px] text-slate-500 font-bold uppercase">${escHtml(title)}</p>
          <p class="text-xl font-black text-slate-900 mt-1">${escHtml(value)}</p>
          <p class="text-[10px] text-slate-500 mt-1">${escHtml(detail)}</p>
        </div>`).join('');
}
function updateTenantRoomChoices(preferred = null) {
    const listingId = document.getElementById('tenantListing').value;
    const listing = getOwnerListings().find(d => d.id === listingId);
    const roomSelect = document.getElementById('tenantRoom');
    const rooms = listing?.rooms.filter(r => isRoomAvailable(r.status) &&
        availableRentalSlots(listingId,r) > 0) || [];
    roomSelect.innerHTML = rooms.length ? rooms.map((r,i)=>`<option value="${escHtml(r.name)}">${escHtml(r.name)} · ${escHtml(formatPeso(r.price))}/mo</option>`).join('')
        : '<option value="">No available rooms</option>';
    if (preferred && rooms.some(r=>r.name===preferred)) roomSelect.value=preferred;
    updateTenantRoomRate();
}
function updateTenantRoomRate() {
    const listing = getOwnerListings().find(d=>d.id===document.getElementById('tenantListing').value);
    const room = listing?.rooms.find(r=>r.name===document.getElementById('tenantRoom').value);
    document.getElementById('tenantMonthlyRent').value = room ? String(Math.round(Number(room.price))) : '';
    const select = document.getElementById('tenantBedSlot');
    const available = room ? displayBedSlots(room).filter(b=>b.status==='Available') : [];
    select.innerHTML = available.length ? available.map(b => `<option value="${escHtml(b.id)}">${escHtml(b.id.replace('bed-','Bed '))} — Available</option>`).join('')
        : '<option value="">No vacant beds</option>';
}
function openTenantAssignmentModal(holdIndex = null, preferredListingId = null) {
    if (HomeboundStore.configured && !activeOwner) {
        showToast('Sign in as an approved landlord to assign a tenant.', 'error'); return;
    }
    const listings = getOwnerListings();
    const select = document.getElementById('tenantListing');
    const available = listings.filter(d=>d.rooms.some(r=>isRoomAvailable(r.status) &&
        availableRentalSlots(d.id,r)>0));
    if (!available.length) {
        showToast('Create a listing with an available room before assigning a tenant.', 'error'); return;
    }
    let hold = holdIndex === null ? null : getOwnerHoldList()[holdIndex];
    if (hold && hold.status !== 'Confirmed Visit') {
        showToast('Approve the student visitation first, then assign the rental.', 'error'); return;
    }
    const holdListingId = hold?.listing_id || listings.find(d=>d.title===hold?.dormTitle)?.id;
    const propertyId = holdListingId || preferredListingId || available[0].id;
    if (!available.some(d=>d.id===propertyId)) {
        showToast('The selected room has no available rental slots.', 'error'); return;
    }
    document.getElementById('tenantAssignmentForm').reset();
    pendingRentalHoldId = hold?.id || null;
    select.innerHTML = available.map(d=>`<option value="${escHtml(d.id)}">${escHtml(d.title)}</option>`).join('');
    select.value=propertyId;
    updateTenantRoomChoices(hold?.room_name || hold?.roomName);
    if (hold && document.getElementById('tenantRoom').value !== (hold.room_name || hold.roomName)) {
        showToast('The held room is not available for a new tenancy.', 'error'); return;
    }
    document.getElementById('tenantFullName').value=hold?.student_name || hold?.studentName || '';
    document.getElementById('tenantPhone').value=hold?.student_phone || hold?.studentPhone || '';
    document.getElementById('tenantEmail').value=hold?.student_email || hold?.studentEmail || '';
    const today=currentPhilippineDate();
    document.getElementById('tenantMoveIn').value=today;
    const planned=document.getElementById('tenantPlannedEnd');
    planned.value='';
    planned.min=today;
    planned.max=localDateISO(new Date(Date.now()+730*86400000));
    document.getElementById('tenantMoveIn').onchange=()=>{
        planned.min=document.getElementById('tenantMoveIn').value>today?document.getElementById('tenantMoveIn').value:today;
        if(planned.value && planned.value<planned.min)planned.value='';
    };
    document.getElementById('tenantDueDay').value=String(Number(today.slice(8,10)));
    const linked = document.getElementById('tenantAssignedFromHold');
    linked.classList.toggle('hidden',!hold);
    linked.textContent=hold ? `Based on confirmed visitation: ${hold.student_name || hold.studentName} — ${hold.room_name || hold.roomName}` : '';
    // If started from a specific hold, freeze the exact room and property.
    select.disabled=Boolean(hold);
    document.getElementById('tenantRoom').disabled=Boolean(hold);
    document.getElementById('modalTenantAssignment').classList.remove('hidden');
}
function updateDemoRoomOccupancy(listingId,roomName) {
    const listing=dormsData.find(d=>d.id===listingId);
    const room=listing?.rooms.find(r=>r.name===roomName);
    if (!room) return;
    syncBedCountStatus(room);
    listing.lastUpdated='Updated just now';
}
function makeDueDate(year,monthZero,dueDay) {
    const monthLength=new Date(Date.UTC(year,monthZero+1,0)).getUTCDate();
    return `${year}-${String(monthZero+1).padStart(2,'0')}-${String(Math.min(dueDay,monthLength)).padStart(2,'0')}`;
}
function syncDemoRentPayments() {
    const today=currentPhilippineDate();
    const [y,m]=today.split('-').map(Number);
    // Generate past periods since lease start, and the next month, without duplicates.
    tenantRecords.forEach(t=>{
        let start=new Date(`${t.start_date}T12:00:00Z`);
        if (Number.isNaN(start.getTime())) return;
        let year=start.getUTCFullYear(),month=start.getUTCMonth();
        // Same limit as server-side schedule generation: previous 24 months.
        const oldest=new Date(Date.UTC(y,m-1-24,1));
        if (new Date(Date.UTC(year,month,1)) < oldest) {
            year=oldest.getUTCFullYear(); month=oldest.getUTCMonth();
        }
        for (let counter=0;counter<28;counter++) {
            const monthDate=new Date(Date.UTC(year,month,1));
            if (monthDate > new Date(Date.UTC(y,m,1))) break; // next month included
            const due=makeDueDate(year,month,Number(t.due_day));
            if (due >= t.start_date && (!t.end_date || due<=t.end_date) &&
                !rentRecords.some(r=>r.tenancy_id===t.id && r.due_date===due)) {
                rentRecords.push({id:crypto.randomUUID(),tenancy_id:t.id,
                    due_date:due,amount_due:t.monthly_rent,paid_at:null});
            }
            month++;if(month===12){month=0;year++;}
        }
    });
}
async function submitTenantAssignment(event) {
    event.preventDefault();
    const form=document.getElementById('tenantAssignmentForm');
    if (!form.reportValidity()) return;
    const id=document.getElementById('tenantListing').value;
    const roomName=document.getElementById('tenantRoom').value;
    const listing=getOwnerListings().find(d=>d.id===id);
    const room=listing?.rooms.find(r=>r.name===roomName);
    if (!room || !isRoomAvailable(room.status)) {
        showToast('Select an available room to continue.', 'error');return;
    }
    const bedSlot = document.getElementById('tenantBedSlot').value;
    if (!bedSlot || !displayBedSlots(room).some(b => b.id===bedSlot && b.status==='Available')) {
        showToast('Choose an available individual bed slot.', 'error'); return;
    }
    const payload={listingId:id,roomName,bedSlot,
        tenantName:document.getElementById('tenantFullName').value.trim(),
        phone:document.getElementById('tenantPhone').value.trim(),
        email:document.getElementById('tenantEmail').value.trim(),
        startDate:document.getElementById('tenantMoveIn').value,
        dueDay:Number(document.getElementById('tenantDueDay').value),
        monthlyRent:Number(document.getElementById('tenantMonthlyRent').value),
        holdId:pendingRentalHoldId,
        plannedEndDate: document.getElementById('tenantPlannedEnd')?.value || null};
    if (!payload.plannedEndDate) {showToast('Expected move-out date is required for future vacancy records.', 'error');return;}
    if (payload.plannedEndDate < currentPhilippineDate() || payload.plannedEndDate > localDateISO(new Date(Date.now()+730*86400000))) {showToast('Expected move-out date must be within the next two years.','error');return;}
    if (payload.plannedEndDate && payload.plannedEndDate < payload.startDate) {
        showToast('Expected move-out must not be before the move-in date.','error');return;
    }
    if (payload.phone.length<7 || !Number.isInteger(payload.dueDay) ||
        payload.dueDay<1 || payload.dueDay>31 || !Number.isInteger(payload.monthlyRent) ||
        payload.monthlyRent<=0 || payload.monthlyRent>10000000) {
        showToast('Check the tenant phone, due day and monthly rent.', 'error');return;
    }
    if (pendingRentalHoldId) {
        const hold=getOwnerHoldList().find(h=>h.id===pendingRentalHoldId);
        if (!hold || hold.status !== 'Confirmed Visit') {
            showToast('The related hold is no longer confirmed.', 'error');return;
        }
    }
    const submit=document.getElementById('tenantAssignSubmit');
    submit.disabled=true;submit.textContent='Saving rental…';
    try {
        if (HomeboundStore.configured) {
            await HomeboundStore.assignTenant(payload);
            await Promise.all([loadListings(),loadOwnerHolds()]);
            await loadOwnerRentData();
        } else {
            if (availableRentalSlots(id,room)<=0)
                throw new Error('This room or bedspace is fully assigned.');
            const advanceMatch=hbDemoAdvance?.find(r=>r.listingId===id && r.roomName===roomName && r.bedSlot===bedSlot && r.status==='Approved');
            if (advanceMatch && (advanceMatch.email.toLowerCase()!==payload.email.toLowerCase() || payload.startDate < advanceMatch.moveIn))
                throw new Error('This bed has an approved advance reservation for another student.');
            if (advanceMatch) {
                advanceMatch.status='Fulfilled';
                const reserved=room.beds.find(b=>b.id===bedSlot);
                if(reserved) delete reserved.reservedFor;
            }
            tenantRecords.push({id:crypto.randomUUID(),listing_id:id,room_name:roomName,
                bed_slot:bedSlot,
                tenant_name:payload.tenantName,tenant_phone:payload.phone,
                tenant_email:payload.email,monthly_rent:payload.monthlyRent,
                start_date:payload.startDate,due_day:payload.dueDay,status:'Active',
                end_date:null,planned_end_date:payload.plannedEndDate,announcement_token:crypto.randomUUID(),source_hold_id:payload.holdId});
            room.beds.find(b=>b.id===bedSlot).status='Occupied';
            if (payload.plannedEndDate) room.beds.find(b=>b.id===bedSlot).availableFrom=payload.plannedEndDate;
            if (payload.holdId) {
                const hold=visitationsList.find(h=>h.id===payload.holdId);
                if (hold) hold.status='Rented';
                const studentHold=studentHolds.find(h=>h.id===payload.holdId);
                if (studentHold) {
                    studentHold.status='Rented';
                    studentHold.statusUpdatedAt=new Date().toISOString();
                    saveStudentHolds();
                    refreshHoldBanner();
                }
            }
            updateDemoRoomOccupancy(id,roomName);
            syncDemoRentPayments();
            refreshListingViews();
        }
        pendingRentalHoldId=null;
        closeModal('modalTenantAssignment');
        switchAdminTab('payments');
        refreshDashboardStats();renderAnalytics();
        showToast(`Tenant assigned to ${roomName}. Monthly rent tracking has started.`, 'success');
    } catch (err) { showToast(`Tenant assignment failed: ${err.message}`, 'error'); }
    finally {submit.disabled=false;submit.textContent='Save Tenant & Start Rent Tracking';}
}
async function endTenantAssignment(tenancyId) {
    const tenant=tenantRecords.find(t=>t.id===tenancyId);
    if (!tenant || tenant.status!=='Active') return;
    if (!window.confirm(`End ${tenant.tenant_name}'s tenancy in ${tenant.room_name}? This frees the room or bedspace and retains historical payment records.`)) return;
    try {
        if (HomeboundStore.configured) {
            const changed=await HomeboundStore.endTenancy(tenancyId);
            if (!changed) throw new Error('This tenancy was already closed.');
            await Promise.all([loadListings(),loadOwnerRentData()]);
        } else {
            tenant.status='Ended';tenant.end_date=currentPhilippineDate();
            const room = dormsData.find(d=>d.id===tenant.listing_id)?.rooms.find(r=>r.name===tenant.room_name);
            const bed = room?.beds?.find(b=>b.id===tenant.bed_slot);
            if (bed) {bed.status='Available';delete bed.availableFrom;}
            rentRecords=rentRecords.filter(r=>r.tenancy_id!==tenant.id ||
                r.paid_at || r.due_date<=tenant.end_date);
            updateDemoRoomOccupancy(tenant.listing_id,tenant.room_name);
            refreshListingViews();
        }
        refreshDashboardStats();renderAnalytics();
        showToast('Tenancy ended; room availability updated.', 'success');
    } catch (err) {showToast(`Could not end tenancy: ${err.message}`, 'error');}
}
async function loadOwnerRentData() {
    if (!HomeboundStore.configured) {
        syncDemoRentPayments();
        renderAdminTables();return;
    }
    if (!activeOwner || ownerRentLoadInProgress) return;
    ownerRentLoadInProgress=true;
    try {
        await HomeboundStore.syncRentPayments();
        const [tenancies,payments]=await Promise.all([
            HomeboundStore.listTenancies(),HomeboundStore.listRentPayments()
        ]);
        tenantRecords=tenancies;rentRecords=payments;
        renderAdminTables();
    } catch (err) {
        showToast(`Could not load tenant/payment records: ${err.message}`, 'error');
    } finally {ownerRentLoadInProgress=false;}
}


function switchAdminTab(tabName) {
    for (const name of ['Visitations','Reservations','Payments','Listings','Chats','Analytics','Announcements']) {
        document.getElementById(`tabContent${name}`).classList.add('hidden');
        const btn = document.getElementById(`tabBtn${name}`);
        btn.className = 'admin-tab-btn px-5 py-3.5 text-xs font-bold border-b-2 border-transparent text-slate-500 hover:text-slate-900 flex items-center space-x-2 whitespace-nowrap';
    }
    const title = tabName.charAt(0).toUpperCase() + tabName.slice(1);
    document.getElementById(`tabContent${title}`).classList.remove('hidden');
    document.getElementById(`tabBtn${title}`).className = 'admin-tab-btn px-5 py-3.5 text-xs font-bold border-b-2 border-brand-600 text-brand-600 flex items-center space-x-2 whitespace-nowrap';
    if (tabName === 'listings') renderAdminListings();
    if (tabName === 'chats') loadOwnerInbox();
    if (tabName === 'visitations') loadOwnerHolds();
    if (tabName === 'payments' && HomeboundStore.configured && activeOwner) {
        HomeboundStore.activateDueReservations().catch(e=>console.warn('Activation check:',e.message)).finally(loadOwnerRentData);
    }
    if (tabName === 'analytics') requestAnimationFrame(() => {
        renderAnalytics();renderHomeboundForecast();
        setAnalyticsView(document.getElementById('analyticsViewFilter').value);
        if(!window.Chart) loadHomeboundChartLibrary().then(loaded=>{
            const notice=document.getElementById('analyticsChartNotice');
            if(notice){notice.classList.toggle('hidden',loaded);}
            if(loaded){renderAnalytics();renderHomeboundForecast();setAnalyticsView(document.getElementById('analyticsViewFilter').value);}
        });
    });
    if (tabName === 'announcements') loadTenantAnnouncements();
    if (tabName === 'reservations') loadAdvanceReservations();
}

function renderAdminTables() {
    const holds = getOwnerHoldList();
    const table = document.getElementById('adminVisitationsTable');
    table.innerHTML = holds.length ? holds.map((v, i) => {
        const status = v.status || 'Pending Approval';
        const isPending = status === 'Pending Approval';
        return `<tr class="hover:bg-slate-50 transition">
          <td class="p-3"><strong class="block text-slate-900">${escHtml(v.studentName || v.student_name)}</strong>
            <span class="text-[10px] text-slate-500">${escHtml(v.studentEmail || v.student_email)}</span></td>
          <td class="p-3"><span class="font-semibold block">${escHtml(v.dormTitle || lookupPropertyName(v.listing_id))}</span>
            <span class="text-brand-700">${escHtml(v.roomName || v.room_name)}</span></td>
          <td class="p-3 whitespace-nowrap">${escHtml(v.visitDate || v.visit_date)}<br>${escHtml(v.visitSlot || formatVisitTime(v.visit_time || v.visitTime))}</td>
          <td class="p-3">${escHtml(v.studentPhone || v.student_phone)}</td>
          <td class="p-3 font-semibold">${escHtml(status)}</td>
          <td class="p-3 text-right">${isPending ? `<button onclick="updateVisitStatus(${i}, 'Confirmed Visit')" class="bg-brand-600 text-white px-2 py-1 rounded text-[10px] font-bold">Approve</button>
            <button onclick="updateVisitStatus(${i}, 'Declined')" class="bg-slate-200 text-slate-700 px-2 py-1 rounded text-[10px] font-bold">Decline</button>`
            : status === 'Confirmed Visit' ? `<div class="inline-flex items-center justify-end gap-2 whitespace-nowrap">
                <button type="button" onclick="markVisitationCompleted(${i})" class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 transition" title="Mark Visited — release this visitation time slot" aria-label="Mark Visited"><i class="fa-solid fa-check-double" aria-hidden="true"></i></button>
                <button type="button" onclick="openTenantAssignmentModal(${i})" class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition" title="Assign Tenant / Rent" aria-label="Assign Tenant / Rent"><i class="fa-solid fa-user-plus" aria-hidden="true"></i></button>
                </div>`
            : status === 'Visited' ? '<span class="text-slate-600 text-[10px]">Visit completed</span>'
            : '<span class="text-slate-400 text-[10px]">Reviewed</span>'}</td>
        </tr>`;
    }).join('') : '<tr><td colspan="6" class="p-5 text-center text-slate-400">No visitation requests yet.</td></tr>';
    renderRentTracker();
    const overdueCount = getPaymentViewRecords().filter(p => p.status === 'Overdue').length;
    document.getElementById('badgeVisitCount').textContent = holds.filter(v => v.status === 'Pending Approval').length;
    document.getElementById('badgeOverdueCount').textContent = overdueCount;
    document.getElementById('statPendingVisits').textContent = holds.filter(v => v.status === 'Pending Approval').length;
    document.getElementById('statActiveHolds').textContent = holds.filter(v => v.status === 'Pending Approval' && (v.expires_at || v.timestamp) && new Date(v.expires_at || new Date(new Date(v.timestamp).getTime() + 86400000)) > new Date()).length;
    document.getElementById('statOverdueCount').textContent = overdueCount;
}

async function updateVisitStatus(idx, newStatus) {
    const hold = getOwnerHoldList()[idx];
    if (!hold || hold.status !== 'Pending Approval') return;
    try {
        if (HomeboundStore.configured) {
            const changed = await HomeboundStore.setHoldStatus(hold.id, newStatus);
            if (!changed) throw new Error('Request was already reviewed or cancelled.');
            await loadOwnerHolds();
        } else {
            hold.status = newStatus;
            const storedHold=studentHolds.find(h=>h.id===hold.id);
            if (storedHold) {
                storedHold.status=newStatus;
                storedHold.statusUpdatedAt=new Date().toISOString();
                saveStudentHolds();
                refreshHoldBanner();
            }
            const conv = demoConversations.find(c=>c.id===hold.conversationId);
            if (conv) {
                conv.messages.push({id:crypto.randomUUID(),sender:'system',
                    body:`Homebound update: Your visitation request for ${hold.roomName || hold.room_name} has been ${newStatus === 'Confirmed Visit' ? 'APPROVED' : 'DECLINED'} by the owner.`,
                    created_at:new Date().toISOString()});
                conv.updatedAt=new Date().toISOString();
            }
            renderAdminTables();
            pollStudentInbox();
        }
        refreshDashboardStats();
        showToast(`Visitation marked as ${newStatus}.`, 'success');
    } catch (err) { showToast(`Could not update request: ${err.message}`, 'error'); }
}

// Completing a visit frees the confirmed one-hour slot without deleting visit history.
async function markVisitationCompleted(index) {
    const hold = getOwnerHoldList()[index];
    if (!hold || hold.status !== 'Confirmed Visit') return;
    try {
        if (HomeboundStore.configured) {
            const changed = await HomeboundStore.completeVisit(hold.id);
            if (!changed) throw new Error('The visit was already updated. Reload the visits list.');
            await loadOwnerHolds();
        } else {
            hold.status = 'Visited';
            const studentCopy = studentHolds.find(h => h.id === hold.id);
            if (studentCopy) {
                studentCopy.status = 'Visited';
                studentCopy.statusUpdatedAt = new Date().toISOString();
                saveStudentHolds();
                refreshHoldBanner();
            }
            const conv = demoConversations.find(c => c.id === hold.conversationId);
            if (conv) {
                conv.messages.push({id:crypto.randomUUID(), sender:'system',
                    body:`Homebound update: Your visit for ${hold.roomName || hold.room_name} is marked completed.`,
                    created_at:new Date().toISOString()});
            }
            renderAdminTables();
        }
        showToast('Visit marked completed. The time slot is available for new visits.', 'success');
        if (typeof refreshVisitSlotAvailability === 'function') void refreshVisitSlotAvailability();
    } catch (err) {
        showToast(`Could not complete visit: ${err.message}`, 'error');
    }
}

async function togglePaymentStatus(idx) {
    const item = getPaymentViewRecords()[idx];
    if (!item) return;
    const shouldMarkPaid = item.status !== 'Paid';
    const action = shouldMarkPaid ? 'mark this month as paid' : 'change this month back to unpaid';
    if (!window.confirm(`Confirm you want to ${action} for ${item.tenantName}, due ${item.dueDate}?`)) return;
    try {
        if (HomeboundStore.configured) {
            const ok = await HomeboundStore.setRentPaid(item.id, shouldMarkPaid);
            if (!ok) throw new Error('The selected payment could not be updated.');
            await loadOwnerRentData();
        } else {
            const record = rentRecords.find(r => r.id === item.id);
            if (record) record.paid_at = shouldMarkPaid ? new Date().toISOString() : null;
            renderAdminTables(); refreshDashboardStats();
        }
        showToast(shouldMarkPaid ? 'Payment marked paid.' : 'Payment marked unpaid.', 'success');
    } catch (err) { showToast(`Payment update failed: ${err.message}`, 'error'); }
}
function previewRentReminder(idx) {
    const item = getPaymentViewRecords()[idx];
    if (!item) return;
    sendSMSPaymentReminder(item.tenantName,item.phone,formatPeso(item.amount),item.dueDate);
}

// Simulated SMS Payment Dispatcher
function sendSMSPaymentReminder(tenant, phone, amount, due) {
    const smsMessage = `[Homebound Payment Notice] Hi ${tenant}, this is a gentle reminder that your rental balance of ${amount} for unit is due on ${due}. Please settle directly with your dorm owner. Thank you!`;
    
    showToast(`SMS preview (not sent) for ${phone}: "${smsMessage}"`, 'info');
}

function toggleOwnerListingDetails(dormIndex) {
    const listing = dormsData[dormIndex];
    if (!listing) return;
    // An accordion: opening a listing collapses the previously open listing.
    expandedOwnerListingId = expandedOwnerListingId === listing.id ? null : listing.id;
    renderAdminListings();
}

function renderAdminListings() {
    const container = document.getElementById('adminListingsContainer');
    if (!container) return;
    const mine = HomeboundStore.configured
        ? dormsData.filter(d => d.ownerId === activeOwner?.id)
        : dormsData;
    if (!mine.length) {
        expandedOwnerListingId = null;
        container.innerHTML = '<p class="text-xs text-slate-500 col-span-full py-6">No listings yet. Use "Add New Unit/Listing" to create your first property.</p>';
        return;
    }
    // Keep the owner's selected property expanded across realtime data refreshes.
    // A removed property cannot remain selected.
    if (expandedOwnerListingId !== null && !mine.some(d => d.id === expandedOwnerListingId)) {
        expandedOwnerListingId = null;
    }
    container.innerHTML = mine.map(d => {
        // Preserve original function index-based toggle signature; index comes from master list.
        const index = dormsData.findIndex(item => item.id === d.id);
        const expanded = expandedOwnerListingId === d.id;
        const beds = d.rooms.flatMap(r => displayBedSlots(r));
        const totalBeds = beds.length;
        const availableBeds = beds.filter(b => b.status === 'Available').length;
        const hasAvailable = d.rooms.some(r => isRoomAvailable(r.status));
        return `
        <article class="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
            <button type="button"
                onclick="toggleOwnerListingDetails(${index})"
                aria-expanded="${expanded}"
                aria-controls="ownerListingDetails-${index}"
                class="w-full p-4 text-left hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-600 transition-colors">
                <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0 flex-1 space-y-1.5">
                        <h4 class="font-bold text-slate-900 text-sm break-words">${escHtml(d.title)}</h4>
                        <p class="text-[11px] text-slate-500">
                            ${d.rooms.length} ${d.rooms.length===1?'room':'rooms'}
                            <span class="mx-1">·</span>${availableBeds} / ${totalBeds} beds available
                            <span class="mx-1">·</span><span class="font-semibold text-brand-700">${escHtml(d.priceRangeStr)}</span>
                        </p>
                        <p class="text-[10px] text-slate-400">${escHtml(d.lastUpdated)}</p>
                    </div>
                    <span class="shrink-0 inline-flex items-center gap-2 text-[11px] font-semibold text-brand-700 pt-1">
                        <span>${expanded?'Hide details':'View details'}</span>
                        <i class="fa-solid fa-chevron-${expanded?'up':'down'}" aria-hidden="true"></i>
                    </span>
                </div>
            </button>
            <div id="ownerListingDetails-${index}"
                class="owner-listing-expansion ${expanded?'':'hidden '}border-t border-slate-100 px-4 pb-4 pt-3 space-y-3">
                <div class="flex flex-wrap justify-between items-center gap-2 text-xs">
                    <span class="font-semibold text-slate-700">Global Availability:</span>
                    <button type="button" onclick="toggleDormAvailability(${index})" class="${hasAvailable?'bg-brand-600 hover:bg-brand-700':'bg-slate-600 hover:bg-slate-700'} text-white text-[10px] font-bold px-3 py-1.5 rounded-lg">
                        ${hasAvailable?'Available':'Full / Occupied'}
                    </button>
                </div>
                <div class="space-y-2 border-t border-slate-100 pt-3">
                    ${d.rooms.map(r => `<div class="rounded-lg bg-slate-50 border border-slate-200 p-3">
                        <div class="flex justify-between gap-2 mb-2"><strong class="text-xs">${escHtml(r.name)}</strong>
                            <span class="text-[11px] font-semibold text-brand-700">${displayBedSlots(r).filter(b=>b.status==='Available').length} / ${displayBedSlots(r).length} available</span></div>
                        <div class="flex gap-2 flex-wrap">${displayBedSlots(r).map(b => `<button type="button"
                            ${b.status==='Occupied'||b.reservedFor?'disabled title="Occupied or has an approved advance reservation"':''}
                            onclick="toggleBedAvailability(${bedActionParams(d.id,r.name,b.id)})"
                            aria-pressed="${b.status==='Unavailable'}"
                            class="rounded-lg px-3 py-2 text-[11px] font-semibold border ${b.status==='Occupied'?'bg-slate-300 text-slate-600 cursor-not-allowed':b.status==='Available'?'bg-brand-50 border-brand-300 text-brand-800 hover:bg-brand-100':'bg-amber-50 border-amber-300 text-amber-900 hover:bg-amber-100'}">
                            ${escHtml(b.id.replace('bed-','Bed '))}: ${escHtml(b.reservedFor ? `Reserved ${b.reservedFor}` : b.status)}</button>`).join('')}</div>
                        <button type="button" onclick="hbCalOpenOwner(${bedActionParams(d.id,r.name)})" class="mt-2 text-[11px] font-bold text-brand-700 hover:underline"><i class="fa-regular fa-calendar-days mr-1"></i>Availability calendar</button>
                    </div>`).join('')}
                </div>
                <div class="flex flex-wrap gap-2 text-xs">
                    <button type="button" onclick="openTenantAssignmentModal(null,'${validListingId(d.id) ? d.id : ''}')" class="bg-brand-50 border border-brand-200 text-brand-800 rounded-lg px-3 py-2 font-bold">Assign Tenant</button>
                    <button type="button" onclick="openEditListingModal('${validListingId(d.id) ? d.id : ''}')" class="bg-slate-100 border border-slate-200 text-slate-700 rounded-lg px-3 py-2 font-bold">Edit Property & Rooms</button>
                    <button type="button" onclick="deleteListing('${validListingId(d.id) ? d.id : ''}')" class="bg-rose-50 border border-rose-200 text-rose-700 rounded-lg px-3 py-2 font-bold">Delete</button>
                </div>
            </div>
        </article>`;
    }).join('');
}

async function toggleBedAvailability(listingId, roomName, bedSlot) {
    const listing = getOwnerListings().find(d=>d.id===listingId);
    const room = listing?.rooms.find(r=>r.name===roomName);
    const bed = displayBedSlots(room).find(b=>b.id===bedSlot);
    if (!bed || bed.status==='Occupied' || bed.reservedFor) {
        showToast('Occupied beds can only be reopened by ending the tenancy.', 'error'); return;
    }
    const available = bed.status !== 'Available';
    try {
        if (HomeboundStore.configured) {
            await HomeboundStore.setBedAvailable(listingId,roomName,bedSlot,available);
            await loadListings();
        } else {
            bed.status=available?'Available':'Unavailable';
            syncBedCountStatus(room);
            refreshListingViews();
        }
        showToast(`${bedSlot.replace('bed-','Bed ')} ${available?'is available':'has been blocked'}.`, 'success');
    } catch(err) { showToast(`Bed availability not updated: ${err.message}`, 'error'); }
}

async function toggleDormAvailability(dormIndex) {
    const current = dormsData[dormIndex];
    if (!current) return;
    if (HomeboundStore.configured && current.ownerId !== activeOwner?.id) {
        showToast('You can only update your own listings.', 'error'); return;
    }
    if (tenantRecords.some(t => t.listing_id === current.id && t.status === 'Active')) {
        showToast('This property has active tenants. Change vacant rooms individually, or end a tenancy to reopen its room.', 'error');
        return;
    }
    const next = JSON.parse(JSON.stringify(current));
    const hasAvailable = next.rooms.some(r => isRoomAvailable(r.status));
    next.rooms.forEach(r => {
        r.beds=displayBedSlots(r).map(b => ({...b,status:hasAvailable?'Unavailable':'Available'}));
        syncBedCountStatus(r);
    });
    next.lastUpdated = 'Updated just now';
    try {
        const saved = HomeboundStore.configured ? await HomeboundStore.update(next) : next;
        dormsData[dormIndex] = saved;
        refreshListingViews();
        showToast('Listing availability updated successfully!', 'success');
    } catch (err) {
        showToast(`Availability update not saved: ${err.message}`, 'error');
    }
}

// Refresh occupied/available states in an open editor when Supabase reports
// a changed listing. Preserve unsaved names, prices, and notes.
function reconcileOpenListingEditor() {
    if (!editingListingId || document.getElementById('modalListingEditor').classList.contains('hidden')) return;
    const latest=dormsData.find(d=>d.id===editingListingId);
    if (!latest) return;
    document.querySelectorAll('.listing-room-form').forEach(el=>{
        const room=latest.rooms.find(r=>r.name===el.dataset.originalRoomName);
        if (!room) return;
        const serverBeds=displayBedSlots(room);
        if (serverBeds.length !== el.bedSlots.length) return;
        let changed=false;
        for (let i=0;i<serverBeds.length;i++) {
            if (el.bedSlots[i].status!==serverBeds[i].status) {
                el.bedSlots[i].status=serverBeds[i].status;changed=true;
            }
        }
        if (changed) renderRoomEditorBedSlots(Number(el.id.replace('editorRoom-','')));
    });
}

function openNewListingModal() {
    if (HomeboundStore.configured && !activeOwner) {
        showToast('Log in as a landlord to add a property.', 'error'); return;
    }
    editingListingId = null;
    document.getElementById('listingEditorForm').reset();
    document.getElementById('listingRoomEditor').innerHTML = '';
    roomEditorSerial = 0;
    document.getElementById('listingEditorTitle').textContent = 'Add New Property Listing';
    document.getElementById('listingOwner').value = activeOwner?.name || '';
    setZoneImages('listingMainDrop', [], true);
    clearListingPin();
    addListingRoom();
    document.getElementById('modalListingEditor').classList.remove('hidden');
    initializeListingPinMap();
}

function openEditListingModal(id) {
    const d = dormsData.find(item => item.id === id);
    if (!d || (HomeboundStore.configured && d.ownerId !== activeOwner?.id)) {
        showToast('This listing is not available for editing.', 'error'); return;
    }
    openNewListingModal();
    editingListingId = id;
    document.getElementById('listingEditorTitle').textContent = 'Edit Property & Room Details';
    const fields = { listingTitle: d.title, listingType: d.type,
        listingLocation: d.locationZone, listingDistance: d.distance,
        listingOwner: d.ownerName, listingPhone: d.ownerPhone, listingNote: d.note };
    for (const [id,value] of Object.entries(fields)) document.getElementById(id).value = value ?? '';
    setZoneImages('listingMainDrop', d.mainImage ? [d.mainImage] : [], true);
    if (Number.isFinite(d.lat) && Number.isFinite(d.lng)) {
        setListingPin(d.lat,d.lng);
        initializeListingPinMap();
    }
    document.getElementById('listingRoomEditor').innerHTML = '';
    roomEditorSerial = 0;
    d.rooms.forEach(room => addListingRoom(room));
}

function addListingRoom(room = {}) {
    const index = ++roomEditorSerial;
    const container = document.getElementById('listingRoomEditor');
    const el = document.createElement('div');
    el.id = `editorRoom-${index}`;
    el.dataset.roomStatus = room.status || 'Available';
    el.dataset.originalRoomName = room.name || '';
    el.className = 'listing-room-form bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3';
    const oldAmenities = Array.isArray(room.amenities) ? room.amenities : [];
    const customAmenities = oldAmenities.filter(a => !ROOM_AMENITIES.includes(a));
    el.bedSlots = displayBedSlots(room).map(b=>({...b}));
    el.innerHTML = `<div class="flex items-center justify-between">
        <strong class="text-slate-800">Room / Unit ${index}</strong>
        <button type="button" onclick="removeListingRoom(${index})" class="text-rose-700 font-semibold">Remove room</button>
      </div>
      <div class="grid sm:grid-cols-2 gap-3">
        <label class="font-semibold">Room Name <span class="required-mark">*</span><input class="input-editor room-name" required value="${escHtml(room.name || '')}" placeholder="Room 101 - Twin Sharing"></label>
        <label class="font-semibold">Monthly Price (PHP) <span class="required-mark">*</span><input class="input-editor room-price price-no-spinner" type="number" min="0" step="1" required value="${Number(room.price || 0)}"></label>
        <label class="font-semibold">Total Bed Capacity <span class="required-mark">*</span><input class="input-editor room-capacity price-no-spinner" type="number" min="1" max="100" step="1" required value="${el.bedSlots.length}" oninput="regenerateRoomBedSlots(${index},this)"></label>
        <label class="font-semibold sm:col-span-2">Additional Notes (optional)<textarea class="input-editor room-note" maxlength="600" rows="2" placeholder="Bathroom details, house rules, allowed occupants...">${escHtml(room.note || '')}</textarea></label>
      </div>
      <div><strong class="block font-semibold mb-2">Individual Bed Slots</strong>
         <p class="text-[11px] text-slate-500 mb-2">Each bed is separate. Available/Blocked can be changed; occupied beds are locked to their tenants.</p>
         <div id="editorRoomBeds-${index}" class="flex flex-wrap gap-2"></div>
      </div>
      <div><strong class="block font-semibold mb-2">Room Amenities</strong>
        <div class="room-amenity-list grid grid-cols-2 sm:grid-cols-3 gap-2">${ROOM_AMENITIES.map(a => `<label class="flex items-center gap-2 text-xs"><input type="checkbox" class="room-amenity-checkbox accent-green-600" value="${escHtml(a)}" ${oldAmenities.includes(a) ? 'checked' : ''}><span>${escHtml(a)}</span></label>`).join('')}</div>
        <div id="customAmenities-${index}" class="custom-amenities flex flex-wrap gap-2 mt-2">${customAmenities.map(a => customAmenityTag(a)).join('')}</div>
        <div class="flex gap-2 mt-2"><input id="customAmenityInput-${index}" class="input-editor !mt-0" placeholder="Add a custom amenity"><button type="button" onclick="addCustomAmenity(${index})" class="bg-slate-200 px-3 rounded-lg font-semibold shrink-0">Add</button></div>
      </div>
      <div><strong class="block font-semibold mb-2">Room Images</strong>
        <div id="roomDrop-${index}" class="image-dropzone" ondragover="event.preventDefault()" ondrop="handleImageDrop(event,'roomDrop-${index}')">
          <i class="fa-solid fa-images text-xl text-brand-600"></i>
          <p>Drag images here or select images (up to 5)</p>
          <input type="file" class="image-file-input mt-2" multiple accept="image/jpeg,image/png,image/webp" onchange="handleImageSelection(event,'roomDrop-${index}')">
          <div class="image-previews mt-2 flex flex-wrap gap-2"></div>
        </div>
      </div>`;
    container.appendChild(el);
    setZoneImages(`roomDrop-${index}`, room.images || [], false);
    renderRoomEditorBedSlots(index);
}
function renderRoomEditorBedSlots(index) {
    const el=document.getElementById(`editorRoom-${index}`);
    const list=document.getElementById(`editorRoomBeds-${index}`);
    if (!el || !list) return;
    list.innerHTML=el.bedSlots.map((b,i)=>`<button type="button" ${b.status==='Occupied'||b.reservedFor?'disabled title="Bed occupied or reserved"':''}
      onclick="toggleRoomEditorBed(${index},${i})"
      class="px-3 py-2 rounded-lg border text-[11px] font-semibold ${b.status==='Occupied'?'bg-slate-200 border-slate-300 text-slate-600 cursor-not-allowed':b.status==='Available'?'bg-brand-50 border-brand-200 text-brand-800':'bg-amber-50 border-amber-200 text-amber-900'}">
      Bed ${i+1}: ${escHtml(b.reservedFor ? `Reserved ${b.reservedFor}` : b.status)}</button>`).join('');
}
function toggleRoomEditorBed(index,slotIndex) {
    const el=document.getElementById(`editorRoom-${index}`);
    const bed=el?.bedSlots?.[slotIndex];
    if (!bed || bed.status==='Occupied' || bed.reservedFor) return;
    bed.status=bed.status==='Available'?'Unavailable':'Available';
    renderRoomEditorBedSlots(index);
}
function regenerateRoomBedSlots(index,input) {
    const el=document.getElementById(`editorRoom-${index}`);
    const total=Number(input.value);
    if (!Number.isInteger(total) || total<1 || total>100) return;
    if (el.bedSlots.slice(total).some(b=>b.status==='Occupied')) {
        showToast('End active tenancies before reducing the capacity below an occupied bed.', 'error');
        input.value=el.bedSlots.length;return;
    }
    el.bedSlots=Array.from({length:total},(_,i)=>el.bedSlots[i] || {id:`bed-${i+1}`,status:'Available'});
    renderRoomEditorBedSlots(index);
}

function removeListingRoom(index) {
    if (document.querySelectorAll('.listing-room-form').length <= 1) {
        showToast('Each property must have at least one room.', 'error'); return;
    }
    document.getElementById(`editorRoom-${index}`)?.remove();
}

function parseHttpsImageUrl(raw) {
    const value = raw.trim();
    if (!value) return '';
    const url = new URL(value);
    if (url.protocol !== 'https:') throw new Error('Image URLs must begin with https://');
    return value;
}

async function saveListing(event) {
    event.preventDefault();
    if (HomeboundStore.configured && !activeOwner) {
        showToast('Sign in as an approved landlord first.', 'error'); return;
    }
    const field = id => document.getElementById(id).value.trim();
    const roomEls = [...document.querySelectorAll('.listing-room-form')];
    const button = document.getElementById('saveListingButton');
    try {
        if (!roomEls.length) throw new Error('Each property needs at least one room.');
        if (field('listingPhone').length < 7) throw new Error('Enter a valid owner contact phone number.');
        const prepared = roomEls.map(el => {
            const read = className => el.querySelector('.' + className).value.trim();
            const priceText = read('room-price');
            const price = Number(priceText);
            if (!priceText || !Number.isInteger(price) || price < 0) throw new Error('Room rates must be whole peso amounts.');
            const amenities = [...el.querySelectorAll('.room-amenity-checkbox:checked')].map(input => input.value)
                .concat([...el.querySelectorAll('.custom-amenity')].map(input => input.value));
            const totalCapacity = Number(read('room-capacity'));
            if (!Number.isInteger(totalCapacity) || totalCapacity < 1 || totalCapacity > 100)
                throw new Error('Each room needs a total bed capacity from 1 to 100.');
            const beds=el.bedSlots.map(b=>({...b}));
            if (beds.length !== totalCapacity) throw new Error('Room bed slots do not match the capacity.');
            const result = { name: read('room-name'), price,
                capacity: `${totalCapacity} ${totalCapacity===1?'Bedspace':'Bedspaces'}`,
                totalCapacity, beds, note: read('room-note'),
                amenities, zone: el.querySelector('.image-dropzone') };
            syncBedCountStatus(result);
            if (!result.name) throw new Error('Every room needs a name and capacity.');
            return result;
        });
        if (new Set(prepared.map(r => r.name.toLowerCase())).size !== prepared.length)
            throw new Error('Room names must be unique within a property so tenants can be assigned accurately.');
        if (!field('listingTitle') || !field('listingOwner') || !field('listingLocation'))
            throw new Error('Enter property title, owner and full location.');
        button.disabled = true; button.textContent = 'Saving…';
        const imageWarnings = [];
        const rooms = [];
        for (const data of prepared) {
            const images = await collectZoneImages(data.zone,imageWarnings);
            const {zone, ...room} = data;
            rooms.push({...room, images});
        }
        const mainImages = await collectZoneImages(document.getElementById('listingMainDrop'),imageWarnings);
        if (imageWarnings.length) {
            const message = `${imageWarnings.length} selected photo(s) failed to upload.\n\n${imageWarnings.join('\n').slice(0, 950)}\n\nSave the listing without those photos? Choose Cancel to keep the form open and retry.`;
            if (!window.confirm(message)) {
                throw new Error('Photo upload was unsuccessful. Your listing form is still open; check Supabase Storage and try saving again.');
            }
        }
        const prices = rooms.map(r => r.price);
        const minPrice = Math.min(...prices), maxPrice = Math.max(...prices);
        const old = editingListingId ? dormsData.find(d => d.id === editingListingId) : null;
        const payload = {
            title: field('listingTitle'), type: field('listingType'),
            locationZone: field('listingLocation'), distance: field('listingDistance'),
            note: field('listingNote'),
            lat: listingDraftCoordinates?.lat ?? null,
            lng: listingDraftCoordinates?.lng ?? null,
            ownerName: field('listingOwner'), ownerPhone: field('listingPhone'),
            mainImage: mainImages[0] || rooms[0].images[0] || '',
            rooms, minPrice, maxPrice,
            priceRangeStr: minPrice === maxPrice ? `₱${minPrice.toLocaleString()} / mo`
                : `₱${minPrice.toLocaleString()} - ₱${maxPrice.toLocaleString()} / mo`,
            lastUpdated: 'Updated just now'
        };
        if (old) {
            const index = dormsData.findIndex(d => d.id === editingListingId);
            const update = {...old,...payload};
            dormsData[index] = HomeboundStore.configured ? await HomeboundStore.update(update) : update;
        } else {
            const created = HomeboundStore.configured ? await HomeboundStore.create(payload)
                : {...payload,id:`dorm-${Date.now()}`};
            dormsData.unshift(created);
        }
        closeModal('modalListingEditor');
        refreshListingViews();
        refreshDashboardStats();
        if (imageWarnings.length) {
            showToast(`Listing saved without ${imageWarnings.length} selected photo(s). ${imageWarnings[0]}`, 'error');
        } else showToast('Property, bed slots and room details saved successfully.', 'success');
    } catch (err) {
        showToast(`Could not save listing: ${err.message}`, 'error');
    } finally { button.disabled = false; button.textContent = 'Save Listing'; }
}

async function deleteListing(id) {
    const item = dormsData.find(d => d.id === id);
    if (!item) return;
    if (HomeboundStore.configured && item.ownerId !== activeOwner?.id) {
        showToast('You can only delete your own listings.', 'error'); return;
    }
    if (!window.confirm(`Delete "${item.title}" and all its rooms? This cannot be undone.`)) return;
    try {
        if (HomeboundStore.configured) await HomeboundStore.remove(id);
        dormsData = dormsData.filter(d => d.id !== id);
        refreshListingViews();
        showToast('Property listing deleted.', 'success');
    } catch (err) {
        showToast(`Listing was not deleted: ${err.message}`, 'error');
    }
}

/* ==========================================================================
   ANALYTICS & CHART.JS INTEGRATION
   ========================================================================== */

function initAnalyticsCharts() { renderAnalytics(); }

function printAnalyticsReport() {
    document.getElementById('analyticsPeriod').textContent = `Prepared ${new Date().toLocaleString('en-PH', {dateStyle:'long',timeStyle:'short'})}`;
    // Print the COMPLETE formal report, not just the currently selected tab.
    const category = document.getElementById('analyticsViewFilter').value;
    document.querySelectorAll('[data-analytics-view]').forEach(p=>p.classList.remove('hidden'));
    renderAnalytics();renderHomeboundForecast();
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
        reportCharts.forEach(chart=>{try {chart.resize();}catch(_){}});
        try {hbForecastChart?.resize();}catch(_){}
        window.addEventListener('afterprint',()=>setAnalyticsView(category),{once:true});
        window.print();
    }));
}

/* ==========================================================================
   ADDITIONAL WORKFLOWS: TIME, PHOTO DROPZONES, INBOX, HOLDS AND ANALYTICS
   ========================================================================== */
function localDateISO(date) {
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function formatVisitTime(value) {
    if (!value) return '—';
    const [hour, minute] = String(value).slice(0,5).split(':').map(Number);
    if (!Number.isFinite(hour)) return String(value);
    return `${String(hour%12 || 12).padStart(2,'0')}:${String(minute).padStart(2,'0')} ${hour >= 12 ? 'PM' : 'AM'}`;
}
function getOwnerListings() {
    return HomeboundStore.configured ? dormsData.filter(d => d.ownerId === activeOwner?.id) : dormsData;
}
function getOwnerHoldList() {
    return HomeboundStore.configured ? ownerHolds : visitationsList;
}
function lookupPropertyName(id) { return dormsData.find(d => d.id === id)?.title || 'Property'; }
const STUDENT_HOLDS_KEY='homebound-student-holds';
const DISMISSED_HOLDS_KEY='homebound-hidden-hold-statuses';
function saveStudentHolds() {
    localStorage.setItem(STUDENT_HOLDS_KEY,JSON.stringify(studentHolds));
    // Preserve most recent single-hold value for compatibility with older tabs.
    if (studentHolds[0]) localStorage.setItem('homebound-active-hold',JSON.stringify(studentHolds[0]));
}
function restoreActiveHold() {
    try {
        const records=JSON.parse(localStorage.getItem(STUDENT_HOLDS_KEY) || 'null');
        const legacy=JSON.parse(localStorage.getItem('homebound-active-hold') || 'null');
        hiddenHoldStatuses=JSON.parse(localStorage.getItem(DISMISSED_HOLDS_KEY) || '{}') || {};
        const source=Array.isArray(records) ? records : (legacy ? [legacy] : []);
        const ids=new Set();
        studentHolds=source.filter(h=>h?.id && h?.token && !ids.has(h.id) && ids.add(h.id));
        activeUserHold=studentHolds[0] || null;
        if (studentHolds.length) saveStudentHolds();
    } catch (err) {
        console.warn('Could not restore saved hold requests:',err);
        studentHolds=[];activeUserHold=null;hiddenHoldStatuses={};
    }
    refreshHoldBanner();
    if (HomeboundStore.configured && studentHolds.length) refreshActiveHold();
}
function holdStatusLabel(status) {
    return ({'Pending Approval':'Pending owner review','Confirmed Visit':'Approved','Visited':'Visit completed',
        'Declined':'Declined','Cancelled by Student':'Cancelled','Expired':'Expired','Rented':'Rented'})[status] || status || 'Pending';
}
function holdStatusColor(status) {
    return status==='Confirmed Visit' || status==='Rented' ? 'text-green-700' :
        status==='Declined' || status==='Expired' ? 'text-rose-700' : 'text-amber-800';
}
function renderStudentHoldList() {
    const list=document.getElementById('studentHoldList');
    if (!list) return;
    list.innerHTML=studentHolds.map(h=>`<button type="button" onclick="selectStudentHold(${bedActionParams(h.id)})"
      class="block w-full text-left rounded-lg border p-2 text-xs ${activeUserHold?.id===h.id?'border-green-500 bg-green-50':'border-slate-200 hover:bg-slate-50'}">
      <span class="font-bold block">${escHtml(h.dormTitle || lookupPropertyName(h.dormId))}</span>
      <span class="block text-slate-600">${escHtml(h.roomName)} · ${escHtml(h.visitDate)} ${escHtml(formatVisitTime(h.visitTime))}</span>
      <span class="font-bold ${holdStatusColor(h.status)}">${escHtml(holdStatusLabel(h.status))}</span>
    </button>`).join('');
    const hold=activeUserHold;
    if (!hold) return;
    const status=hold.status || 'Pending Approval';
    const confirmed=status==='Confirmed Visit';
    const rented=status==='Rented';
    document.getElementById('holdConfirmationTitle').textContent='Your Hold Requests';
    document.getElementById('holdRequestStatus').textContent=`Selected: ${holdStatusLabel(status)}`;
    document.getElementById('holdRequestDescription').textContent=rented
      ? 'The landlord has recorded your rental. Contact them about your agreement and payment instructions.'
      : confirmed ? 'Your visitation was approved. Please attend at the agreed date and time.'
      : status==='Declined' ? 'The owner declined this request. You can submit another request or message the owner.'
      : status==='Cancelled by Student' ? 'You cancelled this request. Your other requests remain unchanged.'
      : status==='Expired' ? 'The request period has ended. You may submit a new request.'
      : 'Your visit request has been sent to the owner for review.';
    document.getElementById('cancelHoldButton').classList.toggle('hidden',!['Pending Approval','Confirmed Visit'].includes(status));
}
function refreshHoldBanner() {
    const banner=document.getElementById('activeHoldBanner');
    if (!banner) return;
    for (const hold of studentHolds) {
        if (!HomeboundStore.configured && hold.status==='Pending Approval' && hold.timestamp &&
            Date.now()-new Date(hold.timestamp).getTime()>86400000) {
            hold.status='Expired';
        }
    }
    const visible=studentHolds.filter(h=>hiddenHoldStatuses[h.id] !== h.status);
    if (!visible.length || currentPortal==='owner') {
        banner.classList.add('hidden');banner.classList.remove('flex');
    } else {
        const top=visible[0];
        document.getElementById('holdDormName').textContent=top.dormTitle || lookupPropertyName(top.dormId);
        document.getElementById('holdBannerSummary').textContent=`· ${holdStatusLabel(top.status)}${visible.length>1?` · ${visible.length} updates`:''}`;
        banner.classList.remove('hidden');banner.classList.add('flex');
    }
    if (studentHolds.length) renderStudentHoldList();
}
function dismissHoldBanner() {
    // Dismiss notices for their current statuses. A later approval/decline
    // or a newly submitted request will become visible automatically.
    for (const h of studentHolds) hiddenHoldStatuses[h.id]=h.status;
    localStorage.setItem(DISMISSED_HOLDS_KEY,JSON.stringify(hiddenHoldStatuses));
    refreshHoldBanner();
}
async function refreshActiveHold() {
    if (!studentHolds.length || !HomeboundStore.configured || holdStatusPollBusy) return;
    holdStatusPollBusy=true;
    let changed=false;
    try {
        // Old, completed requests are retained in history but do not need polling forever.
        const candidates=studentHolds.filter(h=>['Pending Approval','Confirmed Visit'].includes(h.status)).slice(0,30);
        const results=await Promise.allSettled(candidates.map(h=>HomeboundStore.getHold(h.id,h.token)));
        results.forEach((res,i)=>{
            if (res.status!=='fulfilled' || !res.value) return;
            const hold=candidates[i];
            if (hold.status!==res.value.status) {
                hold.status=res.value.status;
                hold.statusUpdatedAt=new Date().toISOString();
                changed=true;
            }
        });
        if (changed) saveStudentHolds();
    } catch (err) { console.warn('Could not refresh hold statuses:',err.message); }
    finally { holdStatusPollBusy=false;refreshHoldBanner(); }
}

async function loadOwnerHolds() {
    if (HomeboundStore.configured) {
        if (!activeOwner) return;
        try { ownerHolds = await HomeboundStore.listHolds(); }
        catch (err) { showToast(`Could not load hold requests: ${err.message}`, 'error'); }
    }
    renderAdminTables();
    refreshDashboardStats();
}
async function loadOwnerData() {
    if (HomeboundStore.configured && activeOwner) {
        try { await HomeboundStore.activateDueReservations(); }
        catch (e) { console.warn('Scheduled reservation activation:', e.message); }
    }
    await Promise.all([loadOwnerInbox(),loadOwnerHolds(),loadOwnerRentData(),loadAdvanceReservations()]);
    refreshDashboardStats();
    renderAnalytics();
}
function customAmenityTag(name) {
    return `<label class="inline-flex items-center gap-1 bg-brand-50 border border-brand-200 rounded-lg px-2 py-1">
      <input type="checkbox" class="custom-amenity sr-only" value="${escHtml(name)}" checked>
      <span>${escHtml(name)}</span><button type="button" onclick="this.closest('label').remove()" aria-label="Remove amenity" class="text-rose-600 font-bold ml-1">×</button></label>`;
}
function addCustomAmenity(index) {
    const input = document.getElementById(`customAmenityInput-${index}`);
    const name = input.value.trim().slice(0,60);
    if (!name) return;
    const list = document.getElementById(`customAmenities-${index}`);
    if ([...document.querySelectorAll(`#editorRoom-${index} .room-amenity-checkbox, #editorRoom-${index} .custom-amenity`)]
       .some(el => el.value.toLowerCase() === name.toLowerCase())) {
        showToast('This amenity is already listed.', 'info'); return;
    }
    list.insertAdjacentHTML('beforeend',customAmenityTag(name));
    input.value = '';
}
function setZoneImages(id, existing = [], single = false) {
    const zone = document.getElementById(id);
    if (!zone) return;
    (zone.previewObjectUrls || []).forEach(url => URL.revokeObjectURL(url));
    zone.previewObjectUrls = [];
    zone.existingImages = [...existing];
    zone.pendingFiles = [];
    zone.singleImage = single;
    renderZoneImages(id);
}
function normalizeImageFile(file) {
    if (!(file instanceof File)) throw new Error('Drop an image saved on your computer (JPG, PNG or WEBP).');
    const ext = String(file.name || '').toLowerCase().split('.').pop();
    const inferred = {jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', webp:'image/webp'}[ext];
    const type = file.type || inferred;
    if (!imageTypes.includes(type) || (inferred && file.type && file.type !== inferred)) {
        throw new Error(`Unsupported file ${file.name}. Use JPG, PNG or WEBP.`);
    }
    if (!file.size) throw new Error(`${file.name} contains 0 bytes. Save the complete image to your Downloads folder, check that it opens, then drag it from Files/Downloads or use Choose File. Images dragged from a browser tab or cloud preview may be empty placeholders.`);
    if (file.size > 5 * 1024 * 1024) throw new Error(`${file.name} exceeds the 5 MB limit.`);
    return file.type ? file : new File([file], file.name, { type, lastModified:file.lastModified });
}
function validateImageFile(file) {
    return normalizeImageFile(file);
}
function setDroppedImages(id, files) {
    const zone = document.getElementById(id);
    if (!zone) return;
    try {
        const next = Array.from(files || []).map(normalizeImageFile);
        if (!next.length) throw new Error('No image files detected. Drag files from your computer or use Choose File.');
        if (zone.singleImage) {
            zone.pendingFiles = next.slice(0, 1);
            zone.existingImages = [];
        } else {
            const pending = zone.pendingFiles || [];
            const unique = next.filter(file => !pending.some(old => old.name === file.name && old.size === file.size && old.lastModified === file.lastModified));
            if ((zone.existingImages || []).length + pending.length + unique.length > 5)
                throw new Error('A room can contain up to five images. Remove a photo before adding another.');
            zone.pendingFiles = [...pending, ...unique];
        }
        renderZoneImages(id);
    } catch (err) {
        showToast(err.message, 'error');
    }
}
function handleImageSelection(event, id) {
    setDroppedImages(id, event.target.files);
    event.target.value = '';
}
async function handleImageDrop(event, id) {
    event.preventDefault();
    event.stopPropagation();

    // Copy DataTransfer data NOW, while the drop event is active. The browser
    // protects file data after the event ends, especially for cloud-backed files.
    const transfer = event.dataTransfer;
    const directFiles = Array.from(transfer?.files || []);
    const fileItems = Array.from(transfer?.items || []).filter(item => item.kind === 'file');
    const itemFiles = fileItems.map(item => item.getAsFile?.()).filter(Boolean);

    // Some Chromium/ChromeOS drags expose a 0-byte placeholder through .files
    // even though the Files app can supply the actual bytes through a handle.
    // Request handles synchronously during the drop event (before any await).
    const recoveryPromises = [];
    for (const item of fileItems) {
        if (typeof item.getAsFileSystemHandle === 'function') {
            try {
                recoveryPromises.push(Promise.resolve(item.getAsFileSystemHandle())
                    .then(handle => handle?.kind === 'file' ? handle.getFile() : null));
            } catch (_) { /* Other supported browser paths are tried below. */ }
        }
        if (typeof item.webkitGetAsEntry === 'function') {
            try {
                const entry = item.webkitGetAsEntry();
                if (entry?.isFile) {
                    recoveryPromises.push(new Promise(resolve =>
                        entry.file(resolve, () => resolve(null))));
                }
            } catch (_) { /* Continue with File objects already captured. */ }
        }
    }

    let files = directFiles.length ? directFiles : itemFiles;
    if (!files.length || files.some(file => file.size === 0)) {
        const resolved = await Promise.allSettled(recoveryPromises);
        const recoveredFiles = [...itemFiles, ...resolved
            .filter(result => result.status === 'fulfilled')
            .map(result => result.value)]
            .filter(file => file instanceof File && file.size > 0);
        if (!files.length) {
            files = recoveredFiles;
        } else {
            files = files.map(file => file.size > 0 ? file
                : (recoveredFiles.find(candidate => candidate.name === file.name)
                    || (files.length === 1 ? recoveredFiles[0] : null)
                    || file));
        }
    }

    if (!files.length) {
        showToast('No local image file was received. Save the image to your computer, then drag it from Files/Downloads or use Choose File.', 'error');
        return;
    }
    setDroppedImages(id, files);
}
function markImageDropzone(zone, isDragging) {
    if (!zone) return;
    zone.classList.toggle('border-brand-600', isDragging);
    zone.classList.toggle('bg-brand-50', isDragging);
    zone.classList.toggle('ring-2', isDragging);
    zone.classList.toggle('ring-brand-200', isDragging);
}
function setupImageDropHandling() {
    // Capture-phase delegation also works for room dropzones added after page load.
    // Prevent inline ondrop handlers from adding the same file twice.
    const targetZone = event => event.target instanceof Element ? event.target.closest('.image-dropzone') : null;
    document.addEventListener('dragenter', event => {
        const zone = targetZone(event);
        if (zone) markImageDropzone(zone, true);
    }, true);
    document.addEventListener('dragover', event => {
        const zone = targetZone(event);
        if (!zone) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
        markImageDropzone(zone, true);
    }, true);
    document.addEventListener('dragleave', event => {
        const zone = targetZone(event);
        if (zone && (!event.relatedTarget || !zone.contains(event.relatedTarget))) markImageDropzone(zone, false);
    }, true);
    document.addEventListener('drop', event => {
        const zone = targetZone(event);
        if (!zone) {
            // Avoid browser navigation if a file is dropped just outside the box.
            if (!document.getElementById('modalListingEditor')?.classList.contains('hidden') && event.dataTransfer?.files?.length)
                event.preventDefault();
            return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        markImageDropzone(zone, false);
        handleImageDrop(event, zone.id);
    }, true);
    window.addEventListener('dragend', () => {
        document.querySelectorAll('.image-dropzone').forEach(zone => markImageDropzone(zone, false));
    });
}
function removeZoneImage(id, which, index) {
    const zone = document.getElementById(id);
    if (!zone) return;
    if (which === 'existing') zone.existingImages.splice(index, 1);
    else zone.pendingFiles.splice(index, 1);
    renderZoneImages(id);
}
function renderZoneImages(id) {
    const zone = document.getElementById(id);
    if (!zone) return;
    (zone.previewObjectUrls || []).forEach(url => URL.revokeObjectURL(url));
    zone.previewObjectUrls = [];
    const preview = zone.querySelector('.image-previews');
    if (!preview) return;
    const stored = (zone.existingImages || []).map((src, index) => ({src, kind:'existing', index}));
    const pending = (zone.pendingFiles || []).map((file, index) => {
        const src = URL.createObjectURL(file);
        zone.previewObjectUrls.push(src);
        return {src, kind:'pending', index};
    });
    preview.innerHTML = [...stored, ...pending].map(item => `<div class="relative w-20 h-20">
       <img src="${safeImageUrl(item.src)}" alt="Property photo" class="w-full h-full object-cover rounded-lg border border-slate-200">
       <button type="button" aria-label="Remove photo" onclick="removeZoneImage('${id}','${item.kind}',${item.index})" class="absolute -top-1 -right-1 rounded-full bg-rose-600 text-white w-5 h-5">×</button></div>`).join('');
    let notice = zone.querySelector('.image-upload-notice');
    if (!notice) {
        notice = document.createElement('p');
        notice.className = 'image-upload-notice text-[11px] text-slate-600 mt-2';
        preview.insertAdjacentElement('beforebegin', notice);
    }
    notice.textContent = pending.length
        ? `${pending.length} selected photo${pending.length === 1 ? '' : 's'} ready to upload when you save the listing.`
        : stored.length ? `${stored.length} saved photo${stored.length === 1 ? '' : 's'}.` : 'No photos selected yet.';
}
function fileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Could not read photo.'));
        reader.readAsDataURL(file);
    });
}
async function collectZoneImages(zone, warnings = []) {
    const urls = [...(zone.existingImages || [])];
    for (const file of (zone.pendingFiles || [])) {
        try {
            const publicUrl = HomeboundStore.configured
                ? await HomeboundStore.uploadImage(file)
                : await fileAsDataUrl(file);
            urls.push(publicUrl);
        } catch (err) {
            const section = zone.singleImage ? 'Main photo' : 'Room photo';
            const message = `${section} (${file.name}): ${err.message}`;
            console.error('Homebound photo upload failed:', message, err);
            warnings.push(message);
        }
    }
    return zone.singleImage ? urls.slice(0, 1) : urls;
}
setupImageDropHandling();
function readSavedStudentConversations() {
    const records=[];
    for (let i=0;i<localStorage.length;i++) {
        const key=localStorage.key(i);
        if (!key?.startsWith('homebound-chat-')) continue;
        const listingId=key.slice('homebound-chat-'.length);
        try {
            const row=JSON.parse(localStorage.getItem(key));
            if (row?.id && row?.token) records.push({listingId,...row});
        } catch (_) {}
    }
    return records;
}
function renderStudentInbox() {
    const floating=document.getElementById('studentInboxFloating');
    if (!floating) return;
    floating.classList.toggle('hidden',currentPortal!=='student');
    const total=studentInboxRecords.reduce((sum,r)=>sum+r.unread,0);
    const badge=document.getElementById('studentUnreadBadge');
    badge.classList.toggle('hidden',!total);
    badge.textContent=String(Math.min(total,99));
    const advanceListingIds=new Set((typeof hbStudentAdvanceRecords!=='undefined'?hbStudentAdvanceRecords:[])
        .map(r=>r.listingId).filter(Boolean));
    const extraAdvance=[...advanceListingIds].filter(id=>!studentInboxRecords.some(r=>r.listingId===id));
    document.getElementById('studentInboxList').innerHTML=studentInboxRecords.map(r =>
        `<button type="button" onclick="openStudentConversation(${bedActionParams(r.listingId)})"
          class="flex items-center justify-between gap-2 w-full text-left border border-slate-200 hover:bg-brand-50 rounded-lg p-2">
            <span class="font-semibold">${escHtml(lookupPropertyName(r.listingId))}</span>
            ${r.unread ? `<span class="bg-rose-600 text-white text-[10px] rounded-full px-2 py-1">${r.unread} new</span>` : '<span class="text-slate-500 text-[10px]">Open chat</span>'}
          </button>`).join('') + extraAdvance.map(id=>
        `<button type="button" onclick="openStudentConversation(${bedActionParams(id)})" class="w-full text-left border border-slate-200 rounded-lg p-2 hover:bg-brand-50"><strong>${escHtml(lookupPropertyName(id))}</strong><span class="block text-[11px] text-slate-500">Advance request status · Open conversation</span></button>`
    ).join('');
    if(!studentInboxRecords.length && !extraAdvance.length)
        document.getElementById('studentInboxList').innerHTML='<p class="text-xs text-slate-500 p-2">No conversations yet. Open a listing and select “Ask Owner A Question” to start one.</p>';
}
async function pollStudentInbox() {
    if (studentInboxBusy) return;
    studentInboxBusy=true;
    try {
        const saved=readSavedStudentConversations();
        const result=[];
        for (const record of saved) {
            try {
                const messages=HomeboundStore.configured
                    ? await HomeboundStore.studentMessages(record.id,record.token)
                    : (demoConversations.find(c=>c.id===record.id)?.messages || []);
                const seen=new Set(record.seenOwnerIds || []);
                result.push({ ...record,
                    hasOwnerReply:(messages||[]).some(m=>m.sender!=='student'),
                    unread:(messages||[]).filter(m => m.sender!=='student' && !seen.has(m.id)).length });
            } catch (err) { console.warn('Unable to refresh one student conversation',err.message); }
        }
        studentInboxRecords=result;
        renderStudentInbox();
    } finally { studentInboxBusy=false; }
}
function toggleCommunityUpdates() {
    if (currentPortal !== 'student') return;
    const panel = document.getElementById('studentAnnouncementSection');
    if (!panel) return;
    const opening = panel.classList.contains('hidden');
    closeHomeboundToolPanels();
    if (opening) {
        panel.classList.remove('hidden');
        if (typeof loadPublicAnnouncements === 'function') void loadPublicAnnouncements();
        if (typeof hbMarkPublicAnnouncementsRead === 'function') hbMarkPublicAnnouncementsRead();
    }
    syncHomeboundToolButtons();
}
function closeHomeboundToolPanels() {
    document.getElementById('studentAnnouncementSection')?.classList.add('hidden');
    document.getElementById('studentInboxPanel')?.classList.add('hidden');
    document.getElementById('aiAssistantWindow')?.classList.add('hidden');
    syncHomeboundToolButtons();
}
function syncHomeboundToolButtons() {
    for (const [target, panel] of [
        ['studentToolAnnouncement', 'studentAnnouncementSection'],
        ['studentInboxFloating', 'studentInboxPanel'],
        ['homeboundFloatingTools', 'aiAssistantWindow']
    ]) {
        const host = document.getElementById(target);
        const button = target === 'homeboundFloatingTools' ? host?.querySelector('[aria-controls="aiAssistantWindow"]') : host?.querySelector('button');
        button?.setAttribute('aria-expanded', String(!document.getElementById(panel)?.classList.contains('hidden')));
    }
}
function toggleStudentInbox() {
    if (currentPortal !== 'student') return;
    const panel=document.getElementById('studentInboxPanel');
    const opening=panel.classList.contains('hidden');
    closeHomeboundToolPanels();
    if (opening) {
        panel.classList.remove('hidden');
        closeLiveChat();
        void pollStudentInbox();
    }
    syncHomeboundToolButtons();
}
async function openStudentConversation(listingId) {
    const dorm=dormsData.find(d=>d.id===listingId);
    if (!dorm) { showToast('This listing is no longer available.', 'error'); return; }
    document.getElementById('studentInboxPanel').classList.add('hidden');
    activeDormViewing=dorm;
    selectedRoomIndex=0;
    await openLiveChat(dorm.ownerName);
}
function markStudentChatSeen(messages) {
    if (!studentChatListingId || !studentConversationId) return;
    const key=`homebound-chat-${studentChatListingId}`;
    try {
        const saved=JSON.parse(localStorage.getItem(key) || '{}') || {};
        const seen=[...new Set([...(saved.seenOwnerIds || []),...messages.filter(m=>m.sender!=='student').map(m=>m.id)])].slice(-200);
        localStorage.setItem(key,JSON.stringify({id:studentConversationId,token:studentChatToken,seenOwnerIds:seen}));
        const record=studentInboxRecords.find(r=>r.listingId===studentChatListingId);
        if (record) {record.unread=0;record.seenOwnerIds=seen;renderStudentInbox();}
    } catch (_) {}
}
async function refreshStudentChat() {
    if (!studentChatListingId || document.getElementById('liveChatDrawer').classList.contains('hidden')) return;
    try {
        let messages = [];
        if (HomeboundStore.configured && studentConversationId) {
            messages = await HomeboundStore.studentMessages(studentConversationId,studentChatToken) || [];
        } else if (!HomeboundStore.configured && studentConversationId) {
            messages = demoConversations.find(c => c.id === studentConversationId)?.messages || [];
        }
        const box = document.getElementById('liveChatMessages');
        box.innerHTML = messages.length ? '' : '<p class="text-center text-slate-400 text-xs">Ask a question about this property to start a conversation.</p>';
        messages.forEach(m => appendChatMessage(m.body,m.sender));
        if(typeof renderAdvanceChatStatuses==='function') renderAdvanceChatStatuses();
        if (currentPortal==='student') markStudentChatSeen(messages);
    } catch (err) { console.warn('Chat refresh failed:',err.message); }
}
async function loadOwnerInbox() {
    if (HomeboundStore.configured) {
        if (!activeOwner) return;
        try { ownerConversations = await HomeboundStore.listConversations(); }
        catch (err) { showToast(`Could not load conversations: ${err.message}`, 'error'); return; }
    } else {
        ownerConversations = [...demoConversations].sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)))
            .map(c => ({ id:c.id, listing_id:c.listingId, updated_at:c.updatedAt }));
    }
    document.getElementById('badgeChatCount').textContent = ownerConversations.length;
    const list = document.getElementById('ownerConversationList');
    list.innerHTML = ownerConversations.length ? ownerConversations.map(c =>
        `<button type="button" onclick="openOwnerConversation('${c.id}')" class="block w-full text-left p-3 border rounded-lg ${ownerConversationId===c.id?'bg-brand-50 border-brand-500':'bg-white border-slate-200'} hover:bg-brand-50">
           <strong class="block text-xs">${escHtml(c.listings?.title || lookupPropertyName(c.listing_id))}</strong>
           <span class="text-[10px] text-slate-500">${escHtml(new Date(c.updated_at).toLocaleString())}</span></button>`
    ).join('') : '<p class="p-3 text-xs text-slate-400">No student messages yet.</p>';
    if (ownerConversationId && ownerConversations.some(c => c.id===ownerConversationId)) await openOwnerConversation(ownerConversationId,false);
}
async function openOwnerConversation(id,refreshList = true) {
    ownerConversationId = id;
    document.getElementById('ownerChatInput').disabled = false;
    document.getElementById('ownerChatSend').disabled = false;
    document.getElementById('ownerChatImage').disabled = false;
    const conv = ownerConversations.find(c => c.id===id);
    document.getElementById('ownerConversationTitle').textContent = `Conversation about ${conv?.listings?.title || lookupPropertyName(conv?.listing_id)}`;
    const box = document.getElementById('ownerChatMessages');
    try {
        const messages = HomeboundStore.configured ? await HomeboundStore.ownerMessages(id)
            : (demoConversations.find(c => c.id===id)?.messages || []);
        box.innerHTML = '';
        messages.forEach(m => appendChatMessage(m.body,m.sender,'ownerChatMessages'));
        if (refreshList) {
            document.querySelectorAll('#ownerConversationList button').forEach(btn => btn.classList.remove('border-brand-500','bg-brand-50'));
        }
    } catch (err) { showToast(`Could not open chat: ${err.message}`, 'error'); }
}
let ownerImagePreviewUrl = null;
// Keep attachment action visible, even before the landlord has selected a chat.
function openOwnerImagePicker() {
    if (!ownerConversationId) {
        showToast('Select a student conversation first, then attach a photo.', 'info');
        return;
    }
    const input = document.getElementById('ownerChatImage');
    if (!input) {
        showToast('The photo picker could not be found. Refresh Homebound.', 'error');
        return;
    }
    input.disabled = false;
    input.click();
}
function clearOwnerImageAttachment() {
    if (ownerImagePreviewUrl) URL.revokeObjectURL(ownerImagePreviewUrl);
    ownerImagePreviewUrl = null;
    const input = document.getElementById('ownerChatImage');
    if (input) input.value = '';
    document.getElementById('ownerImagePreview')?.classList.add('hidden');
    const thumb = document.getElementById('ownerImageThumbnail');
    if (thumb) thumb.removeAttribute('src');
}
function previewOwnerChatImage(input) {
    const file = input?.files?.[0];
    if (!file) { clearOwnerImageAttachment(); return; }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || !file.size || file.size > 5 * 1024 * 1024) {
        clearOwnerImageAttachment();
        showToast('Choose a JPG, PNG, or WEBP image smaller than 5 MB.', 'error');
        return;
    }
    if (ownerImagePreviewUrl) URL.revokeObjectURL(ownerImagePreviewUrl);
    ownerImagePreviewUrl = URL.createObjectURL(file);
    document.getElementById('ownerImageThumbnail').src = ownerImagePreviewUrl;
    document.getElementById('ownerImageFileName').textContent = file.name;
    document.getElementById('ownerImagePreview').classList.remove('hidden');
}
function readDemoChatImage(file) {
    return new Promise((resolve,reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Could not preview attached image.'));
        reader.readAsDataURL(file);
    });
}
async function sendOwnerReply(e) {
    e.preventDefault();
    const input = document.getElementById('ownerChatInput');
    const imageInput = document.getElementById('ownerChatImage');
    const imageFile = imageInput?.files?.[0] || null;
    const message = input.value.trim();
    if (!ownerConversationId || (!message && !imageFile)) return;
    const sendButton = document.getElementById('ownerChatSend');
    input.disabled = true;
    imageInput.disabled = true;
    sendButton.disabled = true;
    try {
        let body = message;
        if (imageFile) {
            const url = HomeboundStore.configured
                ? await HomeboundStore.uploadImage(imageFile)
                : await readDemoChatImage(imageFile);
            body = `${message}${message ? '\n' : ''}[HB_IMAGE:${url}]`;
        }
        if (HomeboundStore.configured) await HomeboundStore.ownerReply(ownerConversationId, body);
        else {
            const conversation = demoConversations.find(c => c.id === ownerConversationId);
            if (!conversation) throw new Error('Conversation not found. Refresh your inbox.');
            conversation.messages.push({id: crypto.randomUUID(), sender: 'owner', body,
                created_at: new Date().toISOString()});
            conversation.updatedAt = new Date().toISOString();
        }
        input.value = '';
        clearOwnerImageAttachment();
        await openOwnerConversation(ownerConversationId);
        await loadOwnerInbox();
        refreshStudentChat();
        pollStudentInbox();
        showToast('Message sent.', 'success');
    } catch (err) { showToast(`Reply not sent: ${err.message}`, 'error'); }
    finally {
        input.disabled = false;
        imageInput.disabled = !ownerConversationId;
        sendButton.disabled = !ownerConversationId;
    }
}
function updateAIAssistant() {
    if (aiContext === currentPortal) return;
    aiContext = currentPortal;
    const owner = currentPortal === 'owner';
    document.getElementById('aiAssistantTitle').textContent = owner ? 'Homebound Owner Assistant' : 'Homebound Listing Assistant';
    document.getElementById('aiInput').placeholder = owner ? 'Ask about vacancies, pricing, or inquiries…' : 'Ask about budget, location, or amenities…';
    document.getElementById('aiChatBody').innerHTML = `<div class="bg-white border border-slate-200 rounded-xl p-3 shadow-sm space-y-2">
       <p>${owner ? 'Hi! I can suggest ways to improve your listings, handle inquiries and manage availability.' : 'Hi! I can help you find available properties based on your location, budget and preferred amenities.'}</p>
       <p class="font-bold">Try asking:</p>
       <div class="flex flex-col gap-2">${(owner ? ['How can I improve my occupancy?','Help review student requests','How should I manage pricing?'] : ['Show budget rooms under ₱3000','Find rooms near campus','Show places with Aircon and WiFi'])
           .map(prompt => `<button type="button" onclick="sendAIPrompt('${prompt.replaceAll("'","&#39;")}')" class="text-left text-brand-700 bg-brand-50 px-2 py-1.5 rounded-lg">${escHtml(prompt)}</button>`).join('')}</div>
       <p class="text-[10px] text-slate-400">Suggestions are based on information available in Homebound.</p></div>`;
}
function refreshDashboardStats() {
    const listings = getOwnerListings();
    const rooms = listings.flatMap(d => d.rooms);
    const available = rooms.reduce((sum,r)=>sum+displayBedSlots(r).filter(b=>b.status==='Available').length,0);
    const totalBeds=rooms.reduce((sum,r)=>sum+displayBedSlots(r).length,0);
    document.getElementById('statOccupancy').textContent = `${available} / ${totalBeds}`;
    const total = tenantRecords.filter(t => t.status === 'Active').reduce((sum,t) => sum + Number(t.monthly_rent || 0),0);
    document.getElementById('statRevenue').textContent = `₱${total.toLocaleString()}`;
    renderAdminTables();
}
function analyticsKpi(label,value,detail) {
    return `<div class="rounded-xl border border-slate-200 p-4 bg-slate-50"><div class="text-xs uppercase tracking-wider font-bold text-slate-500">${escHtml(label)}</div>
      <div class="text-2xl font-black text-slate-900 mt-2">${escHtml(value)}</div><div class="text-[11px] text-slate-500 mt-1">${escHtml(detail)}</div></div>`;
}
function analyticsAdvice(title,detail) {
    return `<div class="p-3 border border-slate-200 rounded-lg bg-slate-50"><strong class="block text-slate-900 mb-1">${escHtml(title)}</strong><p class="text-slate-600">${escHtml(detail)}</p></div>`;
}
function renderAnalytics() {
    if (!document.getElementById('analyticsKpis')) return;
    const listings = getOwnerListings();
    const rooms = listings.flatMap(d => d.rooms);
    const availableRooms = rooms.filter(r => isRoomAvailable(r.status));
    const holds = getOwnerHoldList();
    const chats = ownerConversations;
    const pending = holds.filter(h => h.status === 'Pending Approval').length;
    const endedTenancies = tenantRecords.filter(t => t.status === 'Ended');
    const endedLengths = endedTenancies.map(t => {
        const begin = Date.parse(`${t.start_date}T00:00:00Z`);
        const finish = Date.parse(`${t.end_date}T00:00:00Z`);
        return Number.isFinite(begin) && Number.isFinite(finish) && finish >= begin
            ? Math.round((finish - begin) / 86400000) : null;
    }).filter(days => days !== null);
    const avgEndedDays = endedLengths.length
        ? `${Math.round(endedLengths.reduce((sum, days) => sum + days, 0) / endedLengths.length)} days`
        : 'N/A';
    const rateTotal = rooms.reduce((sum,r)=>sum + (Number(r.price)||0),0);
    const availabilityPct = rooms.length ? Math.round(availableRooms.length / rooms.length * 100) : 0;
    document.getElementById('analyticsPeriod').textContent = `Prepared ${new Date().toLocaleDateString('en-PH', {year:'numeric',month:'long',day:'numeric'})}`;
    document.getElementById('analyticsSource').textContent = HomeboundStore.configured ?
        'Source: Live owner listings, submitted hold requests and student conversations in Supabase.' :
        'Source: Local sample properties, sample visitations and conversations in this browser. Not historical operating data.';
    const dueRecords=getPaymentViewRecords();
    const pastDue=dueRecords.filter(p=>p.status==='Overdue');
    const openBeds=rooms.reduce((sum,r)=>sum+displayBedSlots(r).filter(b=>b.status==='Available').length,0);
    const totalBeds=rooms.reduce((sum,r)=>sum+displayBedSlots(r).length,0);
    document.getElementById('analyticsKpis').innerHTML = [
        analyticsKpi('Properties',listings.length,'Managed listings'),
        analyticsKpi('Beds available',`${openBeds}/${totalBeds}`,'Current open bed slots'),
        analyticsKpi('Active tenants',tenantRecords.filter(t=>t.status==='Active').length,`${endedTenancies.length} historical tenancies`),
        analyticsKpi('Pending visits',pending,'Awaiting review'),
        analyticsKpi('Student inquiries',chats.length,'Recorded conversations'),
        analyticsKpi('Overdue rent',formatPeso(pastDue.reduce((sum,p)=>sum+p.amount,0)),`${pastDue.length} payment records`)
    ].join('');
    const monthsShown = Math.max(3,Math.min(12,Number(document.getElementById('analyticsMonthRange')?.value || 6)));
    const monthKeys=Array.from({length:monthsShown},(_,i)=>{
        const d=new Date();d.setDate(1);d.setMonth(d.getMonth()-(monthsShown-1-i));
        return {key:`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`,
            label:d.toLocaleString('en-PH',{month:'short',year:'numeric'})};
    });
    const inquiries = monthKeys.map(m => chats.filter(c => (c.created_at || c.updatedAt || '').startsWith(m.key)).length);
    const types = ['Dormitory','Bedspace','Apartment'];
    const typeCount = types.map(t => listings.filter(d=>d.type===t).reduce((n,d)=>n+d.rooms.length,0));
    const bands = [[0,3000],[3001,5000],[5001,10000],[10001,Infinity]];
    const bandCounts = bands.map(([min,max])=>rooms.filter(r=>r.price>=min && r.price<=max).length);
    const outcomeStatuses = ['Pending Approval','Confirmed Visit','Declined','Cancelled by Student','Expired'];
    const outcomes = outcomeStatuses.map(status=>holds.filter(h=>h.status===status).length);
    const recommendations = [];
    const overdueDues = getPaymentViewRecords().filter(p => p.status === 'Overdue');
    if (overdueDues.length) recommendations.push(analyticsAdvice('Follow up on overdue rent',
        `${overdueDues.length} payment(s), totaling ${formatPeso(overdueDues.reduce((sum,p)=>sum+p.amount,0))}, are past due. Contact tenants and update payment records only after verifying receipt.`));
    if (pending) recommendations.push(analyticsAdvice('Follow up on pending visits',`Review ${pending} request(s). Confirm or decline promptly so students can plan their inspection.`));
    else recommendations.push(analyticsAdvice('Keep the request queue current','No pending visit requests. Continue monitoring the Visitation tab.'));
    if (rooms.length && availableRooms.length) recommendations.push(analyticsAdvice('Promote vacancies',`${availableRooms.length} rooms are marked available. Add clear room photos, accurate rental prices and complete addresses to help students compare.`));
    if (rooms.length && !availableRooms.length) recommendations.push(analyticsAdvice('Keep availability accurate','All listed rooms are marked full. Update availability as soon as rooms reopen.'));
    if (chats.length) recommendations.push(analyticsAdvice('Respond to student inquiries',`${chats.length} student conversation(s) recorded. Review unanswered questions and respond with specific visit details.`));
    else recommendations.push(analyticsAdvice('Encourage inquiries','No recorded student conversations yet. Keep contact details and images complete so prospective tenants can ask questions.'));
    if (endedTenancies.length) recommendations.push(analyticsAdvice('Review tenancy turnover',
        `${endedTenancies.length} tenancy record(s) have ended. Use their start and end dates to review stay duration and plan vacancy marketing.`));
    if (rooms.length > 1) recommendations.push(analyticsAdvice('Review your advertised rent',`The average room rate is ₱${Math.round(rateTotal/rooms.length).toLocaleString()}/month. Compare rates against facilities and nearby properties; this is not collected revenue.`));
    document.getElementById('analyticsRecommendations').innerHTML = recommendations.slice(0,3).join('');
    const propertyRows = listings.map(d => `<tr class="border-b border-slate-100"><td class="p-2 font-semibold">${escHtml(d.title)}</td>
        <td class="p-2">${d.rooms.length}</td><td class="p-2">${d.rooms.filter(r=>isRoomAvailable(r.status)).length}</td>
        <td class="p-2">${escHtml(d.priceRangeStr)}</td>
        <td class="p-2">${chats.filter(c=>(c.listing_id || c.listingId)===d.id).length}</td>
        <td class="p-2">${holds.filter(h=>(h.listing_id || h.dormId)===d.id).length}</td></tr>`).join('');
    document.getElementById('analyticsPropertyRows').innerHTML = propertyRows || '<tr><td colspan="6" class="p-4 text-slate-400">Add a property to see a performance breakdown.</td></tr>';
    if (!window.Chart) return;
    reportCharts.forEach(chart=>chart.destroy()); reportCharts = [];
    const makeChart = (id,type,labels,data,colors) => {
        const canvas = document.getElementById(id);
        if (!canvas) return;
        reportCharts.push(new Chart(canvas,{
            type,
            data:{labels,datasets:[{label:'Count',data,backgroundColor:colors,borderColor:'#15803d',borderRadius:type==='bar'?5:0,tension:.3}]},
            options:{responsive:true,maintainAspectRatio:false,animation:false,
                plugins:{legend:{display:type==='doughnut'},tooltip:{enabled:true}},
                scales:type==='doughnut'?{}:{y:{beginAtZero:true,ticks:{precision:0}}}}
        }));
    };
    makeChart('chartSeasonalInflux','bar',monthKeys.map(m=>m.label),inquiries,'#16a34a');
    makeChart('chartRoomShare','doughnut',types,typeCount,['#16a34a','#0284c7','#f59e0b']);
    makeChart('chartPriceBands','bar',['≤ ₱3k','₱3k–5k','₱5k–10k','> ₱10k'],bandCounts,'#0284c7');
    makeChart('chartHoldOutcomes','bar',['Pending','Confirmed','Declined','Cancelled','Expired'],outcomes,'#f59e0b');
}

/* ==========================================================================
   UTILITY & TOAST SYSTEM
   ========================================================================== */

function closeModal(modalId) {
    document.getElementById(modalId).classList.add('hidden');
}

function showToast(msg, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    let bgColor = 'bg-slate-900 text-white';
    if (type === 'success') bgColor = 'bg-brand-600 text-white shadow-brand-600/30';
    if (type === 'error') bgColor = 'bg-rose-600 text-white';
    toast.className = `${bgColor} px-4 py-3 rounded-xl shadow-xl text-xs font-semibold flex items-center space-x-2 transition-all transform duration-300 pointer-events-auto max-w-sm`;
    const icon = document.createElement('i');
    icon.className = 'fa-solid fa-circle-info text-sm';
    const span = document.createElement('span');
    span.textContent = String(msg);
    toast.append(icon, span);
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}
