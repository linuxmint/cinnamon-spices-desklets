const Gio = imports.gi.Gio;
const St = imports.gi.St;
const Desklet = imports.ui.desklet;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const GLib = imports.gi.GLib;
const PopupMenu = imports.ui.popupMenu;
const Util = imports.misc.util;
const Settings = imports.ui.settings;
const UUID = "panchang@india";

var n_karan, n_kar, karanaend, karanaendhms, displayDate, tzone, julianDays, vaaram, ayanamsa, sunDegrees, moonDeg, nakshatra, tithi, nakshatraend, nakshatraendhms, tithiend, tithiendhms, n_yoga, yogaend, jdt, z, iyog, Lsun0, Lmoon0, dmoonYoga, dsunYoga, asp1, z1, z2, f, alf, a, b, d, c, e, days, kday, kmon, kyear, hh1, khr, kmin, ksek, s, nakshatra_degree, tithi_degree, mylat, mylong, background_color, border_color, text_color, latitude, longitude;
var minutes = 1000 * 60; //Milliseconds
var hours = minutes * 60; //Milliseconds
var day = hours * 24; //Milliseconds
var longitude = "-78.0081";
var latitude = "27.1767";

function MyDesklet(metadata, desklet_id) {
    this._init(metadata, desklet_id);
}

MyDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function(metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata);
        // initialize settings
        this.settings = new Settings.DeskletSettings(this, this.metadata["uuid"], desklet_id);
        this.settings.bindProperty(Settings.BindingDirection.IN, "background-color", "background_color", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "border-color", "border_color", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "text-color", "text_color", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "mylat", "mylat", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "mylong", "mylong", this.on_setting_changed);

        this._mainContainer = new St.BoxLayout({ vertical: false, style_class: 'main_container' });

        this._calenderContainer = new St.BoxLayout({ vertical: true, style_class: 'calender-container' });
        this._panchangContainer = new St.BoxLayout({ vertical: true, style_class: 'panchang-container' });

        this._dateContainer = new St.BoxLayout({ vertical: false, style_class: 'date-container' });
        this._monthContainer = new St.BoxLayout({ vertical: true, style_class: 'month-container' });
        this._timeContainer = new St.BoxLayout({ vertical: false, style_class: 'time-container' });


        this._date = new St.Label();
        this._month = new St.Label();
        this._time = new St.Label();
        this._sunrise_label = new St.Label();
        this._sunset_label = new St.Label();
        this.sunrise_nakshtra_label = new St.Label();
        this.sunrise_tithi_label = new St.Label();
        this._ayanamsa_label = new St.Label();

        this._nakshtra = new St.Label();
        this._tithi = new St.Label();
        this._vaaram = new St.Label();
        this._karan = new St.Label();
        this._yoga = new St.Label();
        this._sun_deg = new St.Label();
        this._moon_deg = new St.Label();

        this._dateContainer.add(this._date);
        this._monthContainer.add(this._month);
        this._monthContainer.add(this._time);
        this._dateContainer.add(this._monthContainer);
        //this._timeContainer.add(this._time);

        this._calenderContainer.add(this.sunrise_nakshtra_label);
        this._calenderContainer.add(this.sunrise_tithi_label);
        this._calenderContainer.add(this._dateContainer, { x_fill: true });
        //this._calenderContainer.add(this._month, { x_fill: true });
        //this._calenderContainer.add(this._time, { x_fill: true });
        this._calenderContainer.add(this._sunrise_label, { x_fill: true });
        // this._calenderContainer.add(this._sunset_label, { x_fill: true });
        this._calenderContainer.add(this._ayanamsa_label);


        this._panchangContainer.add(this._vaaram);
        this._panchangContainer.add(this._tithi);
        this._panchangContainer.add(this._nakshtra);
        this._panchangContainer.add(this._karan);
        this._panchangContainer.add(this._yoga);
        this._panchangContainer.add(this._sun_deg);
        this._panchangContainer.add(this._moon_deg);

        this._mainContainer.add(this._calenderContainer);
        this._mainContainer.add(this._panchangContainer);

        this.setContent(this._mainContainer);
        this.setHeader("Panchang");
        this.on_setting_changed();
        this.init_at_sunrise();
        this._updateDate();
    },

    on_setting_changed: function() {
        this.latitude = mylat;
        this.longitude = -(mylong);

        this._mainContainer.style = "background-color: "+this.background_color+"; border: 1px solid "+this.border_color+"; border-radius: 10px; padding: 10px;"

        this._date.style = "font-size: 36px; color: "+this.text_color+";";
        this._month.style =  "font-size: 16px; color: "+this.text_color+";";
        this._time.style =  "font-size: 16px; color: "+this.text_color+";";
        this._sunrise_label.style = "font-size: 12px; color: "+this.text_color+";";
        this._sunset_label.style =  "font-size: 12px; color: "+this.text_color+";";
        this.sunrise_nakshtra_label.style =  "font-size: 12px; color: "+this.text_color+";";
        this.sunrise_tithi_label.style =  "font-size: 12px; color: "+this.text_color+";";
        this._ayanamsa_label.style =  "font-size: 12px; color: "+this.text_color+";";

        this._nakshtra.style =  "font-size: 12px; color: "+this.text_color+";";
        this._tithi.style =  "font-size: 12px; color: "+this.text_color+";";
        this._vaaram.style = "font-size: 12px; color: "+this.text_color+";";
        this._karan.style =  "font-size: 12px; color: "+this.text_color+";";
        this._yoga.style = "font-size: 12px; color: "+this.text_color+";";
        this._sun_deg.style =  "font-size: 12px; color: "+this.text_color+";";
        this._moon_deg.style =  "font-size: 12px; color: "+this.text_color+";";
    },

    on_desklet_removed: function() {
        Mainloop.source_remove(this.timeout);
    },

    init_at_sunrise: function() {
        var displayDate = new Date();

        this.sunrise = new Date();
        this.sunrise_next = new Date();
        var sr = this.calcSunriseGMT(this.DtJ(displayDate), latitude, longitude);
        var sr2 = this.calcSunriseGMT(this.DtJ(displayDate + day), latitude, longitude);
        this.sunrise.setTime(parseInt(displayDate / day) * day + sr * minutes);
        this.sunrise_next.setTime(parseInt(displayDate / day) * day + day + sr2 * minutes);
        this.sunset = new Date();
        var ss = this.calcSunsetGMT(this.DtJ(displayDate), latitude, longitude);
        this.sunset.setTime(parseInt(displayDate / day) * day + ss * minutes);
        this._sunrise_label.set_text("🌅 " + this.fTs(this.sunrise) + " 🌇 " + this.fTs(this.sunset));
        // this._sunset_label.set_text("🌇 "+this.fTs(this.sunset));
        tzone = displayDate.getTimezoneOffset() / 60 * (-1);
        julianDays = toJulian(this.sunrise);
        // vaaram = wd[weekDay(julianDays)];
        ayanamsa = calcayan(julianDays);
        sunDegrees = sun(julianDays);
        moonDeg = moon(julianDays);
        var nakshatra_degree = fix360(moonDeg + ayanamsa);
        var tithi_degree = fix360(moonDeg - sunDegrees);
        nakshatra = Math.floor(nakshatra_degree * 6 / 80);
        tithi = Math.floor(tithi_degree / 12);
        this._ayanamsa_label.set_text("अयनांश: "+lon2dms(ayanamsa));
        this.sunrise_nakshtra_label.set_text("नक्षत्र-" + naks[nakshatra] + " (" + parseInt(nakshatra_degree) + "°)");
        this.sunrise_tithi_label.set_text("तिथि-" + tith[tithi] + " (" + parseInt(tithi_degree) + "°)");
    },

    fT: function(d) {
        var m = "" + d.getMinutes() / 100 + "0000";
        var h = "" + d.getHours() / 100 + "0000";
        return h.substr(2, 2) + ":" + m.substr(2, 2);
    },

    fTs: function(d) { return this.fT(d) + ":" + ("" + d.getSeconds() / 100 + "0000").substr(2, 2); },

    DtJ: function(date_time) {
        var d = new Date();
        d.setTime(date_time);
        d.setMonth(0);
        d.setDate(1);
        var n = date_time / day - d.getTime() / day + 1
        return n;
    },
    // Convert radian angle to degrees
    RtD: function(angleRad) {
        return (180 * angleRad / Math.PI);
    },
    // Convert degree angle to radians
    DtR: function(angleDeg) {
        return (Math.PI * angleDeg / 180);
    },
    ///////////////////////////////////////////////////////////////////
    // Returns the gamma value that is used in the calculation for the equation of time
    // and the solar declination.
    calcGamma: function(julianDay) {
        return (2 * Math.PI / 365) * (julianDay - 1);
    },
    // Returns the gamma value used to calculate eq of time
    // and solar declination.
    calcGamma2: function(julianDay, hour) {
        return (2 * Math.PI / 365) * (julianDay - 1 + (hour / 24));
    },
    // Return the equation of time value for the given date.
    calcEqofTime: function(gamma) {
        return (229.18 * (0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma) - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma)));
    },
    // Return the solar declination angle (in radians) for the given date.
    calcSolarDec: function(gamma) {
        return (0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma) - 0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma));
    },
    ///////////////////////////////////////////////////////////////////
    // The hour angle returned below is only for sunrise/sunset, i.e. when the solar
    // zenith angle is 90.8 degrees.
    // the reason why its not 90 degrees is because we need to account for atmoshperic
    // refraction.
    calcHourAngle: function(lat, solarDec, time) {
        var latRad = this.DtR(lat);
        if (time) // ii true, then calculationg for sunrise
            return (Math.acos(Math.cos(this.DtR(90.833)) / (Math.cos(latRad) * Math.cos(solarDec)) - Math.tan(latRad) * Math.tan(solarDec)));
        else
            return -(Math.acos(Math.cos(this.DtR(90.833)) / (Math.cos(latRad) * Math.cos(solarDec)) - Math.tan(latRad) * Math.tan(solarDec)));
    },
    // Return the length of the day in minutes.
    calcDayLength: function(hourAngle) {
        return (2 * Math.abs(RtD(hourAngle))) / 15;
    },


    calcSunriseGMT: function(julDay, latitude, longitude) {
        // console.log("julDay:" + julDay + " lat:" + latitude + " lon:" + longitude);
        // *** First pass to approximate sunrise
        var gamma = this.calcGamma(julDay);
        var eqTime = this.calcEqofTime(gamma);
        var solarDec = this.calcSolarDec(gamma);
        var hourAngle = this.calcHourAngle(latitude, solarDec, 1);
        var delta = longitude - this.RtD(hourAngle);
        var timeDiff = 4 * delta;
        var timeGMT = 720 + timeDiff - eqTime;
        // *** Second pass includes fractional jday in gamma calc
        var gamma_sunrise = this.calcGamma2(julDay, timeGMT / 60);
        eqTime = this.calcEqofTime(gamma_sunrise);
        solarDec = this.calcSolarDec(gamma_sunrise);
        hourAngle = this.calcHourAngle(latitude, solarDec, 1);
        delta = longitude - this.RtD(hourAngle);
        timeDiff = 4 * delta;
        timeGMT = 720 + timeDiff - eqTime; // in minutes
        return timeGMT;
    },
    calcSunsetGMT: function(julDay, latitude, longitude) {
        // First calculates sunrise and approx length of day
        var gamma = this.calcGamma(julDay + 1);
        var eqTime = this.calcEqofTime(gamma);
        var solarDec = this.calcSolarDec(gamma);
        var hourAngle = this.calcHourAngle(latitude, solarDec, 0);
        var delta = longitude - this.RtD(hourAngle);
        var timeDiff = 4 * delta;
        var setTimeGMT = 720 + timeDiff - eqTime;
        // first pass used to include fractional day in gamma calc
        var gamma_sunset = this.calcGamma2(julDay, setTimeGMT / 60);
        eqTime = this.calcEqofTime(gamma_sunset);
        solarDec = this.calcSolarDec(gamma_sunset);
        hourAngle = this.calcHourAngle(latitude, solarDec, 0);
        delta = longitude - this.RtD(hourAngle);
        timeDiff = 4 * delta;
        setTimeGMT = 720 + timeDiff - eqTime; // in minutes
        return setTimeGMT;
    },

    _updateDate: function() {

        displayDate = new Date();
        tzone = displayDate.getTimezoneOffset() / 60 * (-1);
        julianDays = toJulian(displayDate);
        vaaram = wd[weekDay(julianDays)];
        ayanamsa = calcayan(julianDays);
        sunDegrees = sun(julianDays);
        moonDeg = moon(julianDays);
        var nakshatra_degree = fix360(moonDeg + ayanamsa);
        var tithi_degree = fix360(moonDeg - sunDegrees);
        nakshatra = Math.floor((nakshatra_degree) * 6 / 80);
        tithi = Math.floor((tithi_degree) / 12);
        nakshatraend = fromJulian(nakshatra_end(julianDays, nakshatra, ayanamsa));
        var nakshatra_time_remian = new Date(nakshatraend - displayDate);
        nakshatraendhms = " " + String(parseInt((nakshatraend - displayDate) / 3600000)).padStart(2, '0') + ":" + String(parseInt(((nakshatraend - displayDate) / 60000) % 60)).padStart(2, '0') + ":" + String(parseInt(((nakshatraend - displayDate) / 1000) % 60)).padStart(2, '0');
        tithiend = fromJulian(tithi_end(julianDays, tithi, 12));
        tithiendhms = " " + String(parseInt((tithiend - displayDate) / 3600000)).padStart(2, '0') + ":" + String(parseInt(((tithiend - displayDate) / 60000) % 60)).padStart(2, '0') + ":" + String(parseInt(((tithiend - displayDate) / 1000) % 60)).padStart(2, '0');
        //n_yoga = Math.floor((sunDegrees + moonDeg + 2 * ayanamsa - 528119.989395531) * 6 / 80);
        var yoga_deg = fix360(sunDegrees + moonDeg + 2 * ayanamsa - 528119.989395531);
        n_yoga = Math.floor(yoga_deg * 6 / 80);
        yogaend = fromJulian(yogaendcalc(julianDays, yoga_deg));
        var yogaendhms = " " + parseInt((yogaend - displayDate) / 3600000) + ":" + parseInt(((yogaend - displayDate) / 60000) % 60) + ":" + parseInt(((yogaend - displayDate) / 1000) % 60);
        var karan_deg = fix360(moonDeg - sunDegrees);
        // while (n_yoga < 0) n_yoga += 27;
        // while (n_yoga > 27) n_yoga -= 27;
        n_karan = n_karana(moonDeg, sunDegrees, julianDays);
        var karanend = fromJulian(tithi_end(julianDays, Math.floor(karan_deg / 6), 6));
        karanaendhms = " " + parseInt((karanend - displayDate) / 3600000) + ":" + parseInt(((karanend - displayDate) / 60000) % 60) + ":" + parseInt(((karanend - displayDate) / 1000) % 60);



        this._time.set_text(displayDate.toLocaleFormat("%H:%M:%S "));
        this._date.set_text(displayDate.toLocaleFormat("%e "));
        this._month.set_text(displayDate.toLocaleFormat("%B, %Y "));

        this._vaaram.set_text("वार-" + vaaram);
        this._nakshtra.set_text("नक्षत्र-" + naks[nakshatra] + " (" + parseInt(nakshatra_degree) + "°) " + nakshatraendhms);
        this._tithi.set_text("तिथि-" + tith[tithi] + " (" + parseInt(tithi_degree) + "°) " + tithiendhms);
        this._yoga.set_text("योग-" + yog[n_yoga] + " (" + parseInt(yoga_deg) + "°) " + yogaendhms);
        this._karan.set_text("करण-" + kar[n_karan] + " (" + parseInt(karan_deg) + "°) " + karanaendhms);
        this._sun_deg.set_text("सूर्य-" + parseInt(sunDegrees) + "° ( " + zn[Math.floor(sunDegrees * 12 / 360)] + " राशि ) ");
        this._moon_deg.set_text("चंद्र-" + parseInt(moonDeg) + "° ( " + zn[Math.floor(moonDeg * 12 / 360)] + " राशि ) ");
        this.timeout = Mainloop.timeout_add_seconds(1, Lang.bind(this, this._updateDate));

    }
}

