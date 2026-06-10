import type { FastifyInstance } from 'fastify'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { query } from '../db.js'

const __dir = dirname(fileURLToPath(import.meta.url))
const geoJson = JSON.parse(
  readFileSync(join(__dir, '../../../../packages/core/src/geo/rotterdam.geojson'), 'utf8'),
)

interface EventRow {
  id: string
  mmsi: string
  vessel_name: string | null
  event_type: string
  port: string
  timestamp: string
  confidence: number
  anchor_batch_id: string | null
  merkle_root: string | null
  tx_hash: string | null
  evidence: unknown
}

function fmtRow(r: EventRow) {
  const evidence = r.evidence as { corroboration_sources?: string[]; sources?: string[] } | null
  return {
    id:       r.id,
    mmsi:     r.mmsi,
    name:     r.vessel_name,
    type:     r.event_type,
    port:     r.port,
    ts:       r.timestamp,
    conf:     r.confidence,
    anchored: !!r.merkle_root,
    txHash:   r.tx_hash,
    corroborationSources: evidence?.corroboration_sources ?? evidence?.sources ?? [],
  }
}

const EVENT_QUERY = `
  SELECT e.id, e.mmsi, e.vessel_name, e.event_type, e.port,
         e.timestamp, e.confidence, e.anchor_batch_id, e.evidence,
         ab.merkle_root, ab.tx_hash
  FROM events e
  LEFT JOIN anchor_batches ab ON ab.id = e.anchor_batch_id
`

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', async (_req, reply) => {
    reply.type('text/html')
    return reply.send(DASHBOARD_HTML)
  })

  app.get('/api/geo/rotterdam', async () => geoJson)

  app.get('/api/live', async () => {
    const [vessels, stats] = await Promise.all([
      query(`
        SELECT DISTINCT ON (p.mmsi)
          p.mmsi, p.lat, p.lon, p.sog, p.cog, v.name, vs.state
        FROM positions p
        LEFT JOIN vessels v ON v.mmsi = p.mmsi
        LEFT JOIN vessel_states vs ON vs.mmsi = p.mmsi
        WHERE p.time > NOW() - INTERVAL '2 hours'
        ORDER BY p.mmsi, p.time DESC
      `),
      query(`
        SELECT
          COUNT(*)                FILTER (WHERE e.timestamp > NOW() - INTERVAL '24h') AS today,
          COUNT(DISTINCT e.mmsi)  FILTER (WHERE e.timestamp > NOW() - INTERVAL '1h')  AS active_1h,
          MAX(ab.confirmed_at)    AS last_anchor
        FROM events e
        LEFT JOIN anchor_batches ab ON ab.id = e.anchor_batch_id
      `),
    ])
    return { vessels: vessels.rows, stats: stats.rows[0] }
  })

  app.get('/stream/events', async (req, reply) => {
    reply.hijack()
    reply.raw.writeHead(200, {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
    })

    const initial = await query<EventRow>(
      `${EVENT_QUERY} ORDER BY e.id DESC LIMIT 20`,
    )
    const rows = initial.rows.reverse()
    for (const row of rows) {
      reply.raw.write(`data: ${JSON.stringify(fmtRow(row))}\n\n`)
    }
    const nowHex = Date.now().toString(16)
    let lastId = rows.length > 0 ? rows[rows.length - 1]!.id : `evt_${nowHex}`

    const timer = setInterval(async () => {
      try {
        const res = await query<EventRow>(
          `${EVENT_QUERY} WHERE e.id > $1 ORDER BY e.id ASC LIMIT 50`,
          [lastId],
        )
        for (const row of res.rows) {
          reply.raw.write(`data: ${JSON.stringify(fmtRow(row))}\n\n`)
          lastId = row.id
        }
      } catch { /* db gone — will retry */ }
    }, 3000)

    await new Promise<void>(resolve => req.raw.on('close', resolve))
    clearInterval(timer)
    reply.raw.end()
  })
}

