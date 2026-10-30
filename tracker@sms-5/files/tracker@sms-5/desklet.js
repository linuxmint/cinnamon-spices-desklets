const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Settings = imports.ui.settings;
const Mainloop = imports.mainloop;
const Lang = imports.lang;
const Gettext = imports.gettext;
const GLib = imports.gi.GLib;
const Util = imports.misc.util;
const Clutter = imports.gi.Clutter;
const PopupMenu = imports.ui.popupMenu;
const Cinnamon = imports.gi.Cinnamon;
const Main = imports.ui.main;
const Tooltips = imports.ui.tooltips;


const UUID = "tracker@sms-5";
const DESKLET_ROOT = imports.ui.deskletManager.deskletMeta[UUID].path;

if (!DESKLET_ROOT.startsWith("/usr/share/")) {
    Gettext.bindtextdomain(
        UUID,
        GLib.get_home_dir() + "/.local/share/locale"
    );
}

// Language setting: null follows the system locale, otherwise the catalog
// for that language is read directly (Cinnamon installs po/<lang>.po as
// <locale>/LC_MESSAGES/<uuid>.mo).
let forcedLanguage = null;
let forcedCatalog = null;

function setLanguage(language) {
    if (language === forcedLanguage) return;

    forcedLanguage = language;
    forcedCatalog = null;

    if (language === "en" || language === "es") {
        forcedCatalog = loadCatalog(language);
    }
}

function loadCatalog(language) {
    const dirs = [
        GLib.get_home_dir() + "/.local/share/locale",
        "/usr/share/locale"
    ];

    for (let i = 0; i < dirs.length; i++) {
        let path = dirs[i] + "/" + language + "/LC_MESSAGES/" + UUID + ".mo";

        if (!GLib.file_test(path, GLib.FileTest.EXISTS)) continue;

        let [ok, bytes] = GLib.file_get_contents(path);
        if (!ok) continue;

        let catalog = parseCatalog(bytes);
        if (catalog) return catalog;
    }

    return null;
}

function parseCatalog(bytes) {
    if (bytes.length < 28) return null;

    let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    if (view.getUint32(0, true) !== 0x950412de) return null;

    let count = view.getUint32(8, true);
    let idsOffset = view.getUint32(12, true);
    let stringsOffset = view.getUint32(16, true);
    let decoder = new TextDecoder("utf-8");
    let catalog = Object.create(null);

    for (let i = 0; i < count; i++) {
        let idLength = view.getUint32(idsOffset + i * 8, true);
        let idOffset = view.getUint32(idsOffset + i * 8 + 4, true);
        let textLength = view.getUint32(stringsOffset + i * 8, true);
        let textOffset = view.getUint32(stringsOffset + i * 8 + 4, true);

        if (!idLength || !textLength) continue;

        let id = decoder.decode(bytes.subarray(idOffset, idOffset + idLength));
        catalog[id] = decoder.decode(
            bytes.subarray(textOffset, textOffset + textLength)
        );
    }

    return catalog;
}

function _(str) {
    if (forcedLanguage === "en") return str;
    if (forcedCatalog) return forcedCatalog[str] || str;
    return Gettext.dgettext(UUID, str);
}


class TrackerDesklet extends Desklet.Desklet {

    constructor(metadata, desklet_id) {
        super(metadata, desklet_id);

        this.metadata = metadata;
        this.uuid = metadata.uuid;
        this._instanceId = desklet_id;
        this._timeoutId = null;
        this._editor = null;
        this._editMode = false;
        this._openMenu = null;
        this._lastTitleClick = 0;
        this._taskMenuManager = new PopupMenu.PopupMenuManager(this);

        this.container = new St.BoxLayout({
            vertical: true,
            style_class: "main-container"
        });

        this.setContent(this.container);

        this.actor.reactive = true;

        this.settings = new Settings.DeskletSettings(
            this,
            this.uuid,
            desklet_id
        );

        this.settings.bindProperty(
            Settings.BindingDirection.IN,
            "task-list",
            "taskList",
            Lang.bind(this, this.onSettingsChanged)
        );

        this.settings.bindProperty(
            Settings.BindingDirection.IN,
            "sort-order",
            "sortOrder",
            Lang.bind(this, this.onSettingsChanged)
        );

        this.settings.bindProperty(
            Settings.BindingDirection.IN,
            "hide-completed",
            "hideCompleted",
            Lang.bind(this, this.onSettingsChanged)
        );

        this.settings.bindProperty(
            Settings.BindingDirection.IN,
            "hide-checkbox",
            "hideCheckbox",
            Lang.bind(this, this.onSettingsChanged)
        );

        let appearanceBindings = [
            ["color-preset", "colorPreset"],
            ["background-color", "backgroundColor"],
            ["text-color", "textColor"],
            ["border-color", "borderColor"],
            ["overdue-color", "overdueColor"],
            ["done-opacity", "doneOpacity"],
            ["show-border", "showBorder"],
            ["font-family", "fontFamily"],
            ["font-size", "fontSize"],
            ["show-title", "showTitle"],
            ["show-decoration", "showDecoration"],
            ["title-text", "titleText"],
            ["task-prefix", "taskPrefix"],
            ["confirm-delete", "confirmDelete"],
            ["show-tooltips", "showTooltips"],
            ["language", "language"]
        ];

        for (let binding of appearanceBindings) {
            this.settings.bindProperty(
                Settings.BindingDirection.IN,
                binding[0],
                binding[1],
                Lang.bind(this, this.onSettingsChanged)
            );
        }

        this.updateUI();
        this.startLoop();
    }

