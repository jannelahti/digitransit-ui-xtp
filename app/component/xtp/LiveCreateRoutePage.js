import React, { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { Link } from 'found';
import LiveArrowImage from './LiveArrowImage';
import { LIVE, LIVE_STYLE, decodePolyline, getStreetViewKey, waypointLabel, visionFlagInfo } from './liveRoute';

/*
 * XTP Track B — "Create live guided route" editor (plan §13). Mirrors the
 * Mapillary editor's shell (self-contained Leaflet, Carto Voyager, EventSource
 * stream, React review card) but stores JSON only: the route-generator sidecar
 * returns waypoints with no images; the review card shows a *live* Street View
 * frame with an SVG turn arrow. Save persists JSON to the sidecar's live store.
 */
const STYLE = `
.xtp-wrap { position: relative; height: calc(100vh - 64px); }
.xtp-map { position: absolute; inset: 0; }
/* Left-anchored, transparent control panel so it doesn't block the map (matches
 * the edit page). No background; the buttons carry their own, and the text gets
 * a white halo so it stays legible over the map. */
.xtp-panel { position: fixed; left: 16px; bottom: 16px; z-index: 2000;
  width: min(320px, calc(100vw - 32px)); background:transparent; box-shadow:none; padding:0; }
.xtp-panel h2 { margin:0 0 6px; font-size:16px; color:#1c2430;
  text-shadow:0 1px 4px rgba(255,255,255,.95), 0 0 3px rgba(255,255,255,.95); }
.xtp-panel .hint { color:#1c2430; font-size:13px; margin-bottom:10px;
  text-shadow:0 1px 4px rgba(255,255,255,.95), 0 0 3px rgba(255,255,255,.95); }
.xtp-row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
.xtp-btn { border:1px solid #c7ccd4; background:#fff; color:#1c2430; border-radius:8px;
  padding:8px 14px; font-size:14px; font-weight:600; cursor:pointer; transition:background .15s; }
.xtp-btn:hover:not(:disabled){ background:#f1f3f6; }
.xtp-btn:disabled{ opacity:.45; cursor:default; }
.xtp-btn.primary{ background:#1455c0; border-color:#1455c0; color:#fff; }
.xtp-btn.primary:hover:not(:disabled){ background:#0e459f; }
.xtp-btn.success{ background:#1c7c2f; border-color:#1c7c2f; color:#fff; }
.xtp-btn.success:hover:not(:disabled){ background:#166626; }
.xtp-status{ font-size:13px; color:#1c2430; min-height:18px; display:flex; align-items:center; gap:8px;
  text-shadow:0 1px 4px rgba(255,255,255,.95), 0 0 3px rgba(255,255,255,.95); }
.xtp-spin{ width:16px; height:16px; border:3px solid #c7d3ea; border-top-color:#1455c0; border-radius:50%; animation:xtpspin .8s linear infinite; }
@keyframes xtpspin { to { transform:rotate(360deg); } }
.xtp-ctx{ display:flex; flex-direction:column; gap:6px; }
.xtp-ctx button{ border:1px solid #c7ccd4; background:#fff; border-radius:6px; padding:6px 10px; cursor:pointer; font-size:13px; }
.xtp-ctx button:hover{ background:#f1f3f6; }

.xtp-card{ position:fixed; top:80px; left:16px; z-index:2100;
  width:min(340px,calc(100vw - 32px)); background:#11151c; color:#fff; border-radius:12px;
  overflow:hidden; box-shadow:0 8px 28px rgba(0,0,0,.4); }
.xtp-card-close{ position:absolute; top:6px; right:6px; z-index:3; width:26px; height:26px;
  border:none; border-radius:50%; background:rgba(0,0,0,.55); color:#fff; font-size:16px; cursor:pointer; }
.xtp-card-close:hover{ background:rgba(0,0,0,.8); }
.xtp-nav{ position:absolute; top:40%; transform:translateY(-50%); z-index:3; width:34px; height:34px;
  border:none; border-radius:50%; background:rgba(0,0,0,.55); color:#fff; font-size:22px; line-height:32px; cursor:pointer; }
.xtp-nav:hover:not(:disabled){ background:rgba(0,0,0,.8); }
.xtp-nav:disabled{ opacity:.25; cursor:default; }
.xtp-nav-l{ left:8px; } .xtp-nav-r{ right:8px; }
.xtp-card-meta{ padding:10px 12px; }
.xtp-card-meta .lbl{ font-size:13px; font-weight:700; }
${LIVE_STYLE}
`;

const LiveCreateRoutePage = ({ router }) => {
  const mapEl = useRef(null);
  const L = useRef(null);
  const map = useRef(null);
  const startMarker = useRef(null);
  const endMarker = useRef(null);
  const routeLine = useRef(null);
  const wpLayer = useRef(null);
  const es = useRef(null);
  const meta = useRef(null); // route meta for /live/save
  const busy = useRef(false);

  const [svKey, setSvKey] = useState('');
  const [start, setStart] = useState(null);
  const [end, setEnd] = useState(null);
  const [phase, setPhase] = useState('idle');
  const [status, setStatus] = useState('Click the map to set the start point (or right-click).');
  const [count, setCount] = useState(0);
  const [waypoints, setWaypoints] = useState([]);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    getStreetViewKey().then(setSvKey);
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
    setStatus(which === 'start' && !endMarker.current
      ? 'Now click the map to set the end point (or right-click).'
      : 'Ready — press “Auto generate live route”.');
  }

  function openContextMenu(e) {
    if (busy.current) return;
    const Lm = L.current;
    const div = document.createElement('div');
    div.className = 'xtp-ctx';
    const mk = (text, which) => {
      const b = document.createElement('button');
      b.textContent = text;
      b.onclick = () => { place(which, e.latlng); map.current.closePopup(); };
      return b;
    };
    div.appendChild(mk('Set as start (A)', 'start'));
    div.appendChild(mk('Set as end (B)', 'end'));
    Lm.popup().setLatLng(e.latlng).setContent(div).openOn(map.current);
  }

  function clearGenerated() {
    if (wpLayer.current) wpLayer.current.clearLayers();
    if (routeLine.current) { map.current.removeLayer(routeLine.current); routeLine.current = null; }
    meta.current = null;
    setWaypoints([]);
    setSelected(null);
    setCount(0);
  }

  function resetAll() {
    if (es.current) es.current.close();
    busy.current = false;
    clearGenerated();
    [startMarker, endMarker].forEach(r => {
      if (r.current) { map.current.removeLayer(r.current); r.current = null; }
    });
    setStart(null);
    setEnd(null);
    setPhase('idle');
    setStatus('Click the map to set the start point (or right-click).');
  }

  function addMarker(wp) {
    const Lm = L.current;
    const color = wp.kind === 'start' ? '#1c7c2f' : wp.kind === 'destination' ? '#b0271f' : '#1455c0';
    const html = `<div style="background:${color};color:#fff;border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center;border:2px solid #fff;font-size:12px;font-weight:700;box-shadow:0 1px 4px rgba(0,0,0,.4)">${wp.position + 1}</div>`;
    const marker = Lm.marker([wp.lat, wp.lon], {
      icon: Lm.divIcon({ className: 'xtp-wp', html, iconSize: [24, 24], iconAnchor: [12, 12] }),
    });
    marker.on('click', () => setSelected(wp.position));
    marker.addTo(wpLayer.current);
  }

  function generate() {
    if (!start || !end) return;
    clearGenerated();
    busy.current = true;
    setPhase('generating');
    setStatus('Generating route…');
    const source = new EventSource(`${LIVE.generate}?flat=${start.lat}&flon=${start.lon}&tlat=${end.lat}&tlon=${end.lon}`);
    es.current = source;
    let found = 0;

    source.addEventListener('route', e => {
      const data = JSON.parse(e.data);
      routeLine.current = L.current
        .polyline(decodePolyline(data.polyline), { color: '#1455c0', weight: 5, opacity: 0.75 })
        .addTo(map.current);
      map.current.fitBounds(routeLine.current.getBounds(), { padding: [50, 50] });
    });
    source.addEventListener('waypoint', e => {
      const wp = JSON.parse(e.data);
      addMarker(wp);
      setWaypoints(ws => [...ws, wp]);
      found += 1;
      setCount(found);
    });
    source.addEventListener('done', e => {
      meta.current = JSON.parse(e.data);
      setWaypoints(meta.current.waypoints);
      // Drop the A/B endpoint pins — the numbered start/destination waypoint
      // markers now sit on top of them and are otherwise unclickable.
      [startMarker, endMarker].forEach(r => {
        if (r.current) { map.current.removeLayer(r.current); r.current = null; }
      });
      busy.current = false;
      source.close();
      setPhase('preview');
      setStatus(`Done — ${found} guidance points. Click a point to review, then Accept or Reject.`);
    });
    source.addEventListener('failed', e => {
      busy.current = false; source.close(); setPhase('idle');
      let msg = 'generation failed';
      try { msg = JSON.parse(e.data).message; } catch (x) { /* ignore */ }
      setStatus(`Generation failed: ${msg}`);
    });
    source.onerror = () => {
      source.close();
      if (!meta.current) { busy.current = false; setPhase('idle'); setStatus('Connection to the generator was lost.'); }
    };
  }

  async function accept() {
    if (!meta.current) return;
    busy.current = true;
    setPhase('saving');
    setStatus('Saving route…');
    try {
      const r = await fetch(LIVE.save, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...meta.current, waypoints }),
      });
      const data = await r.json();
      if (!r.ok || !data.ok) throw new Error(data.error || `HTTP ${r.status}`);
      busy.current = false; setPhase('saved');
      setStatus(`Saved ✓ live route ${data.id} — returning to editor…`);
      // Return to the cockpit, which reloads the catalog and shows the new route.
      if (router && typeof router.push === 'function') router.push('/create-route');
      else window.location.assign('/create-route');
    } catch (err) {
      busy.current = false; setPhase('preview');
      setStatus(`Save failed: ${err.message}`);
    }
  }

  const generating = phase === 'generating';
  const genDisabled = !start || !end || generating || phase === 'saving';
  const sel = selected != null ? waypoints.find(w => w.position === selected) : null;
  const hasPrev = sel && waypoints.some(w => w.position === sel.position - 1);
  const hasNext = sel && waypoints.some(w => w.position === sel.position + 1);

  return (
    <div className="xtp-wrap">
      <style>{STYLE}</style>
      <div ref={mapEl} className="xtp-map" />

      {sel && (
        <div className="xtp-card">
          <div style={{ position: 'relative' }}>
            <LiveArrowImage wp={sel} svKey={svKey} />
            <button type="button" className="xtp-card-close" onClick={() => setSelected(null)}>×</button>
            <button type="button" className="xtp-nav xtp-nav-l" disabled={!hasPrev} onClick={() => setSelected(sel.position - 1)}>‹</button>
            <button type="button" className="xtp-nav xtp-nav-r" disabled={!hasNext} onClick={() => setSelected(sel.position + 1)}>›</button>
          </div>
          <div className="xtp-card-meta">
            <div className="lbl">{waypointLabel(sel, waypoints)}</div>
            {(() => {
              const v = visionFlagInfo(sel);
              return v ? (
                <div>
                  <span className="xtp-vflag" style={{ background: v.color }}>{v.text}</span>
                  {v.note && <div className="xtp-vnote">“{v.note}”</div>}
                </div>
              ) : null;
            })()}
          </div>
        </div>
      )}

      <div className="xtp-panel">
        <h2>Create live guided route</h2>
        <div className="hint">
          Click the map to set the start, then the end (or right-click for either); drag to adjust.
          Generate places a “head this way” point at the start, a turn point at each junction, and the
          destination — each shown with a live Street View image and a turn arrow.
        </div>
        <div className="xtp-row">
          <Link className="xtp-btn" to="/create-route">‹ Editor</Link>
          <button type="button" className="xtp-btn primary" onClick={generate} disabled={genDisabled}>
            Auto generate live route
          </button>
          <button type="button" className="xtp-btn success" onClick={accept} disabled={phase !== 'preview'}>
            Accept &amp; save
          </button>
          <button type="button" className="xtp-btn" onClick={resetAll} disabled={generating || phase === 'saving'}>
            Reject / reset
          </button>
        </div>
        <div className="xtp-status" style={{ marginTop: 8 }}>
          {generating && <span className="xtp-spin" />}
          <span>{status}{count ? ` (${count})` : ''}</span>
        </div>
      </div>
    </div>
  );
};

LiveCreateRoutePage.propTypes = {
  router: PropTypes.shape({ push: PropTypes.func }),
};

LiveCreateRoutePage.defaultProps = {
  router: undefined,
};

export default LiveCreateRoutePage;
