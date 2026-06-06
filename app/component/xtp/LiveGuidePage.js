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
  TRIGGER_DEFAULT_M,
} from './liveRoute';

/*
 * XTP Track B — fullscreen guided-walk view (plan §13.4).
 * Layout: route map overview on top (~1/3) with a live "you are here" dot, and
 * the live Street View frame + instruction for the current step on the bottom
 * (~2/3). Steps advance manually (‹ ›) or automatically as GPS nears the next
 * waypoint. `?simgps` walks a simulated position along the route for desktop
 * demos. No images are stored — frames are fetched live from Google.
 */
const STYLE = `
/* Full-screen map; the guidance card overlays it. */
.xtp-gwrap { position: relative; height: calc(100vh - 64px); background:#11151c; overflow:hidden; }
.xtp-gmap { position:absolute; inset:0; }
.xtp-gback{ position:absolute; top:10px; left:10px; z-index:1100; display:flex; align-items:center; gap:4px;
  background:#fff; border:none; border-radius:20px; box-shadow:0 2px 10px rgba(0,0,0,.18);
  padding:6px 14px 6px 11px; font-size:14px; font-weight:600; color:#1c2430; cursor:pointer; }
.xtp-gback:hover{ background:#f1f3f6; }
.xtp-gsim{ position:absolute; top:50px; left:10px; z-index:1100; border:none; border-radius:20px;
  box-shadow:0 2px 10px rgba(0,0,0,.18); padding:6px 14px; font-size:13px; font-weight:700; cursor:pointer;
  background:#1455c0; color:#fff; }
.xtp-gsim.on{ background:#b0271f; }
.xtp-gsim:hover{ filter:brightness(1.07); }
.xtp-gspeed{ position:absolute; top:90px; left:10px; z-index:1100; border:none; border-radius:20px;
  box-shadow:0 2px 10px rgba(0,0,0,.18); padding:6px 14px; font-size:13px; font-weight:700; cursor:pointer;
  background:#fff; color:#1c2430; min-width:44px; }
.xtp-gspeed:hover{ background:#f1f3f6; }
.xtp-gtitle{ position:absolute; top:10px; left:50%; transform:translateX(-50%); z-index:1100;
  background:#fff; border-radius:20px; box-shadow:0 2px 10px rgba(0,0,0,.18); padding:6px 14px;
  font-size:13px; font-weight:600; color:#1c2430; max-width:calc(100vw - 220px);
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
/* Card over the map. At a point: bottom sheet with Street View + instruction + nav.
 * Between points (#C): shrinks to a bottom-right thumbnail so the map goes near full-screen. */
.xtp-gcard { position:absolute; left:0; right:0; bottom:0; z-index:1000; display:flex; flex-direction:column;
  height:54%; background:#11151c; color:#fff; box-shadow:0 -4px 20px rgba(0,0,0,.45);
  transition: height .3s, width .3s, right .3s, bottom .3s, border-radius .3s; }
.xtp-gcard > .xtp-sv { flex:1; min-height:0; }
.xtp-gcard > .xtp-sv img { width:100%; height:100%; object-fit:cover; }
.xtp-gcard.mini { left:auto; right:12px; bottom:12px; width:42%; max-width:240px; height:30%; min-height:120px;
  border-radius:12px; overflow:hidden; opacity:.95; box-shadow:0 4px 16px rgba(0,0,0,.5); }
.xtp-gcard.mini .xtp-gnavrow { display:none; }
.xtp-gcard.mini .xtp-ginstr { font-size:12px; padding:6px 10px 8px; }
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
  const radiusCircle = useRef(null); // trigger radius of the current step
  const routeBounds = useRef(null); // whole-route bounds, for the initial fit
  const simUsed = useRef(false); // once true, stopping sim freezes instead of grabbing real GPS
  const followedOnce = useRef(false); // zoom-to-walk once, then pan to follow

  const [svKey, setSvKey] = useState('');
  const [route, setRoute] = useState(null);
  const [mapReady, setMapReady] = useState(false);
  const [error, setError] = useState(null);
  const [step, setStep] = useState(0);
  const [pos, setPos] = useState(null);
  const stepRef = useRef(0);
  stepRef.current = step; // latest step for the marker-build effect (runs on [route])
  const [sim, setSim] = useState(
    () => typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('simgps'),
  );
  const [speed, setSpeed] = useState(1); // 1× / 2× / 3× sim speed
  const speedRef = useRef(1);
  speedRef.current = speed; // read by the sim interval without restarting it

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
        routeBounds.current = line.getBounds();
      }
      wpLayer.current = Lm.layerGroup().addTo(m);
      (route.waypoints || []).forEach(wp => {
        const html = waypointMarkerHtml(wp, 24, wp.position === stepRef.current);
        const marker = Lm.marker([wp.lat, wp.lon], {
          icon: Lm.divIcon({ className: 'xtp-wp', html, iconSize: [24, 24], iconAnchor: [12, 12] }),
        });
        marker.on('click', () => setStep(wp.position));
        marker.addTo(wpLayer.current);
        markers.current[wp.position] = marker;
      });
      map.current = m;
      setMapReady(true);
      // Measure the full-screen container, then frame the whole route in the area
      // above the bottom card (so it isn't hidden behind the photo sheet).
      setTimeout(() => {
        if (!map.current) return;
        map.current.invalidateSize();
        if (routeBounds.current) {
          const h = mapEl.current ? mapEl.current.clientHeight : 0;
          map.current.fitBounds(routeBounds.current, {
            paddingTopLeft: [40, 70],
            paddingBottomRight: [40, Math.round(h * 0.56) + 20],
          });
        }
      }, 0);
    });
    return () => {
      cancelled = true;
      if (map.current) { map.current.remove(); map.current = null; }
      markers.current = {};
      dot.current = null;
      radiusCircle.current = null;
      setMapReady(false);
    };
  }, [route]);

  // Draw the NEXT point's trigger radius on the map (#B) — the upcoming zone you're
  // walking toward, which will advance the guide / flip the photo to full when entered.
  useEffect(() => {
    const Lm = L.current;
    if (!mapReady || !Lm || !map.current) return;
    if (radiusCircle.current) { map.current.removeLayer(radiusCircle.current); radiusCircle.current = null; }
    const wlist = route?.waypoints || [];
    const idxs = [...new Set([step, Math.min(step + 1, wlist.length - 1)])];
    const grp = Lm.layerGroup();
    idxs.forEach(i => {
      const w = wlist[i];
      if (!w) return;
      grp.addLayer(Lm.circle([w.lat, w.lon], {
        radius: w.triggerM ?? TRIGGER_DEFAULT_M,
        color: '#ff2d2d', weight: 1, fillColor: '#ff2d2d',
        fillOpacity: i === step ? 0.06 : 0.13, // current dim, next brighter
      }));
    });
    grp.addTo(map.current);
    radiusCircle.current = grp;
  }, [step, route, mapReady]);

  // Position source: simulation walks the route polyline (the ▶ Simulate toggle or
  // `?simgps`); otherwise real GPS.
  useEffect(() => {
    if (!route) return undefined;
    if (sim) {
      simUsed.current = true; // remember we're in preview mode
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
      setStep(0); // walk from the start whenever simulation begins
      let traveled = 0;
      const timer = setInterval(() => {
        traveled += speedRef.current; // 1 m × speed per tick
        const p = pointAlong(path, segLen, total, traveled);
        setPos({ lat: p[0], lon: p[1] });
        if (traveled >= total) { clearInterval(timer); setSim(false); } // reset toggle so ▶ restarts
      }, 500); // 1× ≈ 2 m/s; 2×/3× scale up
      return () => clearInterval(timer);
    }
    // Real GPS for actual walking — but once the user has previewed with the
    // simulator, stopping it should FREEZE (not jump to the device's real location).
    if (!simUsed.current && navigator.geolocation) {
      const wid = navigator.geolocation.watchPosition(
        p => setPos({ lat: p.coords.latitude, lon: p.coords.longitude }),
        () => {},
        { enableHighAccuracy: true, maximumAge: 2000 },
      );
      return () => navigator.geolocation.clearWatch(wid);
    }
    return undefined;
  }, [route, sim]);

  // Draw / move the live "you are here" dot.
  useEffect(() => {
    if (!pos || !map.current || !L.current) return;
    const ll = [pos.lat, pos.lon];
    if (!dot.current) {
      dot.current = L.current
        .circleMarker(ll, { radius: 11, color: '#fff', weight: 3, fillColor: '#ff8a00', fillOpacity: 1 })
        .addTo(map.current);
    } else {
      dot.current.setLatLng(ll);
    }
    // Follow progress: zoom in to walking level the first time we get a position,
    // then pan to keep the dot centred (respecting any manual zoom).
    if (!followedOnce.current) {
      map.current.setView(ll, Math.max(map.current.getZoom(), 17), { animate: true });
      followedOnce.current = true;
    } else {
      map.current.panTo(ll, { animate: true, duration: 0.4 });
    }
  }, [pos]);

  // Auto-advance: jump to the FURTHEST upcoming waypoint we're within range of, so a
  // skipped or under-triggered point doesn't strand the guide. Monotonic forward only
  // (never goes back, never re-fires a passed point). Per-point radius (triggerM).
  useEffect(() => {
    if (!pos || !route) return;
    const wps = route.waypoints || [];
    let target = step;
    for (let i = step + 1; i < wps.length; i += 1) {
      const radius = wps[i].triggerM ?? TRIGGER_DEFAULT_M;
      if (distanceMeters(pos, { lat: wps[i].lat, lon: wps[i].lon }) <= radius) target = i;
    }
    if (target !== step) setStep(target);
  }, [pos, step, route]);

  // Highlight the current step's marker (red ring); plain ring for the rest.
  useEffect(() => {
    const Lm = L.current;
    if (!Lm) return;
    (route?.waypoints || []).forEach(wp => {
      const m = markers.current[wp.position];
      if (m) {
        m.setIcon(Lm.divIcon({
          className: 'xtp-wp',
          html: waypointMarkerHtml(wp, 24, wp.position === step),
          iconSize: [24, 24],
          iconAnchor: [12, 12],
        }));
      }
    });
  }, [step, route]);

  if (error) return <div className="xtp-gloading"><style>{STYLE}</style>Could not load route: {error}</div>;
  if (!route) return <div className="xtp-gloading"><style>{STYLE}</style>Loading…</div>;

  const wps = route.waypoints || [];
  const wp = wps[step];
  // "At this point" when within its trigger radius (or when we have no GPS fix yet) —
  // drives the photo emphasis. Between points the photo shrinks/dims (#C).
  const curRadius = wp && wp.triggerM != null ? wp.triggerM : TRIGGER_DEFAULT_M;
  const atPoint = !pos || (wp && distanceMeters(pos, { lat: wp.lat, lon: wp.lon }) <= curRadius);

  return (
    <div className="xtp-gwrap">
      <style>{STYLE}</style>
      <div ref={mapEl} className="xtp-gmap" />
      <button type="button" className="xtp-gback" onClick={goBack}>‹ Back</button>
      <div className="xtp-gtitle">{route.name}</div>
      <button type="button" className={`xtp-gsim${sim ? ' on' : ''}`} onClick={() => setSim(s => !s)}>
        {sim ? '⏸ Stop' : '▶ Simulate'}
      </button>
      {sim && (
        <button type="button" className="xtp-gspeed" onClick={() => setSpeed(s => (s % 3) + 1)} title="Simulation speed">
          {speed}×
        </button>
      )}
      <div className={`xtp-gcard${atPoint ? '' : ' mini'}`}>
        {wp && <LiveArrowImage key={step} wp={wp} svKey={svKey} opts={{ w: 640, h: 480, noImage: wp.guidance === false }} />}
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
