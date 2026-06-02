import React, { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import LiveArrowImage from './LiveArrowImage';
import { LIVE, LIVE_STYLE, decodePolyline, getStreetViewKey, waypointLabel } from './liveRoute';

/*
 * XTP Track B — live guide view (plan §13.4). Loads a route's JSON description
 * from the sidecar and walks the traveler through it: a map with the route line
 * + numbered waypoints, and a card showing the live Street View frame with the
 * turn arrow for the current step. No images are stored — the frame is fetched
 * live from Google here.
 */
const STYLE = `
.xtp-wrap { position: relative; height: calc(100vh - 64px); }
.xtp-map { position: absolute; inset: 0; }
.xtp-gcard{ position:fixed; bottom:16px; left:50%; transform:translateX(-50%); z-index:2100;
  width:min(360px,calc(100vw - 32px)); background:#11151c; color:#fff; border-radius:12px;
  overflow:hidden; box-shadow:0 8px 28px rgba(0,0,0,.4); }
.xtp-gcard-meta{ padding:10px 12px; display:flex; align-items:center; gap:10px; }
.xtp-gcard-meta .lbl{ font-size:13px; font-weight:700; flex:1; }
.xtp-gnav{ border:1px solid #3a4150; background:#1b212b; color:#fff; border-radius:8px;
  width:38px; height:34px; font-size:20px; line-height:30px; cursor:pointer; }
.xtp-gnav:hover:not(:disabled){ background:#262e3a; }
.xtp-gnav:disabled{ opacity:.3; cursor:default; }
.xtp-gtitle{ position:fixed; top:76px; left:50%; transform:translateX(-50%); z-index:2000;
  background:#fff; border-radius:20px; box-shadow:0 2px 10px rgba(0,0,0,.18); padding:6px 16px;
  font-size:14px; font-weight:600; color:#1c2430; max-width:calc(100vw - 32px); }
.xtp-gloading{ padding:40px; text-align:center; color:#5a6270; }
${LIVE_STYLE}
`;

const LiveGuidePage = ({ match }) => {
  const id = match?.params?.id;
  const mapEl = useRef(null);
  const L = useRef(null);
  const map = useRef(null);
  const wpLayer = useRef(null);
  const markers = useRef({});

  const [svKey, setSvKey] = useState('');
  const [route, setRoute] = useState(null);
  const [error, setError] = useState(null);
  const [step, setStep] = useState(0);

  // Load key + route JSON.
  useEffect(() => {
    getStreetViewKey().then(setSvKey);
    fetch(LIVE.route(id))
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setRoute)
      .catch(e => setError(e.message));
  }, [id]);

  // Build the map once the route is loaded.
  useEffect(() => {
    if (!route) return undefined;
    let cancelled = false;
    import('leaflet').then(mod => {
      if (cancelled) return;
      const Lm = mod.default || mod;
      L.current = Lm;
      const m = Lm.map(mapEl.current, { zoomControl: true });
      Lm.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        subdomains: 'abcd',
        maxZoom: 20,
        detectRetina: true,
        attribution: '© OpenStreetMap, © CARTO',
      }).addTo(m);
      if (route.polyline) {
        const line = Lm.polyline(decodePolyline(route.polyline), { color: '#1455c0', weight: 5, opacity: 0.75 }).addTo(m);
        m.fitBounds(line.getBounds(), { padding: [50, 50] });
      }
      wpLayer.current = Lm.layerGroup().addTo(m);
      (route.waypoints || []).forEach(wp => {
        const color = wp.kind === 'start' ? '#1c7c2f' : wp.kind === 'destination' ? '#b0271f' : '#1455c0';
        const html = `<div style="background:${color};color:#fff;border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center;border:2px solid #fff;font-size:12px;font-weight:700;box-shadow:0 1px 4px rgba(0,0,0,.4)">${wp.position + 1}</div>`;
        const marker = Lm.marker([wp.lat, wp.lon], {
          icon: Lm.divIcon({ className: 'xtp-wp', html, iconSize: [24, 24], iconAnchor: [12, 12] }),
        });
        marker.on('click', () => setStep(wp.position));
        marker.addTo(wpLayer.current);
        markers.current[wp.position] = marker;
      });
      map.current = m;
    });
    return () => {
      cancelled = true;
      if (map.current) { map.current.remove(); map.current = null; }
      markers.current = {};
    };
  }, [route]);

  // Pan to the active waypoint as the traveler steps.
  useEffect(() => {
    const wp = route?.waypoints?.[step];
    if (wp && map.current) map.current.panTo([wp.lat, wp.lon]);
  }, [step, route]);

  if (error) return <div className="xtp-gloading"><style>{STYLE}</style>Could not load route: {error}</div>;
  if (!route) return <div className="xtp-gloading"><style>{STYLE}</style>Loading…</div>;

  const wps = route.waypoints || [];
  const wp = wps[step];

  return (
    <div className="xtp-wrap">
      <style>{STYLE}</style>
      <div ref={mapEl} className="xtp-map" />
      <div className="xtp-gtitle">{route.name}</div>

      {wp && (
        <div className="xtp-gcard">
          <LiveArrowImage wp={wp} svKey={svKey} opts={{ w: 640, h: 400, fov: 90 }} />
          <div className="xtp-gcard-meta">
            <button type="button" className="xtp-gnav" disabled={step <= 0} onClick={() => setStep(step - 1)}>‹</button>
            <span className="lbl">{waypointLabel(wp, wps.length)}</span>
            <button type="button" className="xtp-gnav" disabled={step >= wps.length - 1} onClick={() => setStep(step + 1)}>›</button>
          </div>
        </div>
      )}
    </div>
  );
};

LiveGuidePage.propTypes = {
  match: PropTypes.shape({
    params: PropTypes.shape({ id: PropTypes.string }),
  }).isRequired,
};

export default LiveGuidePage;
