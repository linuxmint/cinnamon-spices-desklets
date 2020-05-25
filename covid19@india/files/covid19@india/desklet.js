const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Util = imports.misc.util;
const Cinnamon = imports.gi.Cinnamon;
const Mainloop = imports.mainloop;
const Lang = imports.lang;
const Settings = imports.ui.settings;
const Main = imports.ui.main;
const Clutter = imports.gi.Clutter;
const GdkPixbuf = imports.gi.GdkPixbuf;
const Cogl = imports.gi.Cogl;
const Gio = imports.gi.Gio;
const Soup = imports.gi.Soup;
const _httpSession = new Soup.SessionAsync();
const Tooltips = imports.ui.tooltips;

const PopupMenu = imports.ui.popupMenu;
const Gettext = imports.gettext;
var jsonData;

//const DESKLET_ROOT = imports.ui.deskletManager.deskletMeta["covid19@india"].path;

function MyDesklet(metadata, deskletId) {
    this._init(metadata, deskletId);
}


MyDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init(metadata, deskletId) {
        Desklet.Desklet.prototype._init.call(this, metadata, deskletId);

        this.settings = new Settings.DeskletSettings(this, this.metadata.uuid, deskletId);
        this.settings.bindProperty(Settings.BindingDirection.IN, "langdl", "langdl", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "state", "mystate", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "district", "mydistrict");
        this.settings.bindProperty(Settings.BindingDirection.IN, "district_enable", "district_enable", this.on_setting_changed);

        this.setupUI();
        // start update cycle
        this.update();
    },

    setupUI() {
        this._covidContainer = new St.BoxLayout({ vertical: true, styleClass: "covidContainer" });
        this._districtContainer = new St.BoxLayout({ vertical: true, styleClass: "districtContainer" });

        if (this.langdl === "hi") {
            this._title = new St.Label({ text: "कोरोना विवरण", styleClass: "title_css" });
            this._india = new St.Label({ text: "भारत: खोज रहा है", styleClass: "india_css" });
            this._indiaDetails = new St.Label({ text: " खोज रहा है \n  खोज रहा है", styleClass: "indiadetails_css" });
            this._state = new St.Label({ text: "राज्य:  खोज रहा है", styleClass: "state_css" });
            this._stateDetails = new St.Label({ text: " खोज रहा है \n  खोज रहा है", styleClass: "statedetails_css" });
            this._district = new St.Label({ text: "जिला: खोज रहा है", styleClass: "district_css" });
            this._districtZone = new St.Label({ text: "क्षेत्र खोज रहा है", styleClass: "districtzone_css" });
            this._districtDetails = new St.Label({ text: "खोज रहा है \n खोज रहा है \n खोज रहा है \n खोज रहा है", styleClass: "districtdetails_css" });

        } else {
            this._title = new St.Label({ text: "Corona Report", styleClass: "title_css" });
            this._india = new St.Label({ text: "India: loading", styleClass: "india_css" });
            this._indiaDetails = new St.Label({ text: "loading \n loading", styleClass: "indiadetails_css" });
            this._state = new St.Label({ text: "State loading", styleClass: "state_css" });
            this._stateDetails = new St.Label({ text: "loading \n loading", styleClass: "statedetails_css" });
            this._district = new St.Label({ text: "District: loading", styleClass: "district_css" });
            this._districtZone = new St.Label({ text: "zone loading", styleClass: "districtzone_css" });
            this._districtDetails = new St.Label({ text: "loading \n loading \n loading \n loading", styleClass: "districtdetails_css" });

        }
        this._covidContainer.add(this._title);
        this._covidContainer.add(this._india);
        this._covidContainer.add(this._indiaDetails);
        this._covidContainer.add(this._state);
        this._covidContainer.add(this._stateDetails);
        this._districtContainer.add(this._district);
        this._districtContainer.add(this._districtZone);
        this._districtContainer.add(this._districtDetails);

        if (this.district_enable === true) {
            this._covidContainer.add(this._districtContainer);
        }
        this.setContent(this._covidContainer);
        this.setHeader("Covid 19 India");
        global.log("Covid: SetupUI() completed");
    },

    getJSON(url, callback) {
        global.log("Covid: getJson enter");
        var here = this;
        let message = Soup.Message.new("GET", url);
        _httpSession.queue_message(message, function(session, message) {
            if (message.status_code == 200) {
                try {
                    callback.call(here, JSON.parse(message.response_body.data));
                } catch (e) {
                    global.logError(e);
                }
            } else {
                callback.call(here, "");
            }
        });
    },


    refreshStatshi() {
        global.log("Covid: refreshStatshi enter");
        this.getJSON("https://api.covid19india.org/data.json", function(jsonData) {
            if (jsonData !== "") {
                this._india.set_text("भारत: " + jsonData.statewise[0].active);
                this._indiaDetails.set_text("पुष्टीकृत: " + jsonData.statewise[0].confirmed + ", रोगमुक्त: " + jsonData.statewise[0].recovered + ", मृतक: " + jsonData.statewise[0].deaths + " \nसमय " + jsonData.statewise[0].lastupdatedtime + " पर");
                jsonData.statewise.forEach((statecd) => {
                    if (statecd.statecode === this.mystate) {
                        let statenamehi = {
                            "Maharastra": "महाराष्ट्र",
                            "Gujrat": "गुजरात",
                            "Tamil Nadu": "तमिलनाडु",
                            "Delhi": "दिल्ली",
                            "Rajasthan": "राजस्थान",
                            "Madhya Pradesh": "मध्य प्रदेश",
                            "Uttar Pradesh": "उत्तर प्रदेश",
                            "Andra Pradesh": "आंध्र प्रदेश",
                            "West Bengal": "पश्चिम बंगाल",
                            "Punjab": "पंजाब",
                            "Telangana": "तेलंगाना",
                            "Jammu and Kashmir": "जम्मू और कश्मीर",
                            "Karnataka": "कर्नाटक",
                            "Haryana": "हरियाणा",
                            "Bihar": "बिहार",
                            "Kerala": "केरल",
                            "Odisha": "ओडिशा",
                            "Chandigarh": "चंडीगढ़",
                            "Jharkhand": "झारखंड",
                            "Tripura": "त्रिपुरा",
                            "Uttarakhand": "उत्तराखंड",
                            "Chhattisgarh": "छत्तीसगढ़",
                            "Assam": "असम",
                            "Himachal Pradesh": "हिमाचल प्रदेश",
                            "Ladakh": "लद्दाख",
                            "Andaman and Nicobar Islands": "अंडमान व नोकोबार द्वीप समूह",
                            "Meghalaya": "मेघालय",
                            "Puducherry": "पुडुचेरी",
                            "Goa": "गोवा",
                            "Manipur": "मणिपुर",
                            "Mizoram": "मिजोरम",
                            "Arunachal Pradesh": "अरुणाचल प्रदेश",
                            "Dadra and Nagar Haveli and Daman and Diu": "दादरा और नगर हवेली और दमन और दीव",
                            "Nagaland": "नगालैंड",
                            "Daman and Diu": "दमन और दीव",
                            "Lakshadweep": "लक्षद्वीप",
                            "Sikkim": "सिक्किम"
                        };
                        this._state.set_text(statenamehi[statecd.state] + ": " + statecd.active);
                        this._stateDetails.set_text("पुष्टीकृत: " + statecd.confirmed + ", रोगमुक्त: " + statecd.recovered + ", मृतक: " + statecd.deaths + " \nसमय " + statecd.lastupdatedtime + " पर");
                    }
                });
                this.checkDistricthi();
            } else {
                //this._indiaDetails.set_text("अज्ञात\nअज्ञात");
                //this._stateDetails.set_text("अज्ञात\nअज्ञात");
            }


        });
    },
    refreshStatsen() {
        this.getJSON("https://api.covid19india.org/data.json", function(jsonDataen) {
            if (jsonDataen !== "") {
                this._india.set_text("India: " + jsonDataen.statewise[0].active);
                this._indiaDetails.set_text("Confirmed: " + jsonDataen.statewise[0].confirmed + ", Recovered: " + jsonDataen.statewise[0].recovered + ", Death: " + jsonDataen.statewise[0].deaths + " \nat " + jsonDataen.statewise[0].lastupdatedtime);
                jsonDataen.statewise.forEach((stateencd) => {
                    if (stateencd.statecode === this.mystate) {
                        this._state.set_text(stateencd.state + ": " + stateencd.active);
                        this._stateDetails.set_text("Confirmed: " + stateencd.confirmed + ", Recovered: " + stateencd.recovered + ", Death: " + stateencd.deaths + " \nat " + stateencd.lastupdatedtime);

                    }
                });
                this.checkDistricten();
            } else {
                //this._indiaDetails.set_text("unreachable\nunreachable");
                //this._stateDetails.set_text("unreachable\nunreachable");
            }
        });
    },


    checkDistricthi() {
        if (this.district_enable) {
            this.refreshdistricthi();
        }
    },
    checkDistricten() {
        if (this.district_enable) {
            this.refreshdistricten();
        }
    },

    refreshZonehi() {
        this.getJSON("https://api.covid19india.org/zones.json", function(jsonZone) {
            if (jsonZone !== "") {
                jsonZone.zones.forEach((distzn) => {
                    if (distzn.statecode === this.mystate && distzn.district.toLowerCase() === this.mydistrict.toLowerCase()) {
                        this.refreshZoneTexthi(distzn);
                    }
                });
            } else { this._districtZone.set_text("अज्ञात"); }

        });
    },
    refreshZoneTexthi(distzn) {
        switch (distzn.zone) {
            case "Red":
                this._districtContainer.styleClass = "districtred_css";
                this._districtZone.set_text("लाल क्षेत्र " + distzn.lastupdated + " से");
                break;
            case "Green":
                this._districtContainer.styleClass = "districtgreen_css";
                this._districtZone.set_text("हरा क्षेत्र " + distzn.lastupdated + " से");
                break;
            case "Orange":
                this._districtContainer.styleClass = "districtorange_css";
                this._districtZone.set_text("नारंगी क्षेत्र " + distzn.lastupdated + " से");
                break;
        }
    },
    refreshZoneen() {
        this.getJSON("https://api.covid19india.org/zones.json", function(jsonZoneen) {
            if (jsonZoneen !== "") {
                jsonZoneen.zones.forEach((distenzn) => {
                    if (distenzn.statecode === this.mystate && distenzn.district.toLowerCase() === this.mydistrict.toLowerCase()) {
                        this.refreshZoneTexten(distenzn);
                    }
                });
            } else { this._districtZone.set_text("Unreachable"); }

        });
    },
    refreshZoneTexten(distenzn) {
        switch (distenzn.zone) {
            case "Red":
                this._districtContainer.styleClass = "districtred_css";
                this._districtZone.set_text("Red Zone from " + distenzn.lastupdated);
                break;
            case "Green":
                this._districtContainer.styleClass = "districtgreen_css";
                this._districtZone.set_text("Green Zone from " + distenzn.lastupdated);
                break;
            case "Orange":
                this._districtContainer.styleClass = "districtorange_css";
                this._districtZone.set_text("Orange Zone from " + distenzn.lastupdated);
                break;
        }
    },

    refreshdistricthi() {
        this.getJSON("https://api.covid19india.org/v2/state_district_wise.json", function(jsonDistrict) {
            if (jsonDistrict !== "") {
                this.districtfound = false;
                jsonDistrict.forEach((statecd) => {
                    if (statecd.statecode === this.mystate) {
                        statecd.districtData.forEach((distct) => {
                            if (distct.district.toLowerCase() === this.mydistrict.toLowerCase()) {
                            	let districtnamehi = {
                            		"Nicobars" : "निकोबार",
                            		"North and Middle Andaman" : "उत्तर और मध्य अंडमान",
                            		"South Andaman" : "दक्षिण अंडमान",
                            		"Anantapur" : "अनंतपुर",
                            		"Chittoor" : "चित्तूर",
                            		"East Godavari" : "पूर्वी गोदावरी",
                            		"Guntur" : "गुंटूर",
                            		"Krishna" : "कृष्णा",
                            		"Kurnool" : "कुरनूल",
                            		"Other State" : "अन्य राज्य",
                            		"Prakasam" : "प्रकाशम",
                            		"S.P.S. Nellore" : "एस.पी.एस. नेल्लोर",
                            		"Srikakulam" : "श्रीकाकुलम",
                            		"Visakhapatnam" : "विशाखापत्तनम",
                            		"Vizianagaram" : "विजयनगरम",
                            		"West Godavari" : "पश्चिम गोदावरी",
                            		"Y.S.R. Kadapa" : "वाईएसआर कडप्पा",
                            		"Anjaw" : "अंजॉ",
                            		"Changlang" : "चांगलांग",
                            		"East Kameng" : "पूर्वी कामेंग",
                            		"East Siang" : "पूर्वी सियांग",
                            		"Kamle" : "Kamle",
                            		"Kra Daadi" : "काल दाड़ी",
                            		"Kurung Kumey" : "कुरुंग कुमे",
                            		"Lepa Rada" : "लेपा राडा",
                            		"Lohit" : "लोहित",
                            		"Longding" : "लोंगडिंग",
                            		"Lower Dibang Valley" : "निचली दिबांग घाटी",
                            		"Lower Siang" : "लोअर सियांग",
                            		"Lower Subansiri" : "लोअर सुबनसिरी",
                            		"Namsai" : "नामसाई",
                            		"Pakke Kessang" : "पक्के केसांग",
                            		"Papum Pare" : "पापुम पारे",
                            		"Shi Yomi" : "शी योमी",
                            		"Siang" : "सियांग",
                            		"Tawang" : "तवांग",
                            		"Tirap" : "तिरप",
                            		"Upper Dibang Valley" : "अपर दिबांग घाटी",
                            		"Upper Siang" : "अपर सियांग",
                            		"Upper Subansiri" : "अपर सुबनसिरी",
                            		"West Kameng" : "पश्चिम कामेंग",
                            		"West Siang" : "वेस्ट सियांग",
                            		"Baksa" : "बक्सा",
                            		"Barpeta" : "बारपेटा",
                            		"Biswanath" : "विश्वनाथ",
                            		"Bongaigaon" : "बोंगईगांव",
                            		"Cachar" : "कछार",
                            		"Charaideo" : "चराईदेव",
                            		"Chirang" : "चिरांग",
                            		"Darrang" : "दरांग",
                            		"Dhemaji" : "धेमाजी",
                            		"Dhubri" : "धुबरी",
                            		"Dibrugarh" : "डिब्रूगढ़",
                            		"Dima Hasao" : "दीमा हसाओ",
                            		"Goalpara" : "गोलपाड़ा",
                            		"Golaghat" : "गोलाघाट",
                            		"Hailakandi" : "हैलाकांडी",
                            		"Hojai" : "होजाई",
                            		"Jorhat" : "जोरहट",
                            		"Kamrup" : "कामरूप",
                            		"Kamrup Metropolitan" : "कामरूप महानगर",
                            		"Karbi Anglong" : "कार्बी आंगलोंग",
                            		"Karimganj" : "करीमगंज",
                            		"Kokrajhar" : "कोकराझार",
                            		"Lakhimpur" : "लखीमपुर",
                            		"Majuli" : "माजुली",
                            		"Morigaon" : "मोरीगांव",
                            		"Nagaon" : "नगांव",
                            		"Nalbari" : "नलबाड़ी",
                            		"Other State" : "अन्य राज्य",
                            		"Sivasagar" : "शिवसागर",
                            		"Sonitpur" : "सोनितपुर",
                            		"South Salmara Mankachar" : "दक्षिण सलमार मनकचर",
                            		"Tinsukia" : "तिनसुकिया",
                            		"Udalguri" : "उदलगुड़ी",
                            		"West Karbi Anglong" : "वेस्ट कार्बी एंगलोंग",
                            		"Unknown" : "अज्ञात",
                            		"Araria" : "अररिया",
                            		"Arwal" : "अरवल",
                            		"Aurangabad" : "औरंगाबाद",
                            		"Banka" : "बांका",
                            		"Begusarai" : "बेगूसराय",
                            		"Bhagalpur" : "भागलपुर",
                            		"Bhojpur" : "भोजपुर",
                            		"Buxar" : "बक्सर",
                            		"Darbhanga" : "दरभंगा",
                            		"East Champaran" : "पूर्वी चंपारण",
                            		"Gaya" : "गया",
                            		"Gopalganj" : "गोपालगंज",
                            		"Jamui" : "जमुई",
                            		"Jehanabad" : "जहानाबाद",
                            		"Kaimur" : "कैमूर",
                            		"Katihar" : "कटिहार",
                            		"Khagaria" : "खगरिया",
                            		"Kishanganj" : "किशनगंज",
                            		"Lakhisarai" : "लखीसराय",
                            		"Madhepura" : "मधेपुरा",
                            		"Madhubani" : "मधुबनी",
                            		"Munger" : "मुंगेर",
                            		"Muzaffarpur" : "मुजफ्फरपुर",
                            		"Nalanda" : "नालंदा",
                            		"Nawada" : "नवादा",
                            		"Patna" : "पटना",
                            		"Purnia" : "पूर्णिया",
                            		"Rohtas" : "रोहतास",
                            		"Saharsa" : "सहरसा",
                            		"Samastipur" : "समस्तीपुर",
                            		"Saran" : "सरन",
                            		"Sheikhpura" : "शेखपुरा",
                            		"Sheohar" : "शिवहर",
                            		"Sitamarhi" : "सीतामढ़ी",
                            		"Siwan" : "सिवान",
                            		"Supaul" : "सुपौल",
                            		"Vaishali" : "वैशाली",
                            		"West Champaran" : "पश्चिम चंपारण",
                            		"Chandigarh" : "चंडीगढ़",
                            		"Balod" : "बालोद",
                            		"Baloda Bazar" : "बलौदा बाजार",
                            		"Balrampur" : "बलरामपुर",
                            		"Bametara" : "Bametara",
                            		"Bastar" : "बस्तर",
                            		"Bijapur" : "बीजापुर",
                            		"Bilaspur" : "बिलासपुर",
                            		"Dakshin Bastar Dantewada" : "दक्षिण बस्तर दंतेवाड़ा",
                            		"Dhamtari" : "धमतरी",
                            		"Durg" : "दुर्ग",
                            		"Gariaband" : "गरियाबंद",
                            		"Janjgir Champa" : "जांजगीर चांपा",
                            		"Jashpur" : "जशपुर",
                            		"Kabeerdham" : "कबीरधाम",
                            		"Kondagaon" : "कोंडागाँव",
                            		"Korba" : "कोरबा",
                            		"Koriya" : "कोरिया",
                            		"Mahasamund" : "महासमुंद",
                            		"Mungeli" : "मुंगेली",
                            		"Narayanpur" : "नारायणपुर",
                            		"Raigarh" : "रायगढ़",
                            		"Raipur" : "रायपुर",
                            		"Rajnandgaon" : "राजनंदगांव",
                            		"Sukma" : "सुकमा",
                            		"Surajpur" : "सूरजपुर",
                            		"Surguja" : "सरगुजा",
                            		"Uttar Bastar Kanker" : "उत्तर बस्तर कांकेर",
                            		"Central Delhi" : "मध्य दिल्ली",
                            		"East Delhi" : "पूर्वी दिल्ली",
                            		"New Delhi" : "नई दिल्ली",
                            		"North Delhi" : "उत्तरी दिल्ली",
                            		"North East Delhi" : "नॉर्थ ईस्ट दिल्ली",
                            		"North West Delhi" : "उत्तर पश्चिम दिल्ली",
                            		"Shahdara" : "शाहदरा",
                            		"South Delhi" : "दक्षिण दिल्ली",
                            		"South East Delhi" : "साउथ ईस्ट दिल्ली",
                            		"South West Delhi" : "साउथ वेस्ट दिल्ली",
                            		"West Delhi" : "पश्चिम दिल्ली",
                            		"Dadra and Nagar Haveli" : "दादरा और नगर हवेली",
                            		"Daman" : "दमन",
                            		"Diu" : "दीव",
                            		"North Goa" : "उत्तर गोवा",
                            		"South Goa" : "दक्षिण गोवा",
                            		"Ahmedabad" : "अहमदाबाद",
                            		"Amreli" : "अमरेली",
                            		"Anand" : "आनंद",
                            		"Aravalli" : "अरावली",
                            		"Banaskantha" : "बनासकांठा",
                            		"Bharuch" : "भरूच",
                            		"Bhavnagar" : "भावनगर",
                            		"Botad" : "बोटाड",
                            		"Chhota Udaipur" : "छोटा उदयपुर",
                            		"Dahod" : "दाहोद",
                            		"Dang" : "डैंग",
                            		"Devbhumi Dwarka" : "देवभूमि द्वारका",
                            		"Gandhinagar" : "गांधीनगर",
                            		"Gir Somnath" : "गिर सोमनाथ",
                            		"Jamnagar" : "जामनगर",
                            		"Junagadh" : "जूनागढ़",
                            		"Kheda" : "खेड़ा",
                            		"Kutch" : "कच्छ",
                            		"Mahisagar" : "महीसागर",
                            		"Mehsana" : "मेहसाणा",
                            		"Morbi" : "मोरबी",
                            		"Narmada" : "नर्मदा",
                            		"Navsari" : "नवसारी",
                            		"Panchmahal" : "पंचमहल",
                            		"Patan" : "पतन",
                            		"Porbandar" : "पोरबंदर",
                            		"Rajkot" : "राजकोट",
                            		"Sabarkantha" : "साबरकांठा",
                            		"Surat" : "सूरत",
                            		"Surendranagar" : "सुरेंद्रनगर",
                            		"Tapi" : "तापी",
                            		"Vadodara" : "वडोदरा",
                            		"Valsad" : "वलसाड",
                            		"Bilaspur" : "बिलासपुर",
                            		"Chamba" : "चंबा",
                            		"Hamirpur" : "हमीरपुर",
                            		"Kangra" : "कांगड़ा",
                            		"Kinnaur" : "किन्नौर",
                            		"Kullu" : "कुल्लू",
                            		"Lahaul and Spiti" : "लाहौल और स्पीति",
                            		"Mandi" : "मंडी",
                            		"Shimla" : "शिमला",
                            		"Sirmaur" : "सिरमौर",
                            		"Solan" : "सोलन",
                            		"Una" : "ऊना",
                            		"Ambala" : "अंबाला",
                            		"Bhiwani" : "भिवानी",
                            		"Charkhi Dadri" : "चरखी दादरी",
                            		"Faridabad" : "फरीदाबाद",
                            		"Fatehabad" : "फतेहाबाद",
                            		"Gurugram" : "गुड़गाँव",
                            		"Hisar" : "हिसार",
                            		"Italians" : "इटली",
                            		"Jhajjar" : "झज्जर",
                            		"Jind" : "जींद",
                            		"Kaithal" : "कैथल",
                            		"Karnal" : "करनाल",
                            		"Kurukshetra" : "कुरुक्षेत्र",
                            		"Mahendragarh" : "महेंद्रगढ़",
                            		"Nuh" : "नूह",
                            		"Palwal" : "पलवल",
                            		"Panchkula" : "पंचकुला",
                            		"Panipat" : "पानीपत",
                            		"Rewari" : "रेवाड़ी",
                            		"Rohtak" : "रोहतक",
                            		"Sirsa" : "सिरसा",
                            		"Sonipat" : "सोनीपत",
                            		"Yamunanagar" : "यमुनानगर",
                            		"Bokaro" : "बोकारो",
                            		"Chatra" : "चतरा",
                            		"Deoghar" : "देवघर",
                            		"Dhanbad" : "धनबाद",
                            		"Dumka" : "दुमका",
                            		"East Singhbhum" : "पूर्वी सिंहभूम",
                            		"Garhwa" : "गढ़वा",
                            		"Giridih" : "गिरिडीह",
                            		"Godda" : "गोड्डा",
                            		"Gumla" : "गुमला",
                            		"Hazaribagh" : "हजारीबाग",
                            		"Jamtara" : "जामताड़ा",
                            		"Khunti" : "खूंटी",
                            		"Koderma" : "कोडरमा",
                            		"Latehar" : "लातेहार",
                            		"Lohardaga" : "लोहरदगा",
                            		"Pakur" : "पाकुर",
                            		"Palamu" : "पलामू",
                            		"Ramgarh" : "रामगढ़",
                            		"Ranchi" : "रांची",
                            		"Sahibganj" : "साहिबगंज",
                            		"Saraikela-Kharsawan" : "सराइकेला खरसावाँ",
                            		"Simdega" : "सिमडेगा",
                            		"West Singhbhum" : "पश्चिम सिंहभूम",
                            		"Anantnag" : "अनंतनाग",
                            		"Bandipora" : "बांदीपोरा",
                            		"Baramulla" : "बारामूला",
                            		"Budgam" : "बडगाम",
                            		"Doda" : "डोडा",
                            		"Ganderbal" : "गांदरबल",
                            		"Jammu" : "जम्मू",
                            		"Kathua" : "कठुआ",
                            		"Kishtwar" : "किश्तवाड़",
                            		"Kulgam" : "कुलगाम",
                            		"Kupwara" : "कुपवाड़ा",
                            		"Mirpur" : "मीरपुर",
                            		"Muzaffarabad" : "मुजफ्फराबाद",
                            		"Pulwama" : "पुलवामा",
                            		"Punch" : "पंच",
                            		"Rajouri" : "राजौरी",
                            		"Ramban" : "रामबन",
                            		"Reasi" : "रियासी",
                            		"Samba" : "सांबा",
                            		"Shopiyan" : "शुपियाँ",
                            		"Srinagar" : "श्रीनगर",
                            		"Udhampur" : "उधमपुर",
                            		"Bagalkote" : "बागलकोट",
                            		"Ballari" : "बल्लरी",
                            		"Belagavi" : "बेलगावी",
                            		"Bengaluru Rural" : "बेंगलुरु ग्रामीण",
                            		"Bengaluru Urban" : "बेंगलुरु अर्बन",
                            		"Bidar" : "बीदर",
                            		"Chamarajanagara" : "चामराजनगर",
                            		"Chikkaballapura" : "चिक्कबल्लपुर",
                            		"Chikkamagaluru" : "चिक्कामगलुरु",
                            		"Chitradurga" : "चित्रदुर्ग",
                            		"Dakshina Kannada" : "दक्षिणा कन्नड़",
                            		"Davanagere" : "दावनगेरे",
                            		"Dharwad" : "धारवाड़",
                            		"Gadag" : "गदग",
                            		"Hassan" : "हसन",
                            		"Haveri" : "हवेरी",
                            		"Kalaburagi" : "गुलबर्ग",
                            		"Kodagu" : "कोडागु",
                            		"Kolar" : "कोलार",
                            		"Koppal" : "कोप्पल",
                            		"Mandya" : "मंड्या",
                            		"Mysuru" : "मैसूर",
                            		"Raichur" : "रायचुर",
                            		"Ramanagara" : "रामनगर",
                            		"Shivamogga" : "शिवमोगा",
                            		"Tumakuru" : "तुमकूर",
                            		"Udupi" : "उडुपी",
                            		"Uttara Kannada" : "उत्तरा कन्नड़",
                            		"Vijayapura" : "Vijayapura - ವಿಜಯಪುರ",
                            		"Yadgir" : "यादगीर",
                            		"Alappuzha" : "अलपुझा",
                            		"Ernakulam" : "एर्नाकुलम",
                            		"Idukki" : "इडुक्की",
                            		"Kannur" : "कन्नूर",
                            		"Kasaragod" : "कासरगोड",
                            		"Kollam" : "कोल्लम",
                            		"Kottayam" : "कोट्टायम",
                            		"Kozhikode" : "कोझिकोड",
                            		"Malappuram" : "मलप्पुरम",
                            		"Palakkad" : "पलक्कड़",
                            		"Pathanamthitta" : "पथानामथिट्टा",
                            		"Thiruvananthapuram" : "तिरुवनंतपुरम",
                            		"Thrissur" : "त्रिशूर",
                            		"Wayanad" : "वायनाड",
                            		"Kargil" : "कारगिल",
                            		"Leh" : "लेह",
                            		"Lakshadweep" : "लक्षद्वीप",
                            		"Ahmednagar" : "अहमदनगर",
                            		"Akola" : "अकोला",
                            		"Amravati" : "अमरावती",
                            		"Aurangabad" : "औरंगाबाद",
                            		"Beed" : "बीड",
                            		"Bhandara" : "भंडारा",
                            		"Buldhana" : "बुलढाना",
                            		"Chandrapur" : "चंद्रपुर",
                            		"Dhule" : "धुले",
                            		"Gadchiroli" : "गडचिरोली",
                            		"Gondia" : "गोंदिया",
                            		"Hingoli" : "हिंगोली",
                            		"Jalgaon" : "जलगांव",
                            		"Jalna" : "जलना",
                            		"Kolhapur" : "कोल्हापुर",
                            		"Latur" : "लातूर",
                            		"Mumbai" : "मुंबई",
                            		"Mumbai Suburban" : "मुंबई उपनगरीय",
                            		"Nagpur" : "नागपुर",
                            		"Nanded" : "नांदेड़",
                            		"Nandurbar" : "नंदुरबार",
                            		"Nashik" : "नासिक",
                            		"Osmanabad" : "उस्मानाबाद",
                            		"Palghar" : "Palghar",
                            		"Parbhani" : "परभनी",
                            		"Pune" : "पुणे",
                            		"Raigad" : "रायगढ़",
                            		"Ratnagiri" : "रत्नागिरी",
                            		"Sangli" : "सांगली",
                            		"Satara" : "सतारा",
                            		"Sindhudurg" : "सिंधुदुर्ग",
                            		"Solapur" : "सोलापुर",
                            		"Thane" : "ठाणे",
                            		"Wardha" : "वर्धा",
                            		"Washim" : "वाशिम",
                            		"Yavatmal" : "यवतमाल",
                            		"East Garo Hills" : "ईस्ट गारो हिल्स",
                            		"East Jaintia Hills" : "ईस्ट जैंतिया हिल्स",
                            		"East Khasi Hills" : "ईस्ट खासी हिल्स",
                            		"North Garo Hills" : "नॉर्थ गारो हिल्स",
                            		"Ribhoi" : "री भोई",
                            		"South Garo Hills" : "साउथ गारो हिल्स",
                            		"South West Garo Hills" : "साउथ वेस्ट गारो हिल्स",
                            		"South West Khasi Hills" : "साउथ वेस्ट खासी हिल्स",
                            		"West Garo Hills" : "वेस्ट गारो हिल्स",
                            		"West Jaintia Hills" : "वेस्ट जैंतिया हिल्स",
                            		"West Khasi Hills" : "पश्चिम खासी हिल्स",
                            		"Bishnupur" : "बिश्नुपुर",
                            		"Chandel" : "चंदेल",
                            		"Churachandpur" : "छुरछंदपुर",
                            		"Imphal East" : "इम्फाल ईस्ट",
                            		"Imphal West" : "इम्फाल पश्चिम",
                            		"Jiribam" : "जिरीबाम",
                            		"Kakching" : "ककचिंग",
                            		"Kamjong" : "कमजोंग",
                            		"Kangpokpi" : "ककचिंग",
                            		"Noney" : "नोने",
                            		"Pherzawl" : "फेरज़ौल",
                            		"Senapati" : "सेनापति",
                            		"Tamenglong" : "तामेंगलांग",
                            		"Tengnoupal" : "तेंगनोउपल",
                            		"Thoubal" : "थौबल",
                            		"Ukhrul" : "उखरूल",
                            		"Agar Malwa" : "आगर मालवा",
                            		"Alirajpur" : "अलीराजपुर",
                            		"Anuppur" : "अनूपपुर",
                            		"Ashoknagar" : "अशोकनगर",
                            		"Balaghat" : "बालाघाट",
                            		"Barwani" : "बड़वानी",
                            		"Betul" : "बेतुल",
                            		"Bhind" : "भिंड",
                            		"Bhopal" : "भोपाल",
                            		"Burhanpur" : "बुरहानपुर",
                            		"Chhatarpur" : "छतरपुर",
                            		"Chhindwara" : "छिंदवाड़ा",
                            		"Damoh" : "दमोह",
                            		"Datia" : "दतिया",
                            		"Dewas" : "देवास",
                            		"Dhar" : "धार",
                            		"Dindori" : "डिंडोरी",
                            		"Guna" : "गुना",
                            		"Gwalior" : "ग्वालियर",
                            		"Harda" : "हरदा",
                            		"Hoshangabad" : "होशंगाबाद",
                            		"Indore" : "इंदौर",
                            		"Jabalpur" : "जबलपुर",
                            		"Jhabua" : "झाबुआ",
                            		"Katni" : "कटनी",
                            		"Khandwa" : "खंडवा",
                            		"Khargone" : "खरगोन",
                            		"Mandla" : "मंडला",
                            		"Mandsaur" : "मंदसौर",
                            		"Morena" : " मुरैना",
                            		"Narsinghpur" : "नरसिंहपुर",
                            		"Neemuch" : "नीमच",
                            		"Niwari" : "निवारी",
                            		"Panna" : "पन्ना",
                            		"Raisen" : "रायसेन",
                            		"Rajgarh" : "राजगढ़",
                            		"Ratlam" : "रतलाम",
                            		"Rewa" : "रीवा",
                            		"Sagar" : "सागर",
                            		"Satna" : "सतना",
                            		"Sehore" : "सीहोर",
                            		"Seoni" : "सिवनी",
                            		"Shahdol" : "शाहडोल",
                            		"Shajapur" : "शाजापुर",
                            		"Sheopur" : "श्योपुर",
                            		"Shivpuri" : "शिवपुरी",
                            		"Sidhi" : "सीधी",
                            		"Singrauli" : "सिंगरौली",
                            		"Tikamgarh" : "टीकमगढ़",
                            		"Ujjain" : "उज्जैन",
                            		"Umaria" : "उमरिया",
                            		"Vidisha" : "विदिशा",
                            		"Aizawl" : "आइजोल",
                            		"Champhai" : "चम्फाई",
                            		"Hnahthial" : "ह्नाहथिआल",
                            		"Khawzawl" : "खौज़ौल",
                            		"Kolasib" : "कोलासिब",
                            		"Lawngtlai" : "लौंगत्लाइ",
                            		"Lunglei" : "लुंगलेई",
                            		"Mamit" : "मामित",
                            		"Saiha" : "सैहा",
                            		"Saitual" : "सइतुआल",
                            		"Serchhip" : "सेरछिप",
                            		"Dimapur" : "दीमापुर",
                            		"Kiphire" : "किफायर",
                            		"Kohima" : "कोहिमा",
                            		"Longleng" : "लोंगलेंग",
                            		"Mokokchung" : "मोकोकचुंग",
                            		"Mon" : "मोन",
                            		"Peren" : "पेरेन",
                            		"Phek" : "फ़ेक",
                            		"Tuensang" : "तुएनसांग",
                            		"Wokha" : "वोखा",
                            		"Zunheboto" : "जुन्हेबोटो",
                            		"Angul" : "अंगुल",
                            		"Balangir" : "बलांगीर",
                            		"Balasore" : "बालासोर",
                            		"Bargarh" : "बारगढ़",
                            		"Bhadrak" : "भद्रक",
                            		"Boudh" : "बौध",
                            		"Cuttack" : "कटक",
                            		"Deogarh" : "देवगढ़",
                            		"Dhenkanal" : "ढेंकनाल",
                            		"Gajapati" : "गजपति",
                            		"Ganjam" : "गंजम",
                            		"Jagatsinghpur" : "जगतसिंहपुर",
                            		"Jajpur" : "जाजपुर",
                            		"Jharsuguda" : "झारसुगुडा",
                            		"Kalahandi" : "कालाहांडी",
                            		"Kandhamal" : "कंधमाल",
                            		"Kendrapara" : "केंद्रपाड़ा",
                            		"Kendujhar" : "केंदुझार",
                            		"Khordha" : "Khordha",
                            		"Koraput" : "कोरापुट",
                            		"Malkangiri" : "मल्कानगिरी",
                            		"Mayurbhanj" : "मयूरभंज",
                            		"Nabarangapur" : "नबरंगपुर",
                            		"Nayagarh" : "नयागढ़",
                            		"Nuapada" : "नुआपाड़ा",
                            		"Puri" : "पुरी",
                            		"Rayagada" : "रायगढ़",
                            		"Sambalpur" : "संबलपुर",
                            		"Subarnapur" : "सुबर्णपुर",
                            		"Sundargarh" : "सुंदरगढ़",
                            		"Amritsar" : "अमृतसर",
                            		"Barnala" : "बरनाला",
                            		"Bathinda" : "बठिंडा",
                            		"Faridkot" : "फरीदकोट",
                            		"Fatehgarh Sahib" : "फतेहगढ़ साहिब",
                            		"Fazilka" : "फाजिल्का",
                            		"Ferozepur" : "फिरोजपुर",
                            		"Gurdaspur" : "गुरदासपुर",
                            		"Hoshiarpur" : "होशियारपुर",
                            		"Jalandhar" : "जालंधर",
                            		"Kapurthala" : "कपूरथला",
                            		"Ludhiana" : "लुधियाना",
                            		"Mansa" : "मनसा",
                            		"Moga" : "मोगा",
                            		"Pathankot" : "पठानकोट",
                            		"Patiala" : "पटियाला",
                            		"Rupnagar" : "रूपनगर",
                            		"S.A.S. Nagar" : "एस.ए.एस. नगर",
                            		"Sangrur" : "संगरुर",
                            		"Shahid Bhagat Singh Nagar" : "शहीद भगत सिंह नगर",
                            		"Sri Muktsar Sahib" : "श्री मुक्तसर साहिब",
                            		"Tarn Taran" : "तरनतारन",
                            		"Karaikal" : "कराईकल",
                            		"Mahe" : "माहे",
                            		"Puducherry" : "पुडुचेरी",
                            		"Yanam" : "यानम",
                            		"Ajmer" : "अजमेर",
                            		"Alwar" : "अलवर",
                            		"Banswara" : "बांसवाड़ा",
                            		"Baran" : "बाराँ",
                            		"Barmer" : "बाड़मेर",
                            		"Bharatpur" : "भरतपुर",
                            		"Bhilwara" : "भीलवाड़ा",
                            		"Bikaner" : "बीकानेर",
                            		"BSF Camp" : "बीएसएफ कैंप",
                            		"Bundi" : "बूंदी",
                            		"Chittorgarh" : "चित्तौड़गढ़",
                            		"Churu" : "चुरू",
                            		"Dausa" : "दौसा",
                            		"Dholpur" : "धौलपुर",
                            		"Dungarpur" : "डूंगरपुर",
                            		"Evacuees" : "Evacuees",
                            		"Ganganagar" : "गंगानगर",
                            		"Hanumangarh" : "हनुमानगढ़",
                            		"Italians" : "इटली",
                            		"Jaipur" : "जयपुर",
                            		"Jaisalmer" : "जैसलमेर",
                            		"Jalore" : "जालोर",
                            		"Jhalawar" : "झालावाड़",
                            		"Jhunjhunu" : "झुंझुनू",
                            		"Jodhpur" : "जोधपुर",
                            		"Karauli" : "करौली",
                            		"Kota" : "कोटा",
                            		"Nagaur" : "नागौर",
                            		"Pali" : "पाली",
                            		"Pratapgarh" : "प्रतापगढ़",
                            		"Rajsamand" : "राजसमंद",
                            		"Sawai Madhopur" : "सवाई माधोपुर",
                            		"Sikar" : "सीकर",
                            		"Sirohi" : "सिरोही",
                            		"Tonk" : "टोंक",
                            		"Udaipur" : "उदयपुर",
                            		"East District" : "पूर्व जिला",
                            		"North District" : "उत्तर जिला",
                            		"South District" : "दक्षिण जिला",
                            		"West District" : "पश्चिम जिला",
                            		"Adilabad" : "आदिलाबाद",
                            		"Bhadradri Kothagudem" : "भद्राद्री कोठगुदेम",
                            		"Hyderabad" : "हैदराबाद",
                            		"Jagtial" : "जगित्याल",
                            		"Jangaon" : "जनगांव",
                            		"Jayashankar Bhupalapally" : "जयशंकर भूपालपल्ली",
                            		"Jogulamba Gadwal" : "जोगुलम्बा गडवाल",
                            		"Kamareddy" : "Kamareddy",
                            		"Karimnagar" : "करीमनगर",
                            		"Khammam" : "खम्मम",
                            		"Komaram Bheem" : "कोमाराम भीम",
                            		"Mahabubabad" : "महबुबाबाद",
                            		"Mahabubnagar" : "महबूबनगर",
                            		"Mancherial" : "मंचेरियल",
                            		"Medak" : "मेडक",
                            		"Medchal Malkajgiri" : "मेडचल मल्कजगिरी",
                            		"Mulugu" : "Mulugu",
                            		"Nagarkurnool" : "नगरकुरनूल",
                            		"Nalgonda" : "नलगोंडा",
                            		"Narayanpet" : "नारायणपेट",
                            		"Nirmal" : "निर्मल",
                            		"Nizamabad" : "निजामाबाद",
                            		"Peddapalli" : "पेद्दापल्ली",
                            		"Rajanna Sircilla" : "राजन्ना सिरसिला",
                            		"Ranga Reddy" : "रंगा रेड्डी",
                            		"Sangareddy" : "संगारेड्डी",
                            		"Siddipet" : "सिद्दीपेट",
                            		"Suryapet" : "सूर्यापेट",
                            		"Vikarabad" : "विकाराबाद",
                            		"Wanaparthy" : "वानपर्ति",
                            		"Warangal Rural" : "वारंगल ग्रामीण",
                            		"Warangal Urban" : "वारंगल अर्बन",
                            		"Yadadri Bhuvanagiri" : "यदाद्री भुवनगिरि",
                            		"Airport Quarantine" : "एयरपोर्ट क्वारंटाइन",
                            		"Ariyalur" : "अरियालुर",
                            		"Chengalpattu" : "चेंगलपट्टू",
                            		"Chennai" : "चेन्नई",
                            		"Coimbatore" : "कोयंबटूर",
                            		"Cuddalore" : "कुड्डालोर",
                            		"Dharmapuri" : "धर्मपुरी",
                            		"Dindigul" : "डिंडीगुल",
                            		"Erode" : "इरोड",
                            		"Kallakurichi" : "कल्लाकुरिची",
                            		"Kancheepuram" : "कांचीपुरम",
                            		"Kanyakumari" : "कन्याकूमारी",
                            		"Karur" : "करूर",
                            		"Krishnagiri" : "कृष्णागिरी",
                            		"Madurai" : "मदुरै",
                            		"Nagapattinam" : "नागपट्टिनम",
                            		"Namakkal" : "नमक्कल",
                            		"Nilgiris" : "नीलगिरी",
                            		"Perambalur" : "पेरम्बलुर",
                            		"Pudukkottai" : "पुदुक्कोट्टई",
                            		"Ramanathapuram" : "रामनाथपुरम",
                            		"Ranipet" : "रानीपेट",
                            		"Salem" : "सलेम",
                            		"Sivaganga" : "शिवगंगा",
                            		"Tenkasi" : "तेनकाशी",
                            		"Thanjavur" : "तंजावुर",
                            		"Theni" : "फिर म",
                            		"Thiruvallur" : "तिरुवल्लुर",
                            		"Thiruvarur" : "थिरुवरुर",
                            		"Thoothukkudi" : "तूतुकुड़ी",
                            		"Tiruchirappalli" : "तिरुचिरापल्ली",
                            		"Tirunelveli" : "तिरुनेलवेली",
                            		"Tirupathur" : "तिरुपत्तुर",
                            		"Tiruppur" : "तिरुपूर",
                            		"Tiruvannamalai" : "तिरुवन्नामलाई",
                            		"Vellore" : "वेल्लोर",
                            		"Viluppuram" : "विलुप्पुरम",
                            		"Virudhunagar" : "विरुधुनगर",
                            		"Dhalai" : "धलाई",
                            		"Gomati" : "गोमती",
                            		"Khowai" : "खोवाई",
                            		"North Tripura" : "उत्तर त्रिपुरा",
                            		"Sipahijala" : "सिपाहीजाला",
                            		"South Tripura" : "दक्षिण त्रिपुरा",
                            		"Unokoti" : "Unokoti",
                            		"West Tripura" : "पश्चिम त्रिपुरा",
                            		"Agra" : "आगरा",
                            		"Aligarh" : "अलीगढ़",
                            		"Ambedkar Nagar" : "अम्बेडकर नगर",
                            		"Amethi" : "अमेठी",
                            		"Amroha" : "अमरोहा",
                            		"Auraiya" : "औरैया",
                            		"Ayodhya" : "अयोध्या",
                            		"Azamgarh" : "आजमगढ़",
                            		"Baghpat" : "बागपत",
                            		"Bahraich" : "बहराइच",
                            		"Ballia" : "बलिया",
                            		"Balrampur" : "बलरामपुर",
                            		"Banda" : "बांदा",
                            		"Barabanki" : "बाराबंकी",
                            		"Bareilly" : "बरेली",
                            		"Basti" : "बस्ती",
                            		"Bhadohi" : "भदोही",
                            		"Bijnor" : "बिजनौर",
                            		"Budaun" : "बुदौन",
                            		"Bulandshahr" : "बुलंदशहर",
                            		"Chandauli" : "चंदौली",
                            		"Chitrakoot" : "चित्रकूट",
                            		"Deoria" : "देवरिया",
                            		"Etah" : "एटा",
                            		"Etawah" : "इटावा",
                            		"Farrukhabad" : "फर्रुखाबाद",
                            		"Fatehpur" : "फतेहपुर",
                            		"Firozabad" : "फिरोजाबाद",
                            		"Gautam Buddha Nagar" : "गौतम बुद्ध नगर",
                            		"Ghaziabad" : "गाज़ियाबाद",
                            		"Ghazipur" : "गाजीपुर",
                            		"Gonda" : "गोंडा",
                            		"Gorakhpur" : "गोरखपुर",
                            		"Hamirpur" : "हमीरपुर",
                            		"Hapur" : "हापुड़",
                            		"Hardoi" : "हरदोई",
                            		"Hathras" : "हाथरस",
                            		"Jalaun" : "जालौन",
                            		"Jaunpur" : "जौनपुर",
                            		"Jhansi" : "झांसी",
                            		"Kannauj" : "कन्नौज",
                            		"Kanpur Dehat" : "कानपुर देहात",
                            		"Kanpur Nagar" : "कानपुर नगर",
                            		"Kasganj" : "कासगंज",
                            		"Kaushambi" : "कौशाम्बी",
                            		"Kushinagar" : "कुशीनगर",
                            		"Lakhimpur Kheri" : "लखीमपुर खीरी",
                            		"Lalitpur" : "ललितपुर",
                            		"Lucknow" : "लखनऊ",
                            		"Maharajganj" : "महाराजगंज",
                            		"Mahoba" : "महोबा",
                            		"Mainpuri" : "मैनपुरी",
                            		"Mathura" : "मथुरा",
                            		"Mau" : "मऊ",
                            		"Meerut" : "मेरठ",
                            		"Mirzapur" : "मिर्जापुर",
                            		"Moradabad" : "मुरादाबाद",
                            		"Muzaffarnagar" : "मुजफ्फरनगर",
                            		"Pilibhit" : "पीलीभीत",
                            		"Pratapgarh" : "प्रतापगढ़",
                            		"Prayagraj" : "प्रयागराज",
                            		"Rae Bareli" : "रायबरेली",
                            		"Rampur" : "रामपुर",
                            		"Saharanpur" : "सहारनपुर",
                            		"Sambhal" : "संभल",
                            		"Sant Kabir Nagar" : "संत कबीर नगर",
                            		"Shahjahanpur" : "शाहजहांपुर",
                            		"Shamli" : "शामली",
                            		"Shrawasti" : "श्रावस्ती",
                            		"Siddharthnagar" : "सिद्धार्थनगर",
                            		"Sitapur" : "सीतापुर",
                            		"Sonbhadra" : "सोनभद्र",
                            		"Sultanpur" : "सुल्तानपुर",
                            		"Unnao" : "उन्नाव",
                            		"Varanasi" : "वाराणसी",
                            		"Almora" : "अल्मोड़ा",
                            		"Bageshwar" : "बागेश्वर",
                            		"Chamoli" : "चमोली",
                            		"Champawat" : "चम्पावत",
                            		"Dehradun" : "देहरादून",
                            		"Haridwar" : "हरिद्वार",
                            		"Nainital" : "नैनीताल",
                            		"Pauri Garhwal" : "पौड़ी गढ़वाल",
                            		"Pithoragarh" : "पिथोरागढ़",
                            		"Rudraprayag" : "रुद्रप्रयाग",
                            		"Tehri Garhwal" : "टिहरी गढ़वाल",
                            		"Udham Singh Nagar" : "उधम सिंह नगर",
                            		"Uttarkashi" : "उत्तरकाशी",
                            		"Alipurduar" : "अलीपुरद्वार",
                            		"Bankura" : "बांकुड़ा",
                            		"Birbhum" : "बीरभूम",
                            		"Cooch Behar" : "कूच बिहार",
                            		"Dakshin Dinajpur" : "दक्षिण दिनाजपुर",
                            		"Darjeeling" : "दार्जिलिंग",
                            		"Hooghly" : "हुगली",
                            		"Howrah" : "हावड़ा",
                            		"Jalpaiguri" : "जलपाईगुड़ी",
                            		"Jhargram" : "झारग्राम",
                            		"Kalimpong" : "कलिम्पोंग",
                            		"Kolkata" : "कोलकाता",
                            		"Malda" : "मालदा",
                            		"Murshidabad" : "मुर्शिदाबाद",
                            		"Nadia" : "नादिया",
                            		"North 24 Parganas" : "उत्तर 24 परगना",
                            		"Paschim Bardhaman" : "पस्चिम बर्धमान",
                            		"Paschim Medinipur" : "पासीम मेदिनीपुर",
                            		"Purba Bardhaman" : "पूर्बा बर्धमान",
                            		"Purba Medinipur" : "पूर्बा मेदिनीपुर",
                            		"Purulia" : "पुरुलिया",
                            		"South 24 Parganas" : "दक्षिण 24 परगना",
                            		"Uttar Dinajpur" : "उत्तर दिनाजपुर"
                            	};
                            	// next is 13 jharkhand
                                //this._district.set_text(districtnamehi[distct.district]);
                                this._district.set_text((districtnamehi[distct.district]) ? districtnamehi[distct.district] : distct.district);
                                this._districtDetails.set_text("सक्रिय: " + distct.active + " \nपुष्टीकृत: " + distct.confirmed + "\nरोगमुक्त: " + distct.recovered + "\nमृतक: " + distct.deceased);
                                this.districtfound = true;
                            }
                        });
                    }
                });
                if (this.districtfound === false) {
                    this._districtDetails.set_text("सक्रिय: " + "अज्ञात" + " \nपुष्टीकृत: " + "अज्ञात" + "\nरोगमुक्त: " + "अज्ञात" + "\nमृतक: " + "अज्ञात");
                    this._district.set_text(this.mydistrict + ": राज्य में नहीं");
                };
                this.refreshZonehi();
            }
        });
    },



    refreshdistricten() {
        this.getJSON("https://api.covid19india.org/v2/state_district_wise.json", function(jsonDistricten) {
            if (jsonDistricten !== "") {
                this.districtfound = false;
                jsonDistricten.forEach((statecden) => {
                    if (statecden.statecode === this.mystate) {
                        statecden.districtData.forEach((distcten) => {
                            if (distcten.district.toLowerCase() === this.mydistrict.toLowerCase()) {

                                this._districtDetails.set_text("Active: " + distcten.active + " \nConfirmed: " + distcten.confirmed + "\nRecovered: " + distcten.recovered + "\nDeceased: " + distcten.deceased);
                                this._district.set_text(distcten.district);
                                this.districtfound = true;
                            }
                        });
                    }
                });


                if (this.districtfound === false) {
                    this._districtDetails.set_text("Active: " + "Unknown" + " \nConfirmed: " + "Unknown" + "\nRecovered: " + "Unknown" + "\nDeceased: " + "Unknown");
                    this._district.set_text(this.mydistrict + ": Not found in state");
                }
                this.refreshZoneen();
            }
        });
    },

    refreshStats() {
        if (this.langdl === "hi") {
            this.refreshStatshi();
        } else {
            this.refreshStatsen();
        }
    },

    update() {
        this.refreshStats();
        this.timeout = Mainloop.timeout_add_seconds(900, Lang.bind(this, this.update));
    },

    on_setting_changed() {
        this.setupUI();
        this.refreshStats();
    },

    on_desklet_removed: function() {
        Mainloop.source_remove(this.timeout);
    }
}

function main(metadata, deskletId) {
    let desklet = new MyDesklet(metadata, deskletId);
    return desklet;
}