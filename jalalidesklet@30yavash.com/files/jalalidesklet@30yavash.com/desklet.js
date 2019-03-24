//
// Jalali Time And Date - Cinnamon Desklet v0.4 - 29 Sep 2013
//
// The Solar Hijri calendar is the official calendar of Iran and Afghanistan.
//
// based on Ehsan Tabari and Cinnamon Time and Date desklet
//
// -Siavash Salemi
// 30yavash [at] gmail [dot] com
//
const Cinnamon = imports.gi.Cinnamon;
const Gio = imports.gi.Gio;
const St = imports.gi.St;
const Desklet = imports.ui.desklet;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const GLib = imports.gi.GLib;
const PopupMenu = imports.ui.popupMenu;
const Util = imports.misc.util;

const toLocaleFormat = function toLocaleFormat(date, format) {
    return Cinnamon.util_format_date(format, date.getTime());
};

function MyDesklet(metadata){
    this._init(metadata);
}

MyDesklet.prototype = {
	__proto__: Desklet.Desklet.prototype,

	_init: function(metadata){
		Desklet.Desklet.prototype._init.call(this, metadata);

		this.metadata = metadata
		this.dateFormat = this.metadata["dateFormat"];
		this.dateSize = this.metadata["dateSize"];
		this.timeFormat = this.metadata["timeFormat"];
		this.timeSize = this.metadata["timeSize"];

		this._clockContainer = new St.BoxLayout({vertical:true, style_class: 'clock-container'});

		this._dateContainer =  new St.BoxLayout({vertical:false, style_class: 'date-container'});
		this._timeContainer =  new St.BoxLayout({vertical:false, style_class: 'time-container'});

		this._date = new St.Label();
		this._time = new St.Label();


		this._dateContainer.add(this._date);
		this._timeContainer.add(this._time);

		this._clockContainer.add(this._timeContainer, {x_fill: false, x_align: St.Align.MIDDLE});
		this._clockContainer.add(this._dateContainer, {x_fill: false, x_align: St.Align.MIDDLE});

		this.setContent(this._clockContainer);
		this.setHeader(_("Time And Date"));

		// Set the font sizes from .json file

		this._date.style="font-size: " + this.dateSize;
		this._time.style="font-size: " + this.timeSize;

		// let dir_path = ;
		// this.save_path = dir_path.replace('~', GLib.get_home_dir());
		this.configFile = GLib.get_home_dir() + "/.local/share/cinnamon/desklets/jalalidesklet@30yavash.com/metadata.json";
		this.helpFile = GLib.get_home_dir() + "/.local/share/cinnamon/desklets/jalalidesklet@30yavash.com/README";

		global.log("Config file " + this.configFile);

		this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

		this._menu.addAction(_("Edit Config"), Lang.bind(this, function() {
			Util.spawnCommandLine("xdg-open " + this.configFile);
		}));

		this._menu.addAction(_("Help"), Lang.bind(this, function() {
			Util.spawnCommandLine("xdg-open " + this.helpFile);
		}));


		this._updateDate();
	},

	on_desklet_removed: function() {
		Mainloop.source_remove(this.timeout);
	},

	_updateDate: function(){

		// let timeFormat = '%H:%M';
		// let dateFormat = '%A,%e %B';
		let displayDate = new Date();


		this._time.set_text( FarsiNumbers( toLocaleFormat(displayDate, this.timeFormat)) );
		//this._date.set_text(displayDate.toLocaleFormat(this.dateFormat));

		let jalali = new JalaliDate(displayDate);
		this._date.set_text( FarsiNumbers(jalali.toLocaleFormat(this.dateFormat)) );

		this.timeout = Mainloop.timeout_add_seconds(1, Lang.bind(this, this._updateDate));

	}
}

function main(metadata, desklet_id){
	let desklet = new MyDesklet(metadata, desklet_id);
	return desklet;
}



//+++++++++++++++++++++++++++++++++++++++++
String.prototype.charRefToUnicode = function()
{
return this.replace(
/&#(([0-9]{1,7})|(x[0-9a-f]{1,6}));?/gi,
function(match, p1, p2, p3, offset, s)
{
return String.fromCharCode(p2 || ("0" + p3));
});
}

String.prototype.replaceAll = function (find, replace) {
    var str = this;
    return str.replace(new RegExp(find, 'g'), replace);
};

function FarsiNumbers(strText)
{
let engNum=new Array("0","1","2","3","4","5","6","7","8","9");
let farNum=new Array("&#1776;","&#1777;","&#1778;","&#1779;","&#1780;","&#1781;","&#1782;","&#1783;","&#1784;","&#1785;");
	for(let i=0;i<engNum.length;i++)
		strText=strText.replaceAll(engNum[i],farNum[i].charRefToUnicode());
return strText;
}


