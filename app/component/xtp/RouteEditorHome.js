import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'found';
import { LIVE, decodePolyline } from './liveRoute';

/*
 * XTP /v2 — Route-editor cockpit (VTT-only curation). A full map with a side
 * list of all routes (active + inactive). Picking a route drops its line +
 * waypoints on the map and reveals actions (edit / activate-deactivate / delete /
 * preview). "+ Add new guided route" starts the create flow. Routes are JSON in
 * the sidecar live store; the management write endpoints stay VTT-only at nginx.
 */
const STYLE = `
.xtp-cock { position:relative; height:calc(100vh - 64px); }
.xtp-cock-map { position:absolute; inset:0; }
.xtp-cock-panel { position:absolute; top:16px; left:16px; bottom:16px; z-index:1500;
  width:min(330px, calc(100vw - 32px)); background:#fff; border-radius:12px;
  box-shadow:0 6px 24px rgba(0,0,0,.22); display:flex; flex-direction:column; overflow:hidden; }
.xtp-cock-head { padding:14px 16px 10px; border-bottom:1px solid #eef0f3; }
.xtp-cock-head h1 { font-size:18px; margin:0 0 10px; }
.xtp-cock-add { display:inline-block; border:1px solid #1455c0; background:#1455c0; color:#fff;
  border-radius:8px; padding:8px 14px; font-size:14px; font-weight:600; text-decoration:none; }
.xtp-cock-add:hover { background:#0e459f; }
.xtp-cock-list { overflow-y:auto; padding:8px; flex:1; }
.xtp-cock-card { border:1px solid #e1e5ea; border-radius:10px; padding:11px 12px; margin-bottom:8px; cursor:pointer; }
.xtp-cock-card:hover { border-color:#c7ccd4; }
.xtp-cock-card.sel { border-color:#1455c0; box-shadow:0 0 0 1px #1455c0 inset; }
.xtp-cock-card .top { display:flex; align-items:baseline; gap:8px; }
.xtp-cock-card .name { font-size:14px; font-weight:700; color:#1c2430; flex:1; }
.xtp-badge { font-size:10px; font-weight:700; border-radius:20px; padding:2px 8px; white-space:nowrap; }
.xtp-badge.on { background:#e3f4e7; color:#1c7c2f; }
.xtp-badge.off { background:#f0f1f3; color:#7a828e; }
.xtp-cock-card .od { color:#3a4150; font-size:12px; margin-top:2px; }
.xtp-cock-card .meta { color:#7a828e; font-size:11px; margin-top:3px; }
.xtp-cock-acts { display:flex; gap:6px; margin-top:10px; flex-wrap:wrap; }
.xtp-act { border:1px solid #c7ccd4; background:#fff; color:#1c2430; border-radius:7px;
  padding:5px 10px; font-size:12px; font-weight:600; cursor:pointer; text-decoration:none; }
.xtp-act:hover:not(:disabled) { background:#f1f3f6; }
.xtp-act:disabled { opacity:.45; cursor:default; }
.xtp-act.danger { color:#b0271f; border-color:#e3b4b0; }
.xtp-act.danger:hover:not(:disabled) { background:#fbecea; }
.xtp-cock-empty { color:#5a6270; font-size:13px; padding:16px 8px; }
`;

const colorFor = kind =>
  kind === 'start' ? '#1c7c2f' : kind === 'destination' ? '#b0271f' : '#1455c0';

