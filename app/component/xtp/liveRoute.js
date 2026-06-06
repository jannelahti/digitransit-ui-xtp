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
  search: '/api/live/search', // POST plan legs → matching active routes (guidance)
  reframe: '/api/live/reframe', // POST one waypoint → candidate headings + AI pick
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

// Great-circle distance between two {lat,lon} points, in metres. Used by the
// guidance sheet's GPS auto-advance.
export function distanceMeters(a, b) {
  const R = 6371000;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
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

// Add the Track-B base layers + a switcher to a Leaflet map: Carto Voyager (default,
// added to the map) and an Esri World Imagery satellite layer. Returns nothing.
export function addBaseLayers(Lm, map) {
  const voyager = Lm.tileLayer(
    'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    { subdomains: 'abcd', maxZoom: 20, detectRetina: true, attribution: '© OpenStreetMap, © CARTO' },
  );
  const satellite = Lm.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 20, attribution: 'Imagery © Esri' },
  );
  voyager.addTo(map);
  Lm.control.layers({ Map: voyager, Satellite: satellite }, {}, { position: 'topright' }).addTo(map);
}

// Waypoint marker HTML: a numbered colour dot (start green / destination red /
// turn blue) with a small triangle on its rim pointing in the camera heading
// (north = up), so the Street View direction is visible on the map. `size` is the
// dot diameter in px. Pair with divIcon className 'xtp-wp' + the .xtp-wp* styles.
export function waypointMarkerHtml(wp, size = 26) {
  const color =
    wp.kind === 'start' ? '#1c7c2f' : wp.kind === 'destination' ? '#b0271f' : '#1455c0';
  const head = Math.round(wp.heading ?? 0);
  return (
    `<div class="xtp-wpmk" style="width:${size}px;height:${size}px">` +
    `<div class="xtp-wphead" style="transform:rotate(${head}deg)"><i class="xtp-wphead-tri"></i></div>` +
    `<div class="xtp-wpdot" style="background:${color};font-size:${Math.round(size * 0.46)}px">${wp.position + 1}</div>` +
    `</div>`
  );
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
.xtp-sv-noimg { width:100%; height:100%; min-height:220px; background:#1b212b;
  background-image:repeating-linear-gradient(45deg,#1b212b,#1b212b 12px,#20283400 12px,#202834 24px); }
.xtp-sv-arrow { position:absolute; left:50%; bottom:8px; transform:translateX(-50%);
  width:24%; max-width:88px; height:auto; opacity:1; filter:drop-shadow(0 1px 3px rgba(0,0,0,.55)); pointer-events:none; }
.xtp-sv-credit { position:absolute; right:6px; bottom:6px; z-index:2; color:#fff; font-size:11px;
  text-shadow:0 1px 2px rgba(0,0,0,.9); pointer-events:none; }
.xtp-vflag { display:inline-block; margin-top:5px; padding:2px 8px; border-radius:10px;
  font-size:11px; font-weight:700; color:#fff; }
.xtp-vnote { margin-top:4px; font-size:12px; color:#cdd3dd; font-style:italic; }
/* Waypoint marker: numbered dot with a rim triangle pointing in the camera heading
 * (north = up). See waypointMarkerHtml. */
.xtp-wp { background:none; border:0; }
.xtp-wpmk { position:relative; }
.xtp-wphead { position:absolute; inset:0; pointer-events:none; }
.xtp-wphead-tri { position:absolute; left:50%; top:-4px; transform:translateX(-50%);
  width:0; height:0; border-left:5px solid transparent; border-right:5px solid transparent;
  border-bottom:7px solid #11151c; filter:drop-shadow(0 0 1px rgba(255,255,255,.9)); }
.xtp-wpdot { position:absolute; inset:0; color:#fff; border-radius:50%; display:flex;
  align-items:center; justify-content:center; border:2px solid #fff; font-weight:700;
  box-shadow:0 1px 4px rgba(0,0,0,.4); }
`;

// Generic OSM way names that aren't real streets — don't say "Turn onto sidewalk".
const GENERIC_WAYS = new Set([
  'bike path',
  'path',
  'sidewalk',
  'footway',
  'crossing',
  'steps',
  'open area',
]);

// A turn instruction for a waypoint. Turns read "Turn left/right" (from the
// signed turn angle; + = right) and append "onto <street>" only for real named
// streets, so generic ways don't produce "Turn onto sidewalk".
export function waypointLabel(wp, waypoints) {
  const arr = Array.isArray(waypoints) ? waypoints : null;
  const total = arr ? arr.length : typeof waypoints === 'number' ? waypoints : null;
  const withCount = base => (total != null ? `${base} (${wp.position + 1}/${total})` : base);

  // An author-written instruction (annotation editor) overrides the derived
  // maneuver + distance text entirely; only the step counter is still appended.
  const custom = typeof wp.instruction === 'string' ? wp.instruction.trim() : '';
  if (custom) return withCount(custom);

  let base;
  if (wp.kind === 'start') {
    base = 'Start — head this way';
  } else if (wp.kind === 'destination') {
    base = 'You have arrived';
  } else {
    const dir = (wp.turnAngle ?? 0) >= 0 ? 'right' : 'left';
    const named = wp.streetName && !GENERIC_WAYS.has(wp.streetName);
    base = named ? `Turn ${dir} onto ${wp.streetName}` : `Turn ${dir}`;
  }
  // Append the distance to the next point (the leg you walk after this one).
  if (arr && wp.kind !== 'destination') {
    const next = arr.find(w => w.position === wp.position + 1);
    if (next) {
      const d = distanceMeters(wp, next);
      if (d >= 15) base += `, then ~${Math.round(d / 10) * 10} m`;
    }
  }
  return withCount(base);
}

// AI (Haiku vision) framing assessment for a waypoint, for display in the editor.
// Returns null when the route was generated without the vision pass. `flag`:
//   good      — the camera clearly shows the way to go (no action needed)
//   ambiguous — usable but the direction isn't clear → worth a manual heading tweak
//   none      — Street View has no useful frame here → check / hand-tune
export function visionFlagInfo(wp) {
  const flag = wp && wp.visionFlag;
  if (!flag) return null;
  const map = {
    good: { text: 'AI: good frame', color: '#1f7a3d' },
    ambiguous: { text: 'AI: unclear — tune heading', color: '#b06a00' },
    none: { text: 'AI: no usable view — check', color: '#a32020' },
  };
  const info = map[flag] || { text: `AI: ${flag}`, color: '#555' };
  return { ...info, note: wp.visionNote || null };
}
