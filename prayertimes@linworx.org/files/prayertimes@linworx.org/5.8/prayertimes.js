const LATITUDE_VARIATION_STEP = 0.5; // Degrees to add/remove at each resolution step

const UNSAFE_LATITUDE = 65; //

const PolarCircleResolution = {
  AqrabBalad: 'AqrabBalad',
  AqrabYaum: 'AqrabYaum',
  Unresolved: 'Unresolved'
};

class prayerTimes {
  // eslint-disable-next-line complexity
  constructor(coordinates, calculationParameters) {
    this.coordinates = coordinates;
    this.date = new Date();
    const date = this.date;
    this.calculationParameters = calculationParameters;
    let solarTime = new SolarTime(date, coordinates);
    let fajrTime;
    let sunriseTime;
    let dhuhrTime;
    let asrTime;
    let sunsetTime;
    let maghribTime;
    let ishaTime;
    let nightFraction;
    dhuhrTime = new TimeComponents(solarTime.transit).utcDate(date.getFullYear(), date.getMonth(), date.getDate());
    sunriseTime = new TimeComponents(solarTime.sunrise).utcDate(date.getFullYear(), date.getMonth(), date.getDate());
    sunsetTime = new TimeComponents(solarTime.sunset).utcDate(date.getFullYear(), date.getMonth(), date.getDate());
    const tomorrow = dateByAddingDays(date, 1);
    let tomorrowSolarTime = new SolarTime(tomorrow, coordinates);
    const polarCircleResolver = calculationParameters.polarCircleResolution;

    if ((!isValidDate(sunriseTime) || !isValidDate(sunsetTime) || isNaN(tomorrowSolarTime.sunrise)) && polarCircleResolver !== PolarCircleResolution.Unresolved) {
      const resolved = polarCircleResolvedValues(polarCircleResolver, date, coordinates);
      solarTime = resolved.solarTime;
      tomorrowSolarTime = resolved.tomorrowSolarTime;
      const dateComponents = [date.getFullYear(), date.getMonth(), date.getDate()];
      dhuhrTime = new TimeComponents(solarTime.transit).utcDate(...dateComponents);
      sunriseTime = new TimeComponents(solarTime.sunrise).utcDate(...dateComponents);
      sunsetTime = new TimeComponents(solarTime.sunset).utcDate(...dateComponents);
    } // eslint-disable-next-line prefer-const


    asrTime = new TimeComponents(solarTime.afternoon(shadowLength(calculationParameters.madhab))).utcDate(date.getFullYear(), date.getMonth(), date.getDate());
    const tomorrowSunrise = new TimeComponents(tomorrowSolarTime.sunrise).utcDate(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate());
    const night = (Number(tomorrowSunrise) - Number(sunsetTime)) / 1000;
    fajrTime = new TimeComponents(solarTime.hourAngle(-1 * calculationParameters.fajrAngle, false)).utcDate(date.getFullYear(), date.getMonth(), date.getDate()); // special case for moonsighting committee above latitude 55

    if (calculationParameters.method === 'MoonsightingCommittee' && coordinates.latitude >= 55) {
      nightFraction = night / 7;
      fajrTime = dateByAddingSeconds(sunriseTime, -nightFraction);
    }

    const safeFajr = function () {
      if (calculationParameters.method === 'MoonsightingCommittee') {
        return Astronomical.seasonAdjustedMorningTwilight(coordinates.latitude, dayOfYear(date), date.getFullYear(), sunriseTime);
      } else {
        const portion = calculationParameters.nightPortions().fajr;
        nightFraction = portion * night;
        return dateByAddingSeconds(sunriseTime, -nightFraction);
      }
    }();

    if (isNaN(fajrTime.getTime()) || safeFajr > fajrTime) {
      fajrTime = safeFajr;
    }

    if (calculationParameters.ishaInterval > 0) {
      ishaTime = dateByAddingMinutes(sunsetTime, calculationParameters.ishaInterval);
    } else {
      ishaTime = new TimeComponents(solarTime.hourAngle(-1 * calculationParameters.ishaAngle, true)).utcDate(date.getFullYear(), date.getMonth(), date.getDate()); // special case for moonsighting committee above latitude 55

      if (calculationParameters.method === 'MoonsightingCommittee' && coordinates.latitude >= 55) {
        nightFraction = night / 7;
        ishaTime = dateByAddingSeconds(sunsetTime, nightFraction);
      }

      const safeIsha = function () {
        if (calculationParameters.method === 'MoonsightingCommittee') {
          return Astronomical.seasonAdjustedEveningTwilight(coordinates.latitude, dayOfYear(date), date.getFullYear(), sunsetTime, calculationParameters.shafaq);
        } else {
          const portion = calculationParameters.nightPortions().isha;
          nightFraction = portion * night;
          return dateByAddingSeconds(sunsetTime, nightFraction);
        }
      }();

      if (isNaN(ishaTime.getTime()) || safeIsha < ishaTime) {
        ishaTime = safeIsha;
      }
    }

    maghribTime = sunsetTime;

    if (calculationParameters.maghribAngle) {
      const angleBasedMaghrib = new TimeComponents(solarTime.hourAngle(-1 * calculationParameters.maghribAngle, true)).utcDate(date.getFullYear(), date.getMonth(), date.getDate());

      if (sunsetTime < angleBasedMaghrib && ishaTime > angleBasedMaghrib) {
        maghribTime = angleBasedMaghrib;
      }
    }

    const fajrAdjustment = (calculationParameters.adjustments.fajr || 0) + (calculationParameters.methodAdjustments.fajr || 0);
    const sunriseAdjustment = (calculationParameters.adjustments.sunrise || 0) + (calculationParameters.methodAdjustments.sunrise || 0);
    const dhuhrAdjustment = (calculationParameters.adjustments.dhuhr || 0) + (calculationParameters.methodAdjustments.dhuhr || 0);
    const asrAdjustment = (calculationParameters.adjustments.asr || 0) + (calculationParameters.methodAdjustments.asr || 0);
    const maghribAdjustment = (calculationParameters.adjustments.maghrib || 0) + (calculationParameters.methodAdjustments.maghrib || 0);
    const ishaAdjustment = (calculationParameters.adjustments.isha || 0) + (calculationParameters.methodAdjustments.isha || 0);
    this.fajr = roundedMinute(dateByAddingMinutes(fajrTime, fajrAdjustment), calculationParameters.rounding);
    this.sunrise = roundedMinute(dateByAddingMinutes(sunriseTime, sunriseAdjustment), calculationParameters.rounding);
    this.dhuhr = roundedMinute(dateByAddingMinutes(dhuhrTime, dhuhrAdjustment), calculationParameters.rounding);
    this.asr = roundedMinute(dateByAddingMinutes(asrTime, asrAdjustment), calculationParameters.rounding);
    this.sunset = roundedMinute(sunsetTime, calculationParameters.rounding);
    this.maghrib = roundedMinute(dateByAddingMinutes(maghribTime, maghribAdjustment), calculationParameters.rounding);
    this.isha = roundedMinute(dateByAddingMinutes(ishaTime, ishaAdjustment), calculationParameters.rounding);
  }

