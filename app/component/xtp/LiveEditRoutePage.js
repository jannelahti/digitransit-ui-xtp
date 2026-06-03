import React, { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { Link } from 'found';
import LiveArrowImage from './LiveArrowImage';
import {
  LIVE,
  LIVE_STYLE,
  decodePolyline,
  getStreetViewKey,
  waypointLabel,
  bearing,
  signedTurn,
} from './liveRoute';

/*
 * XTP Track B — full waypoint editor for a saved live route (plan §13, manage
 * hub). Seeds from GET /api/live/route/:id (no SSE generate), then lets the
 * curator drag / add / delete waypoints and tune each point's Street View
 * heading + FOV. Save persists via PUT. Mirrors the create editor's shell
 * (self-contained Leaflet + Carto Voyager + review card + LiveArrowImage).
 */
const STYLE = `
.xtp-wrap { position: relative; height: calc(100vh - 64px); }
.xtp-map { position: absolute; inset: 0; }
/* Left-anchored, transparent control panel so it doesn't block the map. The
 * container has no background; the inputs/buttons carry their own, and the
 * heading/hint get a white halo to stay legible over the map tiles. */
.xtp-panel { position: fixed; left: 16px; bottom: 16px; z-index: 2000;
  width: min(300px, calc(100vw - 32px)); background:transparent; box-shadow:none; padding:0; }
.xtp-panel h2 { margin:0 0 8px; font-size:16px; color:#1c2430;
  text-shadow:0 1px 4px rgba(255,255,255,.95), 0 0 3px rgba(255,255,255,.95); }
.xtp-name { width:100%; box-sizing:border-box; border:1px solid #c7ccd4; border-radius:8px;
  padding:8px 10px; font-size:14px; margin-bottom:10px; box-shadow:0 1px 4px rgba(0,0,0,.18); }
.xtp-row { display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
.xtp-spacer { flex:1; }
.xtp-hint { color:#1c2430; font-size:12px; margin-bottom:10px;
  text-shadow:0 1px 4px rgba(255,255,255,.95), 0 0 3px rgba(255,255,255,.95); }
.xtp-btn { border:1px solid #c7ccd4; background:#fff; color:#1c2430; border-radius:8px;
  padding:8px 14px; font-size:14px; font-weight:600; cursor:pointer; transition:background .15s; text-decoration:none; }
.xtp-btn:hover:not(:disabled){ background:#f1f3f6; }
.xtp-btn:disabled{ opacity:.45; cursor:default; }
.xtp-btn.success{ background:#1c7c2f; border-color:#1c7c2f; color:#fff; }
.xtp-btn.success:hover:not(:disabled){ background:#166626; }
.xtp-status{ font-size:13px; color:#1c2430; min-height:18px; margin-top:8px;
  text-shadow:0 1px 4px rgba(255,255,255,.95), 0 0 3px rgba(255,255,255,.95); }
.xtp-ctx{ display:flex; flex-direction:column; gap:6px; }
.xtp-ctx button{ border:1px solid #c7ccd4; background:#fff; border-radius:6px; padding:6px 10px; cursor:pointer; font-size:13px; }
.xtp-ctx button:hover{ background:#f1f3f6; }

.xtp-card{ position:fixed; top:80px; left:50%; transform:translateX(-50%); z-index:2100;
  width:min(340px,calc(100vw - 32px)); background:#11151c; color:#fff; border-radius:12px;
  overflow:hidden; box-shadow:0 8px 28px rgba(0,0,0,.4); }
.xtp-card-close{ position:absolute; top:6px; right:6px; z-index:3; width:26px; height:26px;
  border:none; border-radius:50%; background:rgba(0,0,0,.55); color:#fff; font-size:16px; cursor:pointer; }
.xtp-card-close:hover{ background:rgba(0,0,0,.8); }
.xtp-nav{ position:absolute; top:30%; transform:translateY(-50%); z-index:3; width:34px; height:34px;
  border:none; border-radius:50%; background:rgba(0,0,0,.55); color:#fff; font-size:22px; line-height:32px; cursor:pointer; }
.xtp-nav:hover:not(:disabled){ background:rgba(0,0,0,.8); }
.xtp-nav:disabled{ opacity:.25; cursor:default; }
.xtp-nav-l{ left:8px; } .xtp-nav-r{ right:8px; }
.xtp-card-meta{ padding:10px 12px; }
.xtp-card-meta .lbl{ font-size:13px; font-weight:700; margin-bottom:8px; }
.xtp-slider{ display:flex; align-items:center; gap:8px; font-size:12px; margin-top:6px; color:#c7ccd4; }
.xtp-slider input[type=range]{ flex:1; }
.xtp-slider .val{ width:42px; text-align:right; font-variant-numeric:tabular-nums; }
.xtp-card-del{ width:100%; margin-top:10px; border:1px solid #7a3a36; background:#2a1714; color:#ff9a90;
  border-radius:8px; padding:7px 0; font-size:13px; font-weight:600; cursor:pointer; }
.xtp-card-del:hover:not(:disabled){ background:#3a201c; }
.xtp-card-del:disabled{ opacity:.4; cursor:default; }
.xtp-gloading{ padding:40px; text-align:center; color:#5a6270; }
${LIVE_STYLE}
`;

// Marker colour by kind, matching the create/guide pages.
const colorFor = kind =>
  kind === 'start' ? '#1c7c2f' : kind === 'destination' ? '#b0271f' : '#1455c0';

// Recompute heading + turnAngle for one index from its neighbours' geometry.
// start → face the next point (no turn); destination → face from the previous
// (no arrow); middle → approach heading + signed turn toward the next point.
function geomAt(arr, i) {
  const cur = arr[i];
  const prev = arr[i - 1];
  const next = arr[i + 1];
  if (prev && next) {
    const inB = bearing(prev, cur);
    const outB = bearing(cur, next);
    return { heading: Math.round(inB), turnAngle: Math.round(signedTurn(inB, outB)) };
  }
  if (!prev && next) return { heading: Math.round(bearing(cur, next)), turnAngle: 0 };
  if (prev && !next) return { heading: Math.round(bearing(prev, cur)), turnAngle: null };
  return { heading: cur.heading ?? 0, turnAngle: cur.turnAngle ?? null };
}

// Reassign position + kind (0 = start, last = destination, else turn) after a
// structural change, then recompute geometry for every point.
function renumber(arr) {
  const out = arr.map((wp, i) => ({
    ...wp,
    position: i,
    kind: i === 0 ? 'start' : i === arr.length - 1 ? 'destination' : 'turn',
  }));
  return out.map((wp, i) => ({ ...wp, ...geomAt(out, i) }));
}

const LiveEditRoutePage = ({ match }) => {
  const id = match?.params?.id;
  const mapEl = useRef(null);
  const L = useRef(null);
  const map = useRef(null);
  const wpLayer = useRef(null);
  const busy = useRef(false);

  const [svKey, setSvKey] = useState('');
  const [meta, setMeta] = useState(null); // name + addresses + start/end + polyline
  const [waypoints, setWaypoints] = useState([]);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState('Drag points to move them, right-click the map to add one.');
  const [phase, setPhase] = useState('loading'); // loading | ready | saving | saved
  const [mapReady, setMapReady] = useState(false);

  // Load key + route JSON.
  useEffect(() => {
    getStreetViewKey().then(setSvKey);
    fetch(LIVE.route(id))
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(route => {
        const { waypoints: wps, ...rest } = route;
        setMeta(rest);
        setWaypoints((wps || []).map((wp, i) => ({ ...wp, position: wp.position ?? i })));
        setPhase('ready');
      })
      .catch(e => setError(e.message));
  }, [id]);

  // Build the map once meta is loaded.
  useEffect(() => {
    if (!meta) return undefined;
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
      if (meta.polyline) {
        const line = Lm.polyline(decodePolyline(meta.polyline), { color: '#1455c0', weight: 5, opacity: 0.6 }).addTo(m);
        m.fitBounds(line.getBounds(), { padding: [50, 50] });
      }
      wpLayer.current = Lm.layerGroup().addTo(m);
      m.on('contextmenu', openContextMenu);
      map.current = m;
      setMapReady(true);
    });
    return () => {
      cancelled = true;
      if (map.current) { map.current.remove(); map.current = null; }
      wpLayer.current = null;
      setMapReady(false);
    };
  }, [meta]); // eslint-disable-line react-hooks/exhaustive-deps

  // (Re)draw the draggable waypoint markers whenever the list changes (or once
  // the map becomes ready, since it loads asynchronously after the route data).
  useEffect(() => {
    const Lm = L.current;
    if (!mapReady || !Lm || !wpLayer.current) return;
    wpLayer.current.clearLayers();
    waypoints.forEach(wp => {
      const html = `<div style="background:${colorFor(wp.kind)};color:#fff;border-radius:50%;width:26px;height:26px;display:flex;align-items:center;justify-content:center;border:2px solid #fff;font-size:12px;font-weight:700;box-shadow:0 1px 4px rgba(0,0,0,.4)">${wp.position + 1}</div>`;
      const marker = Lm.marker([wp.lat, wp.lon], {
        draggable: true,
        icon: Lm.divIcon({ className: 'xtp-wp', html, iconSize: [26, 26], iconAnchor: [13, 13] }),
      });
      marker.on('click', () => setSelected(wp.position));
      marker.on('dragend', ev => {
        const ll = ev.target.getLatLng();
        moveWaypoint(wp.position, ll.lat, ll.lng);
      });
      marker.addTo(wpLayer.current);
    });
  }, [waypoints, mapReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // Drag: update position + recompute the affected neighbourhood only (so manual
  // heading/FOV tweaks on other points survive).
  function moveWaypoint(pos, lat, lon) {
    setWaypoints(prev => {
      const arr = prev.map(wp =>
        wp.position === pos ? { ...wp, lat, lon, camLat: lat, camLon: lon } : { ...wp },
      );
      [pos - 1, pos, pos + 1].forEach(i => {
        if (arr[i]) arr[i] = { ...arr[i], ...geomAt(arr, i) };
      });
      return arr;
    });
  }

  function addWaypoint(latlng) {
    setWaypoints(prev => {
      if (prev.length === 0) return prev;
      // insert after the nearest point, clamped between start and destination
      let nearest = 0;
      let best = Infinity;
      prev.forEach((wp, i) => {
        const d = (wp.lat - latlng.lat) ** 2 + (wp.lon - latlng.lng) ** 2;
        if (d < best) { best = d; nearest = i; }
      });
      const insertAt = Math.min(Math.max(nearest + 1, 1), prev.length);
      const arr = [...prev];
      arr.splice(insertAt, 0, {
        kind: 'turn',
        lat: latlng.lat,
        lon: latlng.lng,
        camLat: latlng.lat,
        camLon: latlng.lng,
        heading: 0,
        turnAngle: 0,
        streetName: null,
      });
      const renumbered = renumber(arr);
      setSelected(insertAt);
      return renumbered;
    });
    setStatus('Added a point — drag it onto the junction, then tune heading/FOV.');
  }

  function deleteWaypoint(pos) {
    setWaypoints(prev => {
      if (prev.length <= 2) return prev; // keep at least start + destination
      return renumber(prev.filter(wp => wp.position !== pos));
    });
    setSelected(null);
  }

  function patchSelected(fields) {
    setWaypoints(prev =>
      prev.map(wp => (wp.position === selected ? { ...wp, ...fields } : wp)),
    );
  }

  function openContextMenu(e) {
    if (busy.current) return;
    const Lm = L.current;
    const div = document.createElement('div');
    div.className = 'xtp-ctx';
    const b = document.createElement('button');
    b.textContent = 'Add waypoint here';
    b.onclick = () => { addWaypoint(e.latlng); map.current.closePopup(); };
    div.appendChild(b);
    Lm.popup().setLatLng(e.latlng).setContent(div).openOn(map.current);
  }

  async function save() {
    busy.current = true;
    setPhase('saving');
    setStatus('Saving…');
    try {
      const r = await fetch(LIVE.route(id), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...meta, waypoints }),
      });
      const data = await r.json();
      if (!r.ok || !data.ok) throw new Error(data.error || `HTTP ${r.status}`);
      busy.current = false;
      setPhase('saved');
      setStatus(`Saved ✓ ${data.waypoints} points.`);
    } catch (err) {
      busy.current = false;
      setPhase('ready');
      setStatus(`Save failed: ${err.message}`);
    }
  }

  if (error) return <div className="xtp-gloading"><style>{STYLE}</style>Could not load route: {error}</div>;
  if (!meta) return <div className="xtp-gloading"><style>{STYLE}</style>Loading…</div>;

  const sel = selected != null ? waypoints.find(w => w.position === selected) : null;
  const hasPrev = sel && waypoints.some(w => w.position === sel.position - 1);
  const hasNext = sel && waypoints.some(w => w.position === sel.position + 1);
  const saving = phase === 'saving';

  return (
    <div className="xtp-wrap">
      <style>{STYLE}</style>
      <div ref={mapEl} className="xtp-map" />

      {sel && (
        <div className="xtp-card">
          <div style={{ position: 'relative' }}>
            <LiveArrowImage wp={sel} svKey={svKey} opts={{ fov: sel.fov ?? 90 }} />
            <button type="button" className="xtp-card-close" onClick={() => setSelected(null)}>×</button>
            <button type="button" className="xtp-nav xtp-nav-l" disabled={!hasPrev} onClick={() => setSelected(sel.position - 1)}>‹</button>
            <button type="button" className="xtp-nav xtp-nav-r" disabled={!hasNext} onClick={() => setSelected(sel.position + 1)}>›</button>
          </div>
          <div className="xtp-card-meta">
            <div className="lbl">{waypointLabel(sel, waypoints.length)}</div>
            <div className="xtp-slider">
              <span>Heading</span>
              <input
                type="range" min="0" max="359" step="1"
                value={Math.round(sel.heading ?? 0)}
                onChange={e => patchSelected({ heading: Number(e.target.value) })}
              />
              <span className="val">{Math.round(sel.heading ?? 0)}°</span>
            </div>
            <div className="xtp-slider">
              <span>FOV</span>
              <input
                type="range" min="30" max="120" step="5"
                value={sel.fov ?? 90}
                onChange={e => patchSelected({ fov: Number(e.target.value) })}
              />
              <span className="val">{sel.fov ?? 90}°</span>
            </div>
            <button
              type="button"
              className="xtp-card-del"
              disabled={waypoints.length <= 2 || sel.kind === 'start' || sel.kind === 'destination'}
              onClick={() => deleteWaypoint(sel.position)}
            >
              Delete this point
            </button>
          </div>
        </div>
      )}

      <div className="xtp-panel">
        <h2>Edit guided route</h2>
        <input
          className="xtp-name"
          value={meta.name || ''}
          onChange={e => setMeta(m => ({ ...m, name: e.target.value }))}
          placeholder="Route name"
        />
        <div className="xtp-hint">
          Click a point to review its Street View and tune heading/FOV. Drag points to
          move them; right-click the map to add a point.
        </div>
        <div className="xtp-row">
          <button type="button" className="xtp-btn success" onClick={save} disabled={saving}>
            Save changes
          </button>
          <Link className="xtp-btn" to="/live-reitit/hallinta">Back to manage</Link>
          <div className="xtp-spacer" />
          <Link className="xtp-btn" to={`/live-reitti/${id}`}>Preview</Link>
        </div>
        <div className="xtp-status">{status}</div>
      </div>
    </div>
  );
};

LiveEditRoutePage.propTypes = {
  match: PropTypes.shape({
    params: PropTypes.shape({ id: PropTypes.string }),
  }).isRequired,
};

export default LiveEditRoutePage;
