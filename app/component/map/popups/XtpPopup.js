import PropTypes from 'prop-types';
// import React, { useState } from 'react';
// import React, { useRef, useState, useEffect } from 'react';
import React from 'react';
import { withLeaflet } from 'react-leaflet/es/context'; // New for Leaflet access.
import Popup from 'react-leaflet/es/Popup';
import { locationShape } from '../../../util/shapes';
import Card from '../../Card';
import { getStreetViewKey } from '../../xtp/liveRoute';
import LiveArrowImage from '../../xtp/LiveArrowImage';
// import Toggle from '../../Toggle';
/*
  pid = 'xtp_0', 'xtp_1', etc.
*/
// export default function XtpPopup({ pid, lat, lon, xtpurl }) {
// See similar example at function SelectStopRow  !!!!!
class XtpPopup extends React.Component {
  static displayName = 'XtpPopup';
  static propTypes = {
    leaflet: PropTypes.shape({
      map: PropTypes.shape({
        // openPopup: PropTypes.func.isRequired,
        closePopup: PropTypes.func.isRequired,
        getZoom: PropTypes.func.isRequired,
        on: PropTypes.func.isRequired,
        off: PropTypes.func.isRequired,
      }).isRequired,
    }).isRequired,
    pid: PropTypes.string.isRequired,
    xtp_last_index: PropTypes.number.isRequired,
    lat: PropTypes.number.isRequired,
    lon: PropTypes.number.isRequired,
    xtpurl: PropTypes.string,
    // Track B (live Street View) point fields — present when xtpType==='streetview'.
    xtpType: PropTypes.string,
    heading: PropTypes.number,
    turnAngle: PropTypes.number,
    fov: PropTypes.number,
    camLat: PropTypes.number,
    camLon: PropTypes.number,
    handlePrev: PropTypes.func.isRequired,
    handleNext: PropTypes.func.isRequired,
    handleSetIndex: PropTypes.func.isRequired,
    // toggleSize: PropTypes.func.isRequired,
    toggleAuto: PropTypes.func.isRequired,
    autoOpen: PropTypes.bool.isRequired,
    picSize: PropTypes.string.isRequired,
    locationState: locationShape.isRequired,
  };

  static defaultProps = {
    xtpurl: '',
    xtpType: 'photo',
    heading: 0,
    turnAngle: null,
    fov: undefined,
    camLat: undefined,
    camLon: undefined,
  };
  
  constructor(props) {
    // console.log(['constructor props=',props]);
    super(props);
    this.state = {
      width: 0,
      height: 0,
      // size: 'S',
      zoom: this.props.leaflet.map.getZoom(),
      svKey: '', // Street View key, fetched on mount for streetview points
    };
  }
  
  getMapDimensions = () => {
    const dim = {w:0,h:0};
    const elems = document.querySelectorAll('div.leaflet-container');
    [...elems].forEach(e=>{
      dim.w = e.clientWidth;
      dim.h = e.clientHeight;
    });
    // console.log(['GET MAP DIMENSIONS elems=',elems,'dim.w=',dim.w,'dim.h=',dim.h]);
    return dim;
  }
  
  updateDimensions = () => {
    this.setState(prevState => ({
      ...prevState, // keep all other key-value pairs
      width: window.innerWidth,
      height: window.innerHeight,
    }));
  }
  
  onMapZoom = () => {
    // Toggle the state to re-render component
    const zoom = this.props.leaflet.map.getZoom();
    this.setState(prevState => ({
      ...prevState, // keep all other key-value pairs
      zoom: zoom,   // update the value of specific key
    }));
  }
  
  componentDidMount() {
    // Runs immediately after the DOM has been updated.
    // console.log('componentDidMount');
    this.mounted = true;
    this.props.leaflet.map.on('zoomend', this.onMapZoom);
    window.addEventListener('resize', this.updateDimensions);
    // Live Street View points need the referrer-restricted key (cached promise).
    if (this.props.xtpType === 'streetview') {
      getStreetViewKey().then(k => {
        if (this.mounted) {
          this.setState({ svKey: k });
        }
      });
    }
  }

  componentWillUnmount() {
    // console.log('componentWillUnmount');
    this.mounted = false;
    this.props.leaflet.map.off('zoomend', this.onMapZoom);
    window.removeEventListener('resize', this.updateDimensions);
  }
  /*
  handleClick = () => {
    if (this.state.size==='S') {
      this.setState(prevState => ({
        ...prevState,
        size: 'L',
      }));
    } else {
      this.setState(prevState => ({
        ...prevState,
        size: 'S',
      }));
    }
  }
  */
  handleClose = () => {
    this.props.leaflet.map.closePopup();
    this.props.handleSetIndex(-1);
  }
  
  getPrevButtonState = () => {
    const c_index = parseInt(this.props.pid.slice(4));
    if (this.props.autoOpen) {
       return ''; // "Previous"-button is disabled when "AUTO" mode is selected.
    }
    // "Previous"-button is enabled if current-index is not zero.
    return c_index !== 0 ? 'y' : '';
  }
  