  timeForPrayer(prayer) {
    if (prayer === Prayer.Fajr) {
      return this.fajr;
    } else if (prayer === Prayer.Sunrise) {
      return this.sunrise;
    } else if (prayer === Prayer.Dhuhr) {
      return this.dhuhr;
    } else if (prayer === Prayer.Asr) {
      return this.asr;
    } else if (prayer === Prayer.Maghrib) {
      return this.maghrib;
    } else if (prayer === Prayer.Isha) {
      return this.isha;
    } else {
      return null;
    }
  }

  currentPrayer(date = new Date()) {
    if (date >= this.isha) {
      return Prayer.Isha;
    } else if (date >= this.maghrib) {
      return Prayer.Maghrib;
    } else if (date >= this.asr) {
      return Prayer.Asr;
    } else if (date >= this.dhuhr) {
      return Prayer.Dhuhr;
    } else if (date >= this.sunrise) {
      return Prayer.Sunrise;
    } else if (date >= this.fajr) {
      return Prayer.Fajr;
    } else {
      return Prayer.None;
    }
  }

  nextPrayer(date = new Date()) {
    if (date >= this.isha) {
      return Prayer.None;
    } else if (date >= this.maghrib) {
      return Prayer.Isha;
    } else if (date >= this.asr) {
      return Prayer.Maghrib;
    } else if (date >= this.dhuhr) {
      return Prayer.Asr;
    } else if (date >= this.sunrise) {
      return Prayer.Dhuhr;
    } else if (date >= this.fajr) {
      return Prayer.Sunrise;
    } else {
      return Prayer.Fajr;
    }
  }

}

class SolarTime {
  constructor(date, coordinates) {
    const julianDay = Astronomical.julianDay(date.getFullYear(), date.getMonth() + 1, date.getDate(), 0);
    this.observer = coordinates;
    this.solar = new SolarCoordinates(julianDay);
    this.prevSolar = new SolarCoordinates(julianDay - 1);
    this.nextSolar = new SolarCoordinates(julianDay + 1);
    const m0 = Astronomical.approximateTransit(coordinates.longitude, this.solar.apparentSiderealTime, this.solar.rightAscension);
    const solarAltitude = -50.0 / 60.0;
    this.approxTransit = m0;
    this.transit = Astronomical.correctedTransit(m0, coordinates.longitude, this.solar.apparentSiderealTime, this.solar.rightAscension, this.prevSolar.rightAscension, this.nextSolar.rightAscension);
    this.sunrise = Astronomical.correctedHourAngle(m0, solarAltitude, coordinates, false, this.solar.apparentSiderealTime, this.solar.rightAscension, this.prevSolar.rightAscension, this.nextSolar.rightAscension, this.solar.declination, this.prevSolar.declination, this.nextSolar.declination);
    this.sunset = Astronomical.correctedHourAngle(m0, solarAltitude, coordinates, true, this.solar.apparentSiderealTime, this.solar.rightAscension, this.prevSolar.rightAscension, this.nextSolar.rightAscension, this.solar.declination, this.prevSolar.declination, this.nextSolar.declination);
  }