function main(metadata, desklet_id) {
    let desklet = new MyDesklet(metadata, desklet_id);
    return desklet;
}
var panchang = {};
panchang.tithi = {};
panchang.tithi.end = 0;
panchang.nakshtra = {};
panchang.nakshtra.end = 0;

var e = 23.4397 * Math.PI / 180; // obliquity of the Earth
var dayMs = 1000 * 60 * 60 * 24,
    J1970 = 2440588,
    J2000 = 2451545;
var date = new Date();
var dayMs = 1000 * 60 * 60 * 24,
    J1970 = 2440588,
    jd0, jdn, dn1, wday, nk,
    J2000 = 2451545;

var wd = ["रविवार", "सोमवार", "मंगलवार", "बुधवार", "गुरुवार", "शुक्रवार", "शनिवार"];
var maasam = [" चैत्र", " वैशाख", " ज्येष्ठ", " आषाढ़", " श्रावण", " भाद्रपक्ष", " आश्विन", " कार्तिक", " मार्गशीष", " पौष", " माघ", " फाल्गुन"];
var naks = ["अश्विनी", "भरणी", "कृत्तिका", "रोहिणी", "मृगशिरा", "आर्द्रा", "पुनर्वसु", "पुष्य", "अश्लेषा", "मघा", "पूर्वाफाल्गुनी", "उत्तराफाल्गुनी", "हस्त", "चित्रा", "स्वाती", "विशाखा", "अनुराधा", "ज्येष्ठा", "मुल", "पुर्वाषाढा", "उत्तरषाढा", "श्रवण", "धनिष्ठा", "शतभिषा", "पूर्वभाद्रपद", "उत्तरभाद्रपद", "रेवती"];
var tith = ["शुक्ल प्रतिपदा", "शुक्ल द्वितीया", "शुक्ल तृतीया", "शुक्ल चतुर्थी", "शुक्ल पंचमी", "शुक्ल षष्ठी", "शुक्ल सप्तमी", "शुक्ल अष्टमी", "शुक्ल नवमी", "शुक्ल दशमी", "शुक्ल एकादशी", "शुक्ल द्वादशी", "शुक्ल त्रयोदशी", "शुक्ल चतुर्दशी", "शुक्ल पूर्णिमा", "कृष्ण प्रतिपदा", "कृष्ण द्वितीया", "कृष्ण तृतीया", "कृष्ण चतुर्थी", "कृष्ण पंचमी", "कृष्ण षष्ठी", "कृष्ण सप्तमी", "कृष्ण अष्टमी", "कृष्ण नवमी", "कृष्ण दशमी", "कृष्ण एकादशी", "कृष्ण द्वादशी", "कृष्ण त्रयोदशी", "कृष्ण चतुर्दशी", "कृष्ण अमावस्या"];
var kar = ["बव", "बालव", "कौलव", "तैतिल", "गर", "वणिज", "विष्टी", "शकुनी", "चतुष्पद", "नाग", "किंस्तुघ्न"];
var yog = ["विष्कुंभ", "प्रिति", "आयुष्मान", "सौभाग्य", "शोभन", "अतिगण्ड", "सुकर्मा", "धृति", "शूल", "गण्ड", "बृद्धि", "ध्रुव", "व्यघात", "हर्षण", "वज्र", "सिद्धि", "व्यतिपात", "वरियान", "परिध", "शिव", "सिद्ध", "साध्य", "शुभ", "शुक्ल", "ब्रह्म", "ऐन्द्र", "वैधृति"];
var zn = ["मेष", "वृष", "मिथुन", "कर्क", "सिंह", "कन्या", "तुला", "वृश्चिक", "धनू", "मकर", "कुम्भ", "मीन"];

