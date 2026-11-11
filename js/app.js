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

function escHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
}
function safeImageUrl(value) {
    try {
        const url = new URL(String(value || ''), window.location.href);
        if (url.protocol === 'https:' || (url.hostname === 'localhost' && url.protocol === 'http:')) {
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

    const status = document.getElementById('connectionStatus');
    if (!HomeboundStore.configured) {
        status.textContent = 'Demo mode (local data)';
        return;
    }

    // Do not show fabricated "live" listings while network data is loading.
    dormsData = [];
    refreshListingViews();
    status.textContent = 'Connecting to Supabase…';
    await loadListings();
    try {
        activeOwner = await HomeboundStore.currentOwner();
        if (activeOwner) {
            document.getElementById('ownerLogoutButton').classList.remove('hidden');
        }
        HomeboundStore.subscribe(() => { loadListings(); });
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
        if (HomeboundStore.configured && !activeOwner) {
            attemptOwnerLogin();
            return;
        }
        if (!HomeboundStore.configured && !demoOwnerAuthenticated) {
            attemptOwnerLogin();
            return;
        }
        document.getElementById('studentPortalView').classList.add('hidden');
        document.getElementById('ownerPortalView').classList.remove('hidden');
        document.getElementById('btnPortalStudent').className = "px-3.5 py-1.5 rounded-lg text-xs font-semibold text-slate-500 hover:text-slate-900 transition-all duration-150 flex items-center space-x-1.5";
        document.getElementById('btnPortalOwner').className = "px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 flex items-center space-x-1.5 bg-slate-900 text-white shadow-sm";
        currentPortal = 'owner';
        document.getElementById('ownerLogoutButton').classList.remove('hidden');
        renderAdminListings();
        if (HomeboundStore.configured) {
            // Financial, visitation, and occupancy sample metrics are not database-backed.
            for (const id of ['statOccupancy','statRevenue','statPendingVisits','statActiveHolds','statOverdueCount']) {
                document.getElementById(id).textContent = 'Demo';
            }
        }
        showToast('Switched to Landlord / Owner Management UI', 'info');
    } else {
        document.getElementById('ownerPortalView').classList.add('hidden');
        document.getElementById('studentPortalView').classList.remove('hidden');
        document.getElementById('btnPortalStudent').className = "px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 flex items-center space-x-1.5 bg-white text-slate-900 shadow-sm";
        document.getElementById('btnPortalOwner').className = "px-3.5 py-1.5 rounded-lg text-xs font-semibold text-slate-500 hover:text-slate-900 transition-all duration-150 flex items-center space-x-1.5";
        currentPortal = 'student';
        setTimeout(() => { if (leafletMap) leafletMap.invalidateSize(); }, 80);
    }
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
        document.getElementById('ownerLogoutButton').classList.remove('hidden');
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
    document.getElementById('ownerLogoutButton').classList.add('hidden');
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
    const loc = document.getElementById('filterLocation').value;
    const priceRange = document.getElementById('filterPriceRange').value;
    const type = document.getElementById('filterType').value;
    const amenity = document.getElementById('filterAmenity').value;
    const availability = document.getElementById('filterAvailability').value;
    const filtered = dormsData.filter(d => {
        if (loc !== 'ALL' && d.locationZone !== loc) return false;
        if (type !== 'ALL' && d.type !== type) return false;
        if (priceRange !== 'ALL') {
            const [min, max] = priceRange.split('-').map(Number);
            if (d.maxPrice < min || d.minPrice > max) return false;
        }
        if (amenity !== 'ALL') {
            const token = amenity.toLowerCase();
            const matches = d.rooms.some(r => r.amenities.some(a => {
                const name = String(a).toLowerCase();
                if (token === 'wifi') return /wi-?fi|internet|fiber/.test(name);
                if (token === 'security') return /security|cctv|guard|biometric|keycard/.test(name);
                if (token === 'bathroom') return /private bath/.test(name);
                return name.includes(token);
            }));
            if (!matches) return false;
        }
        if (availability === 'Available' && !d.rooms.some(r => isRoomAvailable(r.status))) return false;
        if (availability === 'Full' && d.rooms.some(r => isRoomAvailable(r.status))) return false;
        return true;
    });
    renderListingsGrid(filtered);
    updateMapMarkers(filtered);
}

function resetFilters() {
    for (const id of ['filterLocation','filterPriceRange','filterType','filterAmenity','filterAvailability']) {
        document.getElementById(id).value = 'ALL';
    }
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
}

function renderRoomDetails() {
    const room = activeDormViewing?.rooms[selectedRoomIndex];
    if (!room) return;
    document.getElementById('modalRoomName').innerText = room.name;
    document.getElementById('modalRoomPrice').innerText = `₱${Number(room.price).toLocaleString()} / mo`;
    document.getElementById('modalRoomCap').innerText = room.capacity;
    document.getElementById('modalRoomTypeTag').innerText = activeDormViewing.type;
    document.getElementById('modalRoomDesc').innerText = `Room status: ${room.status}`;
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
        showToast('This room is currently occupied or unavailable.', 'error');
        return;
    }
    closeModal('modalBedspaceViewer');
    document.getElementById('modalPreHoldForm').classList.remove('hidden');
}

function submitHoldRequest(e) {
    e.preventDefault();

    const name = document.getElementById('holdStudentName').value;
    const phone = document.getElementById('holdStudentPhone').value;
    const email = document.getElementById('holdStudentEmail').value;
    const date = document.getElementById('holdVisitDate').value;
    const slot = document.querySelector('input[name="visitSlot"]:checked').value;

    const room = activeDormViewing.rooms[selectedRoomIndex];

    // Store Active Student Hold
    activeUserHold = {
        dormId: activeDormViewing.id,
        dormTitle: activeDormViewing.title,
        roomName: room.name,
        studentName: name,
        phone: phone,
        email: email,
        visitDate: date,
        visitSlot: slot,
        timestamp: new Date()
    };

    // Add to Admin Monitoring Table
    visitationsList.unshift({
        id: "V-" + Math.floor(100 + Math.random() * 900),
        studentName: name,
        studentPhone: phone,
        studentEmail: email,
        dormTitle: activeDormViewing.title,
        roomName: room.name,
        visitDate: date,
        visitSlot: slot,
        status: "24h Hold Active"
    });

    renderAdminTables();

    // Show Notification Banner on Header
    document.getElementById('holdDormName').innerText = activeDormViewing.title;
    document.getElementById('activeHoldBanner').classList.remove('hidden');
    document.getElementById('activeHoldBanner').classList.add('flex');

    closeModal('modalPreHoldForm');
    document.getElementById('modalHoldConfirmation').classList.remove('hidden');

    showToast(`Demo hold recorded in this browser for ${activeDormViewing.title}. Not sent to the owner.`, 'info');
}

function openHoldStatusModal() {
    document.getElementById('modalHoldConfirmation').classList.remove('hidden');
}

function revokeActiveHold() {
    if (!activeUserHold) return;

    // Find and update status in admin list
    const found = visitationsList.find(v => v.studentName === activeUserHold.studentName);
    if (found) {
        found.status = "Cancelled by Student";
    }

    activeUserHold = null;

    document.getElementById('activeHoldBanner').classList.add('hidden');
    document.getElementById('activeHoldBanner').classList.remove('flex');

    closeModal('modalHoldConfirmation');
    renderAdminTables();

    showToast('Hold reservation successfully revoked.', 'info');
}

/* ==========================================================================
   INTEGRATED LIVE CHAT & AI FLOATING ASSISTANT
   ========================================================================== */

function openChatFromModal() {
    closeModal('modalBedspaceViewer');
    openLiveChat(activeDormViewing.ownerName);
}

function openLiveChat(ownerName) {
    document.getElementById('chatOwnerTitle').innerText = ownerName || "Dorm Owner Chat";
    document.getElementById('chatOwnerAvatar').innerText = (ownerName || "O")[0];
    document.getElementById('liveChatDrawer').classList.remove('hidden');
}

function closeLiveChat() {
    document.getElementById('liveChatDrawer').classList.add('hidden');
}

function sendLiveChatMessage() {
    const input = document.getElementById('liveChatInput');
    const msg = input.value.trim();
    if (!msg) return;

    appendChatMessage(msg, 'user');
    input.value = '';

    // Simulated Automated Owner Reply
    setTimeout(() => {
        appendChatMessage("Hello! Thank you for inquiring. Yes, this unit is available. Would you like to schedule a visitation slot?", 'owner');
    }, 1000);
}

function sendQuickMessage(txt) {
    appendChatMessage(txt, 'user');
    setTimeout(() => {
        appendChatMessage("Thanks for asking! You can also click the 'Hold 24h' button to lock this slot while you decide.", 'owner');
    }, 1000);
}

function appendChatMessage(txt, sender) {
    const box = document.getElementById('liveChatMessages');
    const isUser = sender === 'user';
    box.innerHTML += `
        <div class="flex ${isUser ? 'justify-end' : 'justify-start'}">
            <div class="${isUser ? 'bg-brand-600 text-white rounded-tr-none' : 'bg-white text-slate-800 border border-slate-200 rounded-tl-none'} p-2.5 rounded-2xl max-w-[80%] shadow-sm text-xs">
                ${escHtml(txt)}
            </div>
        </div>
    `;
    box.scrollTop = box.scrollHeight;
}

// AI Floating Assistant
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
    setTimeout(() => {
        if (!dormsData.length) {
            appendAIMessage('<p>No live listings are available yet. Ask an approved landlord to add a property.</p>', 'ai');
            return;
        }
        let matched = dormsData[0]; // fallback
        const q = query.toLowerCase();

        if (q.includes('low') || q.includes('3000') || q.includes('budget')) {
            matched = dormsData.find(d => d.minPrice <= 2500) || dormsData[1];
        } else if (q.includes('gate 1') || q.includes('gate')) {
            matched = dormsData.find(d => d.locationZone.includes('Gate 1')) || dormsData[0];
        } else if (q.includes('aircon') || q.includes('wifi')) {
            matched = dormsData.find(d => d.rooms.some(r => r.amenities.includes('Aircon'))) || dormsData[0];
        }

        const replyHtml = `
            <p>Based on your criteria, I highly recommend checking out:</p>
            <div class="border border-slate-200 rounded-xl p-2 bg-slate-50 space-y-1">
                <strong class="text-slate-900 block text-xs font-bold">${escHtml(matched.title)}</strong>
                <span class="text-brand-700 font-bold block text-[11px]">${escHtml(matched.priceRangeStr)}</span>
                <span class="text-[10px] text-slate-500 block">${escHtml(matched.locationZone)}</span>
                <button onclick="openBedspaceViewer('${validListingId(matched.id) ? matched.id : ''}')" class="mt-1 w-full bg-brand-600 text-white py-1 rounded text-[10px] font-bold">Inspect Rooms Now</button>
            </div>
        `;
        appendAIMessage(replyHtml, 'ai');
    }, 800);
}

