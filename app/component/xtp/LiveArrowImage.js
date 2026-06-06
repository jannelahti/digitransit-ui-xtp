import React from 'react';
import PropTypes from 'prop-types';
import { streetViewUrl } from './liveRoute';

/*
 * One live Street View frame with the turn arrow drawn as an SVG overlay and a
 * "© Google" credit. The arrow points up and rotates by the turn angle
 * (+ = right, clamped ±100°): the author override `wp.arrowDeg` wins, else the
 * geometric `wp.turnAngle`; a null angle (e.g. destination) draws no arrow.
 * `opts.noImage` renders the arrow over a plain panel with no Street View fetch —
 * used for waypoints the author marked as not needing a guidance photo.
 */
const ARROW_PATH = 'M50 14 L70 48 L58 48 L58 88 L42 88 L42 48 L30 48 Z';

const LiveArrowImage = ({ wp, svKey, opts }) => {
  const noImage = !!(opts && opts.noImage);
  const url = noImage ? null : streetViewUrl(wp, svKey, opts);
  const rawRot = wp.arrowDeg != null ? wp.arrowDeg : wp.turnAngle;
  const rot = rawRot == null ? null : Math.max(-100, Math.min(100, rawRot || 0));
  const showArrow = (url || noImage) && rot != null;

  return (
    <div className="xtp-sv">
      {url ? (
        <img src={url} alt="Street View guidance" />
      ) : noImage ? (
        <div className="xtp-sv-noimg" />
      ) : (
        <div className="xtp-sv-missing">
          Street View image unavailable — API key not configured.
        </div>
      )}
      {showArrow && (
        <svg
          className="xtp-sv-arrow"
          viewBox="0 0 100 100"
          preserveAspectRatio="xMidYMid meet"
        >
          <g transform={`rotate(${rot} 50 50)`}>
            <path
              d={ARROW_PATH}
              fill="#ff3b30"
              stroke="#fff"
              strokeWidth="5"
              strokeLinejoin="round"
            />
          </g>
        </svg>
      )}
      {url && <span className="xtp-sv-credit">© Google</span>}
    </div>
  );
};

LiveArrowImage.propTypes = {
  wp: PropTypes.shape({
    lat: PropTypes.number,
    lon: PropTypes.number,
    camLat: PropTypes.number,
    camLon: PropTypes.number,
    heading: PropTypes.number,
    turnAngle: PropTypes.number,
    arrowDeg: PropTypes.number,
  }).isRequired,
  svKey: PropTypes.string,
  opts: PropTypes.shape({}),
};

LiveArrowImage.defaultProps = {
  svKey: '',
  opts: undefined,
};

export default LiveArrowImage;
