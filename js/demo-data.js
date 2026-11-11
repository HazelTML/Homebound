/* Sample data is ONLY used when Supabase is not configured. */
// Standardized Sample Listings Data with Bedspace Granularity & Room Images
const sampleDormsData = [
    {
        id: "dorm-1",
        title: "UnivBelt Heights Student Residences",
        type: "Dormitory",
        locationZone: "Main Campus Gate 1",
        distance: "150m from Gate 1",
        priceRangeStr: "₱2,500 - ₱4,000 / mo",
        minPrice: 2500,
        maxPrice: 4000,
        lat: 14.6042,
        lng: 120.9882,
        ownerName: "Capt. Rodrigo Santos",
        ownerPhone: "+63 917 555 0192",
        lastUpdated: "Updated 1 hr ago",
        mainImage: "https://images.unsplash.com/photo-1555854877-bab0e564b8d5?auto=format&fit=crop&w=800&q=80",
        rooms: [
            {
                name: "Room 101 - Aircon Quad Bedspace",
                price: 2500,
                capacity: "4 Bedspaces",
                status: "Available (2 beds left)",
                images: [
                    "https://images.unsplash.com/photo-1555854877-bab0e564b8d5?auto=format&fit=crop&w=800&q=80",
                    "https://images.unsplash.com/photo-1595526114035-0d45ed16cfbf?auto=format&fit=crop&w=800&q=80"
                ],
                amenities: ["Free High-Speed Wi-Fi", "Aircon", "Study Desk", "Personal Locker", "CCTV Security"]
            },
            {
                name: "Room 202 - Private Solo Room",
                price: 4000,
                capacity: "1 Person",
                status: "Available",
                images: [
                    "https://images.unsplash.com/photo-1522771739844-6a9f6d5f14af?auto=format&fit=crop&w=800&q=80",
                    "https://images.unsplash.com/photo-1513694203232-719a280e022f?auto=format&fit=crop&w=800&q=80"
                ],
                amenities: ["Private Bathroom", "Aircon", "Balcony", "Fridge", "Study Desk"]
            }
        ]
    },
    {
        id: "dorm-2",
        title: "St. Thomas Female Bedspace Hub",
        type: "Bedspace",
        locationZone: "North Campus Area",
        distance: "300m from Science Complex",
        priceRangeStr: "₱1,800 - ₱2,800 / mo",
        minPrice: 1800,
        maxPrice: 2800,
        lat: 14.6090,
        lng: 120.9895,
        ownerName: "Mrs. Elena Cruz",
        ownerPhone: "+63 918 222 4910",
        lastUpdated: "Updated 3 hrs ago",
        mainImage: "https://images.unsplash.com/photo-1595526114035-0d45ed16cfbf?auto=format&fit=crop&w=800&q=80",
        rooms: [
            {
                name: "Room 3A - Non-Aircon 6-Bed Room",
                price: 1800,
                capacity: "6 Bedspaces",
                status: "Available (1 bed left)",
                images: [
                    "https://images.unsplash.com/photo-1595526114035-0d45ed16cfbf?auto=format&fit=crop&w=800&q=80",
                    "https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=800&q=80"
                ],
                amenities: ["Electric Fan", "Wi-Fi", "Shared T&B", "Biometric Gate Access"]
            },
            {
                name: "Room 3B - Aircon 4-Bed Room",
                price: 2800,
                capacity: "4 Bedspaces",
                status: "Available (3 beds left)",
                images: [
                    "https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=800&q=80",
                    "https://images.unsplash.com/photo-1555854877-bab0e564b8d5?auto=format&fit=crop&w=800&q=80"
                ],
                amenities: ["Aircon", "Personal Closets", "Filtered Drinking Water"]
            }
        ]
    },
    {
        id: "dorm-3",
        title: "CampusEdge Studio Apartments",
        type: "Apartment",
        locationZone: "East University Avenue",
        distance: "2 min walk to LRT/Campus",
        priceRangeStr: "₱6,000 - ₱9,500 / mo",
        minPrice: 6000,
        maxPrice: 9500,
        lat: 14.6015,
        lng: 120.9920,
        ownerName: "Engr. Marco Valdes",
        ownerPhone: "+63 920 888 1234",
        lastUpdated: "Updated 30 mins ago",
        mainImage: "https://images.unsplash.com/photo-1522771739844-6a9f6d5f14af?auto=format&fit=crop&w=800&q=80",
        rooms: [
            {
                name: "Unit 402 - Executive Deluxe Studio",
                price: 7500,
                capacity: "Max 2 Persons",
                status: "Available",
                images: [
                    "https://images.unsplash.com/photo-1522771739844-6a9f6d5f14af?auto=format&fit=crop&w=800&q=80",
                    "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=800&q=80"
                ],
                amenities: ["Kitchenette", "Private Bathroom", "Fiber Wi-Fi", "Keycard Entry", "Study Area"]
            }
        ]
    },
    {
        id: "dorm-4",
        title: "Scholar's Haven Dormitory & Study Lounge",
        type: "Dormitory",
        locationZone: "West Student Village",
        distance: "400m from Library",
        priceRangeStr: "₱3,200 - ₱4,800 / mo",
        minPrice: 3200,
        maxPrice: 4800,
        lat: 14.6065,
        lng: 120.9840,
        ownerName: "Dorm Management Corp.",
        ownerPhone: "+63 905 111 7788",
        lastUpdated: "Updated 5 hrs ago",
        mainImage: "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=800&q=80",
        rooms: [
            {
                name: "Room 205 - Twin Aircon Room",
                price: 3500,
                capacity: "2 Bedspaces",
                status: "Available (1 bed left)",
                images: [
                    "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=800&q=80",
                    "https://images.unsplash.com/photo-1513694203232-719a280e022f?auto=format&fit=crop&w=800&q=80"
                ],
                amenities: ["24/7 Study Lounge Access", "Aircon", "Hot Shower", "Generator Backed"]
            }
        ]
    },
    {
        id: "dorm-5",
        title: "Verdant Garden Co-Living Bedspaces",
        type: "Bedspace",
        locationZone: "Main Campus Gate 1",
        distance: "100m from Gate 1",
        priceRangeStr: "₱2,200 - ₱3,100 / mo",
        minPrice: 2200,
        maxPrice: 3100,
        lat: 14.6035,
        lng: 120.9870,
        ownerName: "Alfonso Ramos",
        ownerPhone: "+63 916 444 3322",
        lastUpdated: "Updated 10 mins ago",
        mainImage: "https://images.unsplash.com/photo-1513694203232-719a280e022f?auto=format&fit=crop&w=800&q=80",
        rooms: [
            {
                name: "Garden Suite Bedspace",
                price: 2400,
                capacity: "4 Bedspaces",
                status: "Available",
                images: [
                    "https://images.unsplash.com/photo-1513694203232-719a280e022f?auto=format&fit=crop&w=800&q=80"
                ],
                amenities: ["Lush Courtyard", "High Speed Internet", "Cooking Allowed", "Laundry Area"]
            }
        ]
    },
    {
        id: "dorm-6",
        title: "Metro Student Suites - Tower B",
        type: "Apartment",
        locationZone: "North Campus Area",
        distance: "500m from Engineering Building",
        priceRangeStr: "₱5,500 - ₱8,000 / mo",
        minPrice: 5500,
        maxPrice: 8000,
        lat: 14.6110,
        lng: 120.9910,
        ownerName: "Metro Residences Inc.",
        ownerPhone: "+63 928 999 0011",
        lastUpdated: "Updated 1 day ago",
        mainImage: "https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=800&q=80",
        rooms: [
            {
                name: "Studio 12B - Semi Furnished",
                price: 6000,
                capacity: "2-3 Persons",
                status: "Available",
                images: [
                    "https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=800&q=80"
                ],
                amenities: ["Elevator", "24/7 Security Guards", "In-unit Kitchenette", "Sub-metered Power"]
            }
        ]
    }
];