// ─── HTML ──────────────────────────────────────────────────────────────────
const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Maritime Event Oracle</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg:     #0d1117;
    --bg2:    #161b22;
    --bg3:    #21262d;
    --border: #30363d;
    --text:   #e6edf3;
    --muted:  #8b949e;
    --teal:   #00d4aa;
    --orange: #ff8c00;
    --blue:   #4dabf7;
    --red:    #ff4444;
    --yellow: #e3b341;
    --mono:   'SF Mono','Cascadia Code','Consolas',monospace;
  }
  html, body { height: 100%; background: var(--bg); color: var(--text); font-family: var(--mono); font-size: 13px; }

  #header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 0 16px; background: var(--bg2); border-bottom: 1px solid var(--border);
    height: 48px; flex-shrink: 0;
  }
  #header h1 { font-size: 14px; font-weight: 600; letter-spacing: .4px; }
  #header h1 em { color: var(--teal); font-style: normal; }
  #live-dot {
    display: inline-block; width: 8px; height: 8px; border-radius: 50%;
    background: var(--muted); margin-right: 6px; transition: background .3s;
  }
  #live-dot.on { background: var(--teal); box-shadow: 0 0 6px var(--teal); }
  #live-label { font-size: 11px; color: var(--muted); }

  body { display: flex; flex-direction: column; }
  #main { display: grid; grid-template-columns: 1fr 380px; flex: 1; min-height: 0; }
  #map  { width: 100%; height: 100%; }

  #feed-panel { background: var(--bg2); border-left: 1px solid var(--border); display: flex; flex-direction: column; min-height: 0; }
  #feed-hdr   { padding: 10px 14px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; font-size: 11px; color: var(--muted); letter-spacing: 1px; text-transform: uppercase; flex-shrink: 0; }
  #evt-count  { color: var(--teal); font-weight: 700; }
  #feed-list  { overflow-y: auto; flex: 1; padding: 8px; }

  .card {
    background: var(--bg3); border: 1px solid var(--border); border-radius: 6px;
    padding: 10px 12px; margin-bottom: 6px;
    animation: fadeIn .25s ease;
  }
  .card:hover { border-color: var(--teal); }
  @keyframes fadeIn { from { opacity:0; transform:translateY(-4px); } to { opacity:1; transform:none; } }
  .r1 { display:flex; justify-content:space-between; align-items:center; margin-bottom:4px; }
  .r2 { display:flex; gap:8px; margin-bottom:3px; }
  .r3 { display:flex; justify-content:space-between; color:var(--muted); font-size:11px; }
  .etype { font-weight:700; font-size:12px; }
  .etype.PORT_ARRIVAL    { color:var(--teal);   }
  .etype.PORT_DEPARTURE  { color:var(--orange); }
  .etype.ANCHORAGE_START,.etype.ANCHORAGE_END { color:var(--blue);   }
  .etype.AIS_GAP         { color:var(--red);    }
  .badge { font-size:10px; padding:2px 6px; border-radius:10px; background:var(--bg); border:1px solid var(--border); }
  .badge.hi { border-color:var(--teal);   color:var(--teal);   }
  .badge.md { border-color:var(--yellow); color:var(--yellow); }
  .badge.lo { border-color:var(--red);    color:var(--red);    }
  .vname { font-weight:600; max-width:160px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .mmsi  { color:var(--muted); }
  .chain { font-size:10px; color:var(--blue); }

  #footer {
    height: 40px; flex-shrink: 0; background: var(--bg2); border-top: 1px solid var(--border);
    display: flex; align-items: center; padding: 0 16px; gap: 32px; font-size: 11px; color: var(--muted);
  }
  #footer b { color: var(--text); font-weight: 600; }

  .src-multi  { font-size:10px; color:var(--teal); font-weight:600; }
  .src-single { font-size:10px; color:var(--muted); }

  .leaflet-container { background: #0a0f14; }
  .leaflet-popup-content-wrapper, .leaflet-popup-tip {
    background: var(--bg2); color: var(--text); border: 1px solid var(--border);
    border-radius: 4px; font-family: var(--mono); font-size: 12px; box-shadow: none;
  }
</style>
</head>
<body>

<div id="header">
  <h1>Maritime Event Oracle &nbsp;·&nbsp; <em>NLRTM</em> Rotterdam</h1>
  <div><span id="live-dot"></span><span id="live-label">connecting…</span></div>
</div>

<div id="main">
  <div id="map"></div>
  <div id="feed-panel">
    <div id="feed-hdr"><span>Live Events</span><span id="evt-count">0</span></div>
    <div id="feed-list"></div>
  </div>
</div>

<div id="footer">
  <span>Events today: <b id="s-today">—</b></span>
  <span>Active vessels (1h): <b id="s-vessels">—</b></span>
  <span>Last anchor: <b id="s-anchor">—</b></span>
</div>

<script>
const ICONS = { PORT_ARRIVAL:'↓', PORT_DEPARTURE:'↑', ANCHORAGE_START:'⚓', ANCHORAGE_END:'⚓', AIS_GAP:'⚠' };

// ── Map ──────────────────────────────────────────────────────────────────────
const map = L.map('map', { attributionControl: false }).setView([51.90, 4.10], 11);
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 18 }).addTo(map);
L.control.attribution({ prefix: '© OpenStreetMap · CartoDB' }).addTo(map);

fetch('/api/geo/rotterdam').then(r => r.json()).then(geo => {
  L.geoJSON(geo, {
    style: f => f.properties.id === 'NLRTM'
      ? { color:'#00d4aa', fillColor:'#00d4aa', fillOpacity:.07, weight:1.5 }
      : { color:'#4dabf7', fillColor:'#4dabf7', fillOpacity:.10, weight:1 },
    onEachFeature: (f, l) => l.bindPopup('<b>' + f.properties.name + '</b><br><span style="color:#8b949e">' + f.properties.id + '</span>'),
  }).addTo(map);
});