  hourAngle(angle, afterTransit) {
    return Astronomical.correctedHourAngle(this.approxTransit, angle, this.observer, afterTransit, this.solar.apparentSiderealTime, this.solar.rightAscension, this.prevSolar.rightAscension, this.nextSolar.rightAscension, this.solar.declination, this.prevSolar.declination, this.nextSolar.declination);
  }

  afternoon(shadowLength) {
    // TODO source shadow angle calculation
    const tangent = Math.abs(this.observer.latitude - this.solar.declination);
    const inverse = shadowLength + Math.tan(degreesToRadians(tangent));
    const angle = radiansToDegrees(Math.atan(1.0 / inverse));
    return this.hourAngle(angle, true);
  }

}

var Astronomical = {
  /* The geometric mean longitude of the sun in degrees. */
  meanSolarLongitude(julianCentury) {
    const T = julianCentury;
    /* Equation from Astronomical Algorithms page 163 */

    const term1 = 280.4664567;
    const term2 = 36000.76983 * T;
    const term3 = 0.0003032 * Math.pow(T, 2);
    const L0 = term1 + term2 + term3;
    return unwindAngle(L0);
  },

  /* The geometric mean longitude of the moon in degrees. */
  meanLunarLongitude(julianCentury) {
    const T = julianCentury;
    /* Equation from Astronomical Algorithms page 144 */

    const term1 = 218.3165;
    const term2 = 481267.8813 * T;
    const Lp = term1 + term2;
    return unwindAngle(Lp);
  },

  ascendingLunarNodeLongitude(julianCentury) {
    const T = julianCentury;
    /* Equation from Astronomical Algorithms page 144 */

    const term1 = 125.04452;
    const term2 = 1934.136261 * T;
    const term3 = 0.0020708 * Math.pow(T, 2);
    const term4 = Math.pow(T, 3) / 450000;
    const Omega = term1 - term2 + term3 + term4;
    return unwindAngle(Omega);
  },

  /* The mean anomaly of the sun. */
  meanSolarAnomaly(julianCentury) {
    const T = julianCentury;
    /* Equation from Astronomical Algorithms page 163 */

    const term1 = 357.52911;
    const term2 = 35999.05029 * T;
    const term3 = 0.0001537 * Math.pow(T, 2);
    const M = term1 + term2 - term3;
    return unwindAngle(M);
  },

  /* The Sun's equation of the center in degrees. */
  solarEquationOfTheCenter(julianCentury, meanAnomaly) {
    const T = julianCentury;
    /* Equation from Astronomical Algorithms page 164 */

    const Mrad = degreesToRadians(meanAnomaly);
    const term1 = (1.914602 - 0.004817 * T - 0.000014 * Math.pow(T, 2)) * Math.sin(Mrad);
    const term2 = (0.019993 - 0.000101 * T) * Math.sin(2 * Mrad);
    const term3 = 0.000289 * Math.sin(3 * Mrad);
    return term1 + term2 + term3;
  },

  /* The apparent longitude of the Sun, referred to the
        true equinox of the date. */
  apparentSolarLongitude(julianCentury, meanLongitude) {
    const T = julianCentury;
    const L0 = meanLongitude;
    /* Equation from Astronomical Algorithms page 164 */

    const longitude = L0 + Astronomical.solarEquationOfTheCenter(T, Astronomical.meanSolarAnomaly(T));
    const Omega = 125.04 - 1934.136 * T;
    const Lambda = longitude - 0.00569 - 0.00478 * Math.sin(degreesToRadians(Omega));
    return unwindAngle(Lambda);
  },

  /* The mean obliquity of the ecliptic, formula
        adopted by the International Astronomical Union.
        Represented in degrees. */
  meanObliquityOfTheEcliptic(julianCentury) {
    const T = julianCentury;
    /* Equation from Astronomical Algorithms page 147 */

    const term1 = 23.439291;
    const term2 = 0.013004167 * T;
    const term3 = 0.0000001639 * Math.pow(T, 2);
    const term4 = 0.0000005036 * Math.pow(T, 3);
    return term1 - term2 - term3 + term4;
  },

  /* The mean obliquity of the ecliptic, corrected for
        calculating the apparent position of the sun, in degrees. */
  apparentObliquityOfTheEcliptic(julianCentury, meanObliquityOfTheEcliptic) {
    const T = julianCentury;
    const Epsilon0 = meanObliquityOfTheEcliptic;
    /* Equation from Astronomical Algorithms page 165 */

    const O = 125.04 - 1934.136 * T;
    return Epsilon0 + 0.00256 * Math.cos(degreesToRadians(O));
  },

  /* Mean sidereal time, the hour angle of the vernal equinox, in degrees. */
  meanSiderealTime(julianCentury) {
    const T = julianCentury;
    /* Equation from Astronomical Algorithms page 165 */

    const JD = T * 36525 + 2451545.0;
    const term1 = 280.46061837;
    const term2 = 360.98564736629 * (JD - 2451545);
    const term3 = 0.000387933 * Math.pow(T, 2);
    const term4 = Math.pow(T, 3) / 38710000;
    const Theta = term1 + term2 + term3 - term4;
    return unwindAngle(Theta);
  },

  nutationInLongitude(julianCentury, solarLongitude, lunarLongitude, ascendingNode) {
    const L0 = solarLongitude;
    const Lp = lunarLongitude;
    const Omega = ascendingNode;
    /* Equation from Astronomical Algorithms page 144 */

    const term1 = -17.2 / 3600 * Math.sin(degreesToRadians(Omega));
    const term2 = 1.32 / 3600 * Math.sin(2 * degreesToRadians(L0));
    const term3 = 0.23 / 3600 * Math.sin(2 * degreesToRadians(Lp));
    const term4 = 0.21 / 3600 * Math.sin(2 * degreesToRadians(Omega));
    return term1 - term2 - term3 + term4;
  },

  nutationInObliquity(julianCentury, solarLongitude, lunarLongitude, ascendingNode) {
    const L0 = solarLongitude;
    const Lp = lunarLongitude;
    const Omega = ascendingNode;
    /* Equation from Astronomical Algorithms page 144 */

    const term1 = 9.2 / 3600 * Math.cos(degreesToRadians(Omega));
    const term2 = 0.57 / 3600 * Math.cos(2 * degreesToRadians(L0));
    const term3 = 0.1 / 3600 * Math.cos(2 * degreesToRadians(Lp));
    const term4 = 0.09 / 3600 * Math.cos(2 * degreesToRadians(Omega));
    return term1 + term2 + term3 - term4;
  },

  altitudeOfCelestialBody(observerLatitude, declination, localHourAngle) {
    const Phi = observerLatitude;
    const delta = declination;
    const H = localHourAngle;
    /* Equation from Astronomical Algorithms page 93 */

    const term1 = Math.sin(degreesToRadians(Phi)) * Math.sin(degreesToRadians(delta));
    const term2 = Math.cos(degreesToRadians(Phi)) * Math.cos(degreesToRadians(delta)) * Math.cos(degreesToRadians(H));
    return radiansToDegrees(Math.asin(term1 + term2));
  },

  approximateTransit(longitude, siderealTime, rightAscension) {
    const L = longitude;
    const Theta0 = siderealTime;
    const a2 = rightAscension;
    /* Equation from page Astronomical Algorithms 102 */

    const Lw = L * -1;
    return normalizeToScale((a2 + Lw - Theta0) / 360, 1);
  },

  /* The time at which the sun is at its highest point in the sky (in universal time) */
  correctedTransit(approximateTransit, longitude, siderealTime, rightAscension, previousRightAscension, nextRightAscension) {
    const m0 = approximateTransit;
    const L = longitude;
    const Theta0 = siderealTime;
    const a2 = rightAscension;
    const a1 = previousRightAscension;
    const a3 = nextRightAscension;
    /* Equation from page Astronomical Algorithms 102 */

    const Lw = L * -1;
    const Theta = unwindAngle(Theta0 + 360.985647 * m0);
    const a = unwindAngle(Astronomical.interpolateAngles(a2, a1, a3, m0));
    const H = quadrantShiftAngle(Theta - Lw - a);
    const dm = H / -360;
    return (m0 + dm) * 24;
  },

  correctedHourAngle(approximateTransit, angle, coordinates, afterTransit, siderealTime, rightAscension, previousRightAscension, nextRightAscension, declination, previousDeclination, nextDeclination) {
    const m0 = approximateTransit;
    const h0 = angle;
    const Theta0 = siderealTime;
    const a2 = rightAscension;
    const a1 = previousRightAscension;
    const a3 = nextRightAscension;
    const d2 = declination;
    const d1 = previousDeclination;
    const d3 = nextDeclination;
    /* Equation from page Astronomical Algorithms 102 */

    const Lw = coordinates.longitude * -1;
    const term1 = Math.sin(degreesToRadians(h0)) - Math.sin(degreesToRadians(coordinates.latitude)) * Math.sin(degreesToRadians(d2));
    const term2 = Math.cos(degreesToRadians(coordinates.latitude)) * Math.cos(degreesToRadians(d2));
    const H0 = radiansToDegrees(Math.acos(term1 / term2));
    const m = afterTransit ? m0 + H0 / 360 : m0 - H0 / 360;
    const Theta = unwindAngle(Theta0 + 360.985647 * m);
    const a = unwindAngle(Astronomical.interpolateAngles(a2, a1, a3, m));
    const delta = Astronomical.interpolate(d2, d1, d3, m);
    const H = Theta - Lw - a;
    const h = Astronomical.altitudeOfCelestialBody(coordinates.latitude, delta, H);
    const term3 = h - h0;
    const term4 = 360 * Math.cos(degreesToRadians(delta)) * Math.cos(degreesToRadians(coordinates.latitude)) * Math.sin(degreesToRadians(H));
    const dm = term3 / term4;
    return (m + dm) * 24;
  },

  /* Interpolation of a value given equidistant
        previous and next values and a factor
        equal to the fraction of the interpolated
        point's time over the time between values. */
  interpolate(y2, y1, y3, n) {
    /* Equation from Astronomical Algorithms page 24 */
    const a = y2 - y1;
    const b = y3 - y2;
    const c = b - a;
    return y2 + n / 2 * (a + b + n * c);
  },

  /* Interpolation of three angles, accounting for
        angle unwinding. */
  interpolateAngles(y2, y1, y3, n) {
    /* Equation from Astronomical Algorithms page 24 */
    const a = unwindAngle(y2 - y1);
    const b = unwindAngle(y3 - y2);
    const c = b - a;
    return y2 + n / 2 * (a + b + n * c);
  },

  /* The Julian Day for the given Gregorian date components. */
  julianDay(year, month, day, hours = 0) {
    /* Equation from Astronomical Algorithms page 60 */
    const trunc = Math.trunc;
    const Y = trunc(month > 2 ? year : year - 1);
    const M = trunc(month > 2 ? month : month + 12);
    const D = day + hours / 24;
    const A = trunc(Y / 100);
    const B = trunc(2 - A + trunc(A / 4));
    const i0 = trunc(365.25 * (Y + 4716));
    const i1 = trunc(30.6001 * (M + 1));
    return i0 + i1 + D + B - 1524.5;
  },

  /* Julian century from the epoch. */
  julianCentury(julianDay) {
    /* Equation from Astronomical Algorithms page 163 */
    return (julianDay - 2451545.0) / 36525;
  },

  /* Whether or not a year is a leap year (has 366 days). */
  isLeapYear(year) {
    if (year % 4 !== 0) {
      return false;
    }

    if (year % 100 === 0 && year % 400 !== 0) {
      return false;
    }

    return true;
  },

  seasonAdjustedMorningTwilight(latitude, dayOfYear, year, sunrise) {
    const a = 75 + 28.65 / 55.0 * Math.abs(latitude);
    const b = 75 + 19.44 / 55.0 * Math.abs(latitude);
    const c = 75 + 32.74 / 55.0 * Math.abs(latitude);
    const d = 75 + 48.1 / 55.0 * Math.abs(latitude);

    const adjustment = function () {
      const dyy = Astronomical.daysSinceSolstice(dayOfYear, year, latitude);

      if (dyy < 91) {
        return a + (b - a) / 91.0 * dyy;
      } else if (dyy < 137) {
        return b + (c - b) / 46.0 * (dyy - 91);
      } else if (dyy < 183) {
        return c + (d - c) / 46.0 * (dyy - 137);
      } else if (dyy < 229) {
        return d + (c - d) / 46.0 * (dyy - 183);
      } else if (dyy < 275) {
        return c + (b - c) / 46.0 * (dyy - 229);
      } else {
        return b + (a - b) / 91.0 * (dyy - 275);
      }
    }();

    return dateByAddingSeconds(sunrise, Math.round(adjustment * -60.0));
  },

  seasonAdjustedEveningTwilight(latitude, dayOfYear, year, sunset, shafaq) {
    let a, b, c, d;

    if (shafaq === Shafaq.Ahmer) {
      a = 62 + 17.4 / 55.0 * Math.abs(latitude);
      b = 62 - 7.16 / 55.0 * Math.abs(latitude);
      c = 62 + 5.12 / 55.0 * Math.abs(latitude);
      d = 62 + 19.44 / 55.0 * Math.abs(latitude);
    } else if (shafaq === Shafaq.Abyad) {
      a = 75 + 25.6 / 55.0 * Math.abs(latitude);
      b = 75 + 7.16 / 55.0 * Math.abs(latitude);
      c = 75 + 36.84 / 55.0 * Math.abs(latitude);
      d = 75 + 81.84 / 55.0 * Math.abs(latitude);
    } else {
      a = 75 + 25.6 / 55.0 * Math.abs(latitude);
      b = 75 + 2.05 / 55.0 * Math.abs(latitude);
      c = 75 - 9.21 / 55.0 * Math.abs(latitude);
      d = 75 + 6.14 / 55.0 * Math.abs(latitude);
    }

    const adjustment = function () {
      const dyy = Astronomical.daysSinceSolstice(dayOfYear, year, latitude);

      if (dyy < 91) {
        return a + (b - a) / 91.0 * dyy;
      } else if (dyy < 137) {
        return b + (c - b) / 46.0 * (dyy - 91);
      } else if (dyy < 183) {
        return c + (d - c) / 46.0 * (dyy - 137);
      } else if (dyy < 229) {
        return d + (c - d) / 46.0 * (dyy - 183);
      } else if (dyy < 275) {
        return c + (b - c) / 46.0 * (dyy - 229);
      } else {
        return b + (a - b) / 91.0 * (dyy - 275);
      }
    }();

    return dateByAddingSeconds(sunset, Math.round(adjustment * 60.0));
  },

  daysSinceSolstice(dayOfYear, year, latitude) {
    let daysSinceSolstice = 0;
    const northernOffset = 10;
    const southernOffset = Astronomical.isLeapYear(year) ? 173 : 172;
    const daysInYear = Astronomical.isLeapYear(year) ? 366 : 365;

    if (latitude >= 0) {
      daysSinceSolstice = dayOfYear + northernOffset;

      if (daysSinceSolstice >= daysInYear) {
        daysSinceSolstice = daysSinceSolstice - daysInYear;
      }
    } else {
      daysSinceSolstice = dayOfYear - southernOffset;

      if (daysSinceSolstice < 0) {
        daysSinceSolstice = daysSinceSolstice + daysInYear;
      }
    }

    return daysSinceSolstice;
  }

};

