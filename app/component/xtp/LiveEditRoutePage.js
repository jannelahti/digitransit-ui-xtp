import React, { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { Link } from 'found';
import LiveArrowImage from './LiveArrowImage';
import {
  LIVE,
  LIVE_STYLE,
  decodePolyline,
  getStreetViewKey,
  streetViewUrl,
  waypointLabel,
  visionFlagInfo,
  bearing,
  signedTurn,
  addBaseLayers,
  waypointMarkerHtml,
  TRIGGER_DEFAULT_M,
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

.xtp-card{ position:fixed; top:80px; left:16px; z-index:2100;
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
.xtp-fld{ display:block; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.05em; color:#9aa3b2; margin:10px 0 4px; }
.xtp-subhint{ font-size:11px; color:#8a93a2; margin-top:4px; }
.xtp-instr{ width:100%; box-sizing:border-box; resize:vertical; border:1px solid #2b3340; border-radius:8px;
  background:#0c1018; color:#fff; font:inherit; font-size:13px; padding:7px 9px; }
.xtp-instr::placeholder{ color:#69727f; }
.xtp-mini{ margin-top:6px; border:1px solid #3a4150; background:#1b212b; color:#cdd3dd; border-radius:7px;
  padding:5px 10px; font-size:12px; font-weight:600; cursor:pointer; }
.xtp-mini:hover:not(:disabled){ background:#262e3a; }
.xtp-mini:disabled{ opacity:.45; cursor:default; }
.xtp-mini.wide{ display:block; width:100%; margin-top:10px; }
.xtp-check{ display:flex; align-items:center; gap:8px; margin-top:10px; font-size:13px; color:#cdd3dd; cursor:pointer; }
.xtp-check input{ width:16px; height:16px; }
.xtp-cands{ display:flex; gap:6px; margin-top:8px; }
.xtp-cand{ flex:1; position:relative; padding:0; border:2px solid transparent; border-radius:8px; overflow:hidden;
  background:#000; cursor:pointer; line-height:0; }
.xtp-cand.best{ border-color:#1f7a3d; }
.xtp-cand img{ display:block; width:100%; height:auto; }
.xtp-cand-deg{ position:absolute; left:0; right:0; bottom:0; padding:2px 0; text-align:center;
  font-size:10px; font-weight:700; color:#fff; background:rgba(0,0,0,.55); line-height:1.2; }
.xtp-gloading{ padding:40px; text-align:center; color:#5a6270; }
${LIVE_STYLE}
`;

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
  const circle = useRef(null); // trigger-radius circle for the selected point
  const busy = useRef(false);

  const [svKey, setSvKey] = useState('');
  const [meta, setMeta] = useState(null); // name + addresses + start/end + polyline
  const [waypoints, setWaypoints] = useState([]);
  const [selected, setSelected] = useState(null);
  const [reframe, setReframe] = useState(null); // { position, candidates, best, flag, note, fov }
  const [reframing, setReframing] = useState(false);
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
      addBaseLayers(Lm, m);
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
      const html = waypointMarkerHtml(wp, 26);
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

  // Show the selected point's GPS trigger radius as a circle on the map (#B), and
  // keep it in sync as the radius slider or the point's position changes.
  useEffect(() => {
    const Lm = L.current;
    if (!mapReady || !Lm || !map.current) return;
    if (circle.current) { map.current.removeLayer(circle.current); circle.current = null; }
    const wp = selected != null ? waypoints.find(w => w.position === selected) : null;
    if (wp) {
      circle.current = Lm.circle([wp.lat, wp.lon], {
        radius: wp.triggerM ?? TRIGGER_DEFAULT_M,
        color: '#ff2d2d', weight: 1, fillColor: '#ff2d2d', fillOpacity: 0.12,
      }).addTo(map.current);
    }
  }, [selected, waypoints, mapReady]);

  // Drag: update position + recompute the affected neighbourhood only (so manual
  // heading/FOV tweaks on other points survive).
  // Candidate filmstrip belongs to one point — drop it when the selection changes.
  useEffect(() => { setReframe(null); }, [selected]);

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

  // Ask the sidecar to re-frame the selected point: it returns candidate headings
  // and (if the AI key is set) which one best shows the way + a flag/note. We show
  // the candidates as a filmstrip; the author clicks one to apply it. No pixels are
  // returned — the thumbnails are fetched client-side from each candidate heading.
  async function reframeSelected() {
    const wp = waypoints.find(w => w.position === selected);
    if (!wp) return;
    setReframing(true);
    setStatus('Asking the AI to re-frame this point…');
    try {
      const r = await fetch(LIVE.reframe, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lat: wp.lat, lon: wp.lon, camLat: wp.camLat, camLon: wp.camLon,
          heading: wp.heading, turnAngle: wp.turnAngle, kind: wp.kind, streetName: wp.streetName,
        }),
      });
      const data = await r.json();
      if (!r.ok || !data.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setReframe({ position: selected, ...data });
      setStatus(
        data.best != null
          ? `AI suggests candidate ${data.best + 1} (${data.flag}). Click one to apply.`
          : 'Pick the candidate frame that best shows the way.',
      );
    } catch (e) {
      setStatus(`Re-frame failed: ${e.message}`);
    } finally {
      setReframing(false);
    }
  }

  // Apply one re-frame candidate to the selected point: set its heading (+ fov), and
  // carry the AI flag/note only when applying the AI's own pick.
  function applyCandidate(idx) {
    if (!reframe) return;
    const heading = reframe.candidates[idx];
    const isBest = idx === reframe.best;
    patchSelected({
      heading: Math.round(heading),
      fov: reframe.fov ?? 90,
      ...(isBest && reframe.flag ? { visionFlag: reframe.flag } : {}),
      ...(isBest && reframe.note ? { visionNote: reframe.note } : {}),
    });
    setStatus(`Applied candidate ${idx + 1}${isBest ? ' (AI pick)' : ''}.`);
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
  // The automatic instruction (derived maneuver + distance, step counter stripped) —
  // what the inline field shows when there's no custom override.
  const autoText = sel
    ? waypointLabel({ ...sel, instruction: null }, waypoints).replace(/\s*\(\d+\/\d+\)\s*$/, '')
    : '';

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
            {(() => {
              const v = visionFlagInfo(sel);
              return v ? (
                <div>
                  <span className="xtp-vflag" style={{ background: v.color }}>{v.text}</span>
                  {v.note && <div className="xtp-vnote">“{v.note}”</div>}
                </div>
              ) : null;
            })()}

            {/* #1/#5 — edit the guide text IN PLACE. The field shows exactly what the
                guide displays; clear it to fall back to the automatic instruction. */}
            <label className="xtp-fld">Instruction (step {sel.position + 1}/{waypoints.length})</label>
            <textarea
              className="xtp-instr"
              rows={2}
              value={sel.instruction || autoText}
              onChange={e => patchSelected({ instruction: e.target.value === '' ? null : e.target.value })}
            />
            <div className="xtp-subhint">
              {sel.instruction ? 'Custom — clear the field to revert to automatic.' : 'Automatic — edit to customise.'}
            </div>
            {sel.visionNote && (
              <button type="button" className="xtp-mini" onClick={() => patchSelected({ instruction: sel.visionNote })}>
                Use AI note
              </button>
            )}

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

            {/* #2 — arrow-direction override (+ = right); reset clears it back to geometry. */}
            <div className="xtp-slider">
              <span>Arrow</span>
              <input
                type="range" min="-100" max="100" step="5"
                value={Math.round(sel.arrowDeg ?? sel.turnAngle ?? 0)}
                onChange={e => patchSelected({ arrowDeg: Number(e.target.value) })}
              />
              <span className="val">{Math.round(sel.arrowDeg ?? sel.turnAngle ?? 0)}°</span>
            </div>
            {sel.arrowDeg != null && (
              <button type="button" className="xtp-mini" onClick={() => patchSelected({ arrowDeg: null })}>
                Reset arrow to geometry
              </button>
            )}

            {/* #B — GPS auto-advance radius for this point (drawn as a circle on the map). */}
            <div className="xtp-slider">
              <span>Radius</span>
              <input
                type="range" min="10" max="100" step="5"
                value={sel.triggerM ?? TRIGGER_DEFAULT_M}
                onChange={e => patchSelected({ triggerM: Number(e.target.value) })}
              />
              <span className="val">{sel.triggerM ?? TRIGGER_DEFAULT_M} m</span>
            </div>

            {/* #4 — does this point show a Street View photo in the guide? */}
            <label className="xtp-check">
              <input
                type="checkbox"
                checked={sel.guidance !== false}
                onChange={e => patchSelected({ guidance: e.target.checked })}
              />
              Show Street View photo here
            </label>

            {/* #3 — on-demand AI re-frame + candidate filmstrip. */}
            <button type="button" className="xtp-mini wide" disabled={reframing} onClick={reframeSelected}>
              {reframing ? 'Re-framing…' : 'Re-frame with AI'}
            </button>
            {reframe && reframe.position === sel.position && (
              <div className="xtp-cands">
                {reframe.candidates.map((h, i) => (
                  <button
                    key={i} // eslint-disable-line react/no-array-index-key
                    type="button"
                    className={`xtp-cand${i === reframe.best ? ' best' : ''}`}
                    title={`${Math.round(h)}°${i === reframe.best ? ' — AI pick' : ''}`}
                    onClick={() => applyCandidate(i)}
                  >
                    <img
                      src={streetViewUrl({ ...sel, heading: h }, svKey, { w: 160, h: 110, scale: 1, fov: reframe.fov ?? 90 })}
                      alt={`Candidate ${i + 1}`}
                    />
                    <span className="xtp-cand-deg">{Math.round(h)}°{i === reframe.best ? ' ★' : ''}</span>
                  </button>
                ))}
              </div>
            )}

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
          <Link className="xtp-btn" to="/create-route">Back to editor</Link>
          <div className="xtp-spacer" />
          <Link className="xtp-btn" to={`/routes/${id}`}>Preview</Link>
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