  getToggleModeClass = () => {
    if (this.props.autoOpen) {
      if (this.props.locationState.lat===0 && this.props.locationState.lon===0) {
        return 'xtp-navi-auto-inactive';
      } else {
        return 'xtp-navi-auto';
      }
    }
    return 'xtp-navi-manual';
  }
  
  getNextButtonState = () => {
    const c_index = parseInt(this.props.pid.slice(4));
    if (this.props.autoOpen) {
       return ''; // "Next"-button is disabled when "AUTO" mode is selected.
    }
    // "Next"-button is enabled if current-index is smaller than last index.
    return c_index < this.props.xtp_last_index ? 'y' : '';
  }
  
  getPicWidth = (mapdimw) => {
    if (mapdimw >= 0 && mapdimw < 340) {
      return 220;
    } else if (mapdimw >= 340 && mapdimw < 440) {
      return 320;
    } else if (mapdimw >= 440 && mapdimw < 540) {
      return 420;
    } else if (mapdimw >= 540 && mapdimw < 640) {
      return 520;
    } else if (mapdimw >= 640 && mapdimw < 740) {
      return 620;
    } else {
      return 720;
    }
  }
  
  getPopupClasses = (w) => {
    if (w === 220) {
      return 'popup single-popup-xtp'; // minimum popup width 240px pic 220px
    } else if (w === 320) {
      return 'single-popup-xtp w340px'; // popup 340px pic 320px
    } else if (w === 420) {
      return 'single-popup-xtp w440px';
    } else if (w === 520) {
      return 'single-popup-xtp w540px';
    } else if (w === 620) {
      return 'single-popup-xtp w640px';
    }
    return 'single-popup-xtp w740px';
  }
  
  getButtonClasses = (w) => {
    if (w === 220) {
      return 'xtp-popup-navi-button';
    } else if (w === 320) {
      return 'xtp-popup-navi-button h240px';
    } else if (w === 420) {
      return 'xtp-popup-navi-button h315px';
    } else if (w === 520) {
      return 'xtp-popup-navi-button h390px';
    } else if (w === 620) {
      return 'xtp-popup-navi-button h465px';
    }
    return 'xtp-popup-navi-button h540px';
  }
  
  render() {
    // console.log(['Create Popup this.props.pid=',this.props.pid]);
    const a_title = this.props.autoOpen ? 'Auto ON' : 'Auto OFF';
    const toggleModeClassName = this.getToggleModeClass();
    const prev_state = this.getPrevButtonState();
    const next_state = this.getNextButtonState();
    const p_title = prev_state==='' ? '' : '<';
    const n_title = next_state==='' ? '' : '>';
    const mapdim = this.getMapDimensions();
    const dimw = this.getPicWidth(mapdim.w);
    const xtpClassNames = this.getPopupClasses(dimw);
    const btnClasses = this.getButtonClasses(dimw);
    // console.log(['xtpClassNames=',xtpClassNames]);
    // console.log(['btnClasses=',btnClasses]);
    // console.log(['dimw=',dimw]);
    const dimwpx = dimw+'px';
    return (
      <Popup
        position={{ lat: this.props.lat+0.0001, lng: this.props.lon }}
        offset={[0, 0]}
        autoPanPaddingTopLeft={[5, 125]}
        onClose={() => {
          // console.log('onClose.');
        }}
        onOpen={() => {
          const c_index = parseInt(this.props.pid.slice(4));
          // console.log(['onOpen c_index=',c_index]);
          this.props.handleSetIndex(c_index);
        }}
        maxWidth={dimwpx}
        width={dimwpx}
        autoPan={false}
        className={xtpClassNames}
      >
        <Card className="no-margin">
          <div className="xtp-popup-wrapper">
            <div className="xtp-map-popup-button-container">
              <div className="xtp-map-popup-button-wrapper"><button className={toggleModeClassName} onClick={this.props.toggleAuto}>{a_title}</button></div>
              <div className="xtp-map-popup-button-wrapper"><button onClick={this.handleClose}>Close</button></div>
            </div>
            <div className="xtp-image-container">
              {this.props.xtpType === 'streetview' ? (
                <LiveArrowImage
                  wp={{
                    lat: this.props.lat,
                    lon: this.props.lon,
                    camLat: this.props.camLat,
                    camLon: this.props.camLon,
                    heading: this.props.heading,
                    turnAngle: this.props.turnAngle,
                    fov: this.props.fov,
                  }}
                  svKey={this.state.svKey}
                  opts={{ w: 640, h: 480 }}
                />
              ) : (
                <img src={this.props.xtpurl} width={dimw} alt="" />
              )}
              <div className="xtp-popup-left-button-wrapper"><button className={btnClasses} disabled={!prev_state} onClick={this.props.handlePrev}>{p_title}</button></div>
              <div className="xtp-popup-right-button-wrapper"><button className={btnClasses} disabled={!next_state} onClick={this.props.handleNext}>{n_title}</button></div>
            </div>
          </div>
        </Card>
      </Popup>
    );
  }
}

const XtpPopupWithLeaflet = withLeaflet(XtpPopup);

export {
  XtpPopupWithLeaflet as default,
  XtpPopup as Component,
};
