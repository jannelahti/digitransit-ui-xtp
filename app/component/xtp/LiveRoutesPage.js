import React, { useEffect, useState } from 'react';
import { Link } from 'found';
import { LIVE } from './liveRoute';

/*
 * XTP Track B — the live-route section (decision #4: kept separate from the
 * Track-A stored-photo catalog). Lists the JSON routes from the sidecar and
 * links into the live guide view.
 */
const STYLE = `
.xtp-live-list { max-width: 720px; margin: 0 auto; padding: 20px 16px 40px; }
.xtp-live-list h1 { font-size: 22px; margin: 0 0 4px; }
.xtp-live-list .sub { color:#5a6270; font-size:14px; margin: 0 0 18px; }
.xtp-live-list .create { display:inline-block; margin-bottom:18px; border:1px solid #1455c0; background:#1455c0;
  color:#fff; border-radius:8px; padding:8px 14px; font-size:14px; font-weight:600; text-decoration:none; }
.xtp-live-list .create:hover { background:#0e459f; }
.xtp-live-list .manage { display:inline-block; margin: 0 0 18px 12px; color:#1455c0; font-size:14px; text-decoration:none; }
.xtp-live-list .manage:hover { text-decoration:underline; }
.xtp-live-card { display:block; border:1px solid #e1e5ea; border-radius:10px; padding:14px 16px; margin-bottom:10px;
  text-decoration:none; color:#1c2430; transition:box-shadow .15s, border-color .15s; }
.xtp-live-card:hover { box-shadow:0 3px 12px rgba(0,0,0,.1); border-color:#c7ccd4; }
.xtp-live-card .name { font-size:16px; font-weight:700; margin-bottom:2px; }
.xtp-live-card .od { color:#3a4150; font-size:14px; }
.xtp-live-card .meta { color:#7a828e; font-size:12px; margin-top:4px; }
.xtp-live-empty { color:#5a6270; font-size:14px; padding:20px 0; }
`;

const LiveRoutesPage = () => {
  const [routes, setRoutes] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch(LIVE.catalog)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(d => setRoutes(d.routes || []))
      .catch(e => setError(e.message));
  }, []);

  return (
    <div className="xtp-live-list">
      <style>{STYLE}</style>
      <h1>Live guided routes</h1>
      <p className="sub">
        Routes guided with live Street View imagery. Pick one to follow it turn by turn.
      </p>
      {error && <div className="xtp-live-empty">Could not load routes: {error}</div>}
      {!error && routes == null && <div className="xtp-live-empty">Loading…</div>}
      {!error && routes && routes.length === 0 && (
        <div className="xtp-live-empty">No live routes yet — create the first one.</div>
      )}
      {routes && routes.map(r => (
        <Link key={r.id} to={`/v2/routes/${r.id}`} className="xtp-live-card">
          <div className="name">{r.name}</div>
          <div className="od">{r.startAddress} → {r.endAddress}</div>
          <div className="meta">{r.waypoints} guidance points</div>
        </Link>
      ))}
    </div>
  );
};

export default LiveRoutesPage;