/* ==========================================================================
   ADMIN / OWNER DASHBOARD MANAGEMENT & SMS PAYMENT TRACKER
   ========================================================================== */

function switchAdminTab(tabName) {
    // Hide all
    document.getElementById('tabContentVisitations').classList.add('hidden');
    document.getElementById('tabContentPayments').classList.add('hidden');
    document.getElementById('tabContentListings').classList.add('hidden');
    document.getElementById('tabContentAnalytics').classList.add('hidden');

    // Reset styles
    document.querySelectorAll('.admin-tab-btn').forEach(btn => {
        btn.className = "admin-tab-btn px-5 py-3.5 text-xs font-bold border-b-2 border-transparent text-slate-500 hover:text-slate-900 flex items-center space-x-2 whitespace-nowrap";
    });

    if (tabName === 'visitations') {
        document.getElementById('tabContentVisitations').classList.remove('hidden');
        document.getElementById('tabBtnVisitations').className = "admin-tab-btn px-5 py-3.5 text-xs font-bold border-b-2 border-brand-600 text-brand-600 flex items-center space-x-2 whitespace-nowrap";
    } else if (tabName === 'payments') {
        document.getElementById('tabContentPayments').classList.remove('hidden');
        document.getElementById('tabBtnPayments').className = "admin-tab-btn px-5 py-3.5 text-xs font-bold border-b-2 border-brand-600 text-brand-600 flex items-center space-x-2 whitespace-nowrap";
    } else if (tabName === 'listings') {
        document.getElementById('tabContentListings').classList.remove('hidden');
        document.getElementById('tabBtnListings').className = "admin-tab-btn px-5 py-3.5 text-xs font-bold border-b-2 border-brand-600 text-brand-600 flex items-center space-x-2 whitespace-nowrap";
        renderAdminListings();
    } else if (tabName === 'analytics') {
        document.getElementById('tabContentAnalytics').classList.remove('hidden');
        document.getElementById('tabBtnAnalytics').className = "admin-tab-btn px-5 py-3.5 text-xs font-bold border-b-2 border-brand-600 text-brand-600 flex items-center space-x-2 whitespace-nowrap";
        requestAnimationFrame(() => {
            if (window.Chart) {
                ['chartSeasonalInflux','chartRoomShare'].forEach(id => {
                    const chart = Chart.getChart(document.getElementById(id));
                    if (chart) chart.resize();
                });
            }
        });
    }
}