    getTasks() {
        return Array.isArray(this.taskList) ? this.taskList : [];
    }

    _getPalette() {
        const presets = {
            green: {
                background: "rgba(0,0,0,0.82)",
                text: "#8dffa8",
                border: "rgba(141,255,168,0.55)",
                overdue: "#ff6b6b"
            },
            amber: {
                background: "rgba(0,0,0,0.85)",
                text: "#ffbf66",
                border: "rgba(255,191,102,0.55)",
                overdue: "#ff6b6b"
            },
            ice: {
                background: "rgba(0,0,0,0.82)",
                text: "#9fd8ff",
                border: "rgba(159,216,255,0.5)",
                overdue: "#ff7b9c"
            }
        };

        if (presets[this.colorPreset]) {
            return presets[this.colorPreset];
        }

        return {
            background: this.backgroundColor || "rgba(0,0,0,0.7)",
            text: this.textColor || "#dddddd",
            border: this.borderColor || "#ffffff",
            overdue: this.overdueColor || "#ff6b6b"
        };
    }

    _getFontFamily() {
        let family =
            typeof this.fontFamily === "string" ? this.fontFamily : "";

        family = family.replace(/[;{}]/g, "").trim();

        return family || "\"Fira Code\", monospace";
    }

    _getFontSize(offset) {
        let size = parseInt(this.fontSize, 10);

        if (!(size > 0)) {
            size = 13;
        }

        return Math.max(8, size + (offset || 0));
    }

    _getDoneOpacity() {
        let value = parseFloat(this.doneOpacity);

        if (!(value >= 0.1 && value <= 1)) {
            value = 0.55;
        }

        return value;
    }

    _styleControl(actor, color, fontOffset) {
        let css = `color: ${color};`;

        if (typeof fontOffset === "number") {
            css += ` font-size: ${this._getFontSize(fontOffset)}px;`;
        }

        actor.set_style(css);
    }

    _addTooltip(actor, text) {
        if (this.showTooltips === false) {
            return;
        }

        new Tooltips.Tooltip(actor, text);
    }

    // Parses "YYYY-MM-DD" (ISO) or legacy "MM-DD" (current year).
    // Returns a local-midnight Date, or null when the value is not a
    // real calendar date. The stored string is never modified.
    parseTaskDate(value) {
        if (typeof value !== "string") return null;

        const text = value.trim();

        if (!text) return null;

        let year;
        let month;
        let day;

        const isoMatch = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);

        if (isoMatch) {
            year = parseInt(isoMatch[1], 10);
            month = parseInt(isoMatch[2], 10);
            day = parseInt(isoMatch[3], 10);
        } else {
            const legacyMatch = text.match(/^(\d{1,2})-(\d{1,2})$/);

            if (!legacyMatch) return null;

            year = new Date().getFullYear();
            month = parseInt(legacyMatch[1], 10);
            day = parseInt(legacyMatch[2], 10);
        }

        if (month < 1 || month > 12 || day < 1 || day > 31) return null;

        const dueDate = new Date(year, month - 1, day);

        const isRealDate =
            dueDate.getFullYear() === year &&
            dueDate.getMonth() === month - 1 &&
            dueDate.getDate() === day;

        if (!isRealDate) return null;

        dueDate.setHours(0, 0, 0, 0);