// Vessel markers
const markers = {};
function mkIcon(state) {
  const c = state === 'MOORED' ? '#00d4aa' : state === 'ANCHORED' ? '#4dabf7'
          : (state === 'AT_SEA' || state === 'APPROACHING') ? '#e3b341' : '#8b949e';
  return L.divIcon({
    html: '<svg width="24" height="24" viewBox="-8 -8 16 16" xmlns="http://www.w3.org/2000/svg">'
        + '<polygon points="0,-7 5,4 0,2 -5,4" fill="' + c + '" stroke="#0d1117" stroke-width="0.8"/></svg>',
    className: '', iconSize: [24,24], iconAnchor: [12,12],
  });
}
function updateVessels(list) {
  const seen = new Set(list.map(v => v.mmsi));
  for (const v of list) {
    const popup = '<b>' + (v.name||'Unknown') + '</b><br>MMSI: ' + v.mmsi + '<br>State: ' + (v.state||'?') + '<br>SOG: ' + Number(v.sog).toFixed(1) + ' kn';
    if (markers[v.mmsi]) {
      markers[v.mmsi].setLatLng([v.lat, v.lon]).setIcon(mkIcon(v.state)).getPopup().setContent(popup);
    } else {
      markers[v.mmsi] = L.marker([v.lat, v.lon], { icon: mkIcon(v.state) }).bindPopup(popup).addTo(map);
    }
  }
  for (const m of Object.keys(markers)) {
    if (!seen.has(m)) { markers[m].remove(); delete markers[m]; }
  }
}

// ── Stats ────────────────────────────────────────────────────────────────────
function ago(iso) {
  if (!iso) return '—';
  const s = Math.floor((Date.now() - new Date(iso)) / 1000);
  return s < 60 ? s + 's ago' : s < 3600 ? Math.floor(s/60) + 'm ago' : Math.floor(s/3600) + 'h ago';
}
async function poll() {
  try {
    const d = await fetch('/api/live').then(r => r.json());
    updateVessels(d.vessels || []);
    document.getElementById('s-today').textContent   = d.stats?.today   ?? '0';
    document.getElementById('s-vessels').textContent = d.stats?.active_1h ?? '0';
    document.getElementById('s-anchor').textContent  = ago(d.stats?.last_anchor);
  } catch {}
}
poll(); setInterval(poll, 10000);

// ── SSE Feed ─────────────────────────────────────────────────────────────────
let total = 0;
const feedList = document.getElementById('feed-list');
const cntEl    = document.getElementById('evt-count');

function badgeClass(c) { return c >= 75 ? 'hi' : c >= 50 ? 'md' : 'lo'; }

function addEvent(e) {
  total++;
  cntEl.textContent = total;
  const ts   = new Date(e.ts).toLocaleTimeString('en-GB', { hour12: false });
  const icon = ICONS[e.type] || '•';
  const conf = Number(e.conf).toFixed(1);
  const srcs = (e.corroborationSources || []);
  const srcTag = srcs.length >= 2
    ? '<span class="src-multi">◈ ' + srcs.join(' + ') + '</span>'
    : srcs.length === 1 ? '<span class="src-single">' + srcs[0] + '</span>' : '';
  const el   = document.createElement('div');
  el.className = 'card';
  el.innerHTML =
    '<div class="r1">'
    + '<span class="etype ' + e.type + '">' + icon + ' ' + e.type.replace('_',' ') + '</span>'
    + '<span class="badge ' + badgeClass(e.conf) + '">' + conf + '%</span>'
    + '</div>'
    + '<div class="r2">'
    + '<span class="vname">' + (e.name || 'Unknown') + '</span>'
    + '<span class="mmsi">' + e.mmsi + '</span>'
    + '</div>'
    + '<div class="r3">'
    + '<span>' + ts + ' · ' + e.port + '</span>'
    + '<span>'
    + (e.anchored ? '<span class="chain">⛓ &nbsp;</span>' : '')
    + srcTag
    + '</span>'
    + '</div>';
  feedList.insertBefore(el, feedList.firstChild);
  while (feedList.children.length > 100) feedList.removeChild(feedList.lastChild);
}

const dot   = document.getElementById('live-dot');
const label = document.getElementById('live-label');

(function connect() {
  const es = new EventSource('/stream/events');
  es.onopen    = () => { dot.className = 'on'; label.textContent = 'live'; };
  es.onmessage = e => { try { addEvent(JSON.parse(e.data)); } catch {} };
  es.onerror   = () => {
    dot.className = ''; label.textContent = 'reconnecting…';
    es.close(); setTimeout(connect, 3000);
  };
})();
<\/script>
</body>
</html>`