const Shafaq = {
  // General is a combination of Ahmer and Abyad.
  General: 'general',
  // Ahmer means the twilight is the red glow in the sky. Used by the Shafi, Maliki, and Hanbali madhabs.
  Ahmer: 'ahmer',
  // Abyad means the twilight is the white glow in the sky. Used by the Hanafi madhab.
  Abyad: 'abyad'
};

function degreesToRadians(degrees) {
  return degrees * Math.PI / 180.0;
}
function radiansToDegrees(radians) {
  return radians * 180.0 / Math.PI;
}
function normalizeToScale(num, max) {
  return num - max * Math.floor(num / max);
}
function unwindAngle(angle) {
  return normalizeToScale(angle, 360.0);
}
function quadrantShiftAngle(angle) {
  if (angle >= -180 && angle <= 180) {
    return angle;
  }

  return angle - 360 * Math.round(angle / 360);
}

function dateByAddingDays(date, days) {
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate() + days;
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = date.getSeconds();
  return new Date(year, month, day, hours, minutes, seconds);
}

function dateByAddingMinutes(date, minutes) {
  return dateByAddingSeconds(date, minutes * 60);
}

function dateByAddingSeconds(date, seconds) {
  return new Date(date.getTime() + seconds * 1000);
}

function roundedMinute(date, rounding = Rounding.Nearest) {
  const seconds = date.getUTCSeconds();
  let offset = seconds >= 30 ? 60 - seconds : -1 * seconds;

  if (rounding === Rounding.Up) {
    offset = 60 - seconds;
  } else if (rounding === Rounding.None) {
    offset = 0;
  }

  return dateByAddingSeconds(date, offset);
}

