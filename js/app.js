/* Homebound application: original UI functions retained and extended. */
/* App state. Sample records are used only in demo mode. */
let currentPortal = 'student';
let activeUserHold = null;
let activeDormViewing = null;
let selectedRoomIndex = 0;
let dormsData = JSON.parse(JSON.stringify(sampleDormsData));
let activeOwner = null;
let demoOwnerAuthenticated = false;
let editingListingId = null;
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
let pendingRentalHoldId = null;
let ownerRentLoadInProgress = false;
let liveChatRefreshTimer = null;
let ownerRefreshTimer = null;
let aiContext = null;
let reportCharts = [];
const imageTypes = ['image/jpeg', 'image/png', 'image/webp'];
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
    return 'https://images.unsplash.com/photo-1555854877-bab0e564b8d5?auto=format&fit=crop&w=800&q=80';
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

window.onload = async function() {
    if (window.L) initLeafletMap();
    else showToast('Map library did not load. Check your internet connection.', 'error');
    renderListingsGrid(dormsData);
    renderAdminTables();
    if (window.Chart) initAnalyticsCharts();

    restoreActiveHold();
    updateAIAssistant();
    refreshDashboardStats();
    const status = document.getElementById('connectionStatus');
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
        });
    } catch (err) {
        showToast(`Supabase authorization error: ${err.message}`, 'error');
    }
};

function initLeafletMap() {
    // Center map around university belt
    leafletMap = L.map('map').setView([14.6055, 120.9885], 15);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(leafletMap);

    // Populate markers
    updateMapMarkers(dormsData);
}

