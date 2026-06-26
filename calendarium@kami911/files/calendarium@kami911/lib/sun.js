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
     * Format a decimal UTC hour value to a "HH:MM" string.
     * @param {number}      utcHours       Decimal hours in UTC (may be < 0 or > 24)
     * @param {Date}        refDate        Reference JS Date (only the calendar date matters)
     * @param {number|null} utcOffsetHours Explicit UTC offset in hours (e.g. 1, -5, 5.5).
     *                                     If null/undefined, the system's local timezone is used.
     * @returns {string|null}  "HH:MM", or null on invalid input
     */
    formatTime: function(utcHours, refDate, utcOffsetHours) {
        if (utcHours === null || utcHours === undefined) return null;
        if (utcOffsetHours !== undefined && utcOffsetHours !== null) {
            // Apply explicit UTC offset (handles non-system timezones and DST)
            let localHours = ((utcHours + utcOffsetHours) % 24 + 24) % 24;
            let h = Math.floor(localHours);
            let m = Math.round((localHours - h) * 60);
            if (m === 60) { h = (h + 1) % 24; m = 0; }
            return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
        }
        // Default: system local timezone
        let totalMins = Math.round(utcHours * 60);
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
    getSunTimes: function(date, lat, lon, utcOffsetHours) {
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
            sunrise:    this.formatTime(sunriseMin / 60, date, utcOffsetHours),
            sunset:     this.formatTime(sunsetMin  / 60, date, utcOffsetHours),
            polarNight: false,
            polarDay:   false
        };
    },

    // ── Moon rise / set ───────────────────────────────────────────────────

    /**
     * Compute the Moon's geocentric equatorial position (RA, Dec in radians)
     * for a given offset in days from J2000.0 (2000-01-01 12:00 TT).
     * Based on simplified Meeus Ch.22 formulas (~1° accuracy).
     * @param {number} d  Days since J2000.0
     * @returns {{ ra: number, dec: number }}  Radians
     */
    _moonPos: function(d) {
        let D2R = Math.PI / 180;
        // Fundamental arguments (degrees, wrapped)
        let L  = (218.316 + 13.176396 * d) % 360;
        let M  = (134.963 + 13.064993 * d) % 360;
        let F  = ( 93.272 + 13.229350 * d) % 360;
        let Dm = (297.850 + 12.190749 * d) % 360;
        let Ms = (357.529 +  0.985600 * d) % 360;

        // Ecliptic longitude (degrees)
        let lon = L
                + 6.289 * Math.sin(M  * D2R)
                + 1.274 * Math.sin((2*Dm - M) * D2R)
                + 0.658 * Math.sin(2*Dm * D2R)
                + 0.214 * Math.sin(2*M  * D2R)
                - 0.186 * Math.sin(Ms  * D2R)
                - 0.114 * Math.sin(2*F  * D2R);

        // Ecliptic latitude (degrees)
        let lat = 5.128 * Math.sin(F  * D2R)
                + 0.173 * Math.sin((2*Dm - F) * D2R);

        // Ecliptic → equatorial (obliquity ≈ 23.4397°)
        let eps  = 23.4397 * D2R;
        let lonR = lon * D2R;
        let latR = lat * D2R;
        let ra  = Math.atan2(
            Math.sin(lonR) * Math.cos(eps) - Math.tan(latR) * Math.sin(eps),
            Math.cos(lonR)
        );
        let dec = Math.asin(
            Math.sin(latR) * Math.cos(eps) + Math.cos(latR) * Math.sin(eps) * Math.sin(lonR)
        );
        // Normalise RA to [0, 2π)
        if (ra < 0) ra += 2 * Math.PI;
        return { ra: ra, dec: dec };
    },

    /**
     * Moon altitude above the geometric horizon (radians) for a given
     * J2000.0 epoch offset (days) and observer location.
     * @param {number} d      Days since J2000.0
     * @param {number} latR   Observer latitude in radians
     * @param {number} lonDeg Observer longitude in degrees (East positive)
     * @returns {number} Altitude in radians
     */
    _moonAlt: function(d, latR, lonDeg) {
        let pos  = this._moonPos(d);
        // Greenwich Mean Sidereal Time (degrees)
        let gmst = ((280.46061837 + 360.98564736629 * d) % 360 + 360) % 360;
        // Local Mean Sidereal Time → hour angle (radians)
        let lmst = ((gmst + lonDeg) % 360 + 360) % 360;
        let ha   = lmst * Math.PI / 180 - pos.ra;
        let sinAlt = Math.sin(latR) * Math.sin(pos.dec)
                   + Math.cos(latR) * Math.cos(pos.dec) * Math.cos(ha);
        return Math.asin(sinAlt);
    },

    /**
     * Compute moonrise and moonset times for a given date and location.
     * Scans altitude every hour (UTC) and linearly interpolates crossings.
     *
     * @param {Date}        date            Local JS Date (calendar date used)
     * @param {number}      lat             Latitude (decimal degrees, North positive)
     * @param {number}      lon             Longitude (decimal degrees, East positive)
     * @param {number|null} utcOffsetHours  Explicit UTC offset; null = system tz
     * @returns {{ moonrise: string|null, moonset: string|null }}
     */
    getMoonTimes: function(date, lat, lon, utcOffsetHours) {
        // J2000.0 epoch in ms
        let J2000_MS  = Date.UTC(2000, 0, 1, 12, 0, 0);
        let dayMs     = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0);
        let d0        = (dayMs - J2000_MS) / 86400000.0;
        let latR      = lat * Math.PI / 180;
        // Effective horizon correction: refraction 0.567° - HP 0.95° + SD 0.26° ≈ −0.123°
        // Use 0.133° (SunCalc convention, slightly conservative)
        let H0        = 0.133 * Math.PI / 180;

        let moonrise  = null;
        let moonset   = null;
        let prevAlt   = this._moonAlt(d0, latR, lon) - H0;

        for (let h = 1; h <= 24; h++) {
            let currAlt = this._moonAlt(d0 + h / 24.0, latR, lon) - H0;
            if (moonrise === null && prevAlt < 0 && currAlt >= 0) {
                moonrise = h - 1 + (-prevAlt) / (currAlt - prevAlt);
            } else if (moonset === null && prevAlt >= 0 && currAlt < 0) {
                moonset  = h - 1 + (-prevAlt) / (currAlt - prevAlt);
            }
            prevAlt = currAlt;
        }

        return {
            moonrise: moonrise !== null ? this.formatTime(moonrise, date, utcOffsetHours) : null,
            moonset:  moonset  !== null ? this.formatTime(moonset,  date, utcOffsetHours) : null
        };
    }
};