function renderAdminTables() {
    // 1. Visitations Table
    const vTable = document.getElementById('adminVisitationsTable');
    vTable.innerHTML = visitationsList.map((v, i) => `
        <tr class="hover:bg-slate-50 transition">
            <td class="p-3">
                <strong class="text-slate-900 font-bold block">${escHtml(v.studentName)}</strong>
                <span class="text-[10px] text-slate-400">${escHtml(v.studentEmail)}</span>
            </td>
            <td class="p-3">
                <span class="font-semibold text-slate-800 block">${escHtml(v.dormTitle)}</span>
                <span class="text-[10px] text-brand-700">${escHtml(v.roomName)}</span>
            </td>
            <td class="p-3">
                <span class="bg-slate-100 text-slate-800 px-2 py-0.5 rounded font-bold">${escHtml(v.visitDate)} @ ${escHtml(v.visitSlot)}</span>
            </td>
            <td class="p-3 font-mono text-[11px]">${escHtml(v.studentPhone)}</td>
            <td class="p-3">
                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${v.status.includes('Active') || v.status.includes('Confirmed') ? 'bg-brand-100 text-brand-800' : 'bg-amber-100 text-amber-800'}">
                    ${escHtml(v.status)}
                </span>
            </td>
            <td class="p-3 text-right space-x-1">
                <button onclick="updateVisitStatus(${i}, 'Confirmed Visit')" class="bg-brand-600 hover:bg-brand-700 text-white text-[10px] font-bold px-2.5 py-1 rounded">Approve</button>
                <button onclick="updateVisitStatus(${i}, 'Declined')" class="bg-slate-200 hover:bg-slate-300 text-slate-700 text-[10px] font-bold px-2 py-1 rounded">Decline</button>
            </td>
        </tr>
    `).join('');

    // 2. Payments & SMS Table
    const pTable = document.getElementById('adminPaymentsTable');
    pTable.innerHTML = paymentRecords.map((p, idx) => `
        <tr class="hover:bg-slate-50 transition">
            <td class="p-3">
                <strong class="text-slate-900 font-bold block">${p.tenantName}</strong>
                <span class="text-[10px] text-slate-400 font-mono">${p.phone}</span>
            </td>
            <td class="p-3 text-slate-700 font-medium">${p.unitName}</td>
            <td class="p-3 font-bold text-slate-900">${p.amountDue}</td>
            <td class="p-3 font-mono text-[11px] text-slate-600">${p.dueDate}</td>
            <td class="p-3">
                <span class="px-2.5 py-1 rounded-full text-[10px] font-bold ${p.status === 'Paid' ? 'bg-emerald-100 text-emerald-800' : p.status === 'Overdue' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800'}">
                    ${p.status}
                </span>
            </td>
            <td class="p-3 text-right space-x-1">
                <button onclick="sendSMSPaymentReminder('${p.tenantName}', '${p.phone}', '${p.amountDue}', '${p.dueDate}')" class="bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-bold px-2.5 py-1 rounded shadow-sm">
                    <i class="fa-solid fa-paper-plane mr-1"></i> Send SMS Notice
                </button>
                <button onclick="togglePaymentStatus(${idx})" class="bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-semibold px-2 py-1 rounded">
                    Toggle Status
                </button>
            </td>
        </tr>
    `).join('');

    // Update Badges
    document.getElementById('badgeVisitCount').innerText = visitationsList.length;
    document.getElementById('statPendingVisits').innerText = HomeboundStore.configured
        ? 'Demo' : visitationsList.filter(v => v.status.includes('Pending') || v.status.includes('Hold')).length;
    
    const overdueCount = paymentRecords.filter(p => p.status === 'Overdue').length;
    document.getElementById('badgeOverdueCount').innerText = overdueCount;
    document.getElementById('statOverdueCount').innerText = HomeboundStore.configured ? 'Demo' : overdueCount;
}

