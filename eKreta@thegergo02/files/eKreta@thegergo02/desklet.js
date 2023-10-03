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
const ByteArray = imports.byteArray;

//Constant strings
const API_LINK_INST = "https://kretaglobalmobileapi.ekreta.hu/api/v1/Institute";
const UUID = "eKreta@thegergo02";

//Some variable initialization
var httpSession;
if (Soup.MAJOR_VERSION === 2) {
    httpSession = new Soup.SessionAsync();
    Soup.Session.prototype.add_feature.call(httpSession, new Soup.ProxyResolverDefault());
} else {
    httpSession = new Soup.Session();
}

var isSettingChangedRunning = true;

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
        this.settings.bind("gzip_enabled", "gzipEnabled", this.onSettingChanged);
        // Grade averages
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
        // Grades
        this.settings.bind("show_grade_panel", "showGradePanel", this.onSettingChanged);
        this.settings.bind("group_grades_sub", "groupGradesSub", this.onSettingChanged);
        //Absences
        this.settings.bind("show_absences", "showAbsences", this.onSettingChanged);
        this.settings.bind("sort_absences", "sortAbsences", this.onSettingChanged);
        //Lessons
        this.settings.bind("show_lessons", "showLessons", this.onSettingChanged);
        this.settings.bind("show_filtered_days", "showFilteredDays", this.onSettingChanged);
        
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
            upperThis.curAuthToken = result;
            upperThis.getStudentDetails(upperThis.instID,upperThis.curAuthToken,function(result, upperThis) {
                upperThis.curStudentDetails = result;
                if (!upperThis.showLessons) {
                    upperThis.setupUI(result,null);
                } else {
                    upperThis.getCurrentWeek(function(StartDate,EndDate,upperThis) {
                        var startDate = StartDate.getFullYear() + "-" + ((StartDate.getMonth() == 0) ? "01" : StartDate.getMonth()) + "-" + ((StartDate.getDate() < 10) ? "0" + StartDate.getDate() : StartDate.getDate());
                        var endDate = EndDate.getFullYear() + "-" + ((EndDate.getMonth() == 0) ? "01" : EndDate.getMonth()) + "-" + ((EndDate.getDate() < 10) ? "0" + EndDate.getDate() : EndDate.getDate());
                        
                        upperThis.getLessons(upperThis.curAuthToken,upperThis.instID,startDate, endDate,function(result,upperThis) {
                            for (let i = 0; i < result.length; i++) {
                                var n = result[i]["Date"].lastIndexOf('T');
                                result[i]["Date"] = result[i]["Date"].substring(0,n);
                            }
                            result["EndDate"] = endDate;
                            upperThis.setupUI(upperThis.curStudentDetails,result);
                        });
                }, upperThis);
                }
                isSettingChangedRunning = false;
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
        this.updateLoop = Mainloop.timeout_add(this.delayMinutes * 60 * 1000, Lang.bind(this, this.onUpdate));
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
        }
        return;
    },

    //UI creator function
    /*
        This creates the user interface for our desklet,
        so it's an important function. 
    */
    setupUI(studentDetails,lessonDetails) {
        this.window = new St.BoxLayout({
            vertical: true,
            style_class: "container"
        });

        if (studentDetails === "cantgetauth") {
            this.bigText = new St.Label({style_class: "boldLabel"});
            this.bigText.set_text(_("Error: Couldn't login with the credetinals given. (Check the desklet settings.)"));

            this.window.add(this.bigText);
            this.setContent(this.window);
            return;
        }

        var studentName = studentDetails["Name"]
        var studentInstituteName = studentDetails["InstituteName"];
        var studentSubjectAverages = studentDetails["SubjectAverages"];

        this.nameText = new St.Label({style_class: "normalLabel"});
        this.nameText.set_text(studentName + " (" + studentInstituteName + ")");
        this.window.add(this.nameText);

        this.panelText = new St.Label({style_class: "boldLabel"});

        if (this.showGrades) {
            this.panelText.set_text("Grade averages");
            this.window.add(this.panelText);

            if (this.groupSubCateg) {
                this.fetchSubjectsFromResponse(studentSubjectAverages,"SubjectCategoryName", function(result, upperThis) {
                    upperThis.subjects = result;
                });
                var subjectCategories = this.subjects;

                for(let j = 0; j < subjectCategories.length; j++) {
                    this.currentSubjectText = new St.Label({style_class: "boldLabel"});
                    this.currentSubjectText.set_text(subjectCategories[j]);
                    this.window.add(this.currentSubjectText);
                    for(let i = 0; i < studentDetails["SubjectAverages"].length; i++) {
                        var gradeAverage = studentSubjectAverages[i]["Value"];
                        var subjectName = studentSubjectAverages[i]["Subject"];
                        var classAverage = studentSubjectAverages[i]["ClassValue"];
                        var subjectCategoryName = studentSubjectAverages[i]["SubjectCategoryName"];

                        if (subjectCategoryName === subjectCategories[j]) {
                            this.getGradeColor(gradeAverage,function(result,upperThis) {
                                upperThis.gradeColor = result;
                            });
        
                            this.currentText = new St.Label({style_class: this.gradeColor});
                            this.currentSubText = subjectName + ": " + gradeAverage;
        
                            if (this.showClassAv) {
                                this.currentSubText += " (Class Av.: " + classAverage +")";
        
                                if (this.showGradeDiff) {
                                    this.getClassGradeDiff(gradeAverage, classAverage, function(result, upperThis) {
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
        } else if (this.showGradePanel) {
            this.panelText.set_text("Your grades");
            this.window.add(this.panelText);

            if (this.groupGradesSub) {
                this.fetchSubjectsFromResponse(studentDetails["Evaluations"],"Subject", function(result, upperThis) {
                    upperThis.subjects = result;
                });
                var subjects = this.subjects;

                for (let j = 0; j < subjects.length; j++) {
                    var subjectText = new St.Label({style_class: "boldLabel"});
                    subjectText.set_text(subjects[j]);
                    this.window.add(subjectText);
                    for (let i = 0; i < studentDetails["Evaluations"].length; i++) {
                        var gradeSubject = studentDetails["Evaluations"][i]["Subject"];
                        if (gradeSubject === subjects[j]) {
                            var gradeForm = studentDetails["Evaluations"][i]["Form"];
                            var gradeMode = studentDetails["Evaluations"][i]["Mode"];
                            var gradeTheme = studentDetails["Evaluations"][i]["Theme"];
                            var gradeNumValue = studentDetails["Evaluations"][i]["NumberValue"];
                            var gradeTypeName = studentDetails["Evaluations"][i]["TypeName"];
                            var gradeValue = studentDetails["Evaluations"][i]["Value"];
            
                            if (gradeNumValue !== null) {
                                this.getGradeColor(gradeNumValue,function(result,upperThis) {
                                    upperThis.gradeColour = result;
                                });
                            }
            
                            if (gradeForm !== "Diligence" && gradeForm !== "Deportment") {
                                if (gradeTheme !== "" && gradeTheme !== null) {
                                    var evaluationString = gradeSubject  + " : " + gradeMode + " : " + gradeTheme + " : " + gradeNumValue;
                                } else {
                                    var evaluationString = gradeSubject  + " : " + gradeMode + " : " + gradeNumValue;
                                }
                                var currentText = new St.Label({style_class: this.gradeColour});
            
                                currentText.set_text(evaluationString);
                                this.window.add(currentText);
                            } else {
                                var evaluationString = gradeForm + " : " + gradeTypeName + " : " + gradeValue;
                                var currentText = new St.Label({style_class: "normalLabel"});
            
                                currentText.set_text(evaluationString);
                                this.window.add(currentText);
                            }
                        }
                    }
                }
            } else {
                for (let i = 0; i < studentDetails["Evaluations"].length; i++) {
                    var gradeForm = studentDetails["Evaluations"][i]["Form"];
                    var gradeSubject = studentDetails["Evaluations"][i]["Subject"];
                    var gradeMode = studentDetails["Evaluations"][i]["Mode"];
                    var gradeTheme = studentDetails["Evaluations"][i]["Theme"];
                    var gradeNumValue = studentDetails["Evaluations"][i]["NumberValue"];
                    var gradeTypeName = studentDetails["Evaluations"][i]["TypeName"];
                    var gradeValue = studentDetails["Evaluations"][i]["Value"];
    
                    if (gradeNumValue !== null) {
                        this.getGradeColor(gradeNumValue,function(result,upperThis) {
                            upperThis.gradeColour = result;
                        });
                    }
    
                    if (gradeForm !== "Diligence" && gradeForm !== "Deportment") {
                        if (gradeTheme !== "" && gradeTheme !== null) {
                            var evaluationString = gradeSubject  + " : " + gradeMode + " : " + gradeTheme + " : " + gradeNumValue;
                        } else {
                            var evaluationString = gradeSubject  + " : " + gradeMode + " : " + gradeNumValue;
                        }
                        var currentText = new St.Label({style_class: this.gradeColour});
    
                        currentText.set_text(evaluationString);
                        this.window.add(currentText);
                    } else {
                        var evaluationString = gradeForm + " : " + gradeTypeName + " : " + gradeValue;
                        var currentText = new St.Label({style_class: "normalLabel"});
    
                        currentText.set_text(evaluationString);
                        this.window.add(currentText);
                    }
                }
            }
        } else if (this.showAbsences) {
            this.panelText.set_text("Absences");
            this.window.add(this.panelText);
            if (this.sortAbsences) {
                this.fetchSubjectsFromResponse(studentDetails["Absences"],"Subject", function(result, upperThis) {
                    upperThis.subjects = result;
                });

                var subjects = this.subjects;

                for (let j = 0; j < subjects.length;j++) {
                    var curSubjectText = new St.Label({style_class: "boldLabel"});
                    curSubjectText.set_text(subjects[j]);
                    this.window.add(curSubjectText);

                    for(let i = 0;i < studentDetails["Absences"].length;i++) {
                        if (studentDetails["Absences"][i]["Subject"] === subjects[j]) {
                            var absenceLessonStartTime = studentDetails["Absences"][i]["LessonStartTime"];
                                var n = absenceLessonStartTime.lastIndexOf('T');
                                absenceLessonStartTime = absenceLessonStartTime.substring(0,n);
        
                            var absenceString = absenceLessonStartTime + " : " + studentDetails["Absences"][i]["TypeName"] + " : " + studentDetails["Absences"][i]["ModeName"] + " : " + studentDetails["Absences"][i]["JustificationStateName"] + " : " + studentDetails["Absences"][i]["JustificationTypeName"];
                            var currentTextColor;
                            if (studentDetails["Absences"][i]["JustificationType"] === "Justified") {
                                currentTextColor = "perfectGrade";
                            } else if (studentDetails["Absences"][i]["JustificationType"] === "UnJustified") {
                                currentTextColor = "reallyBadGrade";
                            } else if (studentDetails["Absences"][i]["JustificationType"] === "Medical") {
                                currentTextColor = "medicalAbsence";
                            }
                            
                            var currentText = new St.Label({style_class: currentTextColor});
                            currentText.set_text(absenceString);
                            this.window.add(currentText);
                        }
                    }
                }
            } else {
                for(let i = 0;i < studentDetails["Absences"].length;i++) {
                    var absenceLessonStartTime = studentDetails["Absences"][i]["LessonStartTime"];
                        var n = absenceLessonStartTime.lastIndexOf('T');
                        absenceLessonStartTime = absenceLessonStartTime.substring(0,n);

                    var absenceString = absenceLessonStartTime + " : " + studentDetails["Absences"][i]["TypeName"] + " : " + studentDetails["Absences"][i]["ModeName"] + " : " + studentDetails["Absences"][i]["JustificationStateName"] + " : " + studentDetails["Absences"][i]["JustificationTypeName"];
                    var currentTextColor;
                    if (studentDetails["Absences"][i]["JustificationType"] === "Justified") {
                        currentTextColor = "perfectGrade";
                    } else if (studentDetails["Absences"][i]["JustificationType"] === "UnJustified") {
                        currentTextColor = "reallyBadGrade";
                    } else if (studentDetails["Absences"][i]["JustificationType"] === "Medical") {
                        currentTextColor = "medicalAbsence";
                    }
                    
                    var currentText = new St.Label({style_class: currentTextColor});
                    currentText.set_text(absenceString);
                    this.window.add(currentText);
                }
            }
        } else if (this.showLessons) {
            this.panelText.set_text("Lessons");
            this.window.add(this.panelText);

            var lastRun = -1;
            for (let j = 0;j <= 6;j++) {
                this.curIterationDay = j;
                this.isCurrentDay(j + 1,function(result, upperThis) {
                    upperThis.getDayStyleClass(result,function(result, upperThis) {
                        upperThis.curIterationDayStyle = result;
                        upperThis.getDayName(upperThis.curIterationDay,function(result, upperThis) {
                            upperThis.dayText = new St.Label({ style_class: upperThis.curIterationDayStyle });
                            upperThis.dayText.set_text(result);
                        });
                    });
                });
                if (!this.showFilteredDays) {
                    this.window.add(this.dayText);
                }
                this.alreadyIn = new Array();
                for (let i = 0; i < lessonDetails.length; i++) {
                    var startDate = new Date(lessonDetails[i]["Date"]);

                    if (startDate < new Date(lessonDetails["EndDate"]) && startDate.getDay() === j + 1 && this.alreadyIn.indexOf(lessonDetails[i]["LessonId"]) === -1) {
                        var n = lessonDetails[i]["StartTime"].lastIndexOf('T');
                        var nE = lessonDetails[i]["EndTime"].lastIndexOf('T');
                        lessonDetails[i]["StartTimeHour"] = lessonDetails[i]["StartTime"].substring(n+1);
                        lessonDetails[i]["EndTimeHour"] = lessonDetails[i]["EndTime"].substring(nE+1);
                        lessonDetails[i]["StartTime"] = lessonDetails[i]["StartTime"].substring(0,n);
                        var lessonText = new St.Label({ style_class: "medicalAbsence" })
                        lessonText.set_text(lessonDetails[i]["Count"] + " : " + lessonDetails[i]["Subject"] + " : " + lessonDetails[i]["StartTimeHour"] + " - " + lessonDetails[i]["EndTimeHour"]);
                        if (lastRun !== j) {
                            this.window.add(this.dayText);
                            lastRun = j;
                        }
                        this.window.add(lessonText);
                    }
                }
            }
        }
        
        this.setContent(this.window);    
    },

    //Auth token fetcher function
    /*
        This function fetches the auth token, 
        with the given login details. 
    */
    getAuthToken(instID, usrN, passW, callbackF) {
        var postParameters = "institute_code=" + instID + "&userName=" + usrN + "&password=" + passW + "&grant_type=password&client_id=919e0c1c-76a2-4646-a2fb-7085bbbf3c56";
        this.httpRequest("POST","https://" + instID + ".e-kreta.hu/idp/api/v1/Token",null,postParameters,function(result,upperThis) {
            callbackF(result["access_token"],upperThis);
        })
    },

    //Student data fetcher function
    /*
        This function fetches the user's data, 
        with the given auth token. 
    */
    getStudentDetails(instID,authToken,callbackF) {
        if (authToken == "cantgetauth") {
            callbackF("cantgetauth", this);
            return;
        }

        this.httpRequest("GET", "https://" + instID + ".e-kreta.hu/mapi/api/v1/Student", [["Authorization", "Bearer " + authToken]], null,function(result,upperThis) {
            callbackF(result,upperThis);
        });
    },

    //Institute fetcher function
    /*
        This function fetches the institutions where KRETA is implemented, 
        the code doesn't use it currently. 
    */
    //TODO: The user can automatically select his/her institution.
    getInstitutes(callbackF) {
        this.httpRequest("GET", API_LINK_INST, [["apiKey", "7856d350-1fda-45f5-822d-e1a2f3f1acf0"]], null, function(result,upperThis) {
            callbackF(result);
        });
    },

    getLessons(authToken,instID,fromDate,toDate,callbackF) {
        this.httpRequest("GET", "https://" + instID + ".e-kreta.hu/mapi/api/v1/Lesson", [["Authorization", "Bearer " + authToken]], "fromDate=" + fromDate + "&toDate=" + toDate, function(result,upperThis) {
            callbackF(result,upperThis);
        });
    },

    //HTTP request creator function
    /*
        This function creates all of our HTTP requests.
    */
    httpRequest(method,url,headers,postParameters,callbackF) {
        var message = Soup.Message.new(
            method,
            url
        );

        if (headers !== null) {
            for (let i = 0;i < headers.length;i++) {
                message.request_headers.append(headers[i][0],headers[i][1]);
            }
        }
        if (this.gzipEnabled)
            message.request_headers.append("Accept-Encoding","gzip");

        if (Soup.MAJOR_VERSION === 2) {
            if (postParameters !== null)
                message.set_request("application/x-www-form-urlencoded",2,postParameters);

            httpSession.queue_message(message,
                Lang.bind(this, function(session, response) {
                    if (response.status_code !== Soup.KnownStatusCode.OK) {
                        global.log(response.status_code + " : " + response.response_body.data);
                        callbackF("cantgetauth", this); //TODO: Correct error value.
                        return;
                    }

                    var result = JSON.parse(message.response_body.data);
                    callbackF(result, this);
                    return;
                })
            );
        } else {
            if (postParameters !== null) {
                const bytes = GLib.Bytes.new(ByteArray.fromString(postParameters));
                message.set_request_body_from_bytes('application/x-www-form-urlencoded', bytes);
            }

            httpSession.send_and_read_async(message, Soup.MessagePriority.NORMAL, null, (session, result) => {
                if (message.get_status() === 200) {
                    try {
                        const bytes = httpSession.send_and_read_finish(result);
                        var result = JSON.parse(ByteArray.toString(bytes.get_data()));
                        callbackF(result, this);
                    } catch (e) {
                        global.log(e)
                        callbackF("cantgetauth", this);
                    }
                } else {
                    global.log(message.get_status() + " : " + message.get_reason_phrase());
                    callbackF("cantgetauth", this); //TODO: Correct error value.
                }
            });
        }
        return
    },

    getDayName(dayNumber,callbackF) {
        switch (dayNumber) {
            case 0: { 
                callbackF(_("Monday"), this); 
                break;
            }
            case 1: { 
                callbackF(_("Tuesday"), this); 
                break;
            }
            case 2: { 
                callbackF(_("Wednesday"), this); 
                break;
            }
            case 3: { 
                callbackF(_("Thursday"), this); 
                break;
            }
            case 4: { 
                callbackF(_("Friday"), this); 
                break;
            }
            case 5: { 
                callbackF(_("Saturday"), this); 
                break;
            }
            case 6: { 
                callbackF(_("Sunday"), this); 
                break;
            }
            default: {
                callbackF(_("Not a day"), this);
            }
        }
    },

    isCurrentDay(dayNumber,callbackF) {
        callbackF(dayNumber == new Date().getDay(), this);
    },

    getDayStyleClass(isCurrentDay, callbackF) {
        if (isCurrentDay)
            callbackF("boldLabel", this);
        else 
            callbackF("normalLabel", this);
    },

    fetchSubjectsFromResponse(array,subjectString,callbackF) {
        var subjects = new Array();
        for(let i = 0; i < array.length; i++) {
            var currentSubject = array[i][subjectString];
            if (subjects.indexOf(currentSubject) === -1 && currentSubject !== null) {
                subjects.push(currentSubject);
            }
        }
        callbackF(subjects, this);
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

    getCurrentWeek(callbackF, upperThis) {
        var today = new Date();
        var day = today.getDay();

        var StartDate = new Date();
        var EndDate = new Date();
        StartDate.setHours(0,0,0,0); EndDate.setHours(0,0,0,0);
        StartDate.setDate(today.getDate()-day);
        EndDate.setDate(today.getDate()-day+6);
        EndDate.setDate(EndDate.getDate()-5);
        callbackF(StartDate,EndDate,upperThis);
        global.log(StartDate + " : " + EndDate);
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

    //When the settings gets changed
    /*
        It reloads the desklet with the new settings.
    */
    onSettingChanged() {
        if (!isSettingChangedRunning) {
            isSettingChangedRunning = true;
            this.removeUpdateTimer();
            this.onUpdate();
        }
    },

    //When the desklet gets removed
    /* 
        It fires when the desklet gets removed,
        and cleans up after it.
    */
    on_desklet_removed() {
        this.removeUpdateTimer();
    }
};

//Calls the desklet.
function main(metadata, desklet_id) {
    return new EKretaDesklet(metadata, desklet_id);
}
