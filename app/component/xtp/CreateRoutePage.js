import React, { useEffect, useRef, useState } from 'react';

/*
 * XTP "Create guided route" editor (plan: docs/plans/guided-route-creator.md).
 * Self-contained (Option B): plain Leaflet (dynamic-imported, SSR-safe), crisp
 * Carto Voyager retina tiles, EventSource stream. Talks to the route-generator
 * sidecar via the nginx-proxied paths below (VTT-only).
 */
const GENERATE_URL = '/api/generate';
const SAVE_URL = '/api/save';
const IMAGE_URL = '/api/image';

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

const STYLE = `
.xtp-wrap { position: relative; height: calc(100vh - 64px); }
.xtp-map { position: absolute; inset: 0; }
.xtp-panel {
  position: fixed; left: 16px; right: 16px; bottom: 16px; z-index: 2000;
  background: #fff; border-radius: 12px; box-shadow: 0 6px 24px rgba(0,0,0,.22);
  padding: 14px 16px;
}
.xtp-panel h2 { margin: 0 0 4px; font-size: 16px; }
.xtp-panel .hint { color: #5a6270; font-size: 13px; margin-bottom: 10px; }
.xtp-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.xtp-spacer { flex: 1; }
.xtp-btn {
  border: 1px solid #c7ccd4; background: #fff; color: #1c2430; border-radius: 8px;
  padding: 8px 14px; font-size: 14px; font-weight: 600; cursor: pointer;
  transition: background .15s, border-color .15s;
}
.xtp-btn:hover:not(:disabled) { background: #f1f3f6; }
.xtp-btn:disabled { opacity: .45; cursor: default; }
.xtp-btn.primary { background: #1455c0; border-color: #1455c0; color: #fff; }
.xtp-btn.primary:hover:not(:disabled) { background: #0e459f; }
.xtp-btn.success { background: #1c7c2f; border-color: #1c7c2f; color: #fff; }
.xtp-btn.success:hover:not(:disabled) { background: #166626; }
.xtp-status { font-size: 13px; color: #333; min-height: 18px; display:flex; align-items:center; gap:8px; }
.xtp-spin { width:16px; height:16px; border:3px solid #c7d3ea; border-top-color:#1455c0; border-radius:50%; animation: xtpspin .8s linear infinite; }
@keyframes xtpspin { to { transform: rotate(360deg); } }
.xtp-ctx { display:flex; flex-direction:column; gap:6px; }
.xtp-ctx button { border:1px solid #c7ccd4; background:#fff; border-radius:6px; padding:6px 10px; cursor:pointer; font-size:13px; }
.xtp-ctx button:hover { background:#f1f3f6; }
.xtp-nav {
  position:absolute; top:84px; transform:translateY(-50%); z-index:5;
  width:30px; height:30px; border-radius:50%; border:none; cursor:pointer;
  background:rgba(0,0,0,.55); color:#fff; font-size:20px; line-height:28px; text-align:center;
}
.xtp-nav:hover { background:rgba(0,0,0,.78); }
.xtp-nav:disabled { opacity:.25; cursor:default; }
.xtp-nav-l { left:6px; }
.xtp-nav-r { right:6px; }
`;

