import React from 'react';
import PropTypes from 'prop-types';
import { streetViewUrl } from './liveRoute';

/*
 * One live Street View frame with the turn arrow drawn as an SVG overlay and a
 * "© Google" credit. The arrow points up and rotates by the true turn angle
 * (+ = right, clamped ±100°), matching the old baked-arrow convention; a null
 * turnAngle (destination) draws no arrow.
 */
const ARROW_PATH = 'M50 8 L82 52 L64 52 L64 92 L36 92 L36 52 L18 52 Z';

const LiveArrowImage = ({ wp, svKey, opts }) => {
  const url = streetViewUrl(wp, svKey, opts);
  const rot =
    wp.turnAngle == null ? null : Math.max(-100, Math.min(100, wp.turnAngle || 0));

  return (
    <div className="xtp-sv">
      {url ? (
        <img src={url} alt="Street View guidance" />
      ) : (
        <div className="xtp-sv-missing">
          Street View image unavailable — API key not configured.
        </div>
      )}
      {url && rot != null && (
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
  }).isRequired,
  svKey: PropTypes.string,
  opts: PropTypes.shape({}),
};

LiveArrowImage.defaultProps = {
  svKey: '',
  opts: undefined,
};

export default LiveArrowImage;