function updateVisitStatus(idx, newStatus) {
    visitationsList[idx].status = newStatus;
    renderAdminTables();
    showToast(`Visitation request updated to '${newStatus}'`, 'info');
}

function togglePaymentStatus(idx) {
    const current = paymentRecords[idx].status;
    paymentRecords[idx].status = current === 'Paid' ? 'Pending' : current === 'Pending' ? 'Overdue' : 'Paid';
    renderAdminTables();
    showToast('Payment record updated', 'info');
}

// Simulated SMS Payment Dispatcher
function sendSMSPaymentReminder(tenant, phone, amount, due) {
    const smsMessage = `[DormPulse Payment Notice] Hi ${tenant}, this is a gentle reminder that your rental balance of ${amount} for unit is due on ${due}. Please settle directly with your dorm owner. Thank you!`;
    
    showToast(`Demo SMS preview (NOT sent) for ${phone}: "${smsMessage}"`, 'info');
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
    document.getElementById('listingLat').value = '14.6055';
    document.getElementById('listingLng').value = '120.9885';
    document.getElementById('listingOwner').value = activeOwner?.name || '';
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
    const fields = {
        listingTitle: d.title, listingType: d.type, listingLocation: d.locationZone,
        listingDistance: d.distance, listingLat: d.lat, listingLng: d.lng,
        listingOwner: d.ownerName, listingPhone: d.ownerPhone, listingImage: d.mainImage
    };
    for (const [id, value] of Object.entries(fields)) {
        document.getElementById(id).value = value ?? '';
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
    el.className = 'listing-room-form bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3';
    el.innerHTML = `
        <div class="flex items-center justify-between">
          <strong class="text-slate-800">Room / Unit ${index}</strong>
          <button type="button" onclick="removeListingRoom(${index})" class="text-rose-700 font-semibold">Remove room</button>
        </div>
        <div class="grid sm:grid-cols-2 gap-3">
          <label class="font-semibold">Room Name *<input class="input-editor room-name" required value="${escHtml(room.name || '')}" placeholder="Room 101 - Twin Sharing"></label>
          <label class="font-semibold">Monthly Price (PHP) *<input class="input-editor room-price" type="number" min="0" step="0.01" required value="${Number(room.price || 0)}"></label>
          <label class="font-semibold">Capacity *<input class="input-editor room-capacity" required value="${escHtml(room.capacity || '')}" placeholder="4 Bedspaces"></label>
          <label class="font-semibold">Availability *<input class="input-editor room-status" required value="${escHtml(room.status || 'Available')}" placeholder="Available (2 beds left) or Full / Occupied"></label>
          <label class="font-semibold sm:col-span-2">Image URLs (one https:// link per line)<textarea class="input-editor room-images" rows="2" placeholder="https://images.example.com/room.jpg">${escHtml((room.images || []).join('\n'))}</textarea></label>
          <label class="font-semibold sm:col-span-2">Amenities (comma separated)<input class="input-editor room-amenities" value="${escHtml((room.amenities || []).join(', '))}" placeholder="Wi-Fi, Aircon, Study Desk"></label>
        </div>`;
    container.appendChild(el);
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
        if (roomEls.length < 1) throw new Error('Please add at least one room.');
        const rooms = roomEls.map(el => {
            const read = klass => el.querySelector('.' + klass).value.trim();
            return {
                name: read('room-name'),
                price: Number(read('room-price')),
                capacity: read('room-capacity'),
                status: read('room-status'),
                images: read('room-images').split(/\r?\n/).map(s => s.trim()).filter(Boolean).map(parseHttpsImageUrl),
                amenities: read('room-amenities').split(',').map(s => s.trim()).filter(Boolean)
            };
        });
        if (rooms.some(r => !r.name || !r.capacity || !Number.isFinite(r.price) || r.price < 0)) {
            throw new Error('Every room must have a name, valid price, and capacity.');
        }
        const prices = rooms.map(room => room.price);
        const minPrice = Math.min(...prices);
        const maxPrice = Math.max(...prices);
        const lat = Number(field('listingLat'));
        const lng = Number(field('listingLng'));
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
            throw new Error('Provide valid map latitude and longitude.');
        }
        const mainImage = parseHttpsImageUrl(field('listingImage')) || rooms[0].images[0] || '';
        const payload = {
            title: field('listingTitle'), type: field('listingType'),
            locationZone: field('listingLocation'), distance: field('listingDistance'),
            lat, lng, ownerName: field('listingOwner'), ownerPhone: field('listingPhone'),
            mainImage, rooms, minPrice, maxPrice,
            priceRangeStr: minPrice === maxPrice
                ? `₱${minPrice.toLocaleString()} / mo`
                : `₱${minPrice.toLocaleString()} - ₱${maxPrice.toLocaleString()} / mo`,
            lastUpdated: 'Updated just now'
        };
        if (!payload.title || !payload.ownerName) throw new Error('A property title and owner name are required.');
        button.disabled = true;
        button.textContent = 'Saving...';
        if (editingListingId) {
            const index = dormsData.findIndex(d => d.id === editingListingId);
            if (index === -1) throw new Error('Listing no longer exists.');
            const prior = dormsData[index];
            const input = { ...prior, ...payload };
            const saved = HomeboundStore.configured ? await HomeboundStore.update(input) : input;
            dormsData[index] = saved;
        } else {
            const created = HomeboundStore.configured
                ? await HomeboundStore.create(payload)
                : { ...payload, id: `dorm-${Date.now()}` };
            dormsData.unshift(created);
        }
        closeModal('modalListingEditor');
        refreshListingViews();
        showToast('Property and room details saved successfully.', 'success');
    } catch (err) {
        showToast(`Could not save listing: ${err.message}`, 'error');
    } finally {
        button.disabled = false;
        button.textContent = 'Save Listing';
    }
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

