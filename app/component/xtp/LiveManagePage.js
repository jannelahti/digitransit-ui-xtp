import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'found';
import { LIVE } from './liveRoute';

/*
 * XTP Track B — management hub for live guided routes. Lists every route (active
 * + inactive) and offers create / edit / delete / activate-deactivate. The
 * tester-facing list (/live-reitit) shows active routes only; this page is where
 * routes are curated. No per-user auth — the network gate is the only gate, and
 * the write endpoints (PUT/DELETE) stay VTT-only at nginx.
 */
const STYLE = `
.xtp-mng { max-width: 760px; margin: 0 auto; padding: 20px 16px 40px; }
.xtp-mng h1 { font-size: 22px; margin: 0 0 4px; }
.xtp-mng .sub { color:#5a6270; font-size:14px; margin: 0 0 18px; }
.xtp-mng .bar { display:flex; gap:12px; align-items:center; margin-bottom:18px; }
.xtp-mng .create { display:inline-block; border:1px solid #1455c0; background:#1455c0;
  color:#fff; border-radius:8px; padding:8px 14px; font-size:14px; font-weight:600; text-decoration:none; }
.xtp-mng .create:hover { background:#0e459f; }
.xtp-mng .toview { color:#1455c0; font-size:14px; text-decoration:none; }
.xtp-mng .toview:hover { text-decoration:underline; }
.xtp-row { border:1px solid #e1e5ea; border-radius:10px; padding:14px 16px; margin-bottom:10px; }
.xtp-row .top { display:flex; align-items:baseline; gap:8px; }
.xtp-row .name { font-size:16px; font-weight:700; color:#1c2430; }
.xtp-row .od { color:#3a4150; font-size:14px; margin-top:2px; }
.xtp-row .meta { color:#7a828e; font-size:12px; margin-top:4px; }
.xtp-badge { font-size:11px; font-weight:700; border-radius:20px; padding:2px 9px; }
.xtp-badge.on { background:#e3f4e7; color:#1c7c2f; }
.xtp-badge.off { background:#f0f1f3; color:#7a828e; }
.xtp-row .acts { display:flex; gap:8px; margin-top:12px; flex-wrap:wrap; }
.xtp-act { border:1px solid #c7ccd4; background:#fff; color:#1c2430; border-radius:8px;
  padding:6px 12px; font-size:13px; font-weight:600; cursor:pointer; text-decoration:none; }
.xtp-act:hover:not(:disabled) { background:#f1f3f6; }
.xtp-act:disabled { opacity:.45; cursor:default; }
.xtp-act.danger { color:#b0271f; border-color:#e3b4b0; }
.xtp-act.danger:hover:not(:disabled) { background:#fbecea; }
.xtp-empty { color:#5a6270; font-size:14px; padding:20px 0; }
`;

const fmt = iso => {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
};

const LiveManagePage = () => {
  const [routes, setRoutes] = useState(null);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(() => {
    fetch(LIVE.catalogAll)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(d => {
        setRoutes(d.routes || []);
        setError(null);
      })
      .catch(e => setError(e.message));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggleActive = async r => {
    setBusyId(r.id);
    try {
      const res = await fetch(LIVE.route(r.id), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !r.active }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  };

  const remove = async r => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Delete “${r.name}”? This cannot be undone.`)) return;
    setBusyId(r.id);
    try {
      const res = await fetch(LIVE.route(r.id), { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="xtp-mng">
      <style>{STYLE}</style>
      <h1>Manage guided routes</h1>
      <p className="sub">
        Create, edit, and publish live Street View routes. Active routes appear to
        testers at <Link className="toview" to="/live-reitit">live guided routes</Link>.
      </p>
      <div className="bar">
        <Link to="/luo-live-reitti" className="create">+ Create live route</Link>
      </div>

      {error && <div className="xtp-empty">Error: {error}</div>}
      {!error && routes == null && <div className="xtp-empty">Loading…</div>}
      {!error && routes && routes.length === 0 && (
        <div className="xtp-empty">No routes yet — create the first one.</div>
      )}

      {routes && routes.map(r => (
        <div key={r.id} className="xtp-row">
          <div className="top">
            <span className="name">{r.name}</span>
            <span className={`xtp-badge ${r.active ? 'on' : 'off'}`}>
              {r.active ? 'Active' : 'Inactive'}
            </span>
          </div>
          <div className="od">{r.startAddress} → {r.endAddress}</div>
          <div className="meta">
            {r.waypoints} guidance points · updated {fmt(r.updated)}
          </div>
          <div className="acts">
            <Link className="xtp-act" to={`/live-reitti/${r.id}`}>Preview</Link>
            <Link className="xtp-act" to={`/edit-route/${r.id}`}>Edit</Link>
            <button
              type="button"
              className="xtp-act"
              disabled={busyId === r.id}
              onClick={() => toggleActive(r)}
            >
              {r.active ? 'Deactivate' : 'Activate'}
            </button>
            <button
              type="button"
              className="xtp-act danger"
              disabled={busyId === r.id}
              onClick={() => remove(r)}
            >
              Delete
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};

export default LiveManagePage;