// Student Visitation & Hold Requests (Admin Monitoring Store)
let visitationsList = [
    {
        id: "V-101",
        studentName: "Maria Clara Santos",
        studentPhone: "09171234567",
        studentEmail: "maria@student.univ.edu.ph",
        dormTitle: "UnivBelt Heights Student Residences",
        roomName: "Room 101 - Aircon Quad Bedspace",
        visitDate: "2026-10-02",
        visitSlot: "10:00 AM",
        status: "Pending Approval"
    },
    {
        id: "V-102",
        studentName: "Jose Rizal",
        studentPhone: "09189876543",
        studentEmail: "jrizal@student.univ.edu.ph",
        dormTitle: "CampusEdge Studio Apartments",
        roomName: "Unit 402 - Executive Deluxe Studio",
        visitDate: "2026-10-01",
        visitSlot: "02:00 PM",
        status: "Confirmed Visit"
    }
];

// Payment Tracker Data (No Actual Payment Gateway, strictly monitoring & SMS dispatch)
let paymentRecords = [
    {
        id: "PAY-01",
        tenantName: "Andres Bonifacio",
        phone: "09171112233",
        unitName: "UnivBelt Heights - Room 101 Bed A",
        amountDue: "₱2,500.00",
        dueDate: "2026-10-05",
        status: "Paid"
    },
    {
        id: "PAY-02",
        tenantName: "Emilio Aguinaldo",
        phone: "09184445566",
        unitName: "St. Thomas Hub - Room 3A Bed 2",
        amountDue: "₱1,800.00",
        dueDate: "2026-09-25",
        status: "Overdue"
    },
    {
        id: "PAY-03",
        tenantName: "Apolinario Mabini",
        phone: "09207778899",
        unitName: "CampusEdge Studio - Unit 402",
        amountDue: "₱7,500.00",
        dueDate: "2026-09-28",
        status: "Overdue"
    },
    {
        id: "PAY-04",
        tenantName: "Melchora Aquino",
        phone: "09163332211",
        unitName: "Scholar's Haven - Room 205 Bed 1",
        amountDue: "₱3,500.00",
        dueDate: "2026-10-10",
        status: "Pending"
    }
]; 