import destination from '@turf/destination';

const google = window.google;

class GoogleMapsWrapper {
  init() {
    this.service = new google.maps.StreetViewService();
  }

  // Wraps call getPanorama call to be async.
  //
  // The original documentation:
  // https://developers.google.com/maps/documentation/javascript/reference/street-view-service#StreetViewService
  //
  // @param {google.maps.StreetViewLocationRequest} request
  //
  // @returns {Promise<?google.maps.StreetViewPanoramaData>} The found
  //  panorama - null if zero results were returned.
  async asyncGetPanorama(request) {
    return new Promise((resolve, reject) => {
      this.service.getPanorama(request, (panoramaData, status) => {
        if (status === 'OK') {
          resolve(panoramaData);
        } else if (status === 'ZERO_RESULTS') {
          resolve(null);
        } else {
          reject(status);
        }
      });
    });
  }

  // Attempts to find a panorama within `radius_km` of point.
  //
  // @async
  // @param {Object} point - Object with (lat, lng) elements.
  // @param {Object} radius_m - The search radius in meters, defaults to 40 km.
  // @returns {Object} The closest panorama (object with {lat, lng} elements)
  // or null/undefined if not found.
  async getClosestPanorama(point, radius_m) {
    if (radius_m == undefined) radius_m = 40 * 1000;
    const requestedPoint = new google.maps.LatLng(point.lat, point.lng);
    const foundPanorama = await this.asyncGetPanorama({
      location: requestedPoint,
      preference: google.maps.StreetViewPreference.NEAREST,
      radius: radius_m, // meters
      source: google.maps.StreetViewSource.OUTDOOR,
    });
    if (foundPanorama?.location?.latLng != null) {
      return foundPanorama?.location?.latLng.toJSON();
    }
    return null;
  }

  // Attempts to jump to a panorama at most `distance_km` away from `point`
  // in the direction `bearing_deg`. We try to find a point exactly
  // `distance_km` away, but if that fails, we make a total of 10 attempts
  // to jump to any point in the direction using a linear distance backoff.
  //
  // @async
  // @param {Object} point - Object with {lat, lng} elements - the starting point.
  // @param {float} distance_km - Distance of the jump in kilometers.
  // @param {float} bearing_deg - Compass bearing (0 meaning north, 90 east, -90 west).
  // @returns {Object} An object containing two fields:
  // `destination`: the closest panorama (as an object with {lat, lng} elements),
  // `distance_km`: the distance of the found point wrt. the starting point.
  // If no panorama was found, will return null instead.
  async jumpByDistanceAndBearing(point, distance_km, bearing_deg) {
    // (lng, lat) is the turf coordinate format.
    const num_attempts = 10;
    let panorama = null;
    for (let attempt = 0; attempt < num_attempts; attempt++) {
      let fraction = (num_attempts - attempt) / num_attempts;
      const jump_point_turf = destination(
        [point.lng, point.lat],
        distance_km * fraction,
        bearing_deg,
      ).geometry.coordinates;
      // We first attempt to jump by distance_km, searching in a radius of 0.1 * distance_km.
      // If that fails we attempt to back off each time by 1/num_attempts of distance_km.
      // The radius gets progressively narrower to maintain the same distance-to-search radius proportion.
      const radius_m = distance_km * 0.1 * fraction * 1000;
      console.log(
        'jumpByDistanceAndBearing, searching at distance: ',
        distance_km * fraction,
        ' with radius: ',
        radius_m,
      );
      panorama = await this.getClosestPanorama(
        { lat: jump_point_turf[1], lng: jump_point_turf[0] },
        radius_m,
      );
      if (panorama != null) {
        break;
      }
    }
    if (panorama != null) {
      console.log('jumpByDistanceAndBearing found: ', panorama);
      return {
        destination: { lat: panorama.lat, lng: panorama.lng },
        distance_km: this.haversine_distance(point, panorama),
      };
    }
    return null;
  }

  // Returns an average of the given points, which can be used as an approximate center
  // point.
  //
  // @async
  // @param {Array<Object>} point - Array of objects with {lat, lng} elements.
  // @returns {Object} The mean of the given points, as an object with {lat, lng}
  // elements.
  centerPoint(input_points) {
    let result = { lat: 0, lng: 0 };
    for (const point of input_points) {
      result.lat += point.lat;
      result.lng += point.lng;
    }
    result.lat /= input_points.length;
    result.lng /= input_points.length;
    return result;
  }

  haversine_distance(p1, p2) {
    var R = 6371.071;
    var rlat1 = p1.lat * (Math.PI / 180); // Convert degrees to radians
    var rlat2 = p2.lat * (Math.PI / 180); // Convert degrees to radians
    var difflat = rlat2 - rlat1; // Radian difference (latitudes)
    var difflon = (p2.lng - p1.lng) * (Math.PI / 180); // Radian difference (longitudes)

    var d =
      2 *
      R *
      Math.asin(
        Math.sqrt(
          Math.sin(difflat / 2) * Math.sin(difflat / 2) +
            Math.cos(rlat1) *
              Math.cos(rlat2) *
              Math.sin(difflon / 2) *
              Math.sin(difflon / 2),
        ),
      );
    return d;
  }

  score(unscored_summary) {
    const scores = {};
    const max_score = 100;
    for (const player in unscored_summary) {
      const d = unscored_summary[player].distance;
      let r = 0;
      if (d < 0.5) {
        r = max_score;
      } else {
        r = max_score - Math.sqrt(d);
      }

      if (r < 0) r = 0;
      scores[player] = r;
    }
    return scores;
  }
}

// Exporting a concrete object makes it effectively a singleton.
export default new GoogleMapsWrapper();