var tipnaks = [2, 5, 6, 0, 1, 4, 3, 2, 4, 5, 5, 0, 2, 1, 3, 6, 1, 4, 4, 5, 0, 3, 3, 3, 5, 0, 1];
var Lmoon, Lsun, skor, LmoonYoga, LsunYoga, dt;
var ayanamsa = 0;

function toJulian(date) {
    return date.valueOf() / dayMs - 0.5 + J1970;
}

function fromJulian(j) {
    return new Date((j + 0.5 - J1970) * dayMs);
}

function rightAscension(l, b) {
    return Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l));
}

function declination(l, b) {
    return Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l));
}

function weekDay(jd) {
    // Julian date for the begin of the day
    jd0 = Math.floor(jd) + 0.5;
    if (jd < jd0) jd0 -= 1;

    // day
    jdn = jd0 + 1.5;
    dn1 = Math.floor(jdn / 7) * 7;


    wday = Math.floor(jdn - dn1);

    return wday;
}


function fix360(v) {
    while (v < 0.0) v += 360.0;
    while (v > 360.0) v -= 360.0;
    return v;
}

function kepler(m, ex, err) {
    var u0, delta;
    //kepler = {};
    m = m;
    ex = ex;
    err = err;
    //val u0, delta;
    m *= Math.PI / 180;
    u0 = m;
    err *= Math.PI / 180;
    delta = 1;
    while (Math.abs(delta) >= err) {
        delta = (m + ex * Math.sin(u0) - u0) / (1 - ex * Math.cos(u0));
        u0 += delta;
    }
    return u0;
}

function nutation(jd) {
    var t, t2, ls, l, ms, ml, d, om, d2, l2, ls2, nut;
    //nutation = {};
    jd = jd;
    t = (jd - 2415020) / 36525;
    t2 = t * t;

    // avg len sun
    ls = 279.6967 + 36000.7689 * t + 0.000303 * t2;
    // avg len moon
    l = 270.4341639 + 481267.8831417 * t - 0.0011333333 * t2;
    // avg anomaly sun
    ms = 358.4758333333334 + 35999.04974999958 * t - t2 * 1.500000059604645e-4;
    // avg anomaly moon
    ml = 296.1046083333757 + 477198.8491083336 * t + 0.0091916667090522 * t2;
    // the diff medium len of moon and sun (avg elongation moon)
    d = 350.7374861110581 + 445267.1142166667 * t - t2 * 1.436111132303874e-3;

    om = 259.1832750002543 - 1934.142008333206 * t + .0020777778 * t2;
    ls *= Math.PI / 180;
    l *= Math.PI / 180;
    ms *= Math.PI / 180;
    ml *= Math.PI / 180;
    d *= Math.PI / 180;
    om *= Math.PI / 180;
    d2 = d * d;
    l2 = l * l;
    ls2 = ls * ls;


    nut = (-17.2327 - 0.01737 * t) * Math.sin(om);
    nut += 0.2088 * Math.sin(2.0 * om);
    nut += 0.0675 * Math.sin(ml);
    nut -= 0.0149 * Math.sin(ml - d2);
    nut -= 0.0342 * Math.sin(l2 - om);
    nut += 0.0114 * Math.sin(l2 - ml);
    nut -= 0.2037 * Math.sin(l2);
    nut -= 0.0261 * Math.sin(l2 + ml);
    nut += 0.0124 * Math.sin(ls2 - om);
    nut += 0.0214 * Math.sin(ls2 - ms);
    nut -= 1.2729 * Math.sin(ls2);
    nut -= 0.0497 * Math.sin(ls2 + ms);
    nut += 0.1261 * Math.sin(ms);
    nut = nut / 3600.0;

    return nut;
}

function sun(jd) {
    var tdays, t, t2, t3, ls, pes, ms, g, oms, ex, l, ml, le, om, u, u1, u2, u3, u4, u5, u6, il, dl, dr, b, truanom;
    var r1, rs, ab, LsunYoga;
    //sun = {};
    jd = jd;
    // days frm 1900:
    tdays = jd - 2415020;

    t = tdays / 36525;
    t2 = t * t;
    t3 = t * t * t;

    // the avg len sun

    ls = 279.696678 + 0.9856473354 * tdays + 1.089 * t2 / 3600;
    // perigee sun
    pes = 101.220833 + 6189.03 * t / 3600 + 1.63 * t2 / 3600 + 0.012 * t3 / 3600;
    // avg anomoly sun

    ms = fix360(ls - pes + 180);
    g = ms + (0.266 * Math.sin((31.8 + 119.0 * t) * Math.PI / 180) + 6.40 * Math.sin((231.19 + 20.2 * t) * Math.PI / 180) + (1.882 - 0.016 * t) * Math.sin((57.24 + 150.27 * t) * Math.PI / 180)) / 3600.0;
    // Rising sun node len
    oms = 259.18 - 1934.142 * t;
    // eccentricity orbit sun
    ex = 0.01675104 - 0.0000418 * t - 0.000000126 * t2;
    // avg length moon
    l = 270.4337361 + 13.176396544528099 * tdays - 5.86 * t2 / 3600 + 0.0068 * t3 / 3600;
    // avg anomaly moon
    ml = 296.1046083333757 + 477198.8491083336 * t + 0.0091916667090522 * t2 + 0.0000143888893 * t3;
    // avg len earth
    le = 99.696678 + 0.9856473354 * tdays + 1.089 * t2 / 3600;

    om = 259.183275 - 6962911.23 * t / 3600 + 7.48 * t2 / 3600 + 0.008 * t3 / 3600;

    // eccentric anomoloy calculation iterative method
    u = kepler(g, ex, 0.0000003);


    // cal true anomaly sun
    b = Math.sqrt((1 + ex) / (1 - ex));
    if (Math.abs(Math.PI - u) < 1.0e-10) truanom = u;
    else truanom = 2.0 * Math.atan(b * Math.tan(u / 2));
    truanom = fix360(truanom * 180 / Math.PI);

    //corrections for cal of longitude and radius vector
    u1 = (153.23 + 22518.7541 * t) * Math.PI / 180;
    u2 = (216.57 + 45037.5082 * t) * Math.PI / 180;
    u3 = (312.69 + 32964.3577 * t) * Math.PI / 180;
    u4 = (350.74 + 445267.1142 * t - 0.00144 * t2) * Math.PI / 180;
    u6 = (353.4 + 65928.71550000001 * t) * Math.PI / 180;
    u5 = (315.6 + 893.3 * t) * Math.PI / 180;

    dl = 0.00134 * Math.cos(u1);
    dl += 0.00154 * Math.cos(u2);
    dl += 0.002 * Math.cos(u3);
    dl += 0.00179 * Math.sin(u4);
    dl += 0.202 * Math.sin(u5) / 3600;

    dr = 0.00000543 * Math.sin(u1);
    dr += 0.00001575 * Math.sin(u2);
    dr += 0.00001627 * Math.sin(u3);
    dr += 0.00003076 * Math.cos(u4);
    dr += 9.26999999e-06 * Math.sin(u6);

    // true len of sun (deg)
    il = ls + dl + truanom - ms;

    // corrections to abberations links
    r1 = 1.0000002 * (1 - ex * ex) / (1 + ex * Math.cos(truanom * Math.PI / 180));
    rs = r1 + dr; // radius vector
    ab = (20.496 * (1 - ex * ex) / rs) / 3600;
    ls = il + nutation(jd) - ab; // app len sun
    LsunYoga = ls;

    ls = fix360(ls);

    return ls;
}

