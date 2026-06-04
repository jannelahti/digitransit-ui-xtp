import cx from 'classnames';
import PropTypes from 'prop-types';
import React from 'react';
// import React, { useRef } from 'react';
import { connectToStores } from 'fluxible-addons-react';
import distance from '@digitransit-search-util/digitransit-search-util-distance';
import { 
  xtpShape,
  locationShape,
} from '../../util/shapes';
import Icon from '../Icon';
import XtpIconMarker from './XtpIconMarker';
import XtpPopup from './popups/XtpPopup';
// New imports to add locationState into this component
import PositionStore from '../../store/PositionStore';
// import useWindowSize from '../../hooks/useWindowSize';
/*
key
position
type
xtp
xtp_last_index
pid
*/
// export default function XtpLocationMarker({
function XtpLocationMarker(props) {
  // position,
  // type,
  // className,
  // isLarge,
  // disabled,
  // xtp,
  // xtp_last_index,
  // pid,
  // }) {

  /*
  XTP: We want to show different icon for XTP "LocationMarker".
  In case of Xtp change img from:
    img="icon-icon_mapMarker-map"
  to:
    img="icon-icon_mapMarker-xtp-map"
  
  Remember to define following SVG symbol in files: 
    svg-sprite.default.svg
    svg-sprite.hsl.svg
  
  <symbol id="icon-icon_mapMarker-xtp-map" viewBox="0 0 40 40" fill="none">
  <path fill="none" stroke="#b40" stroke-width="2" d="M 20 6 L 28 6 L 28 10 L 38 10 L 38 36 L 2 36 L 2 10 L 12 10 L 12 6 L 20 6" />
  <circle fill="none" stroke="#b40" stroke-width="2" cx="20" cy="23" r="8"/>
  <circle fill="none" stroke="#b40" stroke-width="2" cx="33" cy="15" r="1"/>
  </symbol>
  
  New: Add pid ('xtp_0', 'xtp_1', etc.) to IconMarker classes.
  */
  const validType = 'xtp';
  const sideLength = props.isLarge ? 30 : 24;
  
  // const windowSize = useWindowSize();
  // const sizeH = Math.round(windowSize.height/2);
  // const sizeW = Math.round(windowSize.width/2);
  // console.log(['useWindowSize size=',windowSize]);
  /*
  Keep aspect ratio 3/4
  const new_h = size.height-40;
  const new_w = Math.round(300*size.height/400);
  setImgSize({fullscreen:true, width:new_w, height:new_h});
  */
  
  // const test_classes = cx(validType, props.className, props.pid);
  // console.log(['LocationMarker test_classes=',test_classes]);
  
  // const dist = distance(props.xtp, props.locationState);
  // console.log(['LocationMarker activation_range=',props.xtp.activation_range]);
  // console.log(['LocationMarker alternate_polyline=',props.xtp.alternate_polyline]);
  /*
  if (dist < props.xtp.activation_range) {
    setTimeout(() => {
      openPopup(props.pid);
    }, 100);
  }
  */
  // Go through all props.xtp_active_markers to find if any of the 
  // markers is within activation range.
  // props.locationState:
  // lat: PropTypes.number,
  // lon: PropTypes.number,
  // address: PropTypes.string,
  // type: PropTypes.string,
  // name: PropTypes.string,
  const within_activation_range = [];
  props.xtp_active_markers.forEach((am_xtp, i) => {
    // HACK: If activation_range is very small (<40) force it to 40 metres.
    const A_RANGE = am_xtp.activation_range < 40 ? 40 : am_xtp.activation_range;
    // console.log(['props.locationState lat=',props.locationState.lat,'lon=',props.locationState.lon]);
    const dist = distance(am_xtp, props.locationState);
    if (dist <= A_RANGE) {
      const pid = 'xtp_'+i;
      within_activation_range.push({pid:pid,dist:dist});
    }
  });
  // console.log(['within_activation_range=',within_activation_range]);
  // find the closest of those candidates
  const min_distance = {pid:null,dist:100000};
  within_activation_range.forEach((war) => {
    if (war.dist < min_distance.dist) {
      min_distance.dist = war.dist;
      min_distance.pid = war.pid;
    }
  });

  const getAutoByIndex = pid_ind => {
    if (!props.xtpForce.auto && props.xtpForce.index === pid_ind) {
      // manual AND current forced marker is current marker
      return true;
    }
    return false;
  }

  const getAutoByProximity = min_pid => {
    if (props.xtpForce.auto && props.pid === min_pid) {
      // auto AND minimum distance marker is current marker
      return true;
    }
    return false;
  }

  // Note that pid is 'xtp_'+i;
  const pid_index = parseInt(props.pid.slice(4));
  // If user selects "MANUAL" => popup should autoOpen ONLY WHEN "Next" or "Previous" -buttons are clicked.
  // It should be a ONE-SHOT thing! Otherwise in MANUAL the same thing happens as in "AUTO" -mode, except 
  // that last index is opened over and over again.
  const autoOpenByForce = getAutoByIndex(pid_index) ? true : false;
  const autoOpenByProxi = getAutoByProximity(min_distance.pid) ? true : false;
  // console.log(['autoOpenByForce=',autoOpenByForce,'autoOpenByProxi=',autoOpenByProxi]);

  const isAutoEnabled = autoOpenByForce || autoOpenByProxi;
  
  const initMarker = ref => {
    if (ref) {
      ref.leafletElement.openPopup()
    }
  }
  
  // autoHandler is handed to Marker in XtpIconMarker.
  const autoHandler = isAutoEnabled ? initMarker : null;
  
  return (
    <XtpIconMarker
      autoHandler={autoHandler}
      position={props.position}
      className={cx(validType, props.className, props.pid)}
      icon={{
        className: cx(validType, props.className, props.pid),
        element: (
          <Icon
            img={"icon_mapMarker-xtp-map"}
            color={props.disabled ? '#bbbbbb' : null}
          />
        ),
        iconAnchor: [sideLength / 2, sideLength],
        iconSize: [sideLength, sideLength],
      }}
      zIndexOffset={12000}
    >
      <XtpPopup
        lat={props.xtp.lat}
        lon={props.xtp.lon}
        xtpurl={props.xtp.url}
        xtpType={props.xtp.type}
        heading={props.xtp.heading}
        turnAngle={props.xtp.turnAngle}
        fov={props.xtp.fov}
        camLat={props.xtp.camLat}
        camLon={props.xtp.camLon}
        key={`${props.xtp.lat}${props.xtp.lon}`}
        xtp_last_index={props.xtp_last_index}
        pid={props.pid}
        handlePrev={props.xtpHandlePrev}
        handleNext={props.xtpHandleNext}
        toggleAuto={props.xtpToggleAuto}
        handleSetIndex={props.xtpHandleSetIndex}
        autoOpen={props.xtpForce.auto}
        picSize={props.xtpForce.size}
        locationState={props.locationState}
      />
    </XtpIconMarker>
  );
}

