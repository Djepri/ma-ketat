# 🚀 IHSG MA Ketat Scanner — Server Version

Scanner saham IHSG dengan metode **MA Menguncup (MA Ketat)** sesuai artikel.  
Menggunakan Node.js server sebagai **proxy backend** untuk fetch data Yahoo Finance,  
sehingga **tidak ada masalah CORS** yang terjadi di browser.

---

## ✅ Tidak butuh npm install apapun!
Server ini hanya menggunakan **Node.js built-in modules**:
- `http` — HTTP server
- `https` — Fetch Yahoo Finance dari server
- `fs` — Serve static files
- `path`, `url` — Routing

---

## 🔧 Cara Menjalankan

### 1. Pastikan Node.js terinstall
```bash
node --version   # butuh v14+
```

### 2. Clone / ekstrak folder ini, lalu jalankan:
```bash
node server.js
```

### 3. Buka browser:
```
http://localhost:3000
```

---

## 📁 Struktur Folder
```
ihsg-scanner/
├── server.js        ← Backend Node.js (proxy + static server)
└── public/
    └── index.html   ← Frontend UI
```

---

## ⚙️ Konfigurasi

Ubah PORT jika perlu:
```bash
PORT=8080 node server.js
```

---

## 📊 Metode MA Ketat

| Parameter       | Default | Keterangan                              |
|-----------------|---------|----------------------------------------|
| Max Ticks       | 6       | Jarak max antar MA dalam satuan tick   |
| Max Vol%        | 3.8%    | Volatilitas harian rolling 10 hari     |
| Min Volume      | 1 juta  | Filter likuiditas                      |
| MA100 ≤ Close   | Ya      | Konteks bullish (price di atas MA100)  |

### Tick Size BEI (Piecewise):
| Harga        | Tick Size |
|--------------|-----------|
| < 200        | 1         |
| 200–500      | 2         |
| 500–2000     | 5         |
| 2000–5000    | 10        |
| ≥ 5000       | 25        |

### Formula:
```
range_ticks = (MA_max - MA_min) / tick_size(Close)
vol_pct     = StdDev(daily_return, 10 hari) × 100%
ma_tight    = range_ticks < 6 AND vol_pct < 3.8
signal_ok   = ma_tight AND volume > 1jt AND Close ≥ MA100
```

---

## 🔌 API Endpoint

```
GET /api/scan?ticker=BBCA&maxTicks=6&maxVol=3.8&minVolume=1000000&reqBullish=true
```

Response:
```json
{
  "ok": true,
  "data": {
    "ticker": "BBCA",
    "companyName": "Bank Central Asia",
    "price": 9275,
    "changePct": 0.54,
    "rangeTicks": 3.2,
    "volPct": 1.8,
    "isTight": true,
    "isLiquid": true,
    "isBullish": true,
    "signalOk": true,
    "tableRows": [...]
  }
}
```