function dayOfYear(date) {
  let returnedDayOfYear = 0;
  const feb = Astronomical.isLeapYear(date.getFullYear()) ? 29 : 28;
  const months = [31, feb, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  for (let i = 0; i < date.getMonth(); i++) {
    returnedDayOfYear += months[i];
  }

  returnedDayOfYear += date.getDate();
  return returnedDayOfYear;
}

function isValidDate(date) {
  return date instanceof Date && !isNaN(date.valueOf());
}

const Rounding = {
  Nearest: 'nearest',
  Up: 'up',
  None: 'none'
}

class TimeComponents {
  constructor(num) {
    this.hours = Math.floor(num);
    this.minutes = Math.floor((num - this.hours) * 60);
    this.seconds = Math.floor((num - (this.hours + this.minutes / 60)) * 60 * 60);
    return this;
  }

  utcDate(year, month, date) {
    return new Date(Date.UTC(year, month, date, this.hours, this.minutes, this.seconds));
  }

}

var Prayer = {
  Fajr: 'fajr',
  Sunrise: 'sunrise',
  Dhuhr: 'dhuhr',
  Asr: 'asr',
  Maghrib: 'maghrib',
  Isha: 'isha',
  None: 'none'
}
//# sourceMappingURL=Astronomical.js.map

var Madhab = {
  Shafi: 'shafi',
  Hanafi: 'hanafi'
};

function shadowLength(madhab) {
  switch (madhab) {
    case Madhab.Shafi:
      return 1;

    case Madhab.Hanafi:
      return 2;

    default:
      throw 'Invalid Madhab';
  }
}


const isValidSolarTime = solarTime => !isNaN(solarTime.sunrise) && !isNaN(solarTime.sunset);

const aqrabYaumResolver = (coordinates, date, daysAdded = 1, direction = 1) => {
  if (daysAdded > Math.ceil(365 / 2)) {
    return null;
  }

  const testDate = new Date(date.getTime());
  testDate.setDate(testDate.getDate() + direction * daysAdded);
  const tomorrow = dateByAddingDays(testDate, 1);
  const solarTime = new SolarTime(testDate, coordinates);
  const tomorrowSolarTime = new SolarTime(tomorrow, coordinates);

  if (!isValidSolarTime(solarTime) || !isValidSolarTime(tomorrowSolarTime)) {
    return aqrabYaumResolver(coordinates, date, daysAdded + (direction > 0 ? 0 : 1), -direction);
  }

  return {
    date,
    tomorrow,
    coordinates,
    solarTime,
    tomorrowSolarTime
  };
};

const aqrabBaladResolver = (coordinates, date, latitude) => {
  const solarTime = new SolarTime(date, {
    ...coordinates,
    latitude
  });
  const tomorrow = dateByAddingDays(date, 1);
  const tomorrowSolarTime = new SolarTime(tomorrow, {
    ...coordinates,
    latitude
  });

  if (!isValidSolarTime(solarTime) || !isValidSolarTime(tomorrowSolarTime)) {
    return Math.abs(latitude) >= UNSAFE_LATITUDE ? aqrabBaladResolver(coordinates, date, latitude - Math.sign(latitude) * LATITUDE_VARIATION_STEP) : null;
  }

  return {
    date,
    tomorrow,
    coordinates: new Coordinates(latitude, coordinates.longitude),
    solarTime,
    tomorrowSolarTime
  };
};

const polarCircleResolvedValues = (resolver, date, coordinates) => {
  const defaultReturn = {
    date,
    tomorrow: dateByAddingDays(date, 1),
    coordinates,
    solarTime: new SolarTime(date, coordinates),
    tomorrowSolarTime: new SolarTime(dateByAddingDays(date, 1), coordinates)
  };

  switch (resolver) {
    case PolarCircleResolution.AqrabYaum:
      {
        return aqrabYaumResolver(coordinates, date) || defaultReturn;
      }

    case PolarCircleResolution.AqrabBalad:
      {
        const {
          latitude
        } = coordinates;
        return aqrabBaladResolver(coordinates, date, latitude - Math.sign(latitude) * LATITUDE_VARIATION_STEP) || defaultReturn;
      }

    default:
      {
        return defaultReturn;
      }
  }
};

var HighLatitudeRule = {
  MiddleOfTheNight: 'middleofthenight',
  SeventhOfTheNight: 'seventhofthenight',
  TwilightAngle: 'twilightangle',

  recommended(coordinates) {
    if (coordinates.latitude > 48) {
      return HighLatitudeRule.SeventhOfTheNight;
    } else {
      return HighLatitudeRule.MiddleOfTheNight;
    }
  }

};

class Coordinates {
  constructor(latitude, longitude) {
    this.latitude = latitude;
    this.longitude = longitude;
  }

}

var CalculationMethod = {
  // Muslim World League
  MuslimWorldLeague() {
    const params = new CalculationParameters('MuslimWorldLeague', 18, 17);
    params.methodAdjustments.dhuhr = 1;
    return params;
  },

  // Egyptian General Authority of Survey
  Egyptian() {
    const params = new CalculationParameters('Egyptian', 19.5, 17.5);
    params.methodAdjustments.dhuhr = 1;
    return params;
  },

  // University of Islamic Sciences, Karachi
  Karachi() {
    const params = new CalculationParameters('Karachi', 18, 18);
    params.methodAdjustments.dhuhr = 1;
    return params;
  },

  // Umm al-Qura University, Makkah
  UmmAlQura() {
    return new CalculationParameters('UmmAlQura', 18.5, 0, 90);
  },

  // Dubai
  Dubai() {
    const params = new CalculationParameters('Dubai', 18.2, 18.2);
    params.methodAdjustments = {
      ...params.methodAdjustments,
      sunrise: -3,
      dhuhr: 3,
      asr: 3,
      maghrib: 3
    };
    return params;
  },

  // Moonsighting Committee
  MoonsightingCommittee() {
    const params = new CalculationParameters('MoonsightingCommittee', 18, 18);
    params.methodAdjustments = {
      ...params.methodAdjustments,
      dhuhr: 5,
      maghrib: 3
    };
    return params;
  },

  // ISNA
  NorthAmerica() {
    const params = new CalculationParameters('NorthAmerica', 15, 15);
    params.methodAdjustments.dhuhr = 1;
    return params;
  },

  // Kuwait
  Kuwait() {
    return new CalculationParameters('Kuwait', 18, 17.5);
  },

  // Qatar
  Qatar() {
    return new CalculationParameters('Qatar', 18, 0, 90);
  },

  // Singapore
  Singapore() {
    const params = new CalculationParameters('Singapore', 20, 18);
    params.methodAdjustments.dhuhr = 1;
    params.rounding = Rounding.Up;
    return params;
  },

  // Institute of Geophysics, University of Tehran
  Tehran() {
    const params = new CalculationParameters('Tehran', 17.7, 14, 0, 4.5);
    return params;
  },

  // Dianet
  Turkey() {
    const params = new CalculationParameters('Turkey', 18, 17);
    params.methodAdjustments = {
      ...params.methodAdjustments,
      sunrise: -7,
      dhuhr: 5,
      asr: 4,
      maghrib: 7
    };
    return params;
  },

  // Other
  Other() {
    return new CalculationParameters('Other', 0, 0);
  }
};

class CalculationParameters {
  // Madhab to determine how Asr is calculated.
  madhab = Madhab.Shafi; // Rule to determine the earliest time for Fajr and latest time for Isha
  // needed for high latitude locations where Fajr and Isha may not truly exist
  // or may present a hardship unless bound to a reasonable time.

  highLatitudeRule = HighLatitudeRule.MiddleOfTheNight; // Manual adjustments (in minutes) to be added to each prayer time.

  adjustments = {
    fajr: 0,
    sunrise: 0,
    dhuhr: 0,
    asr: 0,
    maghrib: 0,
    isha: 0
  }; // Adjustments set by a calculation method. This value should not be manually modified.

  methodAdjustments = {
    fajr: 0,
    sunrise: 0,
    dhuhr: 0,
    asr: 0,
    maghrib: 0,
    isha: 0
  }; // Rule to determine how to resolve prayer times inside the Polar Circle
  // where daylight or night may persist for more than 24 hours depending
  // on the season

  polarCircleResolution = PolarCircleResolution.Unresolved; // How seconds are rounded when calculating prayer times

  rounding = Rounding.Nearest; // Used by the MoonsightingCommittee method to determine how to calculate Isha

  shafaq = Shafaq.General;

  constructor( // Name of the method, can be used to apply special behavior in calculations.
    // This property should not be manually modified.
    method, // Angle of the sun below the horizon used for calculating Fajr.
    fajrAngle = 0, // Angle of the sun below the horizon used for calculating Isha.
    ishaAngle = 0, // Minutes after Maghrib to determine time for Isha
    // if this value is greater than 0 then ishaAngle is not used.
    ishaInterval = 0, // Angle of the sun below the horizon used for calculating Maghrib.
    // Only used by the Tehran method to account for lightness in the sky.
    maghribAngle = 0) {
    this.method = method;
    this.fajrAngle = fajrAngle;
    this.ishaAngle = ishaAngle;
    this.ishaInterval = ishaInterval;
    this.maghribAngle = maghribAngle;

    if (this.method === null) {
      // we don't want a breaking change
      this.method = 'Other';
    }
  }

  nightPortions() {
    switch (this.highLatitudeRule) {
      case HighLatitudeRule.MiddleOfTheNight:
        return {
          fajr: 1 / 2,
          isha: 1 / 2
        };

      case HighLatitudeRule.SeventhOfTheNight:
        return {
          fajr: 1 / 7,
          isha: 1 / 7
        };

      case HighLatitudeRule.TwilightAngle:
        return {
          fajr: this.fajrAngle / 60,
          isha: this.ishaAngle / 60
        };

      default:
        throw `Invalid high latitude rule found when attempting to compute night portions: ${this.highLatitudeRule}`;
    }
  }

}

class SolarCoordinates {
  constructor(julianDay) {
    const T = Astronomical.julianCentury(julianDay);
    const L0 = Astronomical.meanSolarLongitude(T);
    const Lp = Astronomical.meanLunarLongitude(T);
    const Omega = Astronomical.ascendingLunarNodeLongitude(T);
    const Lambda = degreesToRadians(Astronomical.apparentSolarLongitude(T, L0));
    const Theta0 = Astronomical.meanSiderealTime(T);
    const dPsi = Astronomical.nutationInLongitude(T, L0, Lp, Omega);
    const dEpsilon = Astronomical.nutationInObliquity(T, L0, Lp, Omega);
    const Epsilon0 = Astronomical.meanObliquityOfTheEcliptic(T);
    const EpsilonApparent = degreesToRadians(Astronomical.apparentObliquityOfTheEcliptic(T, Epsilon0));
    /* declination: The declination of the sun, the angle between
            the rays of the Sun and the plane of the Earth's
            equator, in degrees.
            Equation from Astronomical Algorithms page 165 */

    this.declination = radiansToDegrees(Math.asin(Math.sin(EpsilonApparent) * Math.sin(Lambda)));
    /* rightAscension: Right ascension of the Sun, the angular distance on the
            celestial equator from the vernal equinox to the hour circle,
            in degrees.
            Equation from Astronomical Algorithms page 165 */

    this.rightAscension = unwindAngle(radiansToDegrees(Math.atan2(Math.cos(EpsilonApparent) * Math.sin(Lambda), Math.cos(Lambda))));
    /* apparentSiderealTime: Apparent sidereal time, the hour angle of the vernal
            equinox, in degrees.
            Equation from Astronomical Algorithms page 88 */

    this.apparentSiderealTime = Theta0 + dPsi * 3600 * Math.cos(degreesToRadians(Epsilon0 + dEpsilon)) / 3600;
  }

}

var PrayerTimes = prayerTimes;
var Options = CalculationParameters;