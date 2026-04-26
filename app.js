const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- KONFIGURACJA ŚRODOWISKA ---

// Automatyczne tworzenie folderu na zdjęcia, aby uniknąć błędów zapisu
const uploadDir = './uploads';
if (!fs.existsSync(uploadDir)){
    fs.mkdirSync(uploadDir);
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, 'img-' + Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage: storage });

app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// --- BAZA DANYCH W PAMIĘCI ---
let properties = [
    {
        id: 1,
        title: "Apartament z widokiem na morze",
        city: "Gdańsk",
        street: "Grunwaldzka",
        price: 850000,
        area: 55,
        description: "Piękny apartament blisko plaży.",
        image: "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=500",
        endDate: new Date(Date.now() + 86400000 * 2).toISOString(),
        offers: [ { amount: 860000, user: "Jan", time: "1h temu" } ]
    },
    {
        id: 2,
        title: "Dom pod lasem",
        city: "Kraków",
        street: "Leśna",
        price: 1200000,
        area: 140,
        description: "Cisza i spokój w prestiżowej okolicy.",
        image: "https://images.unsplash.com/photo-1580587771525-78b9dba3b914?w=500",
        endDate: new Date(Date.now() + 86400000 * 5).toISOString(),
        offers: []
    }
];

// --- API ---

// Pobieranie wszystkich ogłoszeń
app.get('/api/properties', (req, res) => {
    res.json(properties);
});

// Dodawanie nowej nieruchomości
app.post('/api/properties', upload.single('image'), (req, res) => {
    try {
        const { title, city, street, price, area, description, days } = req.body;
        
        const newProp = {
            id: Date.now(),
            title: title || "Bez tytułu",
            city: city || "Nieznane",
            street: street || "Brak ulicy",
            price: Number(price) || 0,
            area: Number(area) || 0,
            description: description || "",
            image: (req.file && req.file.filename) ? `/uploads/${req.file.filename}` : "https://via.placeholder.com/500",
            endDate: new Date(Date.now() + 86400000 * (Number(days) || 7)).toISOString(),
            offers: []
        };

        properties.unshift(newProp);
        io.emit('list_updated', properties);
        res.json({ success: true, property: newProp });
    } catch (error) {
        res.status(500).json({ error: "Błąd serwera przy dodawaniu ogłoszenia." });
    }
});

// Składanie oferty
app.post('/api/offer/:id', (req, res) => {
    const prop = properties.find(p => p.id == req.params.id);
    if (!prop) return res.status(404).json({ error: "Nie znaleziono ogłoszenia." });

    const { amount, nickname } = req.body;
    const currentMax = prop.offers.length > 0 ? prop.offers[0].amount : prop.price;

    if (Number(amount) <= currentMax) {
        return res.status(400).json({ error: `Twoja oferta musi być wyższa niż ${currentMax.toLocaleString()} PLN!` });
    }

    prop.offers.unshift({ 
        amount: Number(amount), 
        user: nickname || "Anonim", 
        time: new Date().toLocaleTimeString() 
    });

    io.emit('list_updated', properties);
    res.json({ success: true });
});

