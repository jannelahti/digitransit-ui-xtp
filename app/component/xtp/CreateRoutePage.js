import React, { useEffect, useRef, useState } from 'react';

/*
 * XTP "Create guided route" editor (plan: docs/plans/guided-route-creator.md).
 *
 * Self-contained (Option B): plain Leaflet (dynamic-imported client-side for
 * SSR safety), OSM raster tiles, EventSource to stream the generation. Talks to
 * the route-generator sidecar via the nginx-proxied paths below (VTT-only).
 */
const GENERATE_URL = '/api/generate';
const SAVE_URL = '/api/save';
const IMAGE_URL = '/api/image';

// decode a precision-5 google polyline -> [[lat, lon], ...]
function decodePolyline(str) {
  let index = 0;
  let lat = 0;
  let lng = 0;
  const coords = [];
  while (index < str.length) {
    let b;
    let shift = 0;
    let result = 0;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0;
    result = 0;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    coords.push([lat / 1e5, lng / 1e5]);
  }
  return coords;
}

const CreateRoutePage = () => {
  const mapEl = useRef(null);
  const L = useRef(null);
  const map = useRef(null);
  const startMarker = useRef(null);
  const endMarker = useRef(null);
  const routeLine = useRef(null);
  const wpLayer = useRef(null);
  const es = useRef(null);
  const draft = useRef(null); // accumulated 'done' payload for /save
  const wpMarkers = useRef({}); // position -> leaflet marker
  const busy = useRef(false); // true while generating/saving (refs avoid stale closures)

  const [start, setStart] = useState(null);
  const [end, setEnd] = useState(null);
  const [phase, setPhase] = useState('idle'); // idle|generating|preview|saving|saved
  const [status, setStatus] = useState('Click the map to set the START point.');
  const [counts, setCounts] = useState({ found: 0, skipped: 0 });

  // --- map setup (client-only, SSR-safe) ---
  useEffect(() => {
    let cancelled = false;
    import('leaflet').then(mod => {
      if (cancelled) return;
      const Lm = mod.default || mod;
      L.current = Lm;
      const m = Lm.map(mapEl.current).setView([61.4978, 23.761], 14);
      Lm.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap contributors',
      }).addTo(m);
      wpLayer.current = Lm.layerGroup().addTo(m);
      m.on('click', onMapClick);
      map.current = m;
    });
    return () => {
      cancelled = true;
      if (es.current) es.current.close();
      if (map.current) map.current.remove();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pin = (color, label) =>
    L.current.divIcon({
      className: 'xtp-pin',
      html: `<div style="background:${color};color:#fff;border-radius:50% 50% 50% 0;width:24px;height:24px;transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"><span style="transform:rotate(45deg);font-size:11px;font-weight:700">${label}</span></div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 24],
    });

  function onMapClick(e) {
    if (busy.current) return;
    const Lm = L.current;
    const { lat, lng } = e.latlng;
    if (!startMarker.current) {
      startMarker.current = Lm.marker([lat, lng], { draggable: true, icon: pin('#1c7c2f', 'A') }).addTo(map.current);
      setStart({ lat, lon: lng });
      setStatus('Click the map to set the END point.');
    } else if (!endMarker.current) {
      endMarker.current = Lm.marker([lat, lng], { draggable: true, icon: pin('#b0271f', 'B') }).addTo(map.current);
      setEnd({ lat, lon: lng });
      setStatus('Ready — press “Auto generate guided route”.');
    } else {
      resetAll();
      startMarker.current = Lm.marker([lat, lng], { draggable: true, icon: pin('#1c7c2f', 'A') }).addTo(map.current);
      setStart({ lat, lon: lng });
      setStatus('Click the map to set the END point.');
    }
  }

  function clearGenerated() {
    if (wpLayer.current) wpLayer.current.clearLayers();
    wpMarkers.current = {};
    if (routeLine.current) {
      map.current.removeLayer(routeLine.current);
      routeLine.current = null;
    }
    draft.current = null;
    setCounts({ found: 0, skipped: 0 });
  }

  function resetAll() {
    if (es.current) es.current.close();
    busy.current = false;
    clearGenerated();
    [startMarker, endMarker].forEach(r => {
      if (r.current) {
        map.current.removeLayer(r.current);
        r.current = null;
      }
    });
    setStart(null);
    setEnd(null);
    setPhase('idle');
    setStatus('Click the map to set the START point.');
  }

  function popupHtml(wp) {
    return `<div style="width:230px">
      <img src="${wp.mediaUrl}" style="width:100%;border-radius:4px" alt="guidance" />
      <div style="font-size:11px;color:#555;margin:4px 0">${wp.caption || ''}</div>
      <button data-regen="${wp.position}" style="font-size:12px;padding:3px 8px;cursor:pointer">↻ Next image</button>
    </div>`;
  }

  function bindRegen(ev, position) {
    const btn = ev.popup.getElement().querySelector(`button[data-regen="${position}"]`);
    if (btn) btn.onclick = () => regenerate(position);
  }

  function addWaypointMarker(wp) {
    const Lm = L.current;
    const html = `<div style="background:#1455c0;color:#fff;border-radius:50%;width:22px;height:22px;display:flex;align-items:center;justify-content:center;border:2px solid #fff;font-size:11px;font-weight:700">${wp.position + 1}</div>`;
    const marker = Lm.marker([wp.lat, wp.lon], {
      icon: Lm.divIcon({ className: 'xtp-wp', html, iconSize: [22, 22], iconAnchor: [11, 11] }),
    });
    marker.bindPopup(popupHtml(wp), { minWidth: 240 });
    marker.on('popupopen', ev => bindRegen(ev, wp.position));
    marker.addTo(wpLayer.current);
    wpMarkers.current[wp.position] = marker;
  }

  async function regenerate(position) {
    const d = draft.current;
    if (!d) return;
    const wp = d.waypoints.find(w => w.position === position);
    if (!wp) return;
    try {
      const r = await fetch(IMAGE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hash: d.hash, position, lat: wp.lat, lon: wp.lon, heading: wp.heading }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const img = await r.json();
      wp.mediaUrl = img.mediaUrl;
      wp.caption = img.caption;
      const marker = wpMarkers.current[position];
      if (marker) {
        marker.setPopupContent(popupHtml(wp));
        marker.openPopup();
      }
    } catch (err) {
      setStatus(`Could not fetch another image: ${err.message}`);
    }
  }

  function generate() {
    if (!start || !end) return;
    clearGenerated();
    busy.current = true;
    setPhase('generating');
    setStatus('Generating… routing and finding images.');
    const q = `flat=${start.lat}&flon=${start.lon}&tlat=${end.lat}&tlon=${end.lon}`;
    const source = new EventSource(`${GENERATE_URL}?${q}`);
    es.current = source;
    let found = 0;
    let skipped = 0;

    source.addEventListener('route', e => {
      const data = JSON.parse(e.data);
      routeLine.current = L.current
        .polyline(decodePolyline(data.polyline), { color: '#1455c0', weight: 4, opacity: 0.7 })
        .addTo(map.current);
      map.current.fitBounds(routeLine.current.getBounds(), { padding: [40, 40] });
    });
    source.addEventListener('waypoint', e => {
      addWaypointMarker(JSON.parse(e.data));
      found += 1;
      setCounts({ found, skipped });
      setStatus(`Generating… ${found} photo points so far.`);
    });
    source.addEventListener('skip', () => {
      skipped += 1;
      setCounts({ found, skipped });
    });
    source.addEventListener('done', e => {
      draft.current = JSON.parse(e.data);
      busy.current = false;
      source.close();
      setPhase('preview');
      setStatus(`Done — ${found} photo points${skipped ? `, ${skipped} skipped (no image)` : ''}. Review, then Accept or Reject.`);
    });
    source.addEventListener('failed', e => {
      busy.current = false;
      source.close();
      setPhase('idle');
      let msg = 'generation failed';
      try { msg = JSON.parse(e.data).message; } catch (x) { /* ignore */ }
      setStatus(`Generation failed: ${msg}`);
    });
    source.onerror = () => {
      source.close();
      if (!draft.current) {
        busy.current = false;
        setPhase('idle');
        setStatus('Connection to the generator was lost.');
      }
    };
  }

  async function accept() {
    if (!draft.current) return;
    busy.current = true;
    setPhase('saving');
    setStatus('Saving route…');
    try {
      const r = await fetch(SAVE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft.current),
      });
      const data = await r.json();
      if (!r.ok || !data.ok) throw new Error(data.error || `HTTP ${r.status}`);
      busy.current = false;
      setPhase('saved');
      setStatus(`Saved ✓ route #${data.routeId} with ${data.waypoints} photo points.`);
    } catch (err) {
      busy.current = false;
      setPhase('preview');
      setStatus(`Save failed: ${err.message}`);
    }
  }

  return (
    <div style={{ position: 'relative', height: 'calc(100vh - 64px)' }}>
      <div ref={mapEl} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }} />
      <div
        style={{
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 2000,
          background: 'rgba(245,245,245,0.97)',
          borderTop: '1px solid #ccc',
          padding: '10px 14px',
          boxShadow: '0 -2px 10px rgba(0,0,0,.18)',
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Create guided route</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={generate}
            disabled={!start || !end || phase === 'generating' || phase === 'saving'}
            style={{ padding: '6px 12px', fontWeight: 600 }}
          >
            Auto generate guided route
          </button>
          <button type="button" onClick={accept} disabled={phase !== 'preview'} style={{ padding: '6px 12px' }}>
            Accept &amp; save
          </button>
          <button
            type="button"
            onClick={resetAll}
            disabled={phase === 'generating' || phase === 'saving'}
            style={{ padding: '6px 12px' }}
          >
            Reject / reset
          </button>
          <span style={{ marginLeft: 8, fontSize: 13, color: '#333' }}>
            {status}
            {counts.found ? ` (${counts.found} points)` : ''}
          </span>
        </div>
      </div>
    </div>
  );
};

export default CreateRoutePage;
