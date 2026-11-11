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
            client = window.supabase.createClient(url, key);
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
    async function uploadImage(file) {
        const owner = await currentOwner();
        if (!owner) throw new Error('Please sign in to upload photos.');
        if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024)
            throw new Error('Images must be JPEG, PNG or WEBP and under 5MB.');
        const ext = ({'image/jpeg':'jpg','image/png':'png','image/webp':'webp'})[file.type];
        const filename = `${owner.id}/${crypto.randomUUID()}.${ext}`;
        const { error } = await getClient().storage.from('listing-images').upload(filename, file,
            { cacheControl: '3600', contentType: file.type, upsert: false });
        if (error) throw error;
        return getClient().storage.from('listing-images').getPublicUrl(filename).data.publicUrl;
    }
    async function callRpc(name, params) {
        const { data, error } = await getClient().rpc(name, params);
        if (error) throw error;
        return data;
    }
    async function createHold(payload) {
        return callRpc('homebound_create_hold', {
            p_listing_id: payload.dormId, p_room_name: payload.roomName,
            p_student_name: payload.studentName, p_student_phone: payload.phone,
            p_student_email: payload.email, p_visit_date: payload.visitDate,
            p_visit_time: payload.visitTime, p_request_token: payload.token
        });
    }
    const getHold = (id, token) => callRpc('homebound_get_hold', { p_id: id, p_token: token });
    const cancelHold = (id, token) => callRpc('homebound_cancel_hold', { p_id: id, p_token: token });
    const setHoldStatus = (id, status) => callRpc('homebound_owner_set_hold_status', { p_id: id, p_status: status });
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
        return callRpc('homebound_create_tenancy', {
            p_listing_id: payload.listingId, p_room_name: payload.roomName,
            p_tenant_name: payload.tenantName, p_phone: payload.phone,
            p_email: payload.email || '', p_start_date: payload.startDate,
            p_due_day: payload.dueDay, p_monthly_rent: payload.monthlyRent,
            p_hold_id: payload.holdId || null
        });
    }
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
    function subscribe(onChange) {
        if (!configured || liveChannel) return;
        liveChannel = getClient().channel('homebound-changes')
            .on('postgres_changes', {event:'*',schema:'public',table:'listings'}, () => onChange('listings'))
            .on('postgres_changes', {event:'*',schema:'public',table:'chat_messages'}, () => onChange('messages'))
            .on('postgres_changes', {event:'*',schema:'public',table:'hold_requests'}, () => onChange('holds'))
            .on('postgres_changes', {event:'*',schema:'public',table:'tenancies'}, () => onChange('tenancies'))
            .on('postgres_changes', {event:'*',schema:'public',table:'rent_payments'}, () => onChange('payments'))
            .subscribe();
    }
    function unsubscribe() {
        if (!liveChannel) return;
        getClient().removeChannel(liveChannel);
        liveChannel = null;
    }
    return { configured, getClient, list, currentOwner, login, logout, create, update, remove,
        uploadImage, createHold, getHold, cancelHold, setHoldStatus, listHolds,
        studentSend, studentMessages, listConversations, ownerMessages, ownerReply,
        listTenancies, assignTenant, endTenancy, syncRentPayments, listRentPayments, setRentPaid,
        subscribe, unsubscribe };
})();