/**
 * IHSG MA Ketat Scanner - Server
 * Node.js pure built-in (no npm required)
 * 
 * Usage: node server.js
 * Open: http://localhost:3000
 */

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const url   = require('url');

const PORT = process.env.PORT || 3000;

// ─── Mime types ───────────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.ico':  'image/x-icon',
};

// ─── Proxy fetch Yahoo Finance ─────────────────────────────────────────────
function yahooFetch(symbol) {
  return new Promise((resolve, reject) => {
    const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=6mo`;
    
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
      }
    };

    const req = https.get(yahooUrl, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch(e) {
          reject(new Error('Parse error: ' + e.message));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
  });
}

// ─── Tick Size BEI ────────────────────────────────────────────────────────
function getTickSize(price) {
  if (price < 200)  return 1;
  if (price < 500)  return 2;
  if (price < 2000) return 5;
  if (price < 5000) return 10;
  return 25;
}

// ─── SMA ──────────────────────────────────────────────────────────────────
function sma(arr, n) {
  if (!arr || arr.length < n) return null;
  const slice = arr.slice(-n);
  return slice.reduce((a, b) => a + b, 0) / n;
}

// ─── EMA ──────────────────────────────────────────────────────────────────
function ema(arr, n) {
  if (!arr || arr.length === 0) return 0;
  const k = 2 / (n + 1);
  let e = arr[0];
  for (let i = 1; i < arr.length; i++) e = arr[i] * k + e * (1 - k);
  return e;
}

// ─── Rolling Std Dev ──────────────────────────────────────────────────────
function rollingStd(arr, n) {
  if (!arr || arr.length < 2) return 0;
  const slice = arr.slice(-Math.min(n, arr.length));
  const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
  const variance = slice.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / slice.length;
  return Math.sqrt(variance);
}

// ─── Stochastic ───────────────────────────────────────────────────────────
function stochastic(highs, lows, closes, k = 14, d = 3) {
  if (!closes || closes.length < k) return { K: null, D: null };
  const rH = highs.slice(-k), rL = lows.slice(-k), rC = closes.slice(-k);
  const highest = Math.max(...rH), lowest = Math.min(...rL);
  const lastC = rC[rC.length - 1];
  const K = highest === lowest ? 50 : ((lastC - lowest) / (highest - lowest)) * 100;

  const ks = [];
  for (let i = Math.max(0, closes.length - d - k + 1); i <= closes.length - k; i++) {
    const h = highs.slice(i, i + k), l = lows.slice(i, i + k), c = closes.slice(i, i + k);
    const hi = Math.max(...h), lo = Math.min(...l), cl = c[c.length - 1];
    ks.push(hi === lo ? 50 : ((cl - lo) / (hi - lo)) * 100);
  }
  const D = ks.length >= 3 ? ks.slice(-3).reduce((a, b) => a + b, 0) / 3 : K;
  return { K: Math.round(K), D: Math.round(D) };
}

// ─── MACD ─────────────────────────────────────────────────────────────────
function calcMacd(closes) {
  if (!closes || closes.length < 26) return { macd: 0, signal: 0, histogram: 0 };
  const macdVals = [];
  for (let i = 26; i <= closes.length; i++) {
    macdVals.push(ema(closes.slice(0, i), 12) - ema(closes.slice(0, i), 26));
  }
  const macdLine  = macdVals[macdVals.length - 1];
  const sigLine   = ema(macdVals, 9);
  return {
    macd:      +macdLine.toFixed(2),
    signal:    +sigLine.toFixed(2),
    histogram: +(macdLine - sigLine).toFixed(2),
  };
}

// ─── Format date ──────────────────────────────────────────────────────────
function fmtDate(ts) {
  const d = new Date(ts * 1000);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}-${mm}-${d.getFullYear()}`;
}

// ─── Analyze stock from Yahoo data ────────────────────────────────────────
function analyzeStock(ticker, yahooData, params) {
  const result = yahooData.chart?.result?.[0];
  if (!result) return null;

  const timestamps = result.timestamp || [];
  const q = result.indicators?.quote?.[0];
  if (!q || timestamps.length < 55) return null;

  // Build valid candles
  const candles = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (q.close[i] && q.open[i] && q.high[i] && q.low[i] && q.volume[i]) {
      candles.push({
        ts: timestamps[i],
        open: q.open[i], high: q.high[i], low: q.low[i],
        close: q.close[i], volume: q.volume[i],
      });
    }
  }
  if (candles.length < 55) return null;

  const meta       = result.meta || {};
  const companyRaw = meta.longName || meta.shortName || ticker;
  const companyName = companyRaw.replace(/ Tbk\.?/i, '').replace(/PT\.?\s?/i, '').trim();

  const closes  = candles.map(c => c.close);
  const highs   = candles.map(c => c.high);
  const lows    = candles.map(c => c.low);
  const volumes = candles.map(c => c.volume);
  const n       = closes.length;

  // Daily returns
  const dailyReturns = [];
  for (let i = 1; i < closes.length; i++) {
    dailyReturns.push((closes[i] - closes[i - 1]) / closes[i - 1] * 100);
  }

  const lastClose = closes[n - 1];
  const prevClose = closes[n - 2] || lastClose;
  const lastVol   = volumes[n - 1];
  const changePct = (lastClose - prevClose) / prevClose * 100;

  // MAs
  const ma3   = sma(closes, 3);
  const ma5   = sma(closes, 5);
  const ma10  = sma(closes, 10);
  const ma20  = sma(closes, 20);
  const ma50  = sma(closes, 50);
  const ma100 = n >= 100 ? sma(closes, 100) : null;
  if (!ma3 || !ma5 || !ma10 || !ma20 || !ma50) return null;

  const tick       = getTickSize(lastClose);
  const maValues   = [ma3, ma5, ma10, ma20, ma50, lastClose];
  const rangeTicks = (Math.max(...maValues) - Math.min(...maValues)) / tick;
  const volPct     = rollingStd(dailyReturns, 10);

  // Conditions
  const isTight   = rangeTicks < params.maxTicks && volPct < params.maxVol;
  const isLiquid  = lastVol   > params.minVolume;
  const isBullish = ma100 !== null ? lastClose >= ma100 : true;
  const signalOk  = isTight && isLiquid && (params.reqBullish ? isBullish : true);

  // Stale detection
  const daysSince = Math.round((Date.now() / 1000 - candles[n - 1].ts) / 86400);

  // Table rows (last 5 candles)
  const tableRows = [];
  const startIdx  = Math.max(50, n - 5);
  for (let i = startIdx; i < n; i++) {
    const cr  = closes.slice(0, i + 1);
    const hr  = highs.slice(0, i + 1);
    const lr  = lows.slice(0, i + 1);
    const dr  = [];
    for (let j = 1; j <= i; j++) dr.push((closes[j] - closes[j - 1]) / closes[j - 1] * 100);

    const rMa5   = sma(cr, 5);
    const rMa10  = sma(cr, 10);
    const rMa20  = sma(cr, 20);
    const rMa50  = sma(cr, 50);
    const rMa100 = cr.length >= 100 ? sma(cr, 100) : null;

    const rTick  = getTickSize(candles[i].close);
    const rVals  = [rMa5, rMa10, rMa20, rMa50, candles[i].close].filter(v => v !== null);
    const rRange = rVals.length ? (Math.max(...rVals) - Math.min(...rVals)) / rTick : 0;
    const rVol   = rollingStd(dr, Math.min(10, dr.length));
    const rChg   = i > 0 ? (candles[i].close - closes[i - 1]) / closes[i - 1] * 100 : 0;
    const rStoch = stochastic(hr, lr, cr);
    const rMacd  = calcMacd(cr);

    tableRows.push({
      date:      fmtDate(candles[i].ts),
      changePct: +rChg.toFixed(1),
      open:      Math.round(candles[i].open),
      close:     Math.round(candles[i].close),
      volume:    candles[i].volume,
      K:         rStoch.K,
      D:         rStoch.D,
      ma5:       rMa5   ? Math.round(rMa5)   : null,
      ma10:      rMa10  ? Math.round(rMa10)  : null,
      ma20:      rMa20  ? Math.round(rMa20)  : null,
      ma50:      rMa50  ? Math.round(rMa50)  : null,
      ma100:     rMa100 ? Math.round(rMa100) : null,
      macd:      rMacd.macd,
      signal:    rMacd.signal,
      histogram: rMacd.histogram,
      rangeTicks: +rRange.toFixed(1),
      volPct:    +rVol.toFixed(1),
    });
  }

  return {
    ticker,
    companyName,
    price:      Math.round(lastClose),
    changePct:  +changePct.toFixed(2),
    volume:     lastVol,
    ma3: +ma3.toFixed(0), ma5: +ma5.toFixed(0),
    ma10: +ma10.toFixed(0), ma20: +ma20.toFixed(0),
    ma50: +ma50.toFixed(0),
    ma100: ma100 ? +ma100.toFixed(0) : null,
    rangeTicks: +rangeTicks.toFixed(2),
    volPct:     +volPct.toFixed(2),
    tick,
    isTight, isLiquid, isBullish, signalOk,
    daysSince,
    tableRows,
  };
}

// ─── HTTP Request handler ──────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const parsed   = url.parse(req.url, true);
  const pathname = parsed.pathname;

  // CORS headers (for dev)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // ── API: scan single ticker ─────────────────────────────────────────────
  if (pathname === '/api/scan' && req.method === 'GET') {
    const ticker     = (parsed.query.ticker || '').toUpperCase().trim();
    const maxTicks   = parseFloat(parsed.query.maxTicks   || '6');
    const maxVol     = parseFloat(parsed.query.maxVol     || '3.8');
    const minVolume  = parseInt(parsed.query.minVolume    || '1000000');
    const reqBullish = parsed.query.reqBullish !== 'false';

    if (!ticker) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'ticker required' }));
      return;
    }

    try {
      const symbol    = ticker.endsWith('.JK') ? ticker : ticker + '.JK';
      const yahooData = await yahooFetch(symbol);
      const analysis  = analyzeStock(ticker.replace('.JK',''), yahooData, { maxTicks, maxVol, minVolume, reqBullish });

      if (!analysis) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Insufficient data', ticker }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, data: analysis }));
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message, ticker }));
    }
    return;
  }

  // ── Serve static files ──────────────────────────────────────────────────
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.join(__dirname, 'public', filePath);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║   🚀  IHSG MA Ketat Scanner — SERVER         ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log(`║   URL  : http://localhost:${PORT}                ║`);
  console.log('║   API  : /api/scan?ticker=BBCA                ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');
});
