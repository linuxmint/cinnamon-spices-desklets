/* Bikram Sambat
 * Version: 28 February 2018
 *
 * Copyright 2018 Deep Pradhan (https://deeppradhan.heliohost.org/)
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <http://www.gnu.org/licenses/>.
 */

/* BikramSambat Constructor*/
function BikramSambat() {
	let year, month, date;
	if (arguments.length === 3) {
		if (typeof(arguments[0]) !== "number" || typeof(arguments[1]) !== "number"
				|| typeof(this.monthLength[arguments[0]]) === "undefined"
				|| typeof(arguments[2]) != "number" || typeof(this.monthLength[arguments[0]]) !== "object"
				|| arguments[1] < 0 || arguments[1] > 11
				|| arguments[2] < 1 || arguments[2] > this.monthLength[arguments[0]][arguments[1]]
				|| typeof(this.monthLength[arguments[0]]) === "undefined"
				|| arguments[0] < this.epoch.bikramSambat.year
				|| (arguments[0] === this.epoch.bikramSambat.year && arguments[1] < this.epoch.bikramSambat.month)
				|| (arguments[0] === this.epoch.bikramSambat.year && arguments[1] === this.epoch.bikramSambat.month && arguments[2] < this.epoch.bikramSambat.date))
			throw "Error: Invalid Bikrar Sambat date value(s)";
		// Instantiate a BikramSambat date with given BS year, month, date
		// Bikram Sambat Year
		year = arguments[0];
		// Bikram Sambat Month (0 is first month Baishak)
		month = arguments[1];
		// Bikram Sambat Date (1 is first day of the month)
		date = arguments[2];
	} else if (arguments.length === 1 || arguments.length === 0) {
		// Instantiate a BikramSambat date with given Date (i.e. AD) / current Date
		let gregorian = arguments.length === 1 ? new Date(arguments[0]) : new Date();
		if (gregorian instanceof Date && !isNaN(gregorian.valueOf())) {
			if (gregorian.getFullYear() < this.epoch.gregorian.year)
				throw "Error: BikramSambat year not defined for given Date";
			let countGeorgian = this.daysBetween(new Date(this.epoch.gregorian.year,
					this.epoch.gregorian.month, this.epoch.gregorian.date, gregorian.getHours(),
					gregorian.getMinutes(), gregorian.getSeconds()), gregorian);
			year = this.epoch.bikramSambat.year;
			month = this.epoch.bikramSambat.month;
			date = this.epoch.bikramSambat.date;
			while (countGeorgian > 0) {
				if (typeof(this.monthLength[year]) === "undefined"
						|| typeof(this.yearLength[year]) === "undefined")
					throw "Error: BikramSambat year not defined";
				if (month === 0 && date === 1 && countGeorgian > this.yearLength[year]) {
					// Use length of year
					countGeorgian -= this.yearLength[year];
					year++;
				} else if (countGeorgian > this.monthLength[year][month] && date === 1) {
					// Use length of month
					countGeorgian -= this.monthLength[year][month];
					month++;
				} else {
					// Iterate over days
					countGeorgian--;
					date++;
				}
				if (date > this.monthLength[year][month]) {
					date = 1;
					month++;
				}
				if (month > 11) {
					date = 1;
					month = 0;
					year++;
				}
			}
		} else
			throw "Error: Invalid Date for Bikram Sambat";
	}
	this.language = "ne";
	this.monthType = "word";
	this.monthTextShort = true;
	this.weekdayShort = false;
	this.getYear = function() {
		return year;
	};
	this.getMonth = function() {
		return month;
	};
	this.getDate = function() {
		return date;
	};
	this.getYearText = function() {
		this.checkParams();
		return this.language === "ne" ? this.digitsEnToNe(year) : String(year);
	};
	this.getMonthText = function() {
		this.checkParams();
		return this.monthType === "word" ? (this.monthTextShort ?
				this.monthNameShort[this.language][month] : this.monthName[this.language][month]) :
			(this.language === "ne" ? this.digitsEnToNe(month) : String(month));
	};
	this.getDateText = function() {
		this.checkParams();
		return this.language.toLowerCase() === "en" ?
				String(date) : this.digitsEnToNe(date);
	};
}
//Set prototype
BikramSambat.prototype = {
		// Check parameters and set to default if invalid
		checkParams: function() {
			if (typeof(this.language) === "undefined" || this.language.match(/^(en|ne)$/i) === null)
				this.language = "ne";
			if (typeof(this.monthType) === "undefined" || this.monthType.match(/^(number|word)$/i) === null)
				this.monthType = "word";
			if (typeof(this.monthTextShort) !== "boolean")
				this.monthTextShort = false;
			if (typeof(this.weekdayShort) !== "boolean")
				this.weekdayShort = false;
			this.language = this.language.toLowerCase();
			this.monthType = this.monthType.toLowerCase();
		},

		// Calculate Date after adding given days to a Date
		daysAdded: function(date, days) {
			if (date instanceof Date && !isNaN(date.valueOf()) && typeof(days) === "number") {
				let newDate = new Date(date.valueOf());
				newDate.setDate(newDate.getDate() + days);
				return newDate;
			}
		},
	
		// Calculate the number of days between two Dates
		daysBetween: function(date1, date2) {
			if (date1 instanceof Date && !isNaN(date1.valueOf()) &&
					date2 instanceof Date && !isNaN(date2.valueOf()))
				return Math.floor(Math.abs(date1.getTime() - date2.getTime()) / (24 * 60 * 60 * 1000));
		},
	
		// Replace English digits with Nepalese digits in a String
		digitsEnToNe: function(string) {
			if (typeof(string) === "number")
				string = String(string);
			for (let i = 0; i < 10; i++)
				string = string.replace(new RegExp(String(i), "g"), this.digitsNe[i]);
			return string;
		},
	
		// Return a Gregorian Date of the BikramSambat
		toDate: function() {
			let year = this.epoch.bikramSambat.year,
					month = this.epoch.bikramSambat.month,
					date = this.epoch.bikramSambat.date,
					countGeorgian = 0;
			while (year < this.getYear() || (year === this.getYear() && month < this.getMonth())
					|| (year === this.getYear() && month === this.getMonth() && date != this.getDate())) {
				if (year < this.getYear() && month === 0 && date === 1) {
					// Use length of year
					countGeorgian += this.yearLength[year];
					year++;
				} else if (month < this.getMonth() && date === 1) {
					// Use length of month
					countGeorgian += this.monthLength[year][month];
					month++;
				} else {
					// Iterate over days
					countGeorgian++;
					date++;
				}
				if (date > this.monthLength[year][month]) {
					date = 1;
					month++;
				}
				if (month > 11) {
					date = 1;
					month = 0;
					year++;
				}
			}
			return this.daysAdded(new Date(this.epoch.gregorian.year, this.epoch.gregorian.month,
					this.epoch.gregorian.date), countGeorgian);
		},
	
		// Return String representation of a BikramSambat date
		toString: function() {
			if (typeof(this.getYearText()) === "undefined" || typeof(this.getMonthText()) === "undefined"
					|| typeof(this.getDateText()) === "undefined")
				return;
			this.checkParams();
			let separator = this.monthType === "word" ? " " : "/";
			return this.getDateText() + separator + this.getMonthText() + separator + this.getYearText();
		},

		// Method to get weekday name
		getDayName: function(weekdayNo) {
			if (typeof(weekdayNo) !== "number")
				return;
			this.checkParams();
			return this.weekdayShort ? this.weekdayNameShort[this.language][weekdayNo] :
					this.weekdayName[this.language][weekdayNo];
		},
	
		// Digits in Nepalese
		digitsNe: ["०", "१", "२", "३", "४", "५", "६", "७", "८", "९"],
	
		// Epoch values
		epoch: {
			bikramSambat: {year: 2000, month: 8, date: 17},
			gregorian: {year: 1944, month: 0, date: 1}},

		// Name of months
		monthName: {
			en: ["Baishak", "Jestha", "Ashad", "Shrawn", "Bhadra", "Ashwin",
					"Kartik", "Mangshir", "Poush", "Magh", "Falgun", "Chaitra"],
			ne: ["बैशाख", "जेष्ठ", "आषाढ़", "श्रावण", "भाद्र", "आश्विन",
					"कार्तिक", "मंसिर", "पौष", "माघ", "फाल्गुन", "चैत्र"]},
	
		// Short name of months
		monthNameShort: {
			en: ["Bai", "Jes", "Ash", "Shr", "Bha", "Ash", "Kar", "Man", "Pau", "Mag", "Fal", "Cha"],
			ne: ["बैश", "जेष्ठ", "आषा", "श्राव", "भाद्र", "आश्", "कार्ति", "मंसि", "पौष", "माघ", "फाल्", "चैत्र"]},
	
		// Length of month according to year
		monthLength: {
			2000: [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31], 2001: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], 2002: [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30], 2003: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], 2004: [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31], 2005: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], 2006: [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30], 2007: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], 2008: [31, 31, 31, 32, 31, 31, 29, 30, 30, 29, 29, 31], 2009: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
			2010: [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30], 2011: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], 2012: [31, 31, 31, 32, 31, 31, 29, 30, 30, 29, 30, 30], 2013: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], 2014: [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30], 2015: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], 2016: [31, 31, 31, 32, 31, 31, 29, 30, 30, 29, 30, 30], 2017: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], 2018: [31, 32, 31, 32, 31, 30, 30, 29, 30, 29, 30, 30], 2019: [31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31],
			2020: [31, 31, 31, 32, 31, 31, 30, 29, 30, 29, 30, 30], 2021: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], 2022: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30], 2023: [31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31], 2024: [31, 31, 31, 32, 31, 31, 30, 29, 30, 29, 30, 30], 2025: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], 2026: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], 2027: [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31], 2028: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], 2029: [31, 31, 32, 31, 32, 30, 30, 29, 30, 29, 30, 30],
			2030: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], 2031: [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31], 2032: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], 2033: [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30], 2034: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], 2035: [30, 32, 31, 32, 31, 31, 29, 30, 30, 29, 29, 31], 2036: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], 2037: [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30], 2038: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], 2039: [31, 31, 31, 32, 31, 31, 29, 30, 30, 29, 30, 30],
			2040: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], 2041: [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30], 2042: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], 2043: [31, 31, 31, 32, 31, 31, 29, 30, 30, 29, 30, 30], 2044: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], 2045: [31, 32, 31, 32, 31, 30, 30, 29, 30, 29, 30, 30], 2046: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], 2047: [31, 31, 31, 32, 31, 31, 30, 29, 30, 29, 30, 30], 2048: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], 2049: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30],
			2050: [31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31], 2051: [31, 31, 31, 32, 31, 31, 30, 29, 30, 29, 30, 30], 2052: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], 2053: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30], 2054: [31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31], 2055: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], 2056: [31, 31, 32, 31, 32, 30, 30, 29, 30, 29, 30, 30], 2057: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], 2058: [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31], 2059: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
			2060: [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30], 2061: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], 2062: [30, 32, 31, 32, 31, 31, 29, 30, 29, 30, 29, 31], 2063: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], 2064: [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30], 2065: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], 2066: [31, 31, 31, 32, 31, 31, 29, 30, 30, 29, 29, 31], 2067: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], 2068: [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30], 2069: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
			2070: [31, 31, 31, 32, 31, 31, 29, 30, 30, 29, 30, 30], 2071: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], 2072: [31, 32, 31, 32, 31, 30, 30, 29, 30, 29, 30, 30], 2073: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], 2074: [31, 31, 31, 32, 31, 31, 30, 29, 30, 29, 30, 30], 2075: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], 2076: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30], 2077: [31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31], 2078: [31, 31, 31, 32, 31, 31, 30, 29, 30, 29, 30, 30], 2079: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
			2080: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30], 2081: [31, 31, 32, 32, 31, 30, 30, 30, 29, 30, 30, 30], 2082: [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 30, 30], 2083: [31, 31, 32, 31, 31, 30, 30, 30, 29, 30, 30, 30], 2084: [31, 31, 32, 31, 31, 30, 30, 30, 29, 30, 30, 30], 2085: [31, 32, 31, 32, 30, 31, 30, 30, 29, 30, 30, 30], 2086: [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 30, 30], 2087: [31, 31, 32, 31, 31, 31, 30, 30, 29, 30, 30, 30], 2088: [30, 31, 32, 32, 30, 31, 30, 30, 29, 30, 30, 30], 2089: [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 30, 30],
			2090: [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 30, 30], 2091: [31, 31, 32, 31, 31, 31, 30, 30, 29, 30, 30, 30], 2092: [30, 31, 32, 32, 31, 30, 30, 30, 29, 30, 30, 30], 2093: [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 30, 30], 2094: [31, 31, 32, 31, 31, 30, 30, 30, 29, 30, 30, 30], 2095: [31, 31, 32, 31, 31, 31, 30, 29, 30, 30, 30, 30], 2096: [30, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30], 2097: [31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 30, 30], 2098: [31, 31, 32, 31, 31, 31, 29, 30, 29, 30, 29, 31], 2099: [31, 31, 32, 31, 31, 31, 30, 29, 29, 30, 30, 30],
			2100: [31, 32, 31, 32, 30, 32, 30, 29, 30, 29, 30, 30]
		},

		// Name of weekdays
		weekdayName: {
			en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
			ne: ["आइतवार", "सोमवार", "मंगलवार", "बुधवार", "बिहिवार", "शुक्रवार", "शनिवार"]},

		// Short name of weekdays
		weekdayNameShort: {
			en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
			ne: ["आइत", "सोम", "मंगल", "बुध", "बिहि", "शुक्र", "शनि"]},

		// Single character of weekdays
		weekdayNameCharacter: {
			en: ["S", "M", "T", "W", "T", "F", "S"],
			ne: ["आ", "सो", "मं", "बु", "बि", "शु", "श"]
		},

		// Length of years - Set on first run
		yearLength : {}
};
// One time checks and initialisations
for (let i = BikramSambat.prototype.epoch.bikramSambat.year, total;
		typeof(BikramSambat.prototype.monthLength[i]) !== "undefined"; i++) {
	// Validate
	if (typeof(BikramSambat.prototype.monthLength[i + 1]) === "undefined"
			&& typeof (BikramSambat.prototype.monthLength[i + 2]) !== "undefined")
		throw "Error: Incomplete month values for years";
	total = 0;
	for (let j = 0; j < 12; j++) {
		if (typeof(BikramSambat.prototype.monthLength[i][j]) === "number")
			total += BikramSambat.prototype.monthLength[i][j];
		else
			throw "Error: Incomplete month values";
	}
	BikramSambat.prototype.yearLength[i] = total;
	BikramSambat.prototype.maxYearBS = i;
}
//////// End of BikramSambat ////////

const MONTH_NAMES = {
		en: ["January", "February", "March", "April", "May", "June",
			"July", "August", "September", "October", "November", "December"],
		ne: ["जनवरी", "फ़रवरी", "मार्च", "अप्रैल", "मई", "जून",
			"जुलाई", "अगस्त", "सितंबर", "अक्तूबर", "नवंबर", "दिसंबर"]};

/* Method to convert a given Date to given offset from GMT in hours*/
function dateWithOffset(date, offset) {
	return new Date((date.getTime() + (date.getTimezoneOffset() * 60000)) + offset * 3600000);
}

// Method of zero pad single digit numbers
function zeroPad(number) {
	number = Number(number);
	if (typeof(number) !== "number")
		return;
	return (number >= 0 && number <= 9 ? "0" : "") + number;
}
