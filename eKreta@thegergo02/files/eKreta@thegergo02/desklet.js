//Imports
const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Clutter = imports.gi.Clutter;
const Soup = imports.gi.Soup;
const Mainloop = imports.mainloop;
const Lang = imports.lang;
const Settings = imports.ui.settings;
const GLib = imports.gi.GLib;
const Gettext = imports.gettext;

//Constant strings
const API_LINK_INST = "https://kretaglobalmobileapi.ekreta.hu/api/v1/Institute";
const UUID = "eKreta@thegergo02";

//Some variable initialization
var httpSession = new Soup.SessionAsync();

//Setting up translations
Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale")
function _(str) {
  return Gettext.dgettext(UUID, str);
}

//Constructor function
function EKretaDesklet(metadata, desklet_id) {
    this._init(metadata, desklet_id);
}

//Desklet
EKretaDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    //Initialization function
    /*
        We start to load up the desklet, 
        it's settings, and start the mainloop creator function. 
    */
    _init(metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);
        this.deskletId = desklet_id;
        this.showLoadingScreen();
        this.setHeader("eKreta");
        this.loadSettings();
        this.onUpdate();
        global.log(UUID + ":" + _("Desklet started."));
    },

    //Settings loader function
    /*
        This function loads in our settings.
    */
    loadSettings() {
        this.settings = new Settings.DeskletSettings(this, this.metadata.uuid, this.deskletId);
        // Settings for eKreta desklet.
        this.settings.bind("inst_id", "instID", this.onSettingChanged);
        this.settings.bind("usr", "usrN", this.onSettingChanged);
        this.settings.bind("pass", "passW", this.onSettingChanged);
        this.settings.bind("delay_minutes", "delayMinutes", this.onSettingChanged);
        // Grades
        this.settings.bind("show_grades", "showGrades", this.onSettingChanged);
        this.settings.bind("group_sub_categ", "groupSubCateg", this.onSettingChanged);
        this.settings.bind("show_class_av", "showClassAv", this.onSettingChanged);
        this.settings.bind("show_grade_diff", "showGradeDiff", this.onSettingChanged);
        this.settings.bind("perfect_grade_value", "perfectGradeValue", this.onSettingChanged);
        this.settings.bind("almost_perfect_grade_value", "almostPerfectGradeValue", this.onSettingChanged);
        this.settings.bind("perfect_grade_value", "perfectGradeValue", this.onSettingChanged);
        this.settings.bind("good_grade_value", "goodGradeValue", this.onSettingChanged);
        this.settings.bind("middle_grade_value", "middleGradeValue", this.onSettingChanged);
        this.settings.bind("bad_grade_value", "badGradeValue", this.onSettingChanged);
        this.settings.bind("really_bad_grade_value", "reallyBadGradeValue", this.onSettingChanged);
        global.log(UUID + ":" + _("Loaded settings."));
        return;
    },

    //Data updater function
    /*
        This function gets a new auth token, 
        with it the current data from the KRETA servers.
    */
    updateData() {
        this.showLoadingScreen();
        this.getAuthToken(this.instID, this.usrN, this.passW, function(result, upperThis) {
            upperThis.getStudentDetails(upperThis.instID,result,function(result, upperThis) {
                upperThis.setupUI(result);
            });
        });
        return;
    },

    //onUpdate() function
    /*
        This function gets called in time intervals, 
        this reloads the data and sets up the UI with the new data. 
    */
    onUpdate() {
        global.log(UUID + ":" + _("onUpdate() got called."));
        this.setUpdateTimer();
        this.updateData();
        return;
    },
    
    //Mainloop creator function
    /*
        This function creates the mainloop,
        and with it we fetch the current data, 
    */
    setUpdateTimer() {
        global.log(UUID + ":" + _("setUpdateTimer() got called."));
        this.updateLoop = Mainloop.timeout_add(this.delayMinutes * 60 * 1000, Lang.bind(this, this.onUpdate));
        global.log(UUID + ":" + _("Setting up mainloop (for " + this.delayMinutes + " min), and binding onUpdate() to it."));
        return;
    },

    //Mainloop remover function
    /*
        This function removes the mainloop 
        when we don't need it. 
    */
    removeUpdateTimer() {
        if (this.updateLoop !== null) {
            Mainloop.source_remove(this.updateLoop);
            global.log(UUID + ":" + _("Removing Mainloop."));
        }
        return;
    },

    //UI creator function
    /*
        This creates the user interface for our desklet,
        so it's an important function. 
    */
    setupUI(studentDetails) {
        this.window = new St.BoxLayout({
            vertical: true,
            style_class: "container"
        });

        if (studentDetails === "cantgetauth") {
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
                        this.gradeAverage = studentDetails["SubjectAverages"][i]["Value"];
                        this.subjectName = studentDetails["SubjectAverages"][i]["Subject"];
                        this.classAverage = studentDetails["SubjectAverages"][i]["ClassValue"];

                        if (studentDetails["SubjectAverages"][i]["SubjectCategoryName"] === subjectCategories[j]) {
                            this.getGradeColor(this.gradeAverage,function(result,upperThis) {
                                upperThis.gradeColor = result;
                            });
        
                            this.currentText = new St.Label({style_class: this.gradeColor});
                            this.currentSubText = this.subjectName + ": " + this.gradeAverage;
        
                            if (this.showClassAv) {
                                this.currentSubText += " (Class Av.: " + this.classAverage +")";
        
                                if (this.showGradeDiff) {
                                    this.getClassGradeDiff(this.gradeAverage, this.classAverage, function(result, upperThis) {
                                        upperThis.currentSubText += result;
                                    });
                                }
                            }

                            this.currentText.set_text(this.currentSubText);
                            this.window.add(this.currentText);
                        }
                    }
                }
            } else {
                for(let i = 0; i < studentDetails["SubjectAverages"].length; i++) {
                    this.gradeAverage = studentDetails["SubjectAverages"][i]["Value"];
                    this.subjectName = studentDetails["SubjectAverages"][i]["Subject"];
                    this.classAverage = studentDetails["SubjectAverages"][i]["ClassValue"];

                    this.getGradeColor(this.gradeAverage,function(result,upperThis) {
                        upperThis.gradeColor = result;
                    });

                    this.currentText = new St.Label({style_class: this.gradeColor});
                    this.currentSubText = this.subjectName + ": " + this.gradeAverage;

                    if (this.showClassAv) {
                        this.currentSubText += " (Class Av.: " + this.classAverage +")";

                        if (this.showGradeDiff) {
                            this.getClassGradeDiff(this.gradeAverage, this.classAverage, function(result, upperThis) {
                                upperThis.currentSubText += result;
                            });
                        }
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

    //Auth token fetcher function
    /*
        This function fetches the auth token, 
        with the given login details. 
    */
    getAuthToken(instID, usrN, passW, callbackF) {
        global.log(UUID + ":" + _("Setting up a POST request in getAuthToken()."));
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
                    global.log(UUID + ":" + _("Getting auth token failed, passing 'cantgetauth'."));
                    callbackF('cantgetauth', this);
                    return;
                }
                var result = JSON.parse(message.response_body.data);
                global.log(UUID + ":" + _("Got correct response in getAuthToken()."));
                callbackF(result["access_token"], this);
                return;
            })
        );
    },

    //Student data fetcher function
    /*
        This function fetches the user's data, 
        with the given auth token. 
    */
    getStudentDetails(instID,authToken,callbackF) {
        if (authToken == "cantgetauth") {
            global.log(UUID + ":" + _("getStudentDetails() aknowledged that the auth token doesn't exist, passing 'cantgetauth' value."));
            callbackF("cantgetauth", this);
            return;
        }

        global.log(UUID + ":" + _("Setting up a GET request in getStudentDetails()."));
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
                    callbackF("cantgetauth",this); //TODO: Create a correct error value.
                    return;
                }
                var result = JSON.parse(message.response_body.data);
                global.log(UUID + ":" + _("Got correct response in getStudentDetails()."));
                callbackF(result, this);
                return;
            })
        );
    },

    //Institute fetcher function
    /*
        This function fetches the institutions where KRETA is implemented, 
        the code doesn't use it currently. 
    */
    //TODO: The user can automatically select his/her institution.
    getInstitutes(callbackF) {
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
                    callbackF("error", this);
                    return;
                }
    
                var result = JSON.parse(message.response_body.data);
                callbackF(result, this);
                return;
            })
        );
    },

    //Grade coloring mechanism
    /*
        From the grade average, get what range it belongs. 
    */
    getGradeColor(gradeValue, callbackF) {
        if (gradeValue == this.perfectGradeValue) {
            callbackF("perfectGrade", this);
        } else if (gradeValue >= this.almostPerfectGradeValue && gradeValue < this.perfectGradeValue) {
            callbackF("almostPerfectGrade", this);
        } else if (gradeValue >= this.goodGradeValue && gradeValue < this.almostPerfectGradeValue) {
            callbackF("goodGrade", this);
        } else if (gradeValue >= this.middleGradeValue && gradeValue < this.goodGradeValue) {
            callbackF("middleGrade", this);
        } else if (gradeValue >= this.badGradeValue && gradeValue < this.middleGradeValue) {
            callbackF("badGrade", this);
        } else if (gradeValue == this.reallyBadGradeValue){
            callbackF("reallyBadGrade", this);
        } else {
            callbackF("reallyBadGrade", this);
        }
    },

    //Your and class average comparer function
    /*
        Returns how you compare to your class. 
    */
    getClassGradeDiff(gradeAverage, classAverage, callbackF) {
        var diff = +(gradeAverage - classAverage).toFixed(2);
        if (gradeAverage > classAverage) {
            callbackF(" (Your grade is better with: +" + diff +")", this);
        } else if (gradeAverage < classAverage) {
            callbackF(" (Your grade is worse with: -" + diff +")", this);
        } else {
            callbackF(" (Your grade is equal)", this);
        }
    },

    //Loading screen shower function
    /*
        Show the loading screen. 
    */
    showLoadingScreen() {
        this.loadingWindow = new St.BoxLayout({
            vertical: true,
            style_class: "container"
        });
        this.loadingText = new St.Label({style_class: "normalLabel"});
        this.loadingText.set_text("Loading...");
        this.loadingWindow.add(this.loadingText);
        this.setContent(this.loadingWindow)
    },

    //When the desklet gets removed
    /* 
        It fires when the desklet gets removed,
        and cleans up after it.
    */
    on_desklet_removed() {
        this.removeUpdateTimer();
        global.log(UUID + ":" + _("Desklet got removed."));
    }
};

function main(metadata, desklet_id) {
    return new EKretaDesklet(metadata, desklet_id);
}
