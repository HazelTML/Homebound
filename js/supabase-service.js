/* Supabase data/auth adapter. The UI uses this only if credentials are supplied. */
const HomeboundStore = (() => {
    const config = window.HOMEBOUND_CONFIG || {};
    const url = (config.SUPABASE_URL || '').trim();
    const key = (config.SUPABASE_PUBLISHABLE_KEY || '').trim();
    const configured = Boolean(url && key);
    let client = null;
    let liveChannel = null;

    function getClient() {
        if (!configured) throw new Error('Supabase is not configured.');
        if (!client) {
            if (!window.supabase || !window.supabase.createClient) {
                throw new Error('Supabase SDK did not load. Check your internet connection.');
            }
            client = window.supabase.createClient(url, key);
        }
        return client;
    }

    function rowToDorm(row) {
        const rooms = Array.isArray(row.rooms) ? row.rooms : [];
        return {
            id: row.id,
            ownerId: row.owner_id,
            title: row.title,
            type: row.type,
            locationZone: row.location_zone,
            distance: row.distance || '',
            minPrice: Number(row.min_price),
            maxPrice: Number(row.max_price),
            priceRangeStr: row.price_range_str || `₱${Number(row.min_price).toLocaleString()} - ₱${Number(row.max_price).toLocaleString()} / mo`,
            lat: Number(row.lat),
            lng: Number(row.lng),
            ownerName: row.owner_name,
            ownerPhone: row.owner_phone || '',
            mainImage: row.main_image || '',
            lastUpdated: row.updated_at ? `Updated ${new Date(row.updated_at).toLocaleString()}` : 'Updated recently',
            rooms: rooms.map(r => ({
                name: String(r.name || ''),
                price: Number(r.price || 0),
                capacity: String(r.capacity || ''),
                status: String(r.status || 'Available'),
                images: Array.isArray(r.images) ? r.images : [],
                amenities: Array.isArray(r.amenities) ? r.amenities : []
            }))
        };
    }

    function dormToRow(dorm) {
        return {
            title: dorm.title,
            type: dorm.type,
            location_zone: dorm.locationZone,
            distance: dorm.distance,
            min_price: dorm.minPrice,
            max_price: dorm.maxPrice,
            price_range_str: dorm.priceRangeStr,
            lat: dorm.lat,
            lng: dorm.lng,
            owner_name: dorm.ownerName,
            owner_phone: dorm.ownerPhone,
            main_image: dorm.mainImage,
            rooms: dorm.rooms
        };
    }

    async function list() {
        const { data, error } = await getClient().from('listings')
            .select('*').order('updated_at', { ascending: false });
        if (error) throw error;
        return (data || []).map(rowToDorm);
    }

    async function currentOwner() {
        const api = getClient();
        const { data: authData, error: authError } = await api.auth.getUser();
        if (authError && !authData?.user) return null;
        const user = authData?.user;
        if (!user) return null;
        const { data, error } = await api.from('landlords')
            .select('user_id, display_name').eq('user_id', user.id).maybeSingle();
        if (error) throw error;
        if (!data) return null;
        return { id: user.id, email: user.email, name: data.display_name || user.email };
    }

    async function login(email, password) {
        const api = getClient();
        const { error } = await api.auth.signInWithPassword({ email, password });
        if (error) throw error;
        const owner = await currentOwner();
        if (!owner) {
            await api.auth.signOut();
            throw new Error('This account is not approved as a Homebound landlord.');
        }
        return owner;
    }

    async function logout() {
        const { error } = await getClient().auth.signOut();
        if (error) throw error;
    }

    async function create(dorm) {
        const owner = await currentOwner();
        if (!owner) throw new Error('Please log in as an approved landlord.');
        // owner_id is assigned by the database default auth.uid(); RLS checks ownership.
        const { data, error } = await getClient().from('listings')
            .insert(dormToRow(dorm)).select('*').single();
        if (error) throw error;
        return rowToDorm(data);
    }

    async function update(dorm) {
        const owner = await currentOwner();
        if (!owner) throw new Error('Please log in as an approved landlord.');
        const { data, error } = await getClient().from('listings')
            .update(dormToRow(dorm))
            .eq('id', dorm.id).eq('owner_id', owner.id)
            .select('*').single();
        if (error) throw error;
        return rowToDorm(data);
    }

    async function remove(id) {
        const owner = await currentOwner();
        if (!owner) throw new Error('Please log in as an approved landlord.');
        const { data, error } = await getClient().from('listings')
            .delete().eq('id', id).eq('owner_id', owner.id)
            .select('id').single();
        if (error) throw error;
        return data.id;
    }

    function subscribe(onChange) {
        if (!configured || liveChannel) return;
        liveChannel = getClient().channel('homebound-listing-changes')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'listings' }, onChange)
            .subscribe();
    }

    function unsubscribe() {
        if (!liveChannel) return;
        getClient().removeChannel(liveChannel);
        liveChannel = null;
    }

    return { configured, getClient, list, currentOwner, login, logout,
        create, update, remove, subscribe, unsubscribe };
})();