        return dueDate;
    }

    // Integer number of calendar days until the due date (UTC date-only
    // math avoids DST issues). Returns null for invalid dates.
    calculateDaysLeft(value) {
        const dueDate = this.parseTaskDate(value);

        if (!dueDate) return null;

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const dueUtc = Date.UTC(
            dueDate.getFullYear(),
            dueDate.getMonth(),
            dueDate.getDate()
        );

        const todayUtc = Date.UTC(
            today.getFullYear(),
            today.getMonth(),
            today.getDate()
        );

        return Math.round((dueUtc - todayUtc) / 86400000);
    }

    // Returns a sorted copy of the given task entries ({ task, index }).
    // Completed tasks always go last within a course. Invalid or missing
    // due dates always go last, regardless of the sort direction. The
    // input array is never mutated.
    sortTaskEntries(entries) {
        const list = Array.isArray(entries) ? entries.slice() : [];
        const order = this.sortOrder;
        const direction = order === "due-desc" ? -1 : 1;
        const useDueDate = order === "due-asc" || order === "due-desc";

        const decorated = list.map((entry, position) => ({
            entry,
            position
        }));

        decorated.sort((a, b) => {
            const taskA =
                a.entry && typeof a.entry === "object" ? a.entry.task : null;
            const taskB =
                b.entry && typeof b.entry === "object" ? b.entry.task : null;

            const doneA = !!(taskA && taskA.done === true);
            const doneB = !!(taskB && taskB.done === true);

            if (doneA !== doneB) return doneA ? 1 : -1;

            if (useDueDate) {
                const dateA = this.parseTaskDate(
                    taskA && typeof taskA === "object" ? taskA.date : null
                );
                const dateB = this.parseTaskDate(
                    taskB && typeof taskB === "object" ? taskB.date : null
                );

                if (!dateA && !dateB) return a.position - b.position;
                if (!dateA) return 1;
                if (!dateB) return -1;

                const difference =
                    (dateA.getTime() - dateB.getTime()) * direction;

                if (difference !== 0) return difference;
            }

            return a.position - b.position;
        });

        return decorated.map(item => item.entry);
    }

    formatDisplayDate(value) {
        if (typeof value !== "string" || !value.trim()) return _("No date");

        const dueDate = this.parseTaskDate(value);

        if (!dueDate) return _("Invalid date");

        const months = [
            _("Jan"), _("Feb"), _("Mar"), _("Apr"), _("May"), _("Jun"),
            _("Jul"), _("Aug"), _("Sep"), _("Oct"), _("Nov"), _("Dec")
        ];

        const month = months[dueDate.getMonth()];
        const day = dueDate.getDate();
        const year = dueDate.getFullYear();

        if (year === new Date().getFullYear()) {
            return `${month} ${day}`;
        }

        return `${month} ${day}, ${year}`;
    }

    formatDueLabel(value) {
        if (typeof value !== "string" || !value.trim()) return _("No date");

        const daysLeft = this.calculateDaysLeft(value);

        if (daysLeft === null) return _("Invalid date");
        if (daysLeft === 0) return _("Today");
        if (daysLeft === 1) return _("Tomorrow");
        if (daysLeft === -1) return _("1 day overdue");
        if (daysLeft < -1) {
            return _("%d days overdue").replace("%d", String(-daysLeft));
        }

        return _("In %d days").replace("%d", String(daysLeft));
    }

    updateUI() {
        setLanguage(this.language);

        // Close menus before destroying their source actors.
        this._closeOpenMenu();

        this.container.destroy_all_children();

        this._palette = this._getPalette();

        let border = this.showBorder === false
            ? "0 solid transparent"
            : `1px solid ${this._palette.border}`;

        this.container.set_style(
            `background-color: ${this._palette.background};` +
            ` color: ${this._palette.text};` +
            ` font-family: ${this._getFontFamily()};` +
            ` font-size: ${this._getFontSize(0)}px;` +
            ` border: ${border};`
        );

        // Keep the original settings index with every task entry so edits
        // and toggles target the right row without depending on sort order.
        let allEntries = [];
        let settingsTasks = this.getTasks();

        for (let index = 0; index < settingsTasks.length; index++) {
            let task = settingsTasks[index];

            if (task === null || typeof task !== "object") {
                continue;
            }

            allEntries.push({ task: task, index: index });
        }

        let visibleEntries = allEntries;

        if (this.hideCompleted) {
            visibleEntries = allEntries.filter(
                entry => !entry.task.done
            );
        }

        // group tasks by course: case-insensitive key, first-seen display name
        let groupedCourses = Object.create(null);
        let courseOrder = [];

        for (let entry of visibleEntries) {
            let item = entry.task;
            let courseName =
                typeof item.course === "string" ? item.course.trim() : "";
            let courseKey = courseName
                ? courseName.toLowerCase()
                : "uncategorized";

            if (!groupedCourses[courseKey]) {
                groupedCourses[courseKey] = {
                    name: courseName || _("Uncategorized"),
                    entries: []
                };
                courseOrder.push(courseKey);
            }

            groupedCourses[courseKey].entries.push(entry);
        }

        // decoration box
        if (this.showDecoration !== false) {
            let decorationBox = new St.BoxLayout({
                vertical: false,
                style_class: "decoration-container",
                x_expand: true
            });

            decorationBox.set_style(
                `border-bottom-color: ${this._palette.border};`
            );

            for (let i = 0; i < 10; i++) {
                let decoration = new St.Label({
                    text: " | ",
                    x_expand: true,
                    x_align: Clutter.ActorAlign.CENTER
                });
                decorationBox.add_actor(decoration);
            }

            this.container.add_actor(decorationBox);
        }

        // title container
        if (this.showTitle !== false) {
            let titleBox = new St.BoxLayout({
                vertical: false,
                style_class: "title-container",
                x_expand: true
            });

            titleBox.set_style(
                `border-bottom-color: ${this._palette.border};`
            );

            titleBox.reactive = true;
            titleBox.connect("button-press-event", (actor, event) => {
                if (event.get_button() !== 1) {
                    return Clutter.EVENT_PROPAGATE;
                }

                let now = Date.now();

                if (
                    this._lastTitleClick &&
                    (now - this._lastTitleClick) < 400
                ) {
                    this._lastTitleClick = 0;
                    this.openSettings();
                    return Clutter.EVENT_STOP;
                }

                this._lastTitleClick = now;
                return Clutter.EVENT_PROPAGATE;
            });

            this._addTooltip(titleBox, _("Double-click to open settings"));

            // title text
            let titleText =
                typeof this.titleText === "string" ? this.titleText.trim() : "";

            let title = new St.Label({
                text: titleText || _("Tasks"),
                style_class: "title-text",
                x_align: Clutter.ActorAlign.CENTER,
                x_expand: true
            });

            title.set_style(`font-size: ${this._getFontSize(1)}px;`);

            titleBox.add_actor(title);
            this.container.add_actor(titleBox);
        }

        if (courseOrder.length === 0) {
            let emptyText = allEntries.length === 0
                ? _("No tasks yet.")
                : _("No pending tasks.");

            this.container.add_actor(new St.Label({
                text: emptyText,
                style_class: "empty-state"
            }));
        } else {
            for (let courseKey of courseOrder) {
                let group = groupedCourses[courseKey];

                if (group.entries.length === 0) {
                    continue;
                }

                let courseEntries = this.sortTaskEntries(group.entries);

                // course container
                let courseBox = new St.BoxLayout({
                    vertical: true,
                    style_class: "course-container"
                });

                courseBox.set_style(
                    `border-bottom-color: ${this._palette.border};`
                );

                // course name
                let courseLabel = new St.Label({
                    text: "- " + group.name,
                    style_class: "course-text"
                });

                courseBox.add_actor(courseLabel);

                for (let entry of courseEntries) {
                    let task = entry.task;
                    let daysLeft = this.calculateDaysLeft(task.date);
                    let dateText = this.formatDisplayDate(task.date);
                    let dueLabel = this.formatDueLabel(task.date);

                    let taskTitle =
                        typeof task.task === "string" ? task.task.trim() : "";

                    if (!taskTitle) {
                        taskTitle = _("(untitled)");
                    }

                    let styleClasses = ["task-text"];
                    let isOverdue =
                        !task.done && daysLeft !== null && daysLeft < 0;

                    if (task.done) {
                        styleClasses.push("task-done");
                    }

                    if (isOverdue) {
                        styleClasses.push("task-overdue");
                    }

                    let prefix =
                        typeof this.taskPrefix === "string"
                            ? this.taskPrefix.trim()
                            : "--->";

                    if (!prefix) {
                        prefix = "";
                    }

                    //task text
                    let hasDate =
                        typeof task.date === "string" &&
                        task.date.trim() !== "";

                    let taskText =
                        `${prefix ? prefix + " " : ""}${taskTitle}` +
                        (hasDate ? ` · ${dateText} (${dueLabel})` : "");

                    let row = new St.BoxLayout({
                        vertical: false,
                        style_class: "task-row",
                        x_expand: true
                    });

                    let taskLabel = new St.Label({
                        text: taskText,
                        style_class: styleClasses.join(" "),
                        x_expand: true
                    });

                    let labelStyles = [];

                    if (isOverdue) {
                        labelStyles.push(`color: ${this._palette.overdue};`);
                    }

                    if (task.done) {
                        labelStyles.push(
                            `opacity: ${this._getDoneOpacity()};`
                        );
                    }

                    if (labelStyles.length > 0) {
                        taskLabel.set_style(labelStyles.join(" "));
                    }

                    taskLabel.clutter_text.set_line_wrap(true);

                    // Only build the toggle when shown, so hidden ones don't
                    // leave tooltips and handlers attached to the stage.
                    if (!this.hideCheckbox || this._editMode) {
                        let toggleButton = new St.Button({
                            label: task.done ? "☑" : "☐",
                            style_class: "task-toggle"
                        });

                        this._styleControl(toggleButton, this._palette.text);
                        this._addTooltip(
                            toggleButton,
                            task.done ? _("Mark as pending") : _("Mark as done")
                        );

                        toggleButton.connect("clicked", () => {
                            this.toggleTaskDone(entry.index);
                        });

                        row.add_actor(toggleButton);
                    }
                    row.add_actor(taskLabel);

                    if (this._editMode) {
                        let editButton = new St.Button({
                            label: _("Edit"),
                            style_class: "task-action"
                        });

                        this._styleControl(editButton, this._palette.text, -2);
                        this._addTooltip(editButton, _("Edit task"));

                        editButton.connect("clicked", () => {
                            this.openEditor(entry.index);
                        });

                        let deleteButton = new St.Button({
                            label: _("Delete"),
                            style_class: "task-action"
                        });

                        this._styleControl(
                            deleteButton,
                            this._palette.text,
                            -2
                        );
                        this._addTooltip(deleteButton, _("Delete task"));

                        deleteButton.connect("clicked", () => {
                            if (this.confirmDelete === false) {
                                this.deleteTask(entry.index);
                                return;
                            }

                            this.openDeleteConfirm(deleteButton, entry.index);
                        });

                        row.add_actor(editButton);
                        row.add_actor(deleteButton);
                    }

                    courseBox.add_actor(row);
                }

                this.container.add_actor(courseBox);
            }
        }

        if (this._editor) {
            this.container.add_actor(this.buildEditor());
        }

        this.container.add_actor(this.buildFooter());
    }

    buildFooter() {
        let footer = new St.BoxLayout({
            vertical: false,
            style_class: "desklet-footer",
            x_expand: true
        });

        let addButton = new St.Button({
            label: _("+ Add task"),
            style_class: "footer-button",
            x_expand: true
        });

        this._styleControl(addButton, this._palette.text);
        this._addTooltip(addButton, _("Add a new task"));

        addButton.connect("clicked", () => {
            this.openEditor(null);
        });

        let editModeButton = new St.Button({
            label: this._editMode ? _("Close") : _("Edit"),
            style_class: "footer-button"
        });

        this._styleControl(editModeButton, this._palette.text);
        this._addTooltip(
            editModeButton,
            this._editMode
                ? _("Hide per-task actions")
                : _("Show per-task actions")
        );

        editModeButton.connect("clicked", () => {
            this._editMode = !this._editMode;
            this.updateUI();
        });

        footer.add_actor(addButton);
        footer.add_actor(editModeButton);

        return footer;
    }

    openSettings() {
        Util.spawnCommandLine(
            `xlet-settings desklet ${this.uuid} ${this._instanceId}`
        );
    }

    openEditor(index) {
        if (index === null || index === undefined) {
            this._editor = {
                mode: "add",
                index: -1,
                date: null,
                course: "",
                task: ""
            };
        } else {
            let tasks = this.getTasks();
            let task = tasks[index];

            if (task === null || typeof task !== "object") {
                return;
            }

            this._editor = {
                mode: "edit",
                index: index,
                date: this.parseTaskDate(task.date),
                course:
                    typeof task.course === "string" ? task.course : "",
                task: typeof task.task === "string" ? task.task : ""
            };
        }

        this._setDraggingInhibited(true);
        this.updateUI();
    }

    _setDraggingInhibited(inhibited) {
        if (this._draggable) {
            this._draggable.inhibit = inhibited;
        }
    }

    // On the desktop the stage stays in NORMAL input mode, so a plain
    // St.Entry never receives keyboard focus. Temporarily switch to
    // FOCUSED while grabbing focus
    _bindEntryFocus(entry) {
        entry.clutter_text.set_editable(false);

        let focusHandler = (actor, event) => {
            if (event.get_button() !== 1) {
                return Clutter.EVENT_PROPAGATE;
            }

            this._enableEntryInput(entry);

            return Clutter.EVENT_PROPAGATE;
        };

        entry.connect("button-press-event", focusHandler);
        entry.clutter_text.connect("button-press-event", focusHandler);
        entry.clutter_text.connect("key-focus-in", () => {
            entry.clutter_text.set_editable(true);
        });
    }

    _enableEntryInput(entry) {
        entry.clutter_text.set_editable(true);

        if (global.stage_input_mode === Cinnamon.StageInputMode.FULLSCREEN) {
            return;
        }

        global.set_stage_input_mode(Cinnamon.StageInputMode.FOCUSED);
        entry.grab_key_focus();
        global.set_stage_input_mode(Cinnamon.StageInputMode.NORMAL);
    }

    closeEditor() {
        this._editor = null;
        this._setDraggingInhibited(false);
        this.updateUI();
    }

    buildEditor() {
        let editor = this._editor;

        if (!editor) {
            return null;
        }

        let editorBox = new St.BoxLayout({
            vertical: true,
            style_class: "task-editor"
        });

        let titleLabel = new St.Label({
            text: editor.mode === "edit" ? _("Edit task") : _("Add task"),
            style_class: "editor-title"
        });

        this._styleControl(titleLabel, this._palette.text, 0);

        editorBox.add_actor(titleLabel);

        let errorLabel = new St.Label({
            text: "",
            style_class: "editor-error"
        });

        this._styleControl(errorLabel, this._palette.overdue, -2);

        // course row
        let courseRow = new St.BoxLayout({
            vertical: false,
            x_expand: true
        });

        let courseEntry = new St.Entry({
            text: typeof editor.course === "string" ? editor.course : "",
            hint_text: _("Title"),
            style_class: "editor-entry",
            x_expand: true
        });

        this._styleControl(courseEntry, this._palette.text);
        this._bindEntryFocus(courseEntry);

        courseEntry.clutter_text.connect("text-changed", () => {
            if (this._editor) {
                this._editor.course = courseEntry.get_text();
            }
        });

        let courseMenuButton = new St.Button({
            label: "▾",
            style_class: "editor-menu-button"
        });

        this._styleControl(courseMenuButton, this._palette.text);
        this._addTooltip(courseMenuButton, _("Pick an existing title"));

        courseMenuButton.connect("clicked", () => {
            let courses = this.getKnownCourses();

            if (courses.length === 0) {
                return;
            }

            this.openCourseMenu(courseMenuButton, courses, course => {
                courseEntry.set_text(course);
                errorLabel.set_text("");
            });
        });

        courseRow.add_actor(courseEntry);
        courseRow.add_actor(courseMenuButton);
        editorBox.add_actor(courseRow);

        // task entry
        let taskEntry = new St.Entry({
            text: typeof editor.task === "string" ? editor.task : "",
            hint_text: _("Task"),
            style_class: "editor-entry",
            x_expand: true
        });

        this._styleControl(taskEntry, this._palette.text);
        this._bindEntryFocus(taskEntry);

        taskEntry.clutter_text.connect("text-changed", () => {
            if (this._editor) {
                this._editor.task = taskEntry.get_text();
            }
        });

        editorBox.add_actor(taskEntry);

        // date button
        let dateButton = new St.Button({
            label: editor.date
                ? this.formatDateObjectDisplay(editor.date)
                : _("Select due date"),
            style_class: "editor-date-button",
            x_expand: true
        });

        this._styleControl(dateButton, this._palette.text);
        this._addTooltip(dateButton, _("Pick a due date"));

        dateButton.connect("clicked", () => {
            this.openCalendar(
                dateButton,
                this._editor.date || new Date(),
                picked => {
                    if (!this._editor) {
                        return;
                    }

                    this._editor.date = picked;
                    dateButton.set_label(
                        this.formatDateObjectDisplay(picked)
                    );
                    errorLabel.set_text("");
                }
            );
        });

        editorBox.add_actor(dateButton);
        editorBox.add_actor(errorLabel);

        // actions row
        let actionsRow = new St.BoxLayout({
            vertical: false,
            x_expand: true
        });

        let saveButton = new St.Button({
            label: _("Save"),
            style_class: "editor-button"
        });

        this._styleControl(saveButton, this._palette.text);

        saveButton.connect("clicked", () => {
            this.saveEditor(courseEntry, taskEntry, errorLabel);
        });

        let cancelButton = new St.Button({
            label: _("Cancel"),
            style_class: "editor-button"
        });

        this._styleControl(cancelButton, this._palette.text);

        cancelButton.connect("clicked", () => {
            this.closeEditor();
        });

        actionsRow.add_actor(saveButton);
        actionsRow.add_actor(cancelButton);
        editorBox.add_actor(actionsRow);

        taskEntry.clutter_text.connect("activate", () => {
            this.saveEditor(courseEntry, taskEntry, errorLabel);
        });

        return editorBox;
    }

    saveEditor(courseEntry, taskEntry, errorLabel) {
        let editor = this._editor;

        if (!editor) {
            return;
        }

        let course = courseEntry.get_text().trim();
        let taskName = taskEntry.get_text().trim();
        let error = "";

        if (!course) {
            error = _("Title is required.");
        } else if (!taskName) {
            error = _("Task is required.");
        } else if (
            !(editor.date instanceof Date) ||
            isNaN(editor.date.getTime())
        ) {
            error = _("Select a due date.");
        }

        if (error) {
            errorLabel.set_text(error);
            return;
        }

        let tasks = this.getTasks().slice();
        let dateText = this.formatDateObject(editor.date);

        if (editor.mode === "add") {
            tasks.push({
                course: course,
                task: taskName,
                date: dateText,
                done: false
            });
        } else {
            let existing = tasks[editor.index];

            if (existing === null || typeof existing !== "object") {
                existing = {};
            }

            let updated = Object.assign({}, existing);
            updated.course = course;
            updated.task = taskName;
            updated.date = dateText;
            tasks[editor.index] = updated;
        }

        this.taskList = tasks;
        this._editor = null;
        this._setDraggingInhibited(false);
        this.updateUI();
    }

    formatDateObject(date) {
        if (!(date instanceof Date) || isNaN(date.getTime())) {
            return "";
        }

        let year = String(date.getFullYear());

        while (year.length < 4) {
            year = "0" + year;
        }

        let month = date.getMonth() + 1;
        let day = date.getDate();
        let monthText = month < 10 ? "0" + month : String(month);
        let dayText = day < 10 ? "0" + day : String(day);

        return `${year}-${monthText}-${dayText}`;
    }

    formatDateObjectDisplay(date) {
        if (!(date instanceof Date) || isNaN(date.getTime())) {
            return "";
        }

        const months = [
            _("Jan"), _("Feb"), _("Mar"), _("Apr"), _("May"), _("Jun"),
            _("Jul"), _("Aug"), _("Sep"), _("Oct"), _("Nov"), _("Dec")
        ];

        return `${months[date.getMonth()]} ${date.getDate()}, ` +
            `${date.getFullYear()}`;
    }

    getKnownCourses() {
        let seen = Object.create(null);
        let courses = [];
        let tasks = this.getTasks();

        for (let i = 0; i < tasks.length; i++) {
            let task = tasks[i];

            if (task === null || typeof task !== "object") {
                continue;
            }

            if (typeof task.course !== "string") {
                continue;
            }

            let name = task.course.trim();

            if (!name) {
                continue;
            }

            let key = name.toLowerCase();

            if (seen[key]) {
                continue;
            }

            seen[key] = true;
            courses.push(name);
        }

        courses.sort((a, b) => a.localeCompare(b));

        return courses;
    }

    toggleTaskDone(index) {
        let tasks = this.getTasks().slice();

        if (index < 0 || index >= tasks.length) {
            return;
        }

        let task = tasks[index];

        if (task === null || typeof task !== "object") {
            return;
        }

        tasks[index] = Object.assign({}, task, { done: !task.done });
        this.taskList = tasks;
        this.updateUI();
    }

    deleteTask(index) {
        let tasks = this.getTasks().slice();

        if (index < 0 || index >= tasks.length) {
            return;
        }

        tasks.splice(index, 1);
        this.taskList = tasks;
        this._editor = null;
        this._setDraggingInhibited(false);
        this.updateUI();
    }

    _showMenu(menu) {
        if (this._openMenu) {
            this._closeOpenMenu();
        }

        this._openMenu = menu;
        this._taskMenuManager.addMenu(menu);
        // PopupMenu does not parent itself; without this the menu never
        // enters the stage and its actors cannot be themed or clicked.
        Main.uiGroup.add_actor(menu.actor);

        menu.actor.set_style(
            `font-family: ${this._getFontFamily()};` +
            ` font-size: ${this._getFontSize(0)}px;`
        );

        // shortcut: popups inherit font/text only, not panel bg/border;
        // theme them fully if a preset must cover the whole UI.

        menu.connect("open-state-changed", (m, open) => {
            if (!open) {
                if (this._openMenu === m) {
                    this._openMenu = null;
                }

                m.destroy();
            }
        });

        menu.open();
    }

    _closeOpenMenu() {
        let menu = this._openMenu;

        if (!menu) {
            return;
        }

        this._openMenu = null;

        if (menu.isOpen) {
            menu.close(false);
        } else {
            menu.destroy();
        }
    }

    _isSameDay(a, b) {
        return a.getFullYear() === b.getFullYear() &&
            a.getMonth() === b.getMonth() &&
            a.getDate() === b.getDate();
    }

    openCalendar(anchor, initialDate, onSelect) {
        let menu = new PopupMenu.PopupMenu(anchor, St.Side.TOP);
        menu.actor.add_style_class_name("task-calendar-menu");

        let calendarBox = new St.BoxLayout({
            vertical: true,
            style_class: "task-calendar"
        });

        calendarBox.set_style(`color: ${this._palette.text};`);

        menu.box.add_actor(calendarBox);

        let selectedDate = initialDate instanceof Date
            ? new Date(
                initialDate.getFullYear(),
                initialDate.getMonth(),
                initialDate.getDate()
            )
            : new Date();

        selectedDate.setHours(0, 0, 0, 0);

        let viewYear = selectedDate.getFullYear();
        let viewMonth = selectedDate.getMonth();

        let monthNames = [
            _("January"), _("February"), _("March"), _("April"), _("May"),
            _("June"), _("July"), _("August"), _("September"), _("October"),
            _("November"), _("December")
        ];

        let weekStart = 0;

        try {
            weekStart = Cinnamon.util_get_week_start();
        } catch (e) {
            weekStart = 0;
        }

        if (
            typeof weekStart !== "number" ||
            weekStart < 0 ||
            weekStart > 6
        ) {
            weekStart = 0;
        }

        // header
        let headerRow = new St.BoxLayout({
            vertical: false,
            x_expand: true
        });

        let prevButton = new St.Button({
            label: "‹",
            style_class: "task-calendar-nav"
        });

        this._styleControl(prevButton, this._palette.text);

        let monthLabel = new St.Label({
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER
        });

        monthLabel.set_style(`color: ${this._palette.text};`);

        let nextButton = new St.Button({
            label: "›",
            style_class: "task-calendar-nav"
        });

        this._styleControl(nextButton, this._palette.text);

        headerRow.add_actor(prevButton);
        headerRow.add_actor(monthLabel);
        headerRow.add_actor(nextButton);
        calendarBox.add_actor(headerRow);

        // weekday header
        let weekdays = [
            _("Sun"), _("Mon"), _("Tue"), _("Wed"), _("Thu"), _("Fri"),
            _("Sat")
        ];

        let orderedWeekdays = weekdays.slice(weekStart).concat(
            weekdays.slice(0, weekStart)
        );

        let weekdayRow = new St.BoxLayout({
            vertical: false,
            x_expand: true
        });

        for (let weekday of orderedWeekdays) {
            let weekdayLabel = new St.Label({
                text: weekday,
                x_expand: true,
                x_align: Clutter.ActorAlign.CENTER
            });

            weekdayLabel.set_style(`color: ${this._palette.text};`);

            weekdayRow.add_actor(weekdayLabel);
        }

        calendarBox.add_actor(weekdayRow);

        // day grid
        let gridBox = new St.BoxLayout({
            vertical: true,
            style_class: "task-calendar-grid",
            x_expand: true
        });

        calendarBox.add_actor(gridBox);

        let today = new Date();
        today.setHours(0, 0, 0, 0);

        let renderGrid = () => {
            monthLabel.set_text(`${monthNames[viewMonth]} ${viewYear}`);
            gridBox.destroy_all_children();

            let firstDay = new Date(viewYear, viewMonth, 1);
            let offset = (firstDay.getDay() - weekStart + 7) % 7;
            let daysInMonth = new Date(
                viewYear,
                viewMonth + 1,
                0
            ).getDate();

            let cellIndex = 0;

            for (let week = 0; week < 6; week++) {
                let weekRow = new St.BoxLayout({
                    vertical: false,
                    style_class: "task-calendar-week",
                    x_expand: true
                });

                for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
                    let dayNumber = cellIndex - offset + 1;

                    if (dayNumber < 1 || dayNumber > daysInMonth) {
                        weekRow.add_actor(new St.Label({
                            text: "",
                            x_expand: true,
                            style_class: "task-calendar-empty"
                        }));
                    } else {
                        let picked = new Date(
                            viewYear,
                            viewMonth,
                            dayNumber
                        );

                        let classes = ["task-calendar-day"];

                        if (this._isSameDay(picked, today)) {
                            classes.push("task-calendar-today");
                        }

                        if (this._isSameDay(picked, selectedDate)) {
                            classes.push("task-calendar-selected");
                        }

                        let dayButton = new St.Button({
                            label: String(dayNumber),
                            x_expand: true,
                            style_class: classes.join(" ")
                        });

                        if (this._isSameDay(picked, selectedDate)) {
                            dayButton.set_style("color: #ffffff;");
                        } else {
                            dayButton.set_style(
                                `color: ${this._palette.text};`
                            );
                        }

                        dayButton.connect("clicked", () => {
                            let chosen = new Date(
                                picked.getFullYear(),
                                picked.getMonth(),
                                picked.getDate()
                            );

                            onSelect(chosen);
                            menu.close();
                        });

                        weekRow.add_actor(dayButton);
                    }

                    cellIndex++;
                }

                gridBox.add_actor(weekRow);
            }
        };

        prevButton.connect("clicked", () => {
            viewMonth--;

            if (viewMonth < 0) {
                viewMonth = 11;
                viewYear--;
            }

            renderGrid();
        });

        nextButton.connect("clicked", () => {
            viewMonth++;

            if (viewMonth > 11) {
                viewMonth = 0;
                viewYear++;
            }

            renderGrid();
        });

        renderGrid();

        let todayButton = new St.Button({
            label: _("Today"),
            style_class: "task-calendar-nav"
        });

        this._styleControl(todayButton, this._palette.text);

        todayButton.connect("clicked", () => {
            let now = new Date();
            let chosen = new Date(
                now.getFullYear(),
                now.getMonth(),
                now.getDate()
            );

            onSelect(chosen);
            menu.close();
        });

        calendarBox.add_actor(todayButton);

        this._showMenu(menu);
    }

    openCourseMenu(anchor, courses, onSelect) {
        if (!Array.isArray(courses) || courses.length === 0) {
            return;
        }

        let menu = new PopupMenu.PopupMenu(anchor, St.Side.TOP);

        for (let course of courses) {
            let item = new PopupMenu.PopupMenuItem(course);

            item.label.set_style(`color: ${this._palette.text};`);

            item.connect("activate", () => {
                onSelect(course);
                menu.close();
            });

            menu.addMenuItem(item);
        }

        this._showMenu(menu);
    }

    openDeleteConfirm(anchor, index) {
        let menu = new PopupMenu.PopupMenu(anchor, St.Side.TOP);

        let questionItem = new PopupMenu.PopupMenuItem(
            _("Delete this task?"),
            { reactive: false }
        );

        questionItem.label.set_style(`color: ${this._palette.text};`);

        menu.addMenuItem(questionItem);

        let deleteItem = new PopupMenu.PopupMenuItem(_("Delete"));

        deleteItem.label.set_style(`color: ${this._palette.text};`);

        deleteItem.connect("activate", () => {
            menu.close();
            this.deleteTask(index);
        });

        menu.addMenuItem(deleteItem);

        let cancelItem = new PopupMenu.PopupMenuItem(_("Cancel"));

        cancelItem.label.set_style(`color: ${this._palette.text};`);

        cancelItem.connect("activate", () => {
            menu.close();
        });

        menu.addMenuItem(cancelItem);

        this._showMenu(menu);
    }

    onSettingsChanged() {
        this.updateUI();
    }

    _getMillisecondsUntilNextRefresh() {
        const now = new Date();
        const nextRefresh = new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate() + 1,
            0,
            0,
            5,
            0
        );

        return Math.max(1000, nextRefresh.getTime() - now.getTime());
    }

    startLoop() {
        if (this._timeoutId) {
            return;
        }

        this._scheduleNextRefresh();
    }

    _scheduleNextRefresh() {
        if (this._timeoutId) {
            return;
        }

        this._timeoutId = Mainloop.timeout_add(
            this._getMillisecondsUntilNextRefresh(),
            Lang.bind(this, this.onTimer)
        );
    }

    onTimer() {
        this._timeoutId = null;
        this.updateUI();
        this._scheduleNextRefresh();
        return GLib.SOURCE_REMOVE;
    }

    on_desklet_removed() {
        if (this._timeoutId) {
            Mainloop.source_remove(this._timeoutId);
            this._timeoutId = null;
        }

        this._closeOpenMenu();

        if (this._taskMenuManager) {
            this._taskMenuManager.destroy();
            this._taskMenuManager = null;
        }
    }
}

function main(metadata, desklet_id) {
    return new TrackerDesklet(metadata, desklet_id);
}