// --- FRONTEND ---
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="pl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Marketplace Nieruchomości Live</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="/socket.io/socket.io.js"></script>
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
</head>
<body class="bg-gray-100 min-h-screen pb-20 font-sans">

    <nav class="bg-white shadow-md sticky top-0 z-50 p-4">
        <div class="max-w-7xl mx-auto space-y-4">
            <div class="flex justify-between items-center">
                <h1 class="text-2xl font-black text-blue-600 tracking-tighter italic">DOM-BID LIVE</h1>
                <button onclick="toggleAdmin()" class="bg-slate-800 text-white px-6 py-2 rounded-full text-sm font-bold shadow-lg hover:bg-slate-700 transition">
                    + WYSTAW OGŁOSZENIE
                </button>
            </div>

            <div class="grid grid-cols-2 md:grid-cols-6 gap-3 pt-2 border-t border-gray-100">
                <input id="fCity" oninput="filter()" placeholder="Miejscowość" class="p-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                <input id="fMinPrice" oninput="filter()" type="number" placeholder="Cena min" class="p-2 border border-gray-200 rounded-lg text-sm outline-none">
                <input id="fMaxPrice" oninput="filter()" type="number" placeholder="Cena max" class="p-2 border border-gray-200 rounded-lg text-sm outline-none">
                <input id="fMinArea" oninput="filter()" type="number" placeholder="Metraż min m²" class="p-2 border border-gray-200 rounded-lg text-sm outline-none">
                
                <select id="sSort" onchange="filter()" class="p-2 border border-gray-200 rounded-lg text-sm bg-blue-50 font-semibold outline-none cursor-pointer">
                    <option value="dateDesc">Najnowsze</option>
                    <option value="priceAsc">Cena: najniższa</option>
                    <option value="priceDesc">Cena: najwyższa</option>
                    <option value="endSoon">Kończące się</option>
                    <option value="popular">Najwięcej ofert</option>
                </select>
            </div>
        </div>
    </nav>

    <div id="adminModal" class="hidden fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
        <div class="bg-white rounded-3xl p-8 w-full max-w-xl shadow-2xl">
            <div class="flex justify-between items-center mb-6">
                <h2 class="text-2xl font-black text-slate-800">Nowe ogłoszenie</h2>
                <button onclick="toggleAdmin()" class="text-slate-400 hover:text-slate-600 text-2xl font-bold">✕</button>
            </div>
            <form id="addForm" class="grid grid-cols-2 gap-4">
                <input name="title" placeholder="Tytuł ogłoszenia" class="col-span-2 p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none" required>
                <input name="city" placeholder="Miasto" class="p-3 border border-gray-200 rounded-xl outline-none" required>
                <input name="street" placeholder="Ulica" class="p-3 border border-gray-200 rounded-xl outline-none" required>
                <input name="price" type="number" placeholder="Cena wywoławcza (PLN)" class="p-3 border border-gray-200 rounded-xl outline-none" required>
                <input name="area" type="number" placeholder="Metraż (m²)" class="p-3 border border-gray-200 rounded-xl outline-none" required>
                <input name="days" type="number" placeholder="Czas trwania (dni)" class="p-3 border border-gray-200 rounded-xl outline-none" value="7">
                <div class="col-span-1 flex flex-col">
                    <label class="text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">Zdjęcie nieruchomości</label>
                    <input type="file" name="image" class="text-xs text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100">
                </div>
                <textarea name="description" placeholder="Pełny opis nieruchomości..." class="col-span-2 p-3 border border-gray-200 rounded-xl h-24 outline-none"></textarea>
                <button type="submit" class="col-span-2 bg-blue-600 text-white p-4 rounded-2xl font-black text-lg hover:bg-blue-700 shadow-xl shadow-blue-200 transition-all active:scale-95">
                    WYSTAW NIERUCHOMOŚĆ
                </button>
            </form>
        </div>
    </div>

    <main id="mainList" class="max-w-7xl mx-auto mt-8 px-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        </main>

    <script>
        const socket = io();
        let allProperties = [];

        function toggleAdmin() { 
            document.getElementById('adminModal').classList.toggle('hidden'); 
        }

        socket.on('connect', () => {
            console.log("Połączono z serwerem WebSockets");
        });

        socket.on('init_properties', (data) => { 
            allProperties = data; 
            filter(); 
        });

        socket.on('list_updated', (data) => { 
            allProperties = data; 
            filter(); 
        });

        function filter() {
            let filtered = [...allProperties];
            
            const city = document.getElementById('fCity').value.toLowerCase();
            const minP = document.getElementById('fMinPrice').value;
            const maxP = document.getElementById('fMaxPrice').value;
            const minA = document.getElementById('fMinArea').value;

            if(city) filtered = filtered.filter(p => p.city.toLowerCase().includes(city));
            if(minP) filtered = filtered.filter(p => p.price >= minP);
            if(maxP) filtered = filtered.filter(p => p.price <= maxP);
            if(minA) filtered = filtered.filter(p => p.area >= minA);

            const sort = document.getElementById('sSort').value;
            if(sort === 'priceAsc') filtered.sort((a,b) => a.price - b.price);
            if(sort === 'priceDesc') filtered.sort((a,b) => b.price - a.price);
            if(sort === 'popular') filtered.sort((a,b) => b.offers.length - a.offers.length);
            if(sort === 'endSoon') filtered.sort((a,b) => new Date(a.endDate) - new Date(b.endDate));

            render(filtered);
        }

        function render(items) {
            const container = document.getElementById('mainList');
            if (items.length === 0) {
                container.innerHTML = '<div class="col-span-full text-center py-20 text-gray-400 font-bold">Brak ofert spełniających kryteria...</div>';
                return;
            }

            container.innerHTML = items.map(p => {
                const maxOffer = p.offers.length > 0 ? p.offers[0].amount : p.price;
                return \`
                <div class="bg-white rounded-3xl shadow-sm overflow-hidden border border-gray-100 hover:shadow-2xl hover:-translate-y-1 transition-all duration-300">
                    <div class="relative">
                        <img src="\${p.image}" class="w-full h-56 object-cover" onerror="this.src='https://via.placeholder.com/500x300?text=Brak+obrazu'">
                        <div class="absolute top-4 right-4 bg-white/90 backdrop-blur text-slate-800 px-3 py-1 rounded-full text-xs font-black shadow-sm">
                            \${p.area} m²
                        </div>
                    </div>
                    <div class="p-6">
                        <h3 class="font-black text-xl text-slate-800 truncate mb-1">\${p.title}</h3>
                        <p class="text-slate-400 text-sm mb-6 flex items-center">
                            <i class="fas fa-map-marker-alt mr-2 text-blue-500"></i> \${p.city}, ul. \${p.street}
                        </p>
                        
                        <div class="flex justify-between items-center mb-6 p-4 bg-slate-50 rounded-2xl">
                            <div>
                                <p class="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">Aktualna cena</p>
                                <p class="text-2xl font-black text-blue-600 leading-none">\${maxOffer.toLocaleString()} <span class="text-xs">PLN</span></p>
                            </div>
                            <div class="text-right">
                                <p class="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">Ofert: \${p.offers.length}</p>
                                <p class="text-xs font-black text-orange-500 uppercase">Kończy się: \${new Date(p.endDate).toLocaleDateString()}</p>
                            </div>
                        </div>

                        <div class="flex gap-2">
                            <input id="in-\${p.id}" type="number" placeholder="Twoja cena" class="w-full p-3 border border-gray-200 rounded-xl text-sm font-bold outline-none focus:border-blue-500 transition">
                            <button onclick="bid(\${p.id})" class="bg-slate-800 text-white px-6 py-3 rounded-xl font-bold text-sm hover:bg-blue-600 transition shadow-lg active:scale-95">
                                LICYTUJ
                            </button>
                        </div>
                    </div>
                </div>\`;
            }).join('');
        }

        async function bid(id) {
            const input = document.getElementById('in-'+id);
            const val = input.value;
            const res = await fetch('/api/offer/'+id, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ amount: val, nickname: "Użytkownik" })
            });
            if(!res.ok) {
                const err = await res.json();
                alert(err.error);
            } else {
                input.value = '';
            }
        }

        document.getElementById('addForm').onsubmit = async (e) => {
            e.preventDefault();
            const res = await fetch('/api/properties', { 
                method: 'POST', 
                body: new FormData(e.target) 
            });
            if(res.ok) {
                toggleAdmin();
                e.target.reset();
            } else {
                alert("Błąd przy dodawaniu ogłoszenia.");
            }
        };

        // Pobierz dane na start
        fetch('/api/properties')
            .then(res => res.json())
            .then(data => { 
                allProperties = data; 
                filter(); 
            });
    </script>
</body>
</html>
    `);
});

// Port 8080 jest często lepiej obsługiwany przez platformy typu Sandbox
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`Serwer licytacji działa pod adresem: http://localhost:${PORT}`);
});

// Broadcastowanie przy wejściu nowego użytkownika
io.on('connection', (socket) => {
    socket.emit('init_properties', properties);
});
