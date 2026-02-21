/*
 * sun.js — Sunrise / sunset calculation for Calendarium desklet
 *
 * Based on the NOAA simplified solar position algorithm.
 * Inputs: date, latitude (°N), longitude (°E)
 * Output: local "HH:MM" strings for sunrise and sunset.
 *
 * This module exports a single `Sun` object.
 */

var Sun = {

    _deg2rad: function(d) { return d * Math.PI / 180; },
    _rad2deg: function(r) { return r * 180 / Math.PI; },

    /**
     * Convert a JS Date to Julian Day Number (at noon UTC for that calendar date).
     * @param {Date} date
     * @returns {number}
     */
    _toJD: function(date) {
        let Y = date.getFullYear();
        let M = date.getMonth() + 1;
        let D = date.getDate();
        let A = Math.floor((14 - M) / 12);
        let y = Y + 4800 - A;
        let m = M + 12 * A - 3;
        return D
             + Math.floor((153 * m + 2) / 5)
             + 365 * y
             + Math.floor(y / 4)
             - Math.floor(y / 100)
             + Math.floor(y / 400)
             - 32045
             + 0.5;   // +0.5 shifts epoch to noon
    },

    /**
     * Format a decimal UTC hour value to a local "HH:MM" string.
     * @param {number} utcHours  Decimal hours in UTC (may be < 0 or > 24)
     * @param {Date}   refDate   Reference JS Date (only the calendar date matters)
     * @returns {string}  "HH:MM" in the system's local timezone, or null
     */
    formatTime: function(utcHours, refDate) {
        if (utcHours === null || utcHours === undefined) return null;
        let totalMins = Math.round(utcHours * 60);
        // Build a UTC Date at that moment, then read back local hours/minutes
        let d = new Date(Date.UTC(
            refDate.getFullYear(),
            refDate.getMonth(),
            refDate.getDate(),
            Math.floor(totalMins / 60),
            totalMins % 60
        ));
        let h = d.getHours();
        let m = d.getMinutes();
        return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
    },

    /**
     * Compute sunrise and sunset times for a given date and location.
     *
     * @param {Date}   date  Local JS Date (only the calendar date is used)
     * @param {number} lat   Latitude in decimal degrees (positive = North)
     * @param {number} lon   Longitude in decimal degrees (positive = East)
     * @returns {Object}  {
     *   sunrise: "HH:MM" | null,
     *   sunset:  "HH:MM" | null,
     *   polarDay:   boolean,
     *   polarNight: boolean
     * }
     */
    getSunTimes: function(date, lat, lon) {
        let JD = this._toJD(date);

        // Julian century from J2000.0
        let T = (JD - 2451545.0) / 36525.0;

        // Geometric mean longitude of the sun (degrees, mod 360)
        let L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360;
        if (L0 < 0) L0 += 360;

        // Geometric mean anomaly (degrees)
        let M    = 357.52911 + T * (35999.05029 - 0.0001537 * T);
        let Mrad = this._deg2rad(M);

        // Equation of center
        let C = Math.sin(Mrad)       * (1.914602 - T * (0.004817 + 0.000014 * T))
              + Math.sin(2 * Mrad)   * (0.019993 - 0.000101 * T)
              + Math.sin(3 * Mrad)   *  0.000289;

        // Sun's true longitude
        let SunLon = L0 + C;

        // Apparent longitude (apply nutation/aberration correction)
        let omega  = 125.04 - 1934.136 * T;
        let lambda = SunLon - 0.00569 - 0.00478 * Math.sin(this._deg2rad(omega));

        // Mean obliquity of ecliptic
        let eps0 = 23 + (26 + (21.448 - T * (46.8150 + T * (0.00059 - T * 0.001813))) / 60) / 60;
        let eps  = eps0 + 0.00256 * Math.cos(this._deg2rad(omega));

        // Sun declination
        let sinDec = Math.sin(this._deg2rad(eps)) * Math.sin(this._deg2rad(lambda));
        let dec    = this._rad2deg(Math.asin(sinDec));

        // Equation of time (minutes)
        let e    = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
        let yy   = Math.pow(Math.tan(this._deg2rad(eps / 2)), 2);
        let L0r  = this._deg2rad(L0);
        let Mr   = this._deg2rad(M);
        let eqTime = 4 * this._rad2deg(
              yy * Math.sin(2 * L0r)
            - 2 * e * Math.sin(Mr)
            + 4 * e * yy * Math.sin(Mr) * Math.cos(2 * L0r)
            - 0.5 * yy * yy * Math.sin(4 * L0r)
            - 1.25 * e * e * Math.sin(2 * Mr)
        );

        // Hour angle for sunrise/sunset
        // Zenith = 90.833° accounts for atmospheric refraction + solar disk radius
        let latRad = this._deg2rad(lat);
        let decRad = this._deg2rad(dec);
        let cosHA  = (Math.cos(this._deg2rad(90.833))
                    - Math.sin(latRad) * Math.sin(decRad))
                   / (Math.cos(latRad) * Math.cos(decRad));

        if (cosHA > 1)  return { sunrise: null, sunset: null, polarNight: true,  polarDay: false };
        if (cosHA < -1) return { sunrise: null, sunset: null, polarNight: false, polarDay: true  };

        let HA = this._rad2deg(Math.acos(cosHA));  // degrees

        // Solar noon (minutes from midnight UTC)
        let solarNoon = 720 - 4 * lon - eqTime;

        // Sunrise / sunset in minutes from midnight UTC
        let sunriseMin = solarNoon - 4 * HA;
        let sunsetMin  = solarNoon + 4 * HA;

        return {
            sunrise:    this.formatTime(sunriseMin / 60, date),
            sunset:     this.formatTime(sunsetMin  / 60, date),
            polarNight: false,
            polarDay:   false
        };
    }
};