function JalaliDate(dateObject)
{
this.toLocaleFormat=function(strFormat){


let FarsiDayNamesFull = new Array (
"&#1588;&#1606;&#1576;&#1607;",
"&#1740;&#1705;&#1588;&#1606;&#1576;&#1607;",
"&#1583;&#1608;&#1588;&#1606;&#1576;&#1607;",
"&#1587;&#1607;&#8204;&#1588;&#1606;&#1576;&#1607;",
"&#1670;&#1607;&#1575;&#1585;&#1588;&#1606;&#1576;&#1607;",
"&#1662;&#1606;&#1580;&#8204;&#1588;&#1606;&#1576;&#1607;",
"&#1580;&#1605;&#1593;&#1607;"
);
let FarsiMonthNames = new Array ("",
"&#1601;&#1585;&#1608;&#1585;&#1583;&#1740;&#1606;",
"&#1575;&#1585;&#1583;&#1740;&#1576;&#1607;&#1588;&#1578;",
"&#1582;&#1585;&#1583;&#1575;&#1583;",
"&#1578;&#1740;&#1585;",
"&#1605;&#1585;&#1583;&#1575;&#1583;",
"&#1588;&#1607;&#1585;&#1740;&#1608;&#1585;",
"&#1605;&#1607;&#1585;",
"&#1570;&#1576;&#1575;&#1606;",
"&#1570;&#1584;&#1585;",
"&#1583;&#1740;",
"&#1576;&#1607;&#1605;&#1606;",
"&#1575;&#1587;&#1601;&#1606;&#1583;");
let FarsiMonthNamesShort = new Array ("",
"&#1601;&#1585;&#1608;",
"&#1575;&#1585;&#1583;",
"&#1582;&#1585;&#1583;",
"&#1578;&#1740;&#1585;",
"&#1605;&#1585;&#1583;",
"&#1588;&#1607;&#1585;",
"&#1605;&#1607;&#1585;",
"&#1570;&#1576;&#1575;",
"&#1570;&#1584;&#1585;",
"&#1583;&#1740;",
"&#1576;&#1607;&#1605;",
"&#1575;&#1587;&#1601;");

	let dateResult = strFormat;
	dateResult=dateResult.replace("%Y",this.year.toString());
	dateResult=dateResult.replace("%y",this.year.toString().substr(2));
	dateResult=dateResult.replace("%d",this.date.toString());
	dateResult=dateResult.replace("%e",this.date.toString());
	dateResult=dateResult.replace("%m",this.month.toString());
	dateResult=dateResult.replace("%B",FarsiMonthNames[this.month].charRefToUnicode());
	dateResult=dateResult.replace("%b",FarsiMonthNamesShort[this.month].charRefToUnicode());
	dateResult=dateResult.replace("%A",FarsiDayNamesFull[this.day].charRefToUnicode());
	dateResult=toLocaleFormat(dateObject, dateResult);


	return dateResult;
}

function Months_C(Y, M) {
    switch (M) {
        case 1:
        case 3:
        case 5:
        case 7:
        case 8:
        case 10:
        case 12: return 31;
        case 2: if (Y % 4 == 0) return 29;
            else return 28;
        default: return 30;
    }
}


function DaysInMonth(Year, Month) {
    if (Month == 0) {
        Month = 12;
        Year = Year - 1;
    }
    else if (Month == 13) {
        Month = 1;
        Year = Year + 1;
    }
    else if (Month < 0 || Month>13)
        return -10000;

    if (Month >= 1 && Month <= 6)
        return 31;
    else if (Month == 12) {
        if ((((Year % 4) == 2) && (Year < 1374)) || (((Year % 4) == 3) && (Year >= 1374)))
            return 30;
        else
            return 29;
    }
    else return 30;
}

   let AYear4=dateObject.getYear();
   if (AYear4 < 1000)
      AYear4+=1900;
   let ADay=dateObject.getDate();
   let AMonth=dateObject.getMonth()+1; // Check [HINT]

    let Yd = ADay;
    let M = AMonth;
    for (let i = 1; i < M; i++)
        Yd = Yd + Months_C(AYear4, i);

    AYear4 -= 621;
    Yd -= (DaysInMonth(AYear4 - 1, 12) + DaysInMonth(AYear4 - 1, 11) + 20);

    if (DaysInMonth(AYear4 - 1, 12) == 30)
        Yd++;

    if (Yd > 0) {
        AMonth = 1;
        while (Yd > DaysInMonth(AMonth, AMonth)) {
            Yd -= DaysInMonth(AYear4, AMonth);
            AMonth++;
        }
        ADay = Yd;
    }
    else if (Yd <= 0) {
        AYear4--;
        AMonth = 12;
        while (-Yd >= DaysInMonth(AYear4, AMonth)) {
            Yd += DaysInMonth(AYear4, AMonth);
            AMonth--;
        }
        ADay = DaysInMonth(AYear4, AMonth) + Yd;
    }

    let d = dateObject.getDay();
    if (d==6) d=0;
    else d++;


    this.date = ADay;
    this.month = AMonth;
    this.year=AYear4;
    this.day = d;

}// end of class


