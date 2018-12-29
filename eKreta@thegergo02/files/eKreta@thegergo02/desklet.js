const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Clutter = imports.gi.Clutter;
const Soup = imports.gi.Soup;
const Lang = imports.lang;
const Settings = imports.ui.settings;
const GLib = imports.gi.GLib;
const Gettext = imports.gettext;

const API_LINK_INST = "https://kretaglobalmobileapi.ekreta.hu/api/v1/Institute";
const UUID = "eKreta@thegergo02";

var httpSession = new Soup.SessionAsync();

Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale")

function _(str) {
  return Gettext.dgettext(UUID, str);
}

function EKretaDesklet(metadata, desklet_id) {
    this._init(metadata, desklet_id);
}

EKretaDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init(metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);
        global.log(UUID + ":" + _("Desklet started."));
        this.setHeader("eKreta");

        this.settings = new Settings.DeskletSettings(this, this.metadata.uuid, desklet_id);
        // Settings for eKreta desklet.
        this.settings.bind("inst_id", "instID");
        this.settings.bind("usr", "usrN");
        this.settings.bind("pass", "passW");
        // Grades
        this.settings.bind("show_grades", "showGrades");
        this.settings.bind("show_class_av", "showClassAv");
        this.settings.bind("group_sub_categ", "groupSubCateg");
        this.settings.bind("perfect_grade_value", "perfectGradeValue");
        this.settings.bind("almost_perfect_grade_value", "almostPerfectGradeValue");
        this.settings.bind("perfect_grade_value", "perfectGradeValue");
        this.settings.bind("good_grade_value", "goodGradeValue");
        this.settings.bind("middle_grade_value", "middleGradeValue");
        this.settings.bind("bad_grade_value", "badGradeValue");
        this.settings.bind("really_bad_grade_value", "reallyBadGradeValue");

        global.log(UUID + ":" + _("started getAuthToken(x,y,z)."));
        this.getAuthToken(this.instID, this.usrN, this.passW);
    },


    setupUI(studentDetails) {
        this.window = new St.BoxLayout({
            vertical: true,
            style_class: "container"
        });
        if (!studentDetails) {
            this.bigText = new St.Label({style_class: "normalLabel"});
            this.bigText.set_text(_("Error: Couldn't login with the credetinals given. (Check the desklet settings.)"));
            this.window.add(this.bigText);

            this.setContent(this.window);
            return;
        }

        this.bigText = new St.Label({style_class: "normalLabel"});
        this.bigText.set_text(studentDetails.Name + " (" + studentDetails.InstituteName + ")");
        this.window.add(this.bigText);

        if (this.showGrades) {
            if (this.groupSubCateg) {
                let subjectCategories = new Array();
                for(let i = 0; i < studentDetails["SubjectAverages"].length; i++) {
                    if (subjectCategories.indexOf(studentDetails["SubjectAverages"][i]["SubjectCategoryName"]) === -1) {
                        subjectCategories.push(studentDetails["SubjectAverages"][i]["SubjectCategoryName"]);
                    }
                }

                for(let j = 0; j < subjectCategories.length; j++) {
                    this.currentSubjectText = new St.Label({style_class: "boldLabel"});
                    this.currentSubjectText.set_text(subjectCategories[j]);
                    this.window.add(this.currentSubjectText);
                    for(let i = 0; i < studentDetails["SubjectAverages"].length; i++) {
                        if (studentDetails["SubjectAverages"][i]["SubjectCategoryName"] === subjectCategories[j]) {
                            if (studentDetails["SubjectAverages"][i]["Value"] == this.perfectGradeValue) {
                                this.gradeColor = "perfectGrade";
                            } else if (studentDetails["SubjectAverages"][i]["Value"] >= this.almostPerfectGradeValue && studentDetails["SubjectAverages"][i]["Value"] < this.perfectGradeValue) {
                                this.gradeColor = "almostPerfectGrade";
                            } else if (studentDetails["SubjectAverages"][i]["Value"] >= this.goodGradeValue && studentDetails["SubjectAverages"][i]["Value"] < this.almostPerfectGradeValue) {
                                this.gradeColor = "goodGrade";
                            } else if (studentDetails["SubjectAverages"][i]["Value"] >= this.middleGradeValue && studentDetails["SubjectAverages"][i]["Value"] < this.goodGradeValue) {
                                this.gradeColor = "middleGrade";
                            } else if (studentDetails["SubjectAverages"][i]["Value"] >= this.badGradeValue && studentDetails["SubjectAverages"][i]["Value"] < this.middleGradeValue) {
                                this.gradeColor = "badGrade";
                            } else if (studentDetails["SubjectAverages"][i]["Value"] == this.reallyBadGradeValue){
                                this.gradeColor = "reallyBadGrade";
                            } else {
                                this.gradeColor = "reallyBadGrade";
                            }
        
                            this.currentText = new St.Label({style_class: this.gradeColor});
        
                            this.currentSubText = studentDetails["SubjectAverages"][i]["Subject"] + ": " + studentDetails["SubjectAverages"][i]["Value"];
                            if (this.showClassAv) {
                                this.currentSubText += " (Class Av.: " + studentDetails["SubjectAverages"][i]["ClassValue"] +")";
                            }
                            this.currentText.set_text(this.currentSubText);
        
                            this.window.add(this.currentText);
                        }
                    }
                }
            } else {
                for(let i = 0; i < studentDetails["SubjectAverages"].length; i++) {
                    if (studentDetails["SubjectAverages"][i]["Value"] == this.perfectGradeValue) {
                        this.gradeColor = "perfectGrade";
                    } else if (studentDetails["SubjectAverages"][i]["Value"] >= this.almostPerfectGradeValue && studentDetails["SubjectAverages"][i]["Value"] < this.perfectGradeValue) {
                        this.gradeColor = "almostPerfectGrade";
                    } else if (studentDetails["SubjectAverages"][i]["Value"] >= this.goodGradeValue && studentDetails["SubjectAverages"][i]["Value"] < this.almostPerfectGradeValue) {
                        this.gradeColor = "goodGrade";
                    } else if (studentDetails["SubjectAverages"][i]["Value"] >= this.middleGradeValue && studentDetails["SubjectAverages"][i]["Value"] < this.goodGradeValue) {
                        this.gradeColor = "middleGrade";
                    } else if (studentDetails["SubjectAverages"][i]["Value"] >= this.badGradeValue && studentDetails["SubjectAverages"][i]["Value"] < this.middleGradeValue) {
                        this.gradeColor = "badGrade";
                    } else if (studentDetails["SubjectAverages"][i]["Value"] == this.reallyBadGradeValue){
                        this.gradeColor = "reallyBadGrade";
                    } else {
                        this.gradeColor = "reallyBadGrade";
                    }

                    this.currentText = new St.Label({style_class: this.gradeColor});

                    this.currentSubText = studentDetails["SubjectAverages"][i]["Subject"] + ": " + studentDetails["SubjectAverages"][i]["Value"];
                    if (this.showClassAv) {
                        this.currentSubText += " (Class Av.: " + studentDetails["SubjectAverages"][i]["ClassValue"] +")";
                    }
                    this.currentText.set_text(this.currentSubText);

                    this.window.add(this.currentText);
                }
            }
        }
        
        this.setContent(this.window);
        global.log(UUID + ":" + _("UI now ready in setupUI(x)."));
        global.log(UUID + ":" + _("Desklet loaded successfully."));
    },

    getStudentDetails(instID,authToken) {
        if (authToken == "cantgetauth") {
            global.log(UUID + ":" + _("getStudentDetails(x,y) aknowledged that the auth token doesn't exist, calls setupUI(x) with a false value."));
            this.setupUI(false);
            return;
        }
        global.log(UUID + ":" + _("Setting up a GET request in getStudentDetails(x,y)."));
        var message = Soup.Message.new(
            "GET",
            "https://" + instID + ".e-kreta.hu/mapi/api/v1/Student"
        );
        message.request_headers.append("Authorization", "Bearer " + authToken);
    
        httpSession.queue_message(message,
            Lang.bind(this, function(session, response) {
                if (response.status_code !== Soup.KnownStatusCode.OK) {
                    global.log(UUID + ":" + _("Error during download in getStudentDetails()") + ": response code " +
                        response.status_code + ": " + response.reason_phrase + " - " +
                        response.response_body.data);
                    return;
                }
                var result = JSON.parse(message.response_body.data);
                global.log(UUID + ":" + _("Got correct response in getStudentDetails(x,y)."));
                global.log(UUID + ":" + _("Starting setupUI(x)."));
                this.setupUI(result);
                return;
            })
        );
    },

    getAuthToken(instID, usrN, passW) {
        global.log(UUID + ":" + _("Setting up a POST request in getAuthToken(x,y,z)."));
        var message = Soup.Message.new(
            "POST",
            "https://" + instID + ".e-kreta.hu/idp/api/v1/Token"
        );

        var postParameters = "institute_code=" + instID + "&userName=" + usrN + "&password=" + passW + "&grant_type=password&client_id=919e0c1c-76a2-4646-a2fb-7085bbbf3c56";
        message.set_request("application/x-www-form-urlencoded",2,postParameters);

        httpSession.queue_message(message,
            Lang.bind(this, function(session, response) {
                if (response.status_code !== Soup.KnownStatusCode.OK) {
                    global.log(UUID + ":" + _("Error during download in getAuthToken(x,y,z)") + ": response code " +
                        response.status_code + ": " + response.reason_phrase + " - " +
                        response.response_body.data);
                    this.getStudentDetails(instID,"cantgetauth");
                    global.log(UUID + ":" + _("Getting auth token failed, passing 'cantgetauth' to getStudentDetails(x,y)."));
                    return;
                }
                var result = JSON.parse(message.response_body.data);
                global.log(UUID + ":" + _("Got correct response in getAuthToken(x,y,z)."));
                global.log(UUID + ":" + _("Starting getStudentDetails(x,y)."));
                this.getStudentDetails(instID,result["access_token"]);
                return;
            })
        );
    },

    getInstitutes() {
        var message = Soup.Message.new(
            "GET",
            API_LINK_INST
        );
        message.request_headers.append("apiKey", "7856d350-1fda-45f5-822d-e1a2f3f1acf0");
    
        httpSession.queue_message(message,
            Lang.bind(this, function(session, response) {
                if (response.status_code !== Soup.KnownStatusCode.OK) {
                    global.log(_("Error during download getInsitutes()") + ": response code " +
                        response.status_code + ": " + response.reason_phrase + " - " +
                        response.response_body.data);
                    return;
                }
    
                var result = JSON.parse(message.response_body.data);
                return;
            })
        );
    },

    onSettingChanged: function() {
        this.getAuthToken(this.instID, this.usrN, this.passW);
        global.log(UUID + ":" + _("Settings changed, reloading desklet."));
    }
};

function main(metadata, desklet_id) {
    return new EKretaDesklet(metadata, desklet_id);
}