const CreateRoutePage = () => {
  const mapEl = useRef(null);
  const L = useRef(null);
  const map = useRef(null);
  const startMarker = useRef(null);
  const endMarker = useRef(null);
  const routeLine = useRef(null);
  const wpLayer = useRef(null);
  const es = useRef(null);
  const draft = useRef(null);
  const wpMarkers = useRef({});
  const busy = useRef(false);

  const [start, setStart] = useState(null);
  const [end, setEnd] = useState(null);
  const [phase, setPhase] = useState('idle');
  const [status, setStatus] = useState('Click the map to set the start point (or right-click).');
  const [counts, setCounts] = useState({ found: 0, skipped: 0 });

  useEffect(() => {
    let cancelled = false;
    import('leaflet').then(mod => {
      if (cancelled) return;
      const Lm = mod.default || mod;
      L.current = Lm;
      const m = Lm.map(mapEl.current, { zoomControl: true }).setView([61.4978, 23.761], 15);
      Lm.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        subdomains: 'abcd',
        maxZoom: 20,
        detectRetina: true,
        attribution: '© OpenStreetMap, © CARTO',
      }).addTo(m);
      wpLayer.current = Lm.layerGroup().addTo(m);
      m.on('click', e => {
        if (busy.current) return;
        if (!startMarker.current) place('start', e.latlng);
        else if (!endMarker.current) place('end', e.latlng);
      });
      m.on('contextmenu', openContextMenu);
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
      html: `<div style="background:${color};color:#fff;border-radius:50% 50% 50% 0;width:26px;height:26px;transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.45)"><span style="transform:rotate(45deg);font-size:12px;font-weight:700">${label}</span></div>`,
      iconSize: [26, 26],
      iconAnchor: [13, 26],
    });

  function place(which, latlng) {
    const Lm = L.current;
    const ref = which === 'start' ? startMarker : endMarker;
    const setter = which === 'start' ? setStart : setEnd;
    if (ref.current) {
      ref.current.setLatLng(latlng);
    } else {
      ref.current = Lm.marker(latlng, {
        draggable: true,
        icon: pin(which === 'start' ? '#1c7c2f' : '#b0271f', which === 'start' ? 'A' : 'B'),
      }).addTo(map.current);
      ref.current.on('dragend', ev => {
        const ll = ev.target.getLatLng();
        setter({ lat: ll.lat, lon: ll.lng });
      });
    }
    setter({ lat: latlng.lat, lon: latlng.lng });
    if (which === 'start' && !endMarker.current) {
      setStatus('Now click the map to set the end point (or right-click).');
    } else {
      setStatus('Ready — press “Auto generate guided route”.');
    }
  }

  function openContextMenu(e) {
    if (busy.current) return;
    const Lm = L.current;
    const div = document.createElement('div');
    div.className = 'xtp-ctx';
    const mk = (text, which) => {
      const b = document.createElement('button');
      b.textContent = text;
      b.onclick = () => {
        place(which, e.latlng);
        map.current.closePopup();
      };
      return b;
    };
    div.appendChild(mk('Set as start (A)', 'start'));
    div.appendChild(mk('Set as end (B)', 'end'));
    Lm.popup().setLatLng(e.latlng).setContent(div).openOn(map.current);
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
    setStatus('Click the map to set the start point (or right-click).');
  }

  function popupHtml(wp) {
    return `<div style="width:260px;position:relative">
      <img src="${wp.mediaUrl}" style="width:100%;border-radius:6px;display:block" alt="guidance" />
      <button class="xtp-nav xtp-nav-l" data-nav="prev" title="Previous point">‹</button>
      <button class="xtp-nav xtp-nav-r" data-nav="next" title="Next point">›</button>
      <div style="font-size:11px;color:#666;margin:5px 0">${wp.caption || ''}</div>
      <button data-regen="1" style="font-size:12px;padding:4px 9px;cursor:pointer;border:1px solid #c7ccd4;border-radius:6px;background:#fff">↻ Try another photo (this spot)</button>
    </div>`;
  }

  function bindPopup(ev, position) {
    const el = ev.popup.getElement();
    const regen = el.querySelector('button[data-regen]');
    if (regen) regen.onclick = () => regenerate(position);
    const prev = el.querySelector('button[data-nav="prev"]');
    const next = el.querySelector('button[data-nav="next"]');
    const go = pos => {
      const m = wpMarkers.current[pos];
      if (m) m.openPopup();
    };
    if (prev) {
      if (wpMarkers.current[position - 1]) prev.onclick = () => go(position - 1);
      else prev.disabled = true;
    }
    if (next) {
      if (wpMarkers.current[position + 1]) next.onclick = () => go(position + 1);
      else next.disabled = true;
    }
  }

  function addWaypointMarker(wp) {
    const Lm = L.current;
    const html = `<div style="background:#1455c0;color:#fff;border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center;border:2px solid #fff;font-size:12px;font-weight:700;box-shadow:0 1px 4px rgba(0,0,0,.4)">${wp.position + 1}</div>`;
    const marker = Lm.marker([wp.lat, wp.lon], {
      icon: Lm.divIcon({ className: 'xtp-wp', html, iconSize: [24, 24], iconAnchor: [12, 12] }),
    });
    marker.bindPopup(popupHtml(wp), { minWidth: 270 });
    marker.on('popupopen', ev => bindPopup(ev, wp.position));
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
        body: JSON.stringify({
          hash: d.hash,
          position,
          camLat: wp.camLat,
          camLon: wp.camLon,
          heading: wp.heading,
          turnAngle: wp.turnAngle,
          excludeId: wp.imageId,
        }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const img = await r.json();
      wp.mediaUrl = img.mediaUrl;
      wp.caption = img.caption;
      wp.imageId = img.imageId;
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
    setStatus('Generating route…');
    const q = `flat=${start.lat}&flon=${start.lon}&tlat=${end.lat}&tlon=${end.lon}`;
    const source = new EventSource(`${GENERATE_URL}?${q}`);
    es.current = source;
    let found = 0;
    let skipped = 0;

    source.addEventListener('route', e => {
      const data = JSON.parse(e.data);
      routeLine.current = L.current
        .polyline(decodePolyline(data.polyline), { color: '#1455c0', weight: 5, opacity: 0.75 })
        .addTo(map.current);
      map.current.fitBounds(routeLine.current.getBounds(), { padding: [50, 50] });
    });
    source.addEventListener('waypoint', e => {
      addWaypointMarker(JSON.parse(e.data));
      found += 1;
      setCounts({ found, skipped });
      setStatus('Generating route…');
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
      setStatus(`Done — ${found} turn photos${skipped ? `, ${skipped} skipped` : ''}. Click a point to review, then Accept or Reject.`);
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
      setStatus(`Saved ✓ route #${data.routeId} with ${data.waypoints} turn photos.`);
    } catch (err) {
      busy.current = false;
      setPhase('preview');
      setStatus(`Save failed: ${err.message}`);
    }
  }

  const generating = phase === 'generating';
  const genDisabled = !start || !end || generating || phase === 'saving';

  return (
    <div className="xtp-wrap">
      <style>{STYLE}</style>
      <div ref={mapEl} className="xtp-map" />
      <div className="xtp-panel">
        <h2>Create guided route</h2>
        <div className="hint">
          Click the map to set the start, then the end (or right-click for either); drag to adjust.
          Generate adds a photo with a turn arrow at each junction.
        </div>
        <div className="xtp-row">
          <button type="button" className="xtp-btn primary" onClick={generate} disabled={genDisabled}>
            Auto generate guided route
          </button>
          <div className="xtp-spacer" />
          <button type="button" className="xtp-btn success" onClick={accept} disabled={phase !== 'preview'}>
            Accept &amp; save
          </button>
          <button type="button" className="xtp-btn" onClick={resetAll} disabled={generating || phase === 'saving'}>
            Reject / reset
          </button>
        </div>
        <div className="xtp-status" style={{ marginTop: 8 }}>
          {generating && <span className="xtp-spin" />}
          <span>
            {status}
            {counts.found ? ` (${counts.found}${counts.skipped ? `, ${counts.skipped} skipped` : ''})` : ''}
          </span>
        </div>
      </div>
    </div>
  );
};

export default CreateRoutePage;