function initAnalyticsCharts() {
    // 1. Seasonal Influx Bar Chart
    const ctxSeasonal = document.getElementById('chartSeasonalInflux').getContext('2d');
    new Chart(ctxSeasonal, {
        type: 'bar',
        data: {
            labels: ['Jun (Prep)', 'Jul (Pre-Sem)', 'Aug (Sem 1 Peak)', 'Sep (Enrollment)', 'Oct-Dec', 'Jan (Sem 2 Peak)', 'Summer'],
            datasets: [{
                label: 'Student Housing Inquiries / Intake',
                data: [120, 310, 850, 420, 180, 620, 210],
                backgroundColor: '#16a34a',
                borderRadius: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: { beginAtZero: true }
            }
        }
    });

    // 2. Room Type Share Doughnut Chart
    const ctxShare = document.getElementById('chartRoomShare').getContext('2d');
    new Chart(ctxShare, {
        type: 'doughnut',
        data: {
            labels: ['Quad Sharing Bedspace', 'Solo Studio Apartments', 'Twin Sharing Aircon', 'Non-Aircon Budget'],
            datasets: [{
                data: [45, 25, 20, 10],
                backgroundColor: ['#16a34a', '#0284c7', '#f59e0b', '#64748b']
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false
        }
    });
}

function printAnalyticsReport() {
    window.print();
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