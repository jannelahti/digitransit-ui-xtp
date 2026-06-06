import React, { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import LiveArrowImage from './LiveArrowImage';
import {
  LIVE,
  LIVE_STYLE,
  decodePolyline,
  distanceMeters,
  getStreetViewKey,
  waypointLabel,
  addBaseLayers,
  waypointMarkerHtml,
} from './liveRoute';

/*
 * XTP Track B — fullscreen guided-walk view (plan §13.4).
 * Layout: route map overview on top (~1/3) with a live "you are here" dot, and
 * the live Street View frame + instruction for the current step on the bottom
 * (~2/3). Steps advance manually (‹ ›) or automatically as GPS nears the next
 * waypoint. `?simgps` walks a simulated position along the route for desktop
 * demos. No images are stored — frames are fetched live from Google.
 */
const STEP_REACHED_M = 30; // auto-advance when within this of the next waypoint

const STYLE = `
.xtp-gwrap { position: relative; height: calc(100vh - 64px); display:flex; flex-direction:column; background:#11151c; }
.xtp-gmap-wrap { position:relative; height:34vh; min-height:150px; flex:none; }
.xtp-gmap { position:absolute; inset:0; }
.xtp-gback{ position:absolute; top:10px; left:10px; z-index:1001; display:flex; align-items:center; gap:4px;
  background:#fff; border:none; border-radius:20px; box-shadow:0 2px 10px rgba(0,0,0,.18);
  padding:6px 14px 6px 11px; font-size:14px; font-weight:600; color:#1c2430; cursor:pointer; }
.xtp-gback:hover{ background:#f1f3f6; }
.xtp-gtitle{ position:absolute; top:10px; left:50%; transform:translateX(-50%); z-index:1000;
  background:#fff; border-radius:20px; box-shadow:0 2px 10px rgba(0,0,0,.18); padding:6px 14px;
  font-size:13px; font-weight:600; color:#1c2430; max-width:calc(100vw - 150px);
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.xtp-gpanel { flex:1; display:flex; flex-direction:column; color:#fff; min-height:0; }
.xtp-gpanel > .xtp-sv { flex:1; min-height:0; }
.xtp-gpanel > .xtp-sv img { width:100%; height:100%; object-fit:cover; }
.xtp-ginstr { padding:12px 16px 2px; font-size:16px; font-weight:700; text-align:center; }
.xtp-gnavrow { display:flex; align-items:center; justify-content:center; gap:18px; padding:8px 16px 14px; }
.xtp-gnav{ border:1px solid #3a4150; background:#1b212b; color:#fff; border-radius:10px;
  width:56px; height:42px; font-size:22px; cursor:pointer; }
.xtp-gnav:hover:not(:disabled){ background:#262e3a; }
.xtp-gnav:disabled{ opacity:.3; cursor:default; }
.xtp-gcount{ font-size:14px; color:#aab2c0; min-width:54px; text-align:center; font-variant-numeric:tabular-nums; }
.xtp-gloading{ padding:40px; text-align:center; color:#5a6270; }
${LIVE_STYLE}
`;

// Point at `meters` along a decoded polyline (lerp within the containing segment).
function pointAlong(path, segLen, total, meters) {
  const m = Math.max(0, Math.min(meters, total));
  let acc = 0;
  for (let i = 0; i < segLen.length; i += 1) {
    if (acc + segLen[i] >= m) {
      const f = segLen[i] ? (m - acc) / segLen[i] : 0;
      return [
        path[i][0] + (path[i + 1][0] - path[i][0]) * f,
        path[i][1] + (path[i + 1][1] - path[i][1]) * f,
      ];
    }
    acc += segLen[i];
  }
  return path[path.length - 1];
}

const LiveGuidePage = ({ match, router }) => {
  const id = match?.params?.id;
  const goBack = () => {
    if (router && typeof router.go === 'function') router.go(-1);
    else window.history.back();
  };
  const mapEl = useRef(null);
  const L = useRef(null);
  const map = useRef(null);
  const wpLayer = useRef(null);
  const markers = useRef({});
  const dot = useRef(null);

  const [svKey, setSvKey] = useState('');
  const [route, setRoute] = useState(null);
  const [error, setError] = useState(null);
  const [step, setStep] = useState(0);
  const [pos, setPos] = useState(null);

  // Load key + route JSON.
  useEffect(() => {
    getStreetViewKey().then(setSvKey);
    fetch(LIVE.route(id))
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setRoute)
      .catch(e => setError(e.message));
  }, [id]);

  // Build the map once the route is loaded (route overview + waypoint markers).
  useEffect(() => {
    if (!route) return undefined;
    let cancelled = false;
    import('leaflet').then(mod => {
      if (cancelled) return;
      const Lm = mod.default || mod;
      L.current = Lm;
      const m = Lm.map(mapEl.current, { zoomControl: true });
      addBaseLayers(Lm, m);
      if (route.polyline) {
        const line = Lm.polyline(decodePolyline(route.polyline), { color: '#1455c0', weight: 5, opacity: 0.75 }).addTo(m);
        m.fitBounds(line.getBounds(), { padding: [40, 40] });
      }
      wpLayer.current = Lm.layerGroup().addTo(m);
      (route.waypoints || []).forEach(wp => {
        const html = waypointMarkerHtml(wp, 24);
        const marker = Lm.marker([wp.lat, wp.lon], {
          icon: Lm.divIcon({ className: 'xtp-wp', html, iconSize: [24, 24], iconAnchor: [12, 12] }),
        });
        marker.on('click', () => setStep(wp.position));
        marker.addTo(wpLayer.current);
        markers.current[wp.position] = marker;
      });
      map.current = m;
      // The container is sized via flex/vh; make sure Leaflet measures it.
      setTimeout(() => map.current && map.current.invalidateSize(), 0);
    });
    return () => {
      cancelled = true;
      if (map.current) { map.current.remove(); map.current = null; }
      markers.current = {};
      dot.current = null;
    };
  }, [route]);

  // Position source: `?simgps` walks the route polyline; otherwise real GPS.
  useEffect(() => {
    if (!route) return undefined;
    const sim = new URLSearchParams(window.location.search).has('simgps');
    if (sim) {
      const path = decodePolyline(route.polyline || '');
      if (path.length < 2) return undefined;
      const segLen = [];
      let total = 0;
      for (let i = 0; i < path.length - 1; i += 1) {
        const d = distanceMeters(
          { lat: path[i][0], lon: path[i][1] },
          { lat: path[i + 1][0], lon: path[i + 1][1] },
        );
        segLen.push(d);
        total += d;
      }
      let traveled = 0;
      const timer = setInterval(() => {
        traveled += 8; // ~8 m per tick → brisk demo walk
        const p = pointAlong(path, segLen, total, traveled);
        setPos({ lat: p[0], lon: p[1] });
        if (traveled >= total) clearInterval(timer);
      }, 400);
      return () => clearInterval(timer);
    }
    if (navigator.geolocation) {
      const wid = navigator.geolocation.watchPosition(
        p => setPos({ lat: p.coords.latitude, lon: p.coords.longitude }),
        () => {},
        { enableHighAccuracy: true, maximumAge: 2000 },
      );
      return () => navigator.geolocation.clearWatch(wid);
    }
    return undefined;
  }, [route]);

  // Draw / move the live "you are here" dot.
  useEffect(() => {
    if (!pos || !map.current || !L.current) return;
    const ll = [pos.lat, pos.lon];
    if (!dot.current) {
      dot.current = L.current
        .circleMarker(ll, { radius: 8, color: '#fff', weight: 3, fillColor: '#1976d2', fillOpacity: 1 })
        .addTo(map.current);
    } else {
      dot.current.setLatLng(ll);
    }
  }, [pos]);

  // Auto-advance the step as the position nears the next waypoint.
  useEffect(() => {
    if (!pos || !route) return;
    const wps = route.waypoints || [];
    const next = wps[step + 1];
    if (next && distanceMeters(pos, { lat: next.lat, lon: next.lon }) <= STEP_REACHED_M) {
      setStep(s => Math.min(s + 1, wps.length - 1));
    }
  }, [pos, step, route]);

  if (error) return <div className="xtp-gloading"><style>{STYLE}</style>Could not load route: {error}</div>;
  if (!route) return <div className="xtp-gloading"><style>{STYLE}</style>Loading…</div>;

  const wps = route.waypoints || [];
  const wp = wps[step];

  return (
    <div className="xtp-gwrap">
      <style>{STYLE}</style>
      <div className="xtp-gmap-wrap">
        <div ref={mapEl} className="xtp-gmap" />
        <button type="button" className="xtp-gback" onClick={goBack}>‹ Back</button>
        <div className="xtp-gtitle">{route.name}</div>
      </div>
      <div className="xtp-gpanel">
        {wp && <LiveArrowImage wp={wp} svKey={svKey} opts={{ w: 640, h: 480, noImage: wp.guidance === false }} />}
        <div className="xtp-ginstr">{wp ? waypointLabel(wp, wps) : ''}</div>
        <div className="xtp-gnavrow">
          <button type="button" className="xtp-gnav" disabled={step <= 0} onClick={() => setStep(step - 1)}>‹</button>
          <span className="xtp-gcount">{step + 1} / {wps.length}</span>
          <button type="button" className="xtp-gnav" disabled={step >= wps.length - 1} onClick={() => setStep(step + 1)}>›</button>
        </div>
      </div>
    </div>
  );
};

LiveGuidePage.propTypes = {
  match: PropTypes.shape({
    params: PropTypes.shape({ id: PropTypes.string }),
  }).isRequired,
  router: PropTypes.shape({ go: PropTypes.func }),
};

LiveGuidePage.defaultProps = {
  router: undefined,
};

export default LiveGuidePage;