XtpLocationMarker.propTypes = {
  position: XtpIconMarker.propTypes.position,
  type: PropTypes.oneOf(['from', 'via', 'to', 'xtp', 'favourite']),
  className: PropTypes.string,
  isLarge: PropTypes.bool,
  disabled: PropTypes.bool,
  xtp: xtpShape,
  xtp_last_index: PropTypes.number,
  xtp_active_markers: PropTypes.arrayOf(xtpShape),
  pid: PropTypes.string,
  xtpToggleAuto: PropTypes.func.isRequired,
  xtpHandlePrev: PropTypes.func.isRequired,
  xtpHandleNext: PropTypes.func.isRequired,
  xtpHandleSetIndex: PropTypes.func.isRequired,
  xtpForce: PropTypes.shape({
    auto: PropTypes.bool.isRequired,
    index: PropTypes.number.isRequired,
    size: PropTypes.string.isRequired,
  }).isRequired,
  locationState: locationShape,
};

XtpLocationMarker.defaultProps = {
  position: undefined,
  type: 'xtp',
  className: undefined,
  isLarge: false,
  disabled: false,
  xtp: undefined,
  xtp_last_index: undefined,
  xtp_active_markers: [],
  pid: undefined,
  locationState: undefined,
};
/*
How to add locationState into this component?
*/
const XtpLocationMarkerWithStores = connectToStores(
  XtpLocationMarker,
  [PositionStore],
  ({ getStore }) => {
    const locationState = getStore(PositionStore).getLocationState();
    return { locationState };
  },
);
export { XtpLocationMarkerWithStores as default, XtpLocationMarker as Component };
