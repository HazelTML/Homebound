/* Browser Supabase adapter: publishing, photo uploads, holds and owner/student messaging. */
const HomeboundStore = (() => {
    const config = window.HOMEBOUND_CONFIG || {};
    const url = (config.SUPABASE_URL || '').trim();
    const key = (config.SUPABASE_PUBLISHABLE_KEY || '').trim();
    const configured = Boolean(url && key);
    let client = null, liveChannel = null;

    function getClient() {
        if (!configured) throw new Error('Supabase is not configured.');
        if (!client) {
            if (!window.supabase?.createClient) throw new Error('Supabase SDK did not load.');
            // Keep the landlord login only in memory for this page load.
            // Refreshing or closing the page requires a new email/password login,
            // while saved listings, tenants, payments and messages remain in Supabase.
            client = window.supabase.createClient(url, key, {
                auth: {
                    persistSession: false
                }
            });
        }
        return client;
    }
    function rowToDorm(row) {
        return {
            id: row.id, ownerId: row.owner_id, title: row.title, type: row.type,
            locationZone: row.location_zone, distance: row.distance || '',
            note: row.note || '',
            minPrice: Number(row.min_price), maxPrice: Number(row.max_price),
            priceRangeStr: row.price_range_str || `₱${Number(row.min_price).toLocaleString()} - ₱${Number(row.max_price).toLocaleString()} / mo`,
            lat: row.lat == null ? null : Number(row.lat),
            lng: row.lng == null ? null : Number(row.lng),
            ownerName: row.owner_name, ownerPhone: row.owner_phone || '',
            mainImage: row.main_image || '',
            lastUpdated: row.updated_at ? `Updated ${new Date(row.updated_at).toLocaleString()}` : 'Updated recently',
            rooms: (Array.isArray(row.rooms) ? row.rooms : []).map(r => ({
                name: String(r.name || ''), price: Number(r.price || 0),
                capacity: String(r.capacity || ''), status: String(r.status || 'Available'),
                totalCapacity: Number(r.totalCapacity) || null,
                beds: Array.isArray(r.beds) ? r.beds.map(b => ({ id: String(b.id), status: String(b.status), ...(b.availableFrom ? { availableFrom:String(b.availableFrom) } : {}),
                    ...(b.reservedFor ? { reservedFor:String(b.reservedFor) } : {}) })) : [],
                images: Array.isArray(r.images) ? r.images : [],
                amenities: Array.isArray(r.amenities) ? r.amenities : [], note: String(r.note || '')
            }))
        };
    }
    function dormToRow(dorm) {
        return {
            title: dorm.title, type: dorm.type, location_zone: dorm.locationZone,
            distance: dorm.distance || '', note: dorm.note || '',
            min_price: dorm.minPrice, max_price: dorm.maxPrice,
            price_range_str: dorm.priceRangeStr, lat: dorm.lat ?? null,
            lng: dorm.lng ?? null, owner_name: dorm.ownerName,
            owner_phone: dorm.ownerPhone || '', main_image: dorm.mainImage || '', rooms: dorm.rooms
        };
    }
    async function list() {
        const { data, error } = await getClient().from('listings').select('*').order('updated_at', { ascending: false });
        if (error) throw error;
        return (data || []).map(rowToDorm);
    }
    async function currentOwner() {
        const api = getClient();
        const { data: auth, error } = await api.auth.getUser();
        if (error && !auth?.user) return null;
        const user = auth?.user;
        if (!user) return null;
        const { data, error: approvalError } = await api.from('landlords')
            .select('user_id,display_name').eq('user_id', user.id).maybeSingle();
        if (approvalError) throw approvalError;
        return data ? { id: user.id, email: user.email, name: data.display_name || user.email } : null;
    }
    async function login(email, password) {
        const api = getClient();
        const { error } = await api.auth.signInWithPassword({ email, password });
        if (error) throw error;
        const owner = await currentOwner();
        if (!owner) { await api.auth.signOut(); throw new Error('Account is not approved as a Homebound landlord.'); }
        return owner;
    }
    async function logout() {
        const { error } = await getClient().auth.signOut();
        if (error) throw error;
    }
    async function create(dorm) {
        if (!await currentOwner()) throw new Error('Log in as an approved landlord.');
        const { data, error } = await getClient().from('listings').insert(dormToRow(dorm)).select('*').single();
        if (error) throw error;
        return rowToDorm(data);
    }
    async function update(dorm) {
        const owner = await currentOwner();
        if (!owner) throw new Error('Log in as an approved landlord.');
        const { data, error } = await getClient().from('listings').update(dormToRow(dorm))
            .eq('id', dorm.id).eq('owner_id', owner.id).select('*').single();
        if (error) throw error;
        return rowToDorm(data);
    }
    async function remove(id) {
        const owner = await currentOwner();
        if (!owner) throw new Error('Log in as an approved landlord.');
        const { data, error } = await getClient().from('listings').delete()
            .eq('id', id).eq('owner_id', owner.id).select('id').single();
        if (error) throw error;
        return data.id;
    }
    // Upload actual File binaries to the landlord's secured Storage folder.
    async function uploadImage(file) {
        const owner = await currentOwner();
        if (!owner) throw new Error('Landlord session expired. Sign in again before uploading images.');
        if (!(file instanceof File)) throw new Error('Select an image file from your computer.');
        const supported = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
        if (!supported[file.type]) throw new Error('Select a JPG, PNG or WEBP image.');
        if (file.size < 1 || file.size > 5 * 1024 * 1024)
            throw new Error('An image must be no larger than 5 MB and cannot be empty.');
        // Never use the original user-controlled filename as a storage path.
        const randomId = typeof crypto?.randomUUID === 'function'
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const path = `${owner.id}/${randomId}.${supported[file.type]}`;
        let savedPath;
        try {
            const { data, error } = await getClient().storage.from('listing-images').upload(path, file, {
                contentType: file.type,
                cacheControl: '3600',
                upsert: false
            });
            if (error) throw error;
            savedPath = data?.path;
            if (!savedPath) throw new Error('Supabase Storage did not confirm the photo upload.');
        } catch (error) {
            const message = String(error?.message || 'Unknown upload error');
            const status = Number(error?.statusCode || error?.status || 0);
            if (/failed to fetch|networkerror|load failed|fetch failed/i.test(message) || error instanceof TypeError) {
                throw new Error('Cannot reach Supabase Storage. Confirm the Project URL and internet connection; inspect the browser Network tab for a blocked storage/v1 request.');
            }
            if (status === 401 || status === 403 || /row.level.security|permission|unauthorized|forbidden/i.test(message)) {
                throw new Error('Supabase rejected the upload. Verify that you are signed in, the landlord is approved, and the listing-images Storage INSERT policy allows your user ID folder.');
            }
            if (status === 404 || /bucket not found/i.test(message)) {
                throw new Error('Storage bucket listing-images does not exist. Run the current schema.sql or create the bucket with the required policies.');
            }
            if (status === 413 || /too large|exceeds.*size/i.test(message)) {
                throw new Error('The image exceeds the Supabase Storage file-size limit of 5 MB.');
            }
            throw new Error(`Supabase Storage upload failed: ${message}${status ? ` (HTTP ${status})` : ''}`);
        }
        const { data } = getClient().storage.from('listing-images').getPublicUrl(savedPath);
        if (!data?.publicUrl?.startsWith('https://'))
            throw new Error('The image uploaded, but its public URL could not be generated. Check the listing-images bucket settings.');
        return data.publicUrl;
    }
    async function callRpc(name, params) {
        const { data, error } = await getClient().rpc(name, params);
        if (error) throw error;
        return data;
    }
    async function createHold(payload) {
        return callRpc('homebound_create_hold_with_chat', {
            p_listing_id: payload.dormId, p_room_name: payload.roomName,
            p_student_name: payload.studentName, p_student_phone: payload.phone,
            p_student_email: payload.email, p_visit_date: payload.visitDate,
            p_visit_time: payload.visitTime, p_request_token: payload.token,
            p_chat_token: payload.chatToken,
            p_conversation_id: payload.conversationId || null
        });
    }
    const bookedVisitSlots = (listingId, visitDate) => callRpc('homebound_booked_visit_slots', { p_listing_id: listingId, p_visit_date: visitDate });
    const completeVisit = (id) => callRpc('homebound_complete_visit', { p_id: id });
    const getHold = (id, token) => callRpc('homebound_get_hold', { p_id: id, p_token: token });
    const cancelHold = (id, token) => callRpc('homebound_cancel_hold', { p_id: id, p_token: token });
    async function setHoldStatus(id, status) {
        try {
            return await callRpc('homebound_owner_set_hold_status', { p_id: id, p_status: status });
        } catch (err) {
            if (err?.code === '23505')
                throw new Error('Another student already has a confirmed visit at that hour. Decline or reschedule this request.');
            throw err;
        }
    }
    async function listHolds() {
        const { data, error } = await getClient().from('hold_requests').select('*').order('created_at', { ascending: false });
        if (error) throw error;
        return (data || []).map(h => ({ ...h, status: h.status === 'Pending Approval' && new Date(h.expires_at).getTime() < Date.now() ? 'Expired' : h.status }));
    }
    async function studentSend(listingId, conversationId, token, message) {
        return callRpc('homebound_student_send', {
            p_listing_id: listingId, p_conversation_id: conversationId || null,
            p_token: token, p_message: message
        });
    }
    const studentMessages = (id, token) => callRpc('homebound_student_messages', { p_id: id, p_token: token });
    async function listConversations() {
        const { data, error } = await getClient().from('chat_conversations')
            .select('id,listing_id,owner_id,created_at,updated_at,listings(title)')
            .order('updated_at', { ascending: false });
        if (error) throw error;
        return data || [];
    }
    async function ownerMessages(conversationId) {
        const { data, error } = await getClient().from('chat_messages').select('*')
            .eq('conversation_id', conversationId).order('created_at', { ascending: true }).limit(200);
        if (error) throw error;
        return data || [];
    }
    async function ownerReply(conversationId, text) {
        const { error } = await getClient().from('chat_messages').insert({
            conversation_id: conversationId, sender: 'owner', body: text
        });
        if (error) throw error;
    }
    // Owner-only tenant assignments; all writes use checked PostgreSQL RPCs.
    async function listTenancies() {
        const { data, error } = await getClient().from('tenancies').select('*')
            .order('created_at', { ascending: false });
        if (error) throw error;
        return data || [];
    }
    async function assignTenant(payload) {
        return callRpc('homebound_assign_bed_with_moveout', {
            p_listing_id: payload.listingId, p_room_name: payload.roomName,
            p_bed_slot: payload.bedSlot,
            p_tenant_name: payload.tenantName, p_phone: payload.phone,
            p_email: payload.email || '', p_start_date: payload.startDate,
            p_due_day: payload.dueDay, p_monthly_rent: payload.monthlyRent,
            p_hold_id: payload.holdId || null,
            p_planned_end_date: payload.plannedEndDate
        });
    }
    const setBedAvailable = (listingId, roomName, bedSlot, available) => callRpc('homebound_set_bed_available', {
        p_listing_id: listingId, p_room_name: roomName, p_bed_slot: bedSlot, p_available: available
    });
    const endTenancy = id => callRpc('homebound_end_tenancy', { p_tenancy_id: id });
    const syncRentPayments = () => callRpc('homebound_sync_payments', {});
    async function listRentPayments() {
        const { data, error } = await getClient().from('rent_payments').select('*')
            .order('due_date', { ascending: false });
        if (error) throw error;
        return data || [];
    }
    const setRentPaid = (id, paid) => callRpc('homebound_mark_payment', {
        p_payment_id: id, p_paid: paid
    });
    // Separate advance reservations (future move-in) from 24-hour visitation holds.
    async function createAdvanceReservation(payload) {
        return callRpc('homebound_request_reservation_chat', {
            p_listing_id:payload.listingId, p_room_name:payload.roomName,
            p_bed_slot:payload.bedSlot, p_start:payload.moveIn, p_end:payload.moveOut,
            p_student_name:payload.studentName, p_student_phone:payload.phone,
            p_student_email:payload.email, p_token:payload.token,
            p_chat_token:payload.chatToken, p_conversation_id:payload.conversationId || null
        });
    }
    const calendarDates=(listingId,roomName,bedSlot,month)=>callRpc('homebound_calendar_dates',{
        p_listing_id:listingId,p_room_name:roomName,p_bed_slot:bedSlot,p_month:`${month}-01`
    });
    const calendarCheck=(listingId,roomName,bedSlot,start,end)=>callRpc('homebound_calendar_check',{
        p_listing_id:listingId,p_room_name:roomName,p_bed_slot:bedSlot,p_start:start,p_end:end
    });
    const getAdvanceStatus=(id,token)=>callRpc('homebound_advance_status',{p_id:id,p_token:token});
    async function listAdvanceReservations() {
        const {data,error}=await getClient().from('advance_reservations').select('*').order('created_at',{ascending:false}).limit(200);
        if(error) throw error;
        return data||[];
    }
    const reviewReservation=(payload)=>callRpc('homebound_review_reservation',{
        p_id:payload.id,p_action:payload.action,p_monthly_rent:payload.monthlyRent??null,
        p_due_day:payload.dueDay??null,p_offer_start:payload.offerStart||null,
        p_offer_end:payload.offerEnd||null,p_message:payload.note||null
    });
    const respondReservationOffer=(id,token,accept)=>callRpc('homebound_respond_reservation_offer',{
        p_id:id,p_token:token,p_accept:Boolean(accept)
    });
    const activateDueReservations=()=>callRpc('homebound_activate_due_reservations',{});
    const finalizeReservationRent=(id,monthlyRent,dueDay)=>callRpc('homebound_finalize_reservation_rent',{
        p_id:id,p_monthly_rent:monthlyRent,p_due_day:dueDay
    });
    const setAdvanceStatus=(id,status)=>reviewReservation({id,action:status});
    const setPlannedEndDate=(id,date)=>callRpc('homebound_set_expected_moveout',{p_tenancy_id:id,p_date:date||null});
    async function listAnnouncements() {
        const {data,error}=await getClient().from('tenant_announcements').select('id,title,body,listing_id,created_at')
            .order('created_at',{ascending:false}).limit(80);
        if(error) throw error;
        return data||[];
    }
    const publishAnnouncement=(listingId,title,body,isPublic=false)=>callRpc('homebound_publish_announcement_v2',{
        p_listing_id:listingId,p_title:title,p_body:body,p_is_public:Boolean(isPublic)
    });
    const publicAnnouncements=()=>callRpc('homebound_public_announcements',{});
    const tenantAnnouncements=(token)=>callRpc('homebound_tenant_announcements',{p_token:token});
    function subscribe(onChange) {
        if (!configured || liveChannel) return;
        liveChannel = getClient().channel('homebound-changes')
            .on('postgres_changes', {event:'*',schema:'public',table:'listings'}, () => onChange('listings'))
            .on('postgres_changes', {event:'*',schema:'public',table:'chat_messages'}, () => onChange('messages'))
            .on('postgres_changes', {event:'*',schema:'public',table:'hold_requests'}, () => onChange('holds'))
            .on('postgres_changes', {event:'*',schema:'public',table:'tenancies'}, () => onChange('tenancies'))
            .on('postgres_changes', {event:'*',schema:'public',table:'rent_payments'}, () => onChange('payments'))
            .on('postgres_changes', {event:'*',schema:'public',table:'tenant_announcements'}, () => onChange('announcements'))
            .on('postgres_changes', {event:'*',schema:'public',table:'advance_reservations'}, () => onChange('advance_reservations'))
            .subscribe();
    }
    function unsubscribe() {
        if (!liveChannel) return;
        getClient().removeChannel(liveChannel);
        liveChannel = null;
    }
    return { configured, getClient, list, currentOwner, login, logout, create, update, remove,
        uploadImage, createHold, getHold, cancelHold, setHoldStatus, completeVisit, bookedVisitSlots, listHolds,
        studentSend, studentMessages, listConversations, ownerMessages, ownerReply,
        listTenancies, assignTenant, setBedAvailable, endTenancy, syncRentPayments, listRentPayments, setRentPaid,
        createAdvanceReservation,getAdvanceStatus,listAdvanceReservations,setAdvanceStatus,reviewReservation,respondReservationOffer,activateDueReservations,finalizeReservationRent,setPlannedEndDate,calendarDates,calendarCheck,
        listAnnouncements,publishAnnouncement,tenantAnnouncements,publicAnnouncements,
        subscribe, unsubscribe };
})();
