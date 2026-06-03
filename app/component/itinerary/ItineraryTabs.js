/* eslint-disable react/no-array-index-key */
import PropTypes from 'prop-types';
import React from 'react';
import ItineraryDetails from './ItineraryDetails';
import SwipeableTabs from '../SwipeableTabs';
import { planEdgeShape, xtpShape } from '../../util/shapes';

function ItineraryTabs({
  planEdges,
  xtpPoints,
  tabIndex,
  isMobile,
  changeHash,
  recommendedIndex,
  feedback = {},
  giveFeedback,
  hideArrows = false,
  ...rest
}) {
  const itineraryTabs = planEdges.map((edge, i) => {
    // From xtpPoints extract only those "infos" where edge_index equals i
    const xtp_edge_points = xtpPoints.filter(p => p.edge_index === i);
    //console.log(["ItineraryTabs index=",i,"xtp_edge_points=",xtp_edge_points]);
    return (
      <div
        className={`swipeable-tab ${tabIndex !== i && 'inactive'}`}
        key={`itinerary-${i}`}
        aria-hidden={tabIndex !== i}
      >
        <ItineraryDetails
          itinerary={edge.node}
          xtpEdgePoints={xtp_edge_points}
          hideTitle={!isMobile}
          changeHash={isMobile ? changeHash : undefined}
          isMobile={isMobile}
          tabIndex={i}
          recommended={i === recommendedIndex}
          feedback={feedback[i]}
          giveFeedback={
            giveFeedback ? like => giveFeedback(i, like) : undefined
          }
          {...rest}
        />
      </div>
    );
  });

  return (
    <SwipeableTabs
      tabs={itineraryTabs}
      tabIndex={tabIndex}
      hideArrows={hideArrows}
      onSwipe={changeHash}
      classname={isMobile ? 'swipe-mobile-divider' : 'swipe-desktop-view'}
      ariaRole="swipe-summary-page-tab"
    />
  );
}

ItineraryTabs.propTypes = {
  tabIndex: PropTypes.number.isRequired,
  isMobile: PropTypes.bool.isRequired,
  planEdges: PropTypes.arrayOf(planEdgeShape).isRequired,
  xtpPoints: PropTypes.arrayOf(xtpShape),
  changeHash: PropTypes.func,
  recommendedIndex: PropTypes.number,
  feedback: PropTypes.objectOf(PropTypes.bool),
  giveFeedback: PropTypes.func,
  hideArrows: PropTypes.bool,
};

export default ItineraryTabs;