function corr(mlcor, mscor, fcor, dcor, lcor) {
    this.mlcor = mlcor;
    this.mscor = mscor;
    this.fcor = fcor;
    this.dcor = dcor;
    this.lcor = lcor;
}

function corr2(l, ml, ms, f, d) {
    this.l = l;
    this.ml = ml;
    this.ms = ms;
    this.f = f;
    this.d = d;
}

var corrMoon = new Array(); // main
var i = 0;
// ml, ms, f, d, l
corrMoon[i++] = new corr(0, 0, 0, 4, 13.902);
corrMoon[i++] = new corr(0, 0, 0, 2, 2369.912);
corrMoon[i++] = new corr(1, 0, 0, 4, 1.979);
corrMoon[i++] = new corr(1, 0, 0, 2, 191.953);
corrMoon[i++] = new corr(1, 0, 0, 0, 22639.500);
corrMoon[i++] = new corr(1, 0, 0, -2, -4586.465);
corrMoon[i++] = new corr(1, 0, 0, -4, -38.428);
corrMoon[i++] = new corr(1, 0, 0, -6, -0.393);
corrMoon[i++] = new corr(0, 1, 0, 4, -0.289);
corrMoon[i++] = new corr(0, 1, 0, 2, -24.420);
corrMoon[i++] = new corr(0, 1, 0, 0, -668.146);
corrMoon[i++] = new corr(0, 1, 0, -2, -165.145);
corrMoon[i++] = new corr(0, 1, 0, -4, -1.877);
corrMoon[i++] = new corr(0, 0, 0, 3, 0.403);
corrMoon[i++] = new corr(0, 0, 0, 1, -125.154);
corrMoon[i++] = new corr(2, 0, 0, 4, 0.213);
corrMoon[i++] = new corr(2, 0, 0, 2, 14.387);
corrMoon[i++] = new corr(2, 0, 0, 0, 769.016);
corrMoon[i++] = new corr(2, 0, 0, -2, -211.656);
corrMoon[i++] = new corr(2, 0, 0, -4, -30.773);
corrMoon[i++] = new corr(2, 0, 0, -6, -0.570);
corrMoon[i++] = new corr(1, 1, 0, 2, -2.921);
corrMoon[i++] = new corr(1, 1, 0, 0, -109.673);
corrMoon[i++] = new corr(1, 1, 0, -2, -205.962);
corrMoon[i++] = new corr(1, 1, 0, -4, -4.391);
corrMoon[i++] = new corr(1, -1, 0, 4, 0.283);
corrMoon[i++] = new corr(1, -1, 0, 2, 14.577);
corrMoon[i++] = new corr(1, -1, 0, 0, 147.687);
corrMoon[i++] = new corr(1, -1, 0, -2, 28.475);
corrMoon[i++] = new corr(1, -1, 0, -4, 0.636);
corrMoon[i++] = new corr(0, 2, 0, 2, -0.189);
corrMoon[i++] = new corr(0, 2, 0, 0, -7.486);
corrMoon[i++] = new corr(0, 2, 0, -2, -8.096);
corrMoon[i++] = new corr(0, 0, 2, 2, -5.741);
corrMoon[i++] = new corr(0, 0, 2, 0, -411.608);
corrMoon[i++] = new corr(0, 0, 2, -2, -55.173);
corrMoon[i++] = new corr(0, 0, 2, -4, 0.025);
corrMoon[i++] = new corr(1, 0, 0, 1, -8.466);
corrMoon[i++] = new corr(1, 0, 0, -1, 18.609);
corrMoon[i++] = new corr(1, 0, 0, -3, 3.215);
corrMoon[i++] = new corr(0, 1, 0, 1, 18.023);
corrMoon[i++] = new corr(0, 1, 0, -1, 0.560);
corrMoon[i++] = new corr(3, 0, 0, 2, 1.060);
corrMoon[i++] = new corr(3, 0, 0, 0, 36.124);
corrMoon[i++] = new corr(3, 0, 0, -2, -13.193);
corrMoon[i++] = new corr(3, 0, 0, -4, -1.187);
corrMoon[i++] = new corr(3, 0, 0, -6, -0.293);
corrMoon[i++] = new corr(2, 1, 0, 2, -0.290);
corrMoon[i++] = new corr(2, 1, 0, 0, -7.649);
corrMoon[i++] = new corr(2, 1, 0, -2, -8.627);
corrMoon[i++] = new corr(2, 1, 0, -4, -2.740);
corrMoon[i++] = new corr(2, -1, 0, 2, 1.181);
corrMoon[i++] = new corr(2, -1, 0, 0, 9.703);
corrMoon[i++] = new corr(2, -1, 0, -2, -2.494);
corrMoon[i++] = new corr(2, -1, 0, -4, 0.360);
corrMoon[i++] = new corr(1, 2, 0, 0, -1.167);
corrMoon[i++] = new corr(1, 2, 0, -2, -7.412);
corrMoon[i++] = new corr(1, 2, 0, -4, -0.311);
corrMoon[i++] = new corr(1, -2, 0, 2, 0.757);
corrMoon[i++] = new corr(1, -2, 0, 0, 2.580);

