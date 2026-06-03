import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { connectToStores } from 'fluxible-addons-react';
import LiveArrowImage from './LiveArrowImage';
import {
  LIVE_STYLE,
  getStreetViewKey,
  waypointLabel,
  distanceMeters,
} from './liveRoute';
import PositionStore from '../../store/PositionStore';

/*
 * XTP — live Street View guidance, surfaced inside normal journey navigation
 * (the search-matched model, not a standalone picker). Given the routes matched
 * to the plan's walking legs (from /api/live/search), this renders a bottom-sheet
 * card over the itinerary map (map stays visible) showing the active waypoint's
 * live Street View frame + turn arrow + "© Google", with GPS auto-advance as the
 * user walks and manual ‹ › stepping.
 */
const ADVANCE_RANGE_M = 25; // advance to the next waypoint within this distance

const STYLE = `
.xtp-guide-sheet { position:fixed; left:0; right:0; bottom:0; z-index:2200;
  display:flex; justify-content:center; pointer-events:none; }
.xtp-guide-inner { pointer-events:auto; width:min(420px, calc(100vw - 16px)); margin:0 8px 10px;
  background:#11151c; color:#fff; border-radius:14px 14px 0 0; overflow:hidden;
  box-shadow:0 -4px 24px rgba(0,0,0,.4); }
.xtp-guide-bar { display:flex; align-items:center; gap:10px; padding:8px 12px; }
.xtp-guide-bar .lbl { flex:1; font-size:13px; font-weight:700; }
.xtp-guide-nav { border:1px solid #3a4150; background:#1b212b; color:#fff; border-radius:8px;
  width:38px; height:34px; font-size:20px; line-height:30px; cursor:pointer; }
.xtp-guide-nav:hover:not(:disabled){ background:#262e3a; }
.xtp-guide-nav:disabled{ opacity:.3; cursor:default; }
.xtp-guide-auto { border:1px solid #3a4150; border-radius:8px; padding:6px 10px; font-size:12px;
  font-weight:700; cursor:pointer; }
.xtp-guide-auto.on { background:#1c7c2f; border-color:#1c7c2f; color:#fff; }
.xtp-guide-auto.off { background:#1b212b; color:#aab2c0; }
${LIVE_STYLE}
`;

const LiveGuideSheet = ({ matches, position }) => {
  // Flatten matched routes into one ordered step sequence (multi-leg = sequential).
  const steps = [];
  (matches || []).forEach(m => {
    (m.route?.waypoints || []).forEach(wp => steps.push({ wp, routeName: m.route.name }));
  });

  const [svKey, setSvKey] = useState('');
  const [step, setStep] = useState(0);
  const [auto, setAuto] = useState(true);

  useEffect(() => { getStreetViewKey().then(setSvKey); }, []);

  // GPS auto-advance: when walking within range of the next waypoint, step on.
  useEffect(() => {
    if (!auto || !position || (position.lat === 0 && position.lon === 0)) return;
    const next = steps[step + 1];
    if (next && distanceMeters(position, { lat: next.wp.lat, lon: next.wp.lon }) < ADVANCE_RANGE_M) {
      setStep(step + 1);
    }
  }, [position, auto, step, steps]);

  if (steps.length === 0) return null;
  const safeStep = Math.min(step, steps.length - 1);
  const cur = steps[safeStep];

  return (
    <div className="xtp-guide-sheet">
      <style>{STYLE}</style>
      <div className="xtp-guide-inner">
        <LiveArrowImage wp={cur.wp} svKey={svKey} opts={{ fov: cur.wp.fov ?? 90 }} />
        <div className="xtp-guide-bar">
          <button
            type="button"
            className="xtp-guide-nav"
            disabled={safeStep <= 0}
            onClick={() => { setAuto(false); setStep(safeStep - 1); }}
          >
            ‹
          </button>
          <span className="lbl">{waypointLabel(cur.wp, steps.length)}</span>
          <button
            type="button"
            className="xtp-guide-nav"
            disabled={safeStep >= steps.length - 1}
            onClick={() => { setAuto(false); setStep(safeStep + 1); }}
          >
            ›
          </button>
          <button
            type="button"
            className={`xtp-guide-auto ${auto ? 'on' : 'off'}`}
            onClick={() => setAuto(a => !a)}
            title="Auto-advance as you walk"
          >
            {auto ? 'Auto' : 'Manual'}
          </button>
        </div>
      </div>
    </div>
  );
};

LiveGuideSheet.propTypes = {
  matches: PropTypes.arrayOf(PropTypes.shape({})),
  position: PropTypes.shape({ lat: PropTypes.number, lon: PropTypes.number }),
};

LiveGuideSheet.defaultProps = {
  matches: [],
  position: undefined,
};

export default connectToStores(LiveGuideSheet, [PositionStore], ({ getStore }) => ({
  position: getStore(PositionStore).getLocationState(),
}));
