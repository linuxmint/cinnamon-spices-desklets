// Names of the Month
var MONTH_NAMES = [_("January"), _("February"), _("March"), _("April"), _("May"), _("June"),
		_("July"), _("August"), _("September"), _("October"), _("November"), _("December")];

// Names of the Weekdays
var WEEKDAY_NAMES = [_("Sunday"), _("Monday"), _("Tuesday"),
		_("Wednesday"), _("Thursday"), _("Friday"), _("Saturday")];

// Method to return a Date (first day) after adding specified months to specified Date
function dateMonthAdd(date, add) {
	return new Date(date.getFullYear(), date.getMonth() + add, 1);
}

// Method to return the number of days in a given month of a given year
function daysInMonth(month, fullYear) {
	return new Date(fullYear, month + 1, 0).getDate();
}

// Method to return a string with single digit number zero padded
function zeroPad(number) {
	number = Number(number);
	if (typeof number !== "number")
		return;
	return (number >= 0 && number <= 9 ? "0" : "") + number;
}