corrMoon[i++] = new corr(1, -2, 0, -2, 2.533);
corrMoon[i++] = new corr(0, 3, 0, -2, -0.344);
corrMoon[i++] = new corr(1, 0, 2, 2, -0.992);
corrMoon[i++] = new corr(1, 0, 2, 0, -45.099);
corrMoon[i++] = new corr(1, 0, 2, -2, -0.179);
corrMoon[i++] = new corr(1, 0, -2, 2, -6.382);
corrMoon[i++] = new corr(1, 0, -2, 0, 39.528);
corrMoon[i++] = new corr(1, 0, -2, -2, 9.366);
corrMoon[i++] = new corr(0, 1, 2, 0, 0.415);
corrMoon[i++] = new corr(0, 1, 2, -2, -2.152);
corrMoon[i++] = new corr(0, 1, -2, 2, -1.440);
corrMoon[i++] = new corr(0, 1, -2, -2, 0.384);
corrMoon[i++] = new corr(2, 0, 0, 1, -0.586);
corrMoon[i++] = new corr(2, 0, 0, -1, 1.750);
corrMoon[i++] = new corr(2, 0, 0, -3, 1.225);
corrMoon[i++] = new corr(1, 1, 0, 1, 1.267);
corrMoon[i++] = new corr(1, -1, 0, -1, -1.089);
corrMoon[i++] = new corr(0, 0, 2, -1, 0.584);
corrMoon[i++] = new corr(4, 0, 0, 0, 1.938);
corrMoon[i++] = new corr(4, 0, 0, -2, -0.952);
corrMoon[i++] = new corr(3, 1, 0, 0, -0.551);
corrMoon[i++] = new corr(3, 1, 0, -2, -0.482);
corrMoon[i++] = new corr(3, -1, 0, 0, 0.681);
corrMoon[i++] = new corr(2, 0, 2, 0, -3.996);
corrMoon[i++] = new corr(2, 0, 2, -2, 0.557);
corrMoon[i++] = new corr(2, 0, -2, 2, -0.459);
corrMoon[i++] = new corr(2, 0, -2, 0, -1.298);
corrMoon[i++] = new corr(2, 0, -2, -2, 0.538);
corrMoon[i++] = new corr(1, 1, -2, -2, 0.426);
corrMoon[i++] = new corr(1, -1, 2, 0, -0.304);
corrMoon[i++] = new corr(1, -1, -2, 2, -0.372);
corrMoon[i++] = new corr(0, 0, 4, 0, 0.418);
corrMoon[i++] = new corr(2, -1, 0, -1, -0.352);


var corrMoon2 = new Array(); // additional
i = 0;
// l, ml, ms, f, d
corrMoon2[i++] = new corr2(0.127, 0, 0, 0, 6);
corrMoon2[i++] = new corr2(-0.151, 0, 2, 0, -4);
corrMoon2[i++] = new corr2(-0.085, 0, 0, 2, 4);
corrMoon2[i++] = new corr2(0.150, 0, 1, 0, 3);
corrMoon2[i++] = new corr2(-0.091, 2, 1, 0, -6);
corrMoon2[i++] = new corr2(-0.103, 0, 3, 0, 0);
corrMoon2[i++] = new corr2(-0.301, 1, 0, 2, -4);
corrMoon2[i++] = new corr2(0.202, 1, 0, -2, -4);
corrMoon2[i++] = new corr2(0.137, 1, 1, 0, -1);
corrMoon2[i++] = new corr2(0.233, 1, 1, 0, -3);
corrMoon2[i++] = new corr2(-0.122, 1, -1, 0, 1);
corrMoon2[i++] = new corr2(-0.276, 1, -1, 0, -3);
corrMoon2[i++] = new corr2(0.255, 0, 0, 2, 1);
corrMoon2[i++] = new corr2(0.254, 0, 0, 2, -3);
corrMoon2[i++] = new corr2(-0.100, 3, 1, 0, -4);
corrMoon2[i++] = new corr2(-0.183, 3, -1, 0, -2);
corrMoon2[i++] = new corr2(-0.297, 2, 2, 0, -2);
corrMoon2[i++] = new corr2(-0.161, 2, 2, 0, -4);
corrMoon2[i++] = new corr2(0.197, 2, -2, 0, 0);
corrMoon2[i++] = new corr2(0.254, 2, -2, 0, -2);
corrMoon2[i++] = new corr2(-0.250, 1, 3, 0, -2);
corrMoon2[i++] = new corr2(-0.123, 2, 0, 2, 2);
corrMoon2[i++] = new corr2(0.173, 2, 0, -2, -4);
corrMoon2[i++] = new corr2(0.263, 1, 1, 2, 0);
corrMoon2[i++] = new corr2(0.130, 3, 0, 0, -1);
corrMoon2[i++] = new corr2(0.113, 5, 0, 0, 0);
corrMoon2[i++] = new corr2(0.092, 3, 0, 2, -2);


