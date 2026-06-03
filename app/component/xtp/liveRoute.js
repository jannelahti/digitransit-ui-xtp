/*
 * Track B (live Street View) shared helpers — see docs/plans/guided-route-creator.md §13.
 * The route-generator sidecar stores JSON route descriptions only (no images);
 * the Street View image is fetched live here in the browser and the turn arrow
 * is drawn as an SVG overlay (no pixels stored → within Google terms).
 */

export const LIVE = {
  generate: '/api/live/generate',
  save: '/api/live/save',
  catalog: '/api/live/catalog', // active only (tester list)
  catalogAll: '/api/live/catalog?all=1', // active + inactive (manage hub)
  config: '/api/live/config',
  route: id => `/api/live/route/${id}`, // GET / PUT / DELETE by method
};

// Compass bearing a → b in degrees [0,360). Used when a waypoint is dragged or
// inserted in the editor to recompute heading/turn from neighbours.
export function bearing(a, b) {
  const toRad = d => (d * Math.PI) / 180;
  const φ1 = toRad(a.lat);
  const φ2 = toRad(b.lat);
  const Δλ = toRad(b.lon - a.lon);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}

// Signed turn from an incoming to an outgoing bearing, in (-180,180].
// Positive = right (matches the arrow convention in LiveArrowImage).
export function signedTurn(inBearing, outBearing) {
  return ((outBearing - inBearing + 540) % 360) - 180;
}

// Precision-5 google polyline -> [[lat, lon], ...]
export function decodePolyline(str) {
  let index = 0;
  let lat = 0;
  let lng = 0;
  const coords = [];
  while (index < str.length) {
    let b;
    let shift = 0;
    let result = 0;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0;
    result = 0;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    coords.push([lat / 1e5, lng / 1e5]);
  }
  return coords;
}

// Fetch the referrer-restricted Street View key once (cached). Resolves to ''
// when unconfigured so callers can show a placeholder instead of broken images.
let keyPromise = null;
export function getStreetViewKey() {
  if (!keyPromise) {
    keyPromise = fetch(LIVE.config)
      .then(r => (r.ok ? r.json() : { streetViewKey: '' }))
      .then(d => d.streetViewKey || '')
      .catch(() => '');
  }
  return keyPromise;
}

// Google Street View Static image URL. We shoot from the waypoint's approach
// camera (camLat/camLon) facing the travel heading, so the junction is ahead.
export function streetViewUrl(wp, key, opts = {}) {
  if (!key) return null;
  const { w = 640, h = 400, scale = 2 } = opts;
  // explicit opts.fov (editor slider) wins, else the saved per-point fov, else 90
  const fov = opts.fov ?? wp.fov ?? 90;
  const lat = wp.camLat ?? wp.lat;
  const lon = wp.camLon ?? wp.lon;
  const params = new URLSearchParams({
    size: `${w}x${h}`,
    location: `${lat},${lon}`,
    heading: String(Math.round(wp.heading ?? 0)),
    fov: String(fov),
    pitch: '0',
    source: 'outdoor',
    scale: String(scale),
    key,
  });
  return `https://maps.googleapis.com/maps/api/streetview?${params.toString()}`;
}

// Shared styles for the live Street View image + arrow overlay + credit, and
// the simple list/guide chrome. Each page renders <style>{LIVE_STYLE}</style>.
export const LIVE_STYLE = `
.xtp-sv { position:relative; background:#000; line-height:0; }
.xtp-sv img { display:block; width:100%; }
.xtp-sv-missing { color:#aab2c0; font-size:13px; line-height:1.4; padding:28px 16px; text-align:center; }
.xtp-sv-arrow { position:absolute; left:50%; bottom:8px; transform:translateX(-50%);
  width:34%; max-width:120px; height:auto; opacity:.95; filter:drop-shadow(0 1px 3px rgba(0,0,0,.5)); pointer-events:none; }
.xtp-sv-credit { position:absolute; right:6px; bottom:6px; z-index:2; color:#fff; font-size:11px;
  text-shadow:0 1px 2px rgba(0,0,0,.9); pointer-events:none; }
`;

// A turn label for a waypoint card.
export function waypointLabel(wp, total) {
  const base =
    wp.kind === 'start'
      ? 'Start — head this way'
      : wp.kind === 'destination'
        ? 'Destination'
        : wp.streetName
          ? `Turn onto ${wp.streetName}`
          : `Turn ${wp.position}`;
  return total != null ? `${base} (${wp.position + 1}/${total})` : base;
}