const RouteEditorHome = () => {
  const mapEl = useRef(null);
  const L = useRef(null);
  const map = useRef(null);
  const pinLayer = useRef(null);
  const routeLayer = useRef(null);

  const [routes, setRoutes] = useState(null);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [mapReady, setMapReady] = useState(false);

  const load = useCallback(() => {
    fetch(LIVE.catalogAll)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(d => { setRoutes(d.routes || []); setError(null); })
      .catch(e => setError(e.message));
  }, []);

  useEffect(() => { load(); }, [load]);

  // Build the map once.
  useEffect(() => {
    let cancelled = false;
    import('leaflet').then(mod => {
      if (cancelled) return;
      const Lm = mod.default || mod;
      L.current = Lm;
      const m = Lm.map(mapEl.current, { zoomControl: true }).setView([61.4978, 23.761], 13);
      Lm.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        subdomains: 'abcd', maxZoom: 20, detectRetina: true,
        attribution: '© OpenStreetMap, © CARTO',
      }).addTo(m);
      pinLayer.current = Lm.layerGroup().addTo(m);
      routeLayer.current = Lm.layerGroup().addTo(m);
      map.current = m;
      setMapReady(true);
    });
    return () => {
      cancelled = true;
      if (map.current) { map.current.remove(); map.current = null; }
      pinLayer.current = null; routeLayer.current = null; setMapReady(false);
    };
  }, []);

  // One pin per route (at its start), so the whole set is visible at a glance.
  useEffect(() => {
    const Lm = L.current;
    if (!mapReady || !Lm || !pinLayer.current || !routes) return;
    pinLayer.current.clearLayers();
    routes.forEach(r => {
      if (!r.start) return;
      const bg = r.active ? '#1455c0' : '#9aa1ac';
      const html = `<div style="background:${bg};color:#fff;border-radius:50% 50% 50% 0;width:22px;height:22px;transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`;
      const marker = Lm.marker([r.start.lat, r.start.lon], {
        icon: Lm.divIcon({ className: 'xtp-rpin', html, iconSize: [22, 22], iconAnchor: [11, 22] }),
      });
      marker.on('click', () => setSelectedId(r.id));
      marker.addTo(pinLayer.current);
    });
  }, [routes, mapReady]);

  // Draw the selected route's line + waypoints.
  useEffect(() => {
    const Lm = L.current;
    if (!mapReady || !Lm || !routeLayer.current) return undefined;
    routeLayer.current.clearLayers();
    if (!selectedId) return undefined;
    let cancelled = false;
    fetch(LIVE.route(selectedId))
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(route => {
        if (cancelled || !routeLayer.current) return;
        if (route.polyline) {
          const line = Lm.polyline(decodePolyline(route.polyline), { color: '#1455c0', weight: 5, opacity: 0.8 }).addTo(routeLayer.current);
          map.current.fitBounds(line.getBounds(), { padding: [60, 60], maxZoom: 17 });
        }
        (route.waypoints || []).forEach(wp => {
          const html = `<div style="background:${colorFor(wp.kind)};color:#fff;border-radius:50%;width:22px;height:22px;display:flex;align-items:center;justify-content:center;border:2px solid #fff;font-size:11px;font-weight:700;box-shadow:0 1px 4px rgba(0,0,0,.4)">${wp.position + 1}</div>`;
          Lm.marker([wp.lat, wp.lon], {
            icon: Lm.divIcon({ className: 'xtp-wp', html, iconSize: [22, 22], iconAnchor: [11, 11] }),
          }).addTo(routeLayer.current);
        });
      })
      .catch(() => { /* selection draw is best-effort */ });
    return () => { cancelled = true; };
  }, [selectedId, mapReady]);

  const toggleActive = async r => {
    setBusyId(r.id);
    try {
      const res = await fetch(LIVE.route(r.id), {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !r.active }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      load();
    } catch (e) { setError(e.message); } finally { setBusyId(null); }
  };

  const remove = async r => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Delete “${r.name}”? This cannot be undone.`)) return;
    setBusyId(r.id);
    try {
      const res = await fetch(LIVE.route(r.id), { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (selectedId === r.id) setSelectedId(null);
      load();
    } catch (e) { setError(e.message); } finally { setBusyId(null); }
  };

  return (
    <div className="xtp-cock">
      <style>{STYLE}</style>
      <div ref={mapEl} className="xtp-cock-map" />
      <div className="xtp-cock-panel">
        <div className="xtp-cock-head">
          <h1>Route editor</h1>
          <Link to="/v2/route-editor/new" className="xtp-cock-add">+ Add new guided route</Link>
        </div>
        <div className="xtp-cock-list">
          {error && <div className="xtp-cock-empty">Error: {error}</div>}
          {!error && routes == null && <div className="xtp-cock-empty">Loading…</div>}
          {!error && routes && routes.length === 0 && (
            <div className="xtp-cock-empty">No routes yet — add the first one.</div>
          )}
          {routes && routes.map(r => (
            <div
              key={r.id}
              className={`xtp-cock-card${selectedId === r.id ? ' sel' : ''}`}
              onClick={() => setSelectedId(r.id)}
              role="button"
              tabIndex={0}
              onKeyDown={e => { if (e.key === 'Enter') setSelectedId(r.id); }}
            >
              <div className="top">
                <span className="name">{r.name}</span>
                <span className={`xtp-badge ${r.active ? 'on' : 'off'}`}>{r.active ? 'Active' : 'Inactive'}</span>
              </div>
              <div className="od">{r.startAddress} → {r.endAddress}</div>
              <div className="meta">{r.waypoints} points</div>
              {selectedId === r.id && (
                <div className="xtp-cock-acts" onClick={e => e.stopPropagation()}>
                  <Link className="xtp-act" to={`/v2/route-editor/${r.id}`}>Edit</Link>
                  <Link className="xtp-act" to={`/v2/routes/${r.id}`}>Preview</Link>
                  <button type="button" className="xtp-act" disabled={busyId === r.id} onClick={() => toggleActive(r)}>
                    {r.active ? 'Deactivate' : 'Activate'}
                  </button>
                  <button type="button" className="xtp-act danger" disabled={busyId === r.id} onClick={() => remove(r)}>
                    Delete
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default RouteEditorHome;