function updateMapMarkers(items) {
    if (!leafletMap) return;
    mapMarkers.forEach(marker => leafletMap.removeLayer(marker));
    mapMarkers = [];
    items.forEach(item => {
        if (!Number.isFinite(item.lat) || !Number.isFinite(item.lng)) return;
        const marker = L.marker([item.lat, item.lng]).addTo(leafletMap)
            .bindPopup(`
                <div class="text-xs p-1">
                    <strong class="font-bold text-slate-900 block">${escHtml(item.title)}</strong>
                    <span class="text-brand-700 font-bold block">${escHtml(item.priceRangeStr)}</span>
                    <button onclick="openBedspaceViewer('${validListingId(item.id) ? item.id : ''}')" class="mt-2 bg-brand-600 text-white text-[10px] px-2 py-1 rounded w-full font-bold">View Rooms</button>
                </div>
            `);
        mapMarkers.push(marker);
    });
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
        setTimeout(() => leafletMap?.invalidateSize(), 80);
    }
    updateAIAssistant();
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
                        ${escHtml(dorm.rooms.some(r => isRoomAvailable(r.status)) ? 'Available' : 'Full / Occupied')}
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
    const filtered = dormsData.filter(d => {
        const searchable = `${d.locationZone || ''} ${d.distance || ''} ${d.title || ''}`.toLocaleLowerCase();
        if (!tokens.every(token => searchable.includes(token))) return false;
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
    applyFilters();
}

function openBedspaceViewer(dormId) {
    const dorm = dormsData.find(d => d.id === dormId);
    if (!dorm) return;

    activeDormViewing = dorm;
    selectedRoomIndex = 0;

    document.getElementById('modalDormTitle').innerText = dorm.title;
    document.getElementById('modalDormSub').innerText = `${dorm.locationZone} • Managed by ${dorm.ownerName}`;

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
    document.getElementById('modalRoomCap').innerText = room.capacity;
    document.getElementById('modalRoomTypeTag').innerText = activeDormViewing.type;
    document.getElementById('modalRoomDesc').textContent = room.note ? `${room.note} • Status: ${room.status}` : `Room status: ${room.status}`;
    document.getElementById('modalPropertyNote').textContent = activeDormViewing.note || '';
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

function openPreHoldForm() {
    if (!isRoomAvailable(activeDormViewing?.rooms[selectedRoomIndex]?.status)) {
        showToast('This room is currently occupied or unavailable.', 'error'); return;
    }
    if (activeUserHold && !['Cancelled by Student','Declined','Expired'].includes(activeUserHold.status)) {
        showToast('You already have a hold request. Cancel it before creating another.', 'error');
        openHoldStatusModal(); return;
    }
    const date = document.getElementById('holdVisitDate');
    date.min = localDateISO(new Date());
    if (!date.value || date.value < date.min) date.value = date.min;
    document.getElementById('holdVisitTime').value = '10:00';
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
    const visitTime = document.getElementById('holdVisitTime').value;
    if (!name || !phone || !email || !visitDate || !visitTime || visitDate < localDateISO(new Date())) {
        showToast('Please complete the visitation form with a future date.', 'error'); return;
    }
    const room = activeDormViewing.rooms[selectedRoomIndex];
    const token = crypto.randomUUID();
    const payload = { dormId: activeDormViewing.id, dormTitle: activeDormViewing.title,
        roomName: room.name, studentName: name, phone, email, visitDate, visitTime,
        token, timestamp: new Date().toISOString(), status: 'Pending Approval' };
    button.disabled = true;
    button.textContent = 'Submitting…';
    try {
        if (HomeboundStore.configured) {
            const result = await HomeboundStore.createHold(payload);
            payload.id = result.id;
        } else {
            payload.id = crypto.randomUUID();
            visitationsList.unshift({ id: payload.id, ...payload, studentPhone: phone,
                studentEmail: email, visitSlot: formatVisitTime(visitTime), status: 'Pending Approval' });
        }
        activeUserHold = payload;
        localStorage.setItem('homebound-active-hold', JSON.stringify(payload));
        refreshHoldBanner();
        if (currentPortal === 'owner') await loadOwnerData();
        else renderAdminTables();
        closeModal('modalPreHoldForm');
        document.getElementById('modalHoldConfirmation').classList.remove('hidden');
        showToast('Your hold request has been submitted.', 'success');
    } catch (err) {
        showToast(`Unable to submit hold request: ${err.message}`, 'error');
    } finally {
        button.disabled = false;
        button.textContent = 'Submit Hold Request';
    }
}

async function openHoldStatusModal() {
    if (!activeUserHold) { showToast('You have no active hold request.', 'info'); return; }
    await refreshActiveHold();
    document.getElementById('modalHoldConfirmation').classList.remove('hidden');
}

async function revokeActiveHold() {
    if (!activeUserHold) return;
    try {
        if (HomeboundStore.configured) {
            const updated = await HomeboundStore.cancelHold(activeUserHold.id, activeUserHold.token);
            if (!updated) throw new Error('This request is no longer cancellable.');
        } else {
            const found = visitationsList.find(v => v.id === activeUserHold.id);
            if (found) found.status = 'Cancelled by Student';
        }
        activeUserHold = null;
        localStorage.removeItem('homebound-active-hold');
        refreshHoldBanner();
        closeModal('modalHoldConfirmation');
        if (currentPortal === 'owner') await loadOwnerData();
        renderAdminTables();
        showToast('Hold request cancelled successfully.', 'success');
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
        localStorage.setItem(`homebound-chat-${studentChatListingId}`,
            JSON.stringify({ id: studentConversationId, token: studentChatToken }));
        input.value = '';
        await refreshStudentChat();
        if (currentPortal === 'owner') await loadOwnerInbox();
    } catch (err) { showToast(`Message not sent: ${err.message}`, 'error'); }
    finally { input.disabled = false; input.focus(); }
}

function sendQuickMessage(txt) { sendLiveChatMessage(txt); }

function appendChatMessage(txt, sender, targetId = 'liveChatMessages') {
    const box = document.getElementById(targetId);
    const mine = targetId === 'ownerChatMessages' ? sender === 'owner' : sender === 'student';
    box.insertAdjacentHTML('beforeend', `<div class="flex ${mine ? 'justify-end' : 'justify-start'}">
      <div class="${mine ? 'bg-brand-600 text-white' : 'bg-white text-slate-800 border border-slate-200'} p-2.5 rounded-2xl max-w-[85%] shadow-sm break-words text-xs">${escHtml(txt)}</div></div>`);
    box.scrollTop = box.scrollHeight;
}

function toggleAIChat() {
    const win = document.getElementById('aiAssistantWindow');
    win.classList.toggle('hidden');
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
    if (!/bedspace|beds?/i.test(String(room?.capacity || ''))) return 1;
    const n = Number((String(room.capacity).match(/\d+/) || [1])[0]);
    return Math.max(1, Math.min(100, n));
}
function activeTenantCount(listingId, roomName) {
    return tenantRecords.filter(t => t.status === 'Active' &&
        t.listing_id === listingId && t.room_name === roomName).length;
}
function availableRentalSlots(listingId,room) {
    const baseline=HomeboundStore.configured ? 0 : (samplePreExistingOccupancy[JSON.stringify([listingId,room.name])] || 0);
    return rentalRoomCapacity(room)-baseline-activeTenantCount(listingId,room.name);
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
function renderRentTracker() {
    const body = document.getElementById('adminPaymentsTable');
    if (!body) return;
    const all = getPaymentViewRecords();
    const filter = document.getElementById('paymentStatusFilter')?.value || 'all';
    const visible = all.map((p,idx)=>({p,idx}))
        .filter(({p})=>filter==='all' || p.status.toLowerCase()===filter);
    body.innerHTML = visible.length ? visible.map(({p,idx})=>`
        <tr class="hover:bg-slate-50">
          <td class="p-3"><strong class="block text-slate-900">${escHtml(p.tenantName)}</strong>
              <span class="text-slate-500">${escHtml(p.phone)}</span></td>
          <td class="p-3">${escHtml(p.unitName)}</td>
          <td class="p-3 font-semibold whitespace-nowrap">${escHtml(formatPeso(p.amount))}</td>
          <td class="p-3 whitespace-nowrap">${escHtml(p.dueDate)}</td>
          <td class="p-3"><span class="inline-block rounded-full px-2 py-1 text-[10px] font-bold ${p.status==='Paid'?'bg-brand-100 text-brand-800':p.status==='Overdue'?'bg-rose-100 text-rose-800':'bg-amber-100 text-amber-800'}">${p.status}</span></td>
          <td class="p-3 text-right"><div class="flex flex-wrap justify-end gap-1.5">
              <button type="button" onclick="previewRentReminder(${idx})" class="px-2 py-1.5 rounded text-[10px] bg-indigo-600 text-white">Preview Reminder</button>
              <button type="button" onclick="togglePaymentStatus(${idx})" class="px-2 py-1.5 rounded text-[10px] ${p.status==='Paid'?'bg-slate-200 text-slate-700':'bg-brand-600 text-white'}">${p.status==='Paid'?'Undo Paid':'Mark Paid'}</button>
          </div></td>
        </tr>`).join('') : `<tr><td colspan="6" class="p-6 text-center text-slate-500">${filter==='all'
            ? 'No rental payment records yet. Assign a tenant to begin tracking monthly rent.'
            : 'No payment records match this filter.'}</td></tr>`;
    const active = tenantRecords.filter(t => t.status === 'Active');
    document.getElementById('activeTenantsTable').innerHTML = active.length ? active.map(t=>`
        <tr class="hover:bg-slate-50">
          <td class="p-3"><strong class="block text-slate-900">${escHtml(t.tenant_name)}</strong><span class="text-slate-500">${escHtml(t.tenant_phone)}</span></td>
          <td class="p-3">${escHtml(lookupPropertyName(t.listing_id))}<span class="block text-brand-700">${escHtml(t.room_name)}</span></td>
          <td class="p-3">${escHtml(t.start_date)}</td>
          <td class="p-3 font-semibold">${escHtml(formatPeso(t.monthly_rent))}</td>
          <td class="p-3 text-right"><button type="button" onclick="endTenantAssignment('${escHtml(t.id)}')" class="text-rose-700 bg-rose-50 border border-rose-200 px-3 py-1.5 rounded font-semibold">End Tenancy</button></td>
        </tr>`).join('') : '<tr><td colspan="5" class="p-5 text-center text-slate-500">No active tenants assigned yet.</td></tr>';
    const unpaid = all.filter(p=>p.status!=='Paid');
    const overdue = all.filter(p=>p.status==='Overdue');
    const paid = all.filter(p=>p.status==='Paid');
    const blocks = [
        ['Active Tenants',active.length,'Signed rental agreements'],
        ['Unpaid Dues',formatPeso(unpaid.reduce((sum,p)=>sum+p.amount,0)),'Pending and overdue'],
        ['Overdue Dues',formatPeso(overdue.reduce((sum,p)=>sum+p.amount,0)),`${overdue.length} overdue monthly record(s)`],
        ['Recorded Paid',formatPeso(paid.reduce((sum,p)=>sum+p.amount,0)),'Marked paid by landlord']
    ];
    document.getElementById('rentTrackerSummary').innerHTML = blocks.map(([title,value,detail])=>`
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
    const available=availableRentalSlots(listingId,room);
    room.status=available<=0 ? 'Full / Occupied' : rentalRoomCapacity(room)===1 ? 'Available' : `Available (${available} ${available === 1 ? 'bed' : 'beds'} left)`;
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
    const payload={listingId:id,roomName,
        tenantName:document.getElementById('tenantFullName').value.trim(),
        phone:document.getElementById('tenantPhone').value.trim(),
        email:document.getElementById('tenantEmail').value.trim(),
        startDate:document.getElementById('tenantMoveIn').value,
        dueDay:Number(document.getElementById('tenantDueDay').value),
        monthlyRent:Number(document.getElementById('tenantMonthlyRent').value),
        holdId:pendingRentalHoldId};
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
            tenantRecords.push({id:crypto.randomUUID(),listing_id:id,room_name:roomName,
                tenant_name:payload.tenantName,tenant_phone:payload.phone,
                tenant_email:payload.email,monthly_rent:payload.monthlyRent,
                start_date:payload.startDate,due_day:payload.dueDay,status:'Active',
                end_date:null,source_hold_id:payload.holdId});
            if (payload.holdId) {
                const hold=visitationsList.find(h=>h.id===payload.holdId);
                if (hold) hold.status='Rented';
                if (activeUserHold?.id===payload.holdId) {
                    activeUserHold.status='Rented';
                    localStorage.setItem('homebound-active-hold',JSON.stringify(activeUserHold));
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
    for (const name of ['Visitations','Payments','Listings','Chats','Analytics']) {
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
    if (tabName === 'payments' && HomeboundStore.configured && activeOwner) loadOwnerRentData();
    if (tabName === 'analytics') requestAnimationFrame(renderAnalytics);
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
          <td class="p-3 text-right space-x-2">${isPending ? `<button onclick="updateVisitStatus(${i}, 'Confirmed Visit')" class="bg-brand-600 text-white px-2 py-1 rounded text-[10px] font-bold">Approve</button>
            <button onclick="updateVisitStatus(${i}, 'Declined')" class="bg-slate-200 text-slate-700 px-2 py-1 rounded text-[10px] font-bold">Decline</button>`
            : status === 'Confirmed Visit' ? `<button type="button" onclick="openTenantAssignmentModal(${i})" class="bg-indigo-600 text-white px-3 py-1.5 rounded text-[10px] font-bold">Assign Tenant / Rent</button>`
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
            renderAdminTables();
        }
        refreshDashboardStats();
        showToast(`Visitation marked as ${newStatus}.`, 'success');
    } catch (err) { showToast(`Could not update request: ${err.message}`, 'error'); }
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

function renderAdminListings() {
    const container = document.getElementById('adminListingsContainer');
    const mine = HomeboundStore.configured
        ? dormsData.filter(d => d.ownerId === activeOwner?.id)
        : dormsData;
    if (!mine.length) {
        container.innerHTML = '<p class="text-xs text-slate-500 col-span-full py-6">No listings yet. Use "Add New Unit/Listing" to create your first property.</p>';
        return;
    }
    container.innerHTML = mine.map(d => {
        // Keep original function index-based toggle signature; index comes from master list.
        const index = dormsData.findIndex(item => item.id === d.id);
        return `
        <div class="p-4 rounded-xl border border-slate-200 bg-white space-y-3">
            <div class="flex items-center justify-between gap-2">
                <h4 class="font-bold text-slate-900 text-sm">${escHtml(d.title)}</h4>
                <span class="text-[10px] text-slate-400 font-mono">${escHtml(d.lastUpdated)}</span>
            </div>
            <div class="text-xs text-slate-600 flex justify-between gap-2">
                <span>Total Rooms: ${d.rooms.length}</span>
                <span class="font-bold text-brand-700">${escHtml(d.priceRangeStr)}</span>
            </div>
            <div class="pt-2 border-t border-slate-100 flex flex-wrap justify-between items-center gap-2 text-xs">
                <span class="font-semibold text-slate-700">Global Availability:</span>
                <button onclick="toggleDormAvailability(${index})" class="bg-brand-600 hover:bg-brand-700 text-white text-[10px] font-bold px-3 py-1.5 rounded-lg">
                    ${escHtml(d.rooms.some(r => isRoomAvailable(r.status)) ? 'Available' : 'Full / Occupied')}
                </button>
            </div>
            <div class="flex gap-2 text-xs">
                <button onclick="openTenantAssignmentModal(null,'${validListingId(d.id) ? d.id : ''}')" class="bg-brand-50 border border-brand-200 text-brand-800 rounded-lg px-3 py-2 font-bold">Assign Tenant</button>
                <button onclick="openEditListingModal('${validListingId(d.id) ? d.id : ''}')" class="bg-slate-100 border border-slate-200 text-slate-700 rounded-lg px-3 py-2 font-bold">Edit Property & Rooms</button>
                <button onclick="deleteListing('${validListingId(d.id) ? d.id : ''}')" class="bg-rose-50 border border-rose-200 text-rose-700 rounded-lg px-3 py-2 font-bold">Delete</button>
            </div>
        </div>`;
    }).join('');
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
    next.rooms.forEach(r => { r.status = hasAvailable ? 'Full / Occupied' : 'Available'; });
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
    addListingRoom();
    document.getElementById('modalListingEditor').classList.remove('hidden');
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
    el.className = 'listing-room-form bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3';
    const oldAmenities = Array.isArray(room.amenities) ? room.amenities : [];
    const customAmenities = oldAmenities.filter(a => !ROOM_AMENITIES.includes(a));
    el.innerHTML = `<div class="flex items-center justify-between">
        <strong class="text-slate-800">Room / Unit ${index}</strong>
        <button type="button" onclick="removeListingRoom(${index})" class="text-rose-700 font-semibold">Remove room</button>
      </div>
      <div class="grid sm:grid-cols-2 gap-3">
        <label class="font-semibold">Room Name *<input class="input-editor room-name" required value="${escHtml(room.name || '')}" placeholder="Room 101 - Twin Sharing"></label>
        <label class="font-semibold">Monthly Price (PHP) *<input class="input-editor room-price price-no-spinner" type="number" min="0" step="1" required value="${Number(room.price || 0)}"></label>
        <label class="font-semibold">Capacity *<input class="input-editor room-capacity" required value="${escHtml(room.capacity || '')}" placeholder="4 Bedspaces"></label>
        <label class="font-semibold sm:col-span-2">Additional Notes (optional)<textarea class="input-editor room-note" maxlength="600" rows="2" placeholder="Bathroom details, house rules, allowed occupants...">${escHtml(room.note || '')}</textarea></label>
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
        const prepared = roomEls.map(el => {
            const read = className => el.querySelector('.' + className).value.trim();
            const priceText = read('room-price');
            const price = Number(priceText);
            if (!priceText || !Number.isInteger(price) || price < 0) throw new Error('Room rates must be whole peso amounts.');
            const amenities = [...el.querySelectorAll('.room-amenity-checkbox:checked')].map(input => input.value)
                .concat([...el.querySelectorAll('.custom-amenity')].map(input => input.value));
            const result = { name: read('room-name'), price, capacity: read('room-capacity'),
                status: el.dataset.roomStatus || 'Available', note: read('room-note'),
                amenities, zone: el.querySelector('.image-dropzone') };
            if (!result.name || !result.capacity) throw new Error('Every room needs a name and capacity.');
            return result;
        });
        if (new Set(prepared.map(r => r.name.toLowerCase())).size !== prepared.length)
            throw new Error('Room names must be unique within a property so tenants can be assigned accurately.');
        if (!field('listingTitle') || !field('listingOwner') || !field('listingLocation'))
            throw new Error('Enter property title, owner and full location.');
        button.disabled = true; button.textContent = 'Saving…';
        const rooms = [];
        for (const data of prepared) {
            const images = await collectZoneImages(data.zone);
            const {zone, ...room} = data;
            rooms.push({...room, images});
        }
        const mainImages = await collectZoneImages(document.getElementById('listingMainDrop'));
        const prices = rooms.map(r => r.price);
        const minPrice = Math.min(...prices), maxPrice = Math.max(...prices);
        const old = editingListingId ? dormsData.find(d => d.id === editingListingId) : null;
        const payload = {
            title: field('listingTitle'), type: field('listingType'),
            locationZone: field('listingLocation'), distance: field('listingDistance'),
            note: field('listingNote'), lat: old?.lat ?? null, lng: old?.lng ?? null,
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
        showToast('Property and room details saved successfully.', 'success');
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
    renderAnalytics();
    requestAnimationFrame(() => window.print());
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
function restoreActiveHold() {
    try {
        const hold = JSON.parse(localStorage.getItem('homebound-active-hold') || 'null');
        if (hold && hold.id && hold.token) activeUserHold = hold;
    } catch (_) { localStorage.removeItem('homebound-active-hold'); }
    refreshHoldBanner();
    if (HomeboundStore.configured && activeUserHold) refreshActiveHold();
}
function refreshHoldBanner() {
    const banner = document.getElementById('activeHoldBanner');
    if (activeUserHold && Date.now() - new Date(activeUserHold.timestamp).getTime() > 86400000 && activeUserHold.status === 'Pending Approval') {
        activeUserHold.status = 'Expired';
    }
    if (!activeUserHold || ['Declined','Cancelled by Student','Expired'].includes(activeUserHold.status)) {
        banner.classList.add('hidden'); banner.classList.remove('flex'); return;
    }
    document.getElementById('holdDormName').textContent = activeUserHold.dormTitle;
    document.getElementById('holdRequestStatus').textContent = `Status: ${activeUserHold.status}`;
    const rented = activeUserHold.status === 'Rented';
    document.getElementById('holdConfirmationTitle').textContent = rented ? 'Rental Assignment Recorded' : 'Hold Request Submitted';
    document.getElementById('holdRequestDescription').textContent = rented
        ? 'Your landlord has recorded your room rental. Contact the owner directly for your agreement and payment instructions.'
        : 'Your visit and 24-hour hold request is recorded. The owner can review your preferred visit details.';
    document.getElementById('cancelHoldButton').classList.toggle('hidden',rented);
    banner.classList.remove('hidden'); banner.classList.add('flex');
}
async function refreshActiveHold() {
    if (!activeUserHold || !HomeboundStore.configured) return;
    try {
        const result = await HomeboundStore.getHold(activeUserHold.id, activeUserHold.token);
        if (!result) return;
        activeUserHold.status = result.status;
        localStorage.setItem('homebound-active-hold', JSON.stringify(activeUserHold));
        refreshHoldBanner();
    } catch (err) { console.warn('Could not refresh hold status:', err.message); }
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
    await Promise.all([loadOwnerInbox(),loadOwnerHolds(),loadOwnerRentData()]);
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
    zone.existingImages = [...existing];
    zone.pendingFiles = [];
    zone.singleImage = single;
    renderZoneImages(id);
}
function validateImageFile(file) {
    if (!imageTypes.includes(file.type)) throw new Error('Upload only JPG, PNG or WEBP photos.');
    if (file.size > 5 * 1024 * 1024) throw new Error(`Photo ${file.name} exceeds 5MB.`);
}
function setDroppedImages(id, files) {
    const zone = document.getElementById(id);
    if (!zone) return;
    try {
        const next = [...files];
        next.forEach(validateImageFile);
        const existing = zone.existingImages || [];
        if (zone.singleImage) {
            zone.pendingFiles = next.slice(0,1);
            if (next.length) zone.existingImages = [];
        } else {
            if (existing.length + (zone.pendingFiles || []).length + next.length > 5)
                throw new Error('Maximum of five images per room.');
            zone.pendingFiles = [...(zone.pendingFiles || []), ...next];
        }
        renderZoneImages(id);
    } catch (err) { showToast(err.message, 'error'); }
}
function handleImageSelection(event,id) {
    setDroppedImages(id,event.target.files);
    event.target.value = '';
}
function handleImageDrop(event,id) {
    event.preventDefault();
    setDroppedImages(id,event.dataTransfer.files);
}
function removeZoneImage(id,which,index) {
    const zone = document.getElementById(id);
    if (which === 'existing') zone.existingImages.splice(index,1);
    else zone.pendingFiles.splice(index,1);
    renderZoneImages(id);
}
function renderZoneImages(id) {
    const zone = document.getElementById(id);
    if (!zone) return;
    (zone.previewObjectUrls || []).forEach(url => URL.revokeObjectURL(url));
    zone.previewObjectUrls = [];
    const preview = zone.querySelector('.image-previews');
    const stored = (zone.existingImages || []).map((src,index) => ({src,kind:'existing',index}));
    const pending = (zone.pendingFiles || []).map((file,index) => {
        const src = URL.createObjectURL(file); zone.previewObjectUrls.push(src);
        return {src,kind:'pending',index};
    });
    preview.innerHTML = [...stored,...pending].map(item => `<div class="relative w-20 h-20">
       <img src="${safeImageUrl(item.src)}" alt="Uploaded property photo" class="w-full h-full object-cover rounded-lg border border-slate-200">
       <button type="button" aria-label="Remove photo" onclick="removeZoneImage('${id}','${item.kind}',${item.index})" class="absolute -top-1 -right-1 rounded-full bg-rose-600 text-white w-5 h-5">×</button></div>`).join('');
}
function fileAsDataUrl(file) {
    return new Promise((resolve,reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Could not read photo.'));
        reader.readAsDataURL(file);
    });
}
async function collectZoneImages(zone) {
    const originals = [...(zone.existingImages || [])];
    for (const file of (zone.pendingFiles || [])) {
        originals.push(HomeboundStore.configured ? await HomeboundStore.uploadImage(file) : await fileAsDataUrl(file));
    }
    return zone.singleImage ? originals.slice(0,1) : originals;
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
async function sendOwnerReply(e) {
    e.preventDefault();
    const input = document.getElementById('ownerChatInput');
    const message = input.value.trim();
    if (!ownerConversationId || !message) return;
    input.disabled = true;
    try {
        if (HomeboundStore.configured) await HomeboundStore.ownerReply(ownerConversationId,message);
        else {
            const conversation = demoConversations.find(c => c.id===ownerConversationId);
            conversation.messages.push({id:crypto.randomUUID(), sender:'owner',body:message,created_at:new Date().toISOString()});
            conversation.updatedAt = new Date().toISOString();
        }
        input.value='';
        await openOwnerConversation(ownerConversationId);
        await loadOwnerInbox();
        refreshStudentChat();
    } catch (err) { showToast(`Reply not sent: ${err.message}`, 'error'); }
    finally { input.disabled=false; }
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
    const available = rooms.filter(r => isRoomAvailable(r.status)).length;
    document.getElementById('statOccupancy').textContent = `${available} / ${rooms.length}`;
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
    const rateTotal = rooms.reduce((sum,r)=>sum + (Number(r.price)||0),0);
    const availabilityPct = rooms.length ? Math.round(availableRooms.length / rooms.length * 100) : 0;
    document.getElementById('analyticsPeriod').textContent = `Prepared ${new Date().toLocaleDateString('en-PH', {year:'numeric',month:'long',day:'numeric'})}`;
    document.getElementById('analyticsSource').textContent = HomeboundStore.configured ?
        'Source: Live owner listings, submitted hold requests and student conversations in Supabase.' :
        'Source: Local sample properties, sample visitations and conversations in this browser. Not historical operating data.';
    document.getElementById('analyticsKpis').innerHTML = [
        analyticsKpi('Listed Properties',listings.length,'Properties managed'),
        analyticsKpi('Rooms Available',`${availableRooms.length}/${rooms.length}`,`${availabilityPct}% of listed rooms`),
        analyticsKpi('Student Inquiries',chats.length,'Unique conversations'),
        analyticsKpi('Pending Visits',pending,'Requests awaiting review'),
        analyticsKpi('Active Renters',tenantRecords.filter(t=>t.status==='Active').length,'Signed tenant assignments'),
        analyticsKpi('Overdue Rent',formatPeso(getPaymentViewRecords().filter(p=>p.status==='Overdue').reduce((sum,p)=>sum+p.amount,0)),'Outstanding past-due amounts')
    ].join('');
    const monthKeys = Array.from({length:6},(_,i)=>{const d=new Date();d.setDate(1);d.setMonth(d.getMonth()-(5-i));return {key:`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`,label:d.toLocaleString('en-PH',{month:'short',year:'2-digit'})};});
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
    if (rooms.length > 1) recommendations.push(analyticsAdvice('Review your advertised rent',`The average room rate is ₱${Math.round(rateTotal/rooms.length).toLocaleString()}/month. Compare rates against facilities and nearby properties; this is not collected revenue.`));
    document.getElementById('analyticsRecommendations').innerHTML = recommendations.join('');
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