//-----------------------------------------------------------------------------------
// Calculating geotsent p avoid longitude Moon and angular sector p News.
// (2 sec accuracy. longitude)
//-----------------------------------------------------------------------------------
function moon(jd) {
    var tdays, t, t2, t3, ob, l, d, pe, ms, ml, om, f, d;
    // days from 1900
    tdays = jd - 2415020;
    t = tdays / 36525;
    t2 = t * t;
    t3 = t * t * t;

    // slope travels to the equator
    ob = 23.452294 - 0.0130125 * t - 0.00000164 * t2 + 0.000000503 * t3;
    // the average length moon
    l = 270.4337361 + 13.176396544528099 * tdays - 5.86 * t2 / 3600 + 0.0068 * t3 / 3600;
    // the difference medium length Moon and the Sun (the averageElongation Moon):
    d = 350.7374861110581 + 445267.1142166667 * t - t2 * 1.436111132303874e-3 + 0.0000018888889 * t3;
    // Perigee moon
    pe = 334.329556 + 14648522.52 * t / 3600 - 37.17 * t2 / 3600 - 0.045 * t3 / 3600;
    // the average anomoly sun
    ms = 358.4758333333334 + 35999.04974999958 * t - t2 * 1.500000059604645e-4 - t3 * 3.3333333623078e-6;
    // The average anomoloy moon
    //ml = 296.1046083333757 + 477198.8491083336*t + 0.0091916667090522*t2 + 0.0000143888893*t3;
    ml = fix360(l - pe);
    // Rising length node orbit the moon:
    om = 259.183275 - 6962911.23 * t / 3600 + 7.48 * t2 / 3600 + 0.008 * t3 / 3600;
    // the average length Moon, measured from the bottom up hub orbit:

    f = fix360(l - om);

    var r2rad, tb, t2c, a1, a2, a3, a4, a5, a6, a7, a8, a9, c2, c4, dlm, dpm, dkm, dls, dgc;
    // periodic revisions
    r2rad = 360.0 * Math.PI / 180;
    tb = tdays * 1e-12; // *10^12
    t2c = tdays * tdays * 1e-16; // *10^16
    a1 = Math.sin(r2rad * (0.53733431 - 10104982 * tb + 191 * t2c));
    a2 = Math.sin(r2rad * (0.71995354 - 147094228 * tb + 43 * t2c));
    c2 = Math.cos(r2rad * (0.71995354 - 147094228 * tb + 43 * t2c));
    a3 = Math.sin(r2rad * (0.14222222 + 1536238 * tb));
    a4 = Math.sin(r2rad * (0.48398132 - 147269147 * tb + 43 * t2c));
    c4 = Math.cos(r2rad * (0.48398132 - 147269147 * tb + 43 * t2c));
    a5 = Math.sin(r2rad * (0.52453688 - 147162675 * tb + 43 * t2c));
    a6 = Math.sin(r2rad * (0.84536324 - 11459387 * tb));
    a7 = Math.sin(r2rad * (0.23363774 + 1232723 * tb + 191 * t2c));
    a8 = Math.sin(r2rad * (0.58750000 + 9050118 * tb));
    a9 = Math.sin(r2rad * (0.61043085 - 67718733 * tb));

    dlm = 0.84 * a3 + 0.31 * a7 + 14.27 * a1 + 7.261 * a2 + 0.282 * a4 + 0.237 * a6;
    dpm = -2.1 * a3 - 2.076 * a2 - 0.840 * a4 - 0.593 * a6;
    dkm = 0.63 * a3 + 95.96 * a2 + 15.58 * a4 + 1.86 * a5;
    dls = -6.4 * a3 - 0.27 * a8 - 1.89 * a6 + 0.20 * a9;
    dgc = (-4.318 * c2 - 0.698 * c4) / 3600.0 / 360.0;
    dgc = (1.000002708 + 139.978 * dgc);

    ml = (ml + (dlm - dpm) / 3600.0) * Math.PI / 180; //Average anomoly moon
    ms = (ms + dls / 3600.0) * Math.PI / 180; //Average anomoly sun
    f = (f + (dlm - dkm) / 3600.0) * Math.PI / 180;
    d = (d + (dlm - dls) / 3600.0) * Math.PI / 180; //avg elongation moon
    var lk, lk1, sk, sinp, nip, g1c, i1corr, i2corr, arg, sinarg, dlid, vl, nib;
    lk = 0;
    lk1 = 0;
    sk = 0;
    sinp = 0;
    nib = 0;
    g1c = 0;
    i1corr = 1.0 - 6.8320e-8 * tdays;
    i2corr = dgc * dgc;

    for (i = 0; i < 93; i++) { // outrage at length
        arg = corrMoon[i].mlcor * ml + corrMoon[i].mscor * ms + corrMoon[i].fcor * f + corrMoon[i].dcor * d;
        sinarg = Math.sin(arg);
        if (corrMoon[i].mscor != 0) {
            sinarg *= i1corr;
            if (corrMoon[i].mscor == 2 || corrMoon[i].mscor == -2) sinarg *= i1corr;
        }
        if (corrMoon[i].fcor != 0) sinarg *= i2corr;
        lk += corrMoon[i].lcor * sinarg;
    }
    for (i = 0; i < 27; i++) { // outrage at length additional
        arg = corrMoon2[i].ml * ml + corrMoon2[i].ms * ms + corrMoon2[i].f * f + corrMoon2[i].d * d;
        sinarg = Math.sin(arg);
        lk1 += corrMoon2[i].l * sinarg;
    }

    // resentments of the planets
    dlid = 0.822 * Math.sin(r2rad * (0.32480 - 0.0017125594 * tdays));
    dlid += 0.307 * Math.sin(r2rad * (0.14905 - 0.0034251187 * tdays));
    dlid += 0.348 * Math.sin(r2rad * (0.68266 - 0.0006873156 * tdays));
    dlid += 0.662 * Math.sin(r2rad * (0.65162 + 0.0365724168 * tdays));
    dlid += 0.643 * Math.sin(r2rad * (0.88098 - 0.0025069941 * tdays));
    dlid += 1.137 * Math.sin(r2rad * (0.85823 + 0.0364487270 * tdays));
    dlid += 0.436 * Math.sin(r2rad * (0.71892 + 0.0362179180 * tdays));
    dlid += 0.327 * Math.sin(r2rad * (0.97639 + 0.0001734910 * tdays));

    l = l + nutation(jd) + (dlm + lk + lk1 + dlid) / 3600.0;
    LmoonYoga = l;
    //alert("Lmoon="+l);
    l = fix360(l);

    // angular velocity of the moon on ecliptic (deg/day):
    vl = 13.176397;
    vl = vl + 1.434006 * Math.cos(ml);
    vl = vl + .280135 * Math.cos(2 * d);
    vl = vl + .251632 * Math.cos(2 * d - ml);
    vl = vl + .09742 * Math.cos(2 * ml);
    vl = vl - .052799 * Math.cos(2 * f);
    vl = vl + .034848 * Math.cos(2 * d + ml);
    vl = vl + .018732 * Math.cos(2 * d - ms);
    vl = vl + .010316 * Math.cos(2 * d - ms - ml);
    vl = vl + .008649 * Math.cos(ms - ml);
    vl = vl - .008642 * Math.cos(2 * f + ml);
    vl = vl - .007471 * Math.cos(ms + ml);
    vl = vl - .007387 * Math.cos(d);
    vl = vl + .006864 * Math.cos(3 * ml);
    vl = vl + .00665 * Math.cos(4 * d - ml);
    vl = vl + .003523 * Math.cos(2 * d + 2 * ml);
    vl = vl + .003377 * Math.cos(4 * d - 2 * ml);
    vl = vl + .003287 * Math.cos(4 * d);
    vl = vl - .003193 * Math.cos(ms);
    vl = vl - .003003 * Math.cos(2 * d + ms);
    vl = vl + .002577 * Math.cos(ml - ms + 2 * d);
    vl = vl - .002567 * Math.cos(2 * f - ml);
    vl = vl - .001794 * Math.cos(2 * d - 2 * ml);
    vl = vl - .001716 * Math.cos(ml - 2 * f - 2 * d);
    vl = vl - .001698 * Math.cos(2 * d + ms - ml);
    vl = vl - .001415 * Math.cos(2 * d + 2 * f);
    vl = vl + .001183 * Math.cos(2 * ml - ms);
    vl = vl + .00115 * Math.cos(d + ms);
    vl = vl - .001035 * Math.cos(d + ml);
    vl = vl - .001019 * Math.cos(2 * f + 2 * ml);
    vl = vl - .001006 * Math.cos(ms + 2 * ml);

    skor = vl;
    //l += ay;
    //imoon.f(l < 0.0)l += 360.0;
    return l;
}

function calcayan(jd) {
    var t, om, ls, aya;
    t = (jd - 2415020) / 36525;
    // avg node len moon
    om = 259.183275 - 1934.142008333206 * t + 0.0020777778 * t * t + 0.0000022222222 * t * t * t;
    // avg len sun
    ls = 279.696678 + 36000.76892 * t + 0.0003025 * t * t;
    aya = 17.23 * Math.sin(om * Math.PI / 180) + 1.27 * Math.sin(Math.PI / 180 * ls * 2) - (5025.64 + 1.11 * t) * t;
    aya = (aya - 80861.27) / 3600.0; // 84038.27 = Fagan-Bradley, 80861.27 = Lahiri

    return aya;
}

function lon2dms(x) {

    var d, m, s, ss0, str;
    x = Math.abs(x);
    d = Math.floor(x);
    ss0 = Math.round((x - d) * 3600);
    m = Math.floor(ss0 / 60);
    s = (ss0 % 60) % 60;
    str = d + "º " + m + "'" + s + "\"";

    return str;
}

function nakshatra_end(jd, n_naksh, ayanamsa) {
    if (panchang.nakshtra.end > jd) {
        return panchang.nakshtra.end;
    } else {
        var flag,
            jdt, n1, Lmoon0, asp1;
        jdt = jd;
        flag = 0;
        n1 = fix360((n_naksh + 1) * 80 / 6);
        while (flag < 1) {
            Lmoon0 = fix360(moon(jdt) + ayanamsa);
            asp1 = n1 - Lmoon0; // distance frm moon before nakshatra(degree)
            if (asp1 > 180) asp1 -= 360;
            if (asp1 < -180) asp1 += 360;
            flag = 1;
            if (Math.abs(asp1) > 0.001) {
                jdt += (asp1 / skor);
                flag = 0;
            }
        }
        panchang.nakshtra.end = jdt;
    }
    return panchang.nakshtra.end;
}

function tithi_end(jd, n1, len) {
    var flag = 0,
        jdt, knv, itit, aspect, Lsun0, Lmoon0, a, asp1;
    jdt = jd;
    knv = Math.floor(((jd - 2415020) / 365.25) * 12.3685);
    itit = n1 + 1;
    aspect = len * itit; // sun n moon in the early tithi
    /*if (aspect == 0) {
        jdt = novolun(jd, knv);
        flag = 1;
    }
    if (aspect == 360) {
        jdt = novolun(jd, (knv + 1));
        flag = 1;
    }*/
    while (flag < 1) {
        Lsun0 = sun(jdt);
        Lmoon0 = moon(jdt);
        a = fix360(Lsun0 + aspect); // pt should be where luna
        asp1 = a - Lmoon0; // assymptots of the moon to ur point
        if (asp1 > 180) asp1 -= 360;
        if (asp1 < -180) asp1 += 360;
        flag = 1;

        if (Math.abs(asp1) > 0.001) {
            jdt += (asp1 / (skor - 1));
            flag = 0;
        }
    }
    panchang.tithi.end = jdt;


    return panchang.tithi.end;
}

function n_karana(Lmoon, Lsun, jd) {
    nk = (Lmoon - Lsun) / 6;
    if (nk < 0) nk += 60;

    if (nk == 0) n_kar = 10;
    if (nk >= 57) n_kar = nk - 50;
    if (nk > 0 && nk < 57) n_kar = (nk - 1) - (Math.floor((nk - 1) / 7)) * 7;
    return Math.floor(n_kar);
}



//----------------------------------------------------------------------------
// cal begin and end of yoga
//----------------------------------------------------------------------------
function yogaendcalc(jd, zyoga) {
    var s_t_end;
    var flag;
    jdt = jd;
    z = zyoga;
    var nn_yoga = (Math.floor(z * 6 / 80) + 1) * 80 / 6;
    flag = 0;
    while (flag < 1) {
        z = fix360(sun(jdt) + moon(jdt) + 2 * ayanamsa - 528119.989395531);
        asp1 = nn_yoga - z;
        flag = 1;
        if (Math.abs(asp1) > 0.001) {
            jdt += (asp1 / (skor + 1.0145616633));
            flag = 0;
        }
    }

    // var nn_yoga = new Array(2);
    // nn_yoga[0] = Math.floor(z * 6 / 80) * 80 / 6;
    // nn_yoga[1] = (Math.floor(z * 6 / 80) + 1) * 80 / 6;
    // for (iyog = 1; iyog < 2; ++iyog) {
    //     flag = 0;
    //     while (flag < 1) {
    //         Lsun0 = sun(jdt);
    //         Lmoon0 = moon(jdt);
    //         dmoonYoga = (LmoonYoga + ayanamsa - 491143.07698973856);
    //         dsunYoga = (LsunYoga + ayanamsa - 36976.91240579201);
    //         //alert(LmoonYoga+"\r"+LsunYoga+"\r"+ayanamsa);
    //         z = dmoonYoga + dsunYoga;
    //         asp1 = nn_yoga[iyog] - z;
    //         flag = 1;
    //         if (Math.abs(asp1) > 0.001) {
    //             jdt += (asp1 / (skor + 1.0145616633));
    //             flag = 0;
    //         }
    //         //if (Math.abs(asp1) > 0.001) {jdt += (asp1 / skor) + (58.13 * Math.sin(asp1*d2r)); flag = 0;}
    //     }
    //     // if (iyog == 0) s_t.start = calData(jdt + (tzone - dt) / 24);
    //     // if (iyog == 1) 
    //         // s_t_end = calData(jdt;
    // }
    return jdt;
}

//------------------------------------------------------------------------------------------
// cal date on calendar date
//------------------------------------------------------------------------------------------
function calData(jd) {

    z1 = jd + 0.5;
    z2 = Math.floor(z1);
    f = z1 - z2;

    if (z2 < 2299161) a = z2;
    else {
        alf = Math.floor((z2 - 1867216.25) / 36524.25);
        a = z2 + 1 + alf - Math.floor(alf / 4);
    }

    b = a + 1524;
    c = Math.floor((b - 122.1) / 365.25);
    d = Math.floor(365.25 * c);
    e = Math.floor((b - d) / 30.6001);

    days = b - d - Math.floor(30.6001 * e) + f;
    kday = Math.floor(days);

    if (e < 13.5) kmon = e - 1;
    else kmon = e - 13;

    if (kmon > 2.5) kyear = c - 4716;
    if (kmon < 2.5) kyear = c - 4715;

    hh1 = (days - kday) * 24;
    khr = Math.floor(hh1);
    kmin = hh1 - khr;
    ksek = kmin * 60;
    kmin = Math.floor(ksek);
    ksek = Math.floor((ksek - kmin) * 60);
    s = new Date(kyear, kmon - 1, kday, khr, kmin, ksek, 0);

    return s;
}