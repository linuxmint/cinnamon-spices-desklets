const Desklet = imports.ui.desklet;
const ModalDialog = imports.ui.modalDialog;
const Tooltips = imports.ui.tooltips;
const PopupMenu = imports.ui.popupMenu;
const Main = imports.ui.main;
const Mainloop = imports.mainloop;
const St = imports.gi.St;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Clutter = imports.gi.Clutter;
const Util = imports.misc.util;
const ByteArray = imports.byteArray;

const COLUMNS = 5;
const ROWS = 2;
const SLOTS_PER_PAGE = COLUMNS * ROWS;
const MAX_PAGES = 5;
const ICON_SIZE = 34;
const BUTTON_SIZE = 64;
const SLOT_MARGIN = 7;
const GRID_EDIT_BORDER_COLOR = "rgba(255,255,255,0.8)";
const CUSTOM_ICON_MAX_BYTES = 2 * 1024 * 1024;
const DONATE_URL = "https://ko-fi.com/oliveirawro";
const DONATE_COIN_COLOR = "#FFD729";

const PALETTE = [
    "#e6194b", "#e91e8c", "#f39c12", "#9b59b6", "#2D6DD9",
    "#19BC97", "#1abc9c", "#ffffff", "#34495e", "#7f8c8d", "#2c2c2c"
];

const FOOTER_BUTTON_STYLE_BASE = "border: none; border-radius: 10px; padding: 8px 18px; font-size: 18px; font-weight: normal; color: white; min-width: 120px; background-color: #2D6DD9;";
const FOOTER_BUTTON_STYLE_HOVER = "border: none; border-radius: 10px; padding: 8px 18px; font-size: 18px; font-weight: normal; color: white; min-width: 120px; background-color: #FF4D00;";

// Inline-style the dialog footer buttons (Cinnamon's stylesheet reload for xlets is
// unreliable, so we avoid relying on an external CSS class here) and drive the hover
// color change directly off St.Button's own "hover" state.
function styleFooterButton(button) {
    button.style = FOOTER_BUTTON_STYLE_BASE;
    button.connect("notify::hover", () => {
        button.style = button.hover ? FOOTER_BUTTON_STYLE_HOVER : FOOTER_BUTTON_STYLE_BASE;
    });
}

function emptySlot() {
    return { label: "", command: "", icon: "", color: "", showTitle: true };
}

function isEmptySlot(slot) {
    return !slot.icon && !slot.command && !slot.label;
}

function emptyPage() {
    let slots = [];
    for (let i = 0; i < SLOTS_PER_PAGE; i++) slots.push(emptySlot());
    return { slots: slots };
}

// Dialog: search & pick an icon from the bundled Font Awesome set.
class IconPickerDialog extends ModalDialog.ModalDialog {
    // parentDialog (optional): the ModalDialog this picker was opened from (e.g. the
    // button editor). Needed to fully drop Cinnamon's shell-wide input grab while an
    // external file picker is up - see _hideForExternalPicker() below.
    constructor(deskletPath, onPick, parentDialog) {
        super({ styleClass: "xtream-deck-dialog" });
        this.contentLayout.style = "spacing: 18px; padding: 22px 22px;";
        this._deskletPath = deskletPath;
        this._onPick = onPick;
        this._parentDialog = parentDialog || null;
        this._manifest = this._loadManifest();

        let titleRow = new St.BoxLayout({ vertical: false });
        let title = new St.Label({ text: "Choose an icon", style: "font-weight: bold; color: white; font-size: 24px;" });
        titleRow.add(title, { expand: true, x_fill: true, x_align: St.Align.START, y_align: St.Align.MIDDLE });
        let closeBtn = new St.Button({ style: "width: 42px; height: 42px; border-radius: 21px; background-color: #2D6DD9; margin-right: 0; margin-top: 0;" });
        let closeGicon = makeWhiteIconFile(deskletPath, "solid", "xmark");
        if (closeGicon) closeBtn.set_child(new St.Icon({ gicon: closeGicon, icon_size: 22 }));
        closeBtn.connect("clicked", () => this.close());
        titleRow.add(closeBtn, { y_align: St.Align.START });
        this.contentLayout.add(titleRow);

        let libraryColumn = new St.BoxLayout({ vertical: true, style: "spacing: 10px;" });
        libraryColumn.add(new St.Label({ text: "SELECT FROM LIBRARY", style_class: "xtream-deck-field-label" }));

        this._entry = new St.Entry({ style_class: "xtream-deck-entry", hint_text: "Search icons…" });
        let hint = new St.Label({ text: "Type to search, e.g. \"microphone\", \"camera\", \"play\". Showing first 24 matches.", style_class: "xtream-deck-hint" });
        let searchGroup = new St.BoxLayout({ vertical: true, style: "spacing: 6px;" });
        searchGroup.add(this._entry);
        searchGroup.add(hint);
        libraryColumn.add(searchGroup);
        this.setInitialKeyFocus(this._entry.clutter_text);

        this._resultsBin = new St.Bin({ style: "width: 420px; min-height: 220px;" });
        libraryColumn.add(this._resultsBin);

        this._entry.clutter_text.connect("text-changed", () => this._renderResults(this._entry.get_text()));
        this._renderResults("");

        let divider = new St.Bin({ style: "width: 1px; background-color: rgba(255,255,255,0.15);" });

        let uploadColumn = new St.BoxLayout({ vertical: true, style: "spacing: 10px; width: 220px;" });
        uploadColumn.add(new St.Label({ text: "UPLOAD CUSTOM ICON", style_class: "xtream-deck-field-label" }));
        uploadColumn.add(this._makeUploadDropzone());
        this._uploadStatus = new St.Label({ text: "", style: "color: #e6194b; font-size: 12px;" });
        this._uploadStatus.clutter_text.line_wrap = true;
        uploadColumn.add(this._uploadStatus);

        let bodyRow = new St.BoxLayout({ vertical: false, style: "spacing: 22px;" });
        bodyRow.add(libraryColumn);
        bodyRow.add(divider, { y_fill: true, y_align: St.Align.START });
        bodyRow.add(uploadColumn);
        this.contentLayout.add(bodyRow);

        this.setButtons([
            { label: "No icon", action: () => { this._onPick(""); this.close(); } },
            { label: "Close", action: () => this.close() }
        ]);
        this._buttonLayout.style = "spacing: 14px;";
        for (let button of this._buttonLayout.get_children()) {
            styleFooterButton(button);
        }
    }

    // Dashed borders don't render on this toolkit when combined with border-radius
    // (confirmed limitation - see memory), so the dropzone uses a solid border instead
    // of the dashed one from the original mockup.
    _makeUploadDropzone() {
        let dropzone = new St.Button({
            style: "width: 220px; background-color: rgba(255,255,255,0.05); " +
                "border: 2px solid rgba(255,255,255,0.4); border-radius: 8px; padding: 22px 14px;"
        });
        dropzone.set_pivot_point(0.5, 0.5);
        dropzone.connect("notify::hover", () => {
            dropzone.style = "width: 220px; background-color: rgba(255,255,255,0.05); " +
                "border-radius: 8px; padding: 22px 14px; border: 2px solid " +
                (dropzone.hover ? "white" : "rgba(255,255,255,0.4)") + ";";
        });

        let content = new St.BoxLayout({ vertical: true, x_align: St.Align.MIDDLE, style: "spacing: 10px;" });
        let cloudGicon = makeWhiteIconFile(this._deskletPath, "solid", "cloud-arrow-up");
        if (cloudGicon) {
            content.add(new St.Icon({ gicon: cloudGicon, icon_size: 32, opacity: 220 }), { x_align: St.Align.MIDDLE });
        }
        let text = new St.Label({ text: "Click to upload an icon.", style: "color: white; font-size: 14px; text-align: center;" });
        text.clutter_text.line_wrap = true;
        content.add(text, { x_align: St.Align.MIDDLE });
        let subtext = new St.Label({ text: "PNG, JPG or GIF. Max size: 2MB.", style_class: "xtream-deck-hint" });
        content.add(subtext, { x_align: St.Align.MIDDLE });
        dropzone.set_child(content);

        dropzone.connect("clicked", () => {
            this._uploadStatus.text = "";
            this._hideForExternalPicker();
            pickImageFileAsync((sourcePath) => {
                this._showAfterExternalPicker();
                if (!sourcePath) return;
                importCustomImageIcon(
                    sourcePath,
                    (destPath) => {
                        this._onPick(destPath);
                        this.close();
                    },
                    (message) => { this._uploadStatus.text = message; }
                );
            });
        });

        return dropzone;
    }

    // Cinnamon's modal dialogs take a shell-wide input grab (global.begin_modal) that
    // stays in effect as long as ANY dialog in the stack is pushed - popping just this
    // dialog isn't enough, since the parent (button editor) below it still holds its
    // own modal push. Without dropping both, zenity's window renders behind the shell's
    // dimmed overlay and can't receive any input. Hide (not close/destroy) so all field
    // values in the parent dialog survive.
    _hideForExternalPicker() {
        this.popModal();
        this._group.hide();
        if (this._parentDialog) {
            this._parentDialog.popModal();
            this._parentDialog._group.hide();
        }
    }

    _showAfterExternalPicker() {
        if (this._parentDialog) {
            this._parentDialog._group.show();
            this._parentDialog.pushModal();
        }
        this._group.show();
        this.pushModal();
    }

    _loadManifest() {
        try {
            let path = this._deskletPath + "/icons/fontawesome/manifest.json";
            let [ok, contents] = GLib.file_get_contents(path);
            if (!ok) return [];
            return JSON.parse(ByteArray.toString(contents));
        } catch (e) {
            global.logError("xtream-desklet-deck: failed to load icon manifest: " + e);
            return [];
        }
    }

    _renderResults(query) {
        let q = query.trim().toLowerCase();
        let matches = this._manifest.filter(i => !q || i.name.includes(q));
        matches = matches.slice(0, 24);

        if (matches.length === 0) {
            this._resultsBin.set_child(new St.Label({ text: q ? "No icons match \"" + q + "\"." : "No icons available.", style: "color: #999; padding: 12px;" }));
            return;
        }

        let cols = 6;
        let grid = new St.Table({ homogeneous: false });
        for (let idx = 0; idx < matches.length; idx++) {
            let item = matches[idx];
            let row = Math.floor(idx / cols);
            let col = idx % cols;

            let btn = new St.Button({ style: "width: 56px; height: 56px; margin: 3px; background-color: rgba(255,255,255,0.08); border-radius: 6px;" });
            let gicon = makeWhiteIconFile(this._deskletPath, item.style, item.name);
            if (gicon) {
                btn.set_child(new St.Icon({ gicon: gicon, icon_size: 28 }));
            } else {
                btn.set_child(new St.Label({ text: "?", style: "color: white;" }));
            }
            let tooltip = new Tooltips.Tooltip(btn, item.name);
            tooltip._tooltip.style = "font-size: 20px; font-weight: bold; padding: 8px 14px;";
            btn.connect("clicked", () => {
                this._onPick("fa:" + item.style + ":" + item.name);
                this.close();
            });
            grid.add(btn, { row: row, col: col, x_expand: false, y_expand: false });
        }
        this._resultsBin.set_child(grid);
    }
}

// Small reusable confirmation dialog, styled to match the rest of Xtream Deck.
class ConfirmDialog extends ModalDialog.ModalDialog {
    constructor(deskletPath, titleText, messageText, confirmLabel, onConfirm, confirmColor) {
        super({ styleClass: "xtream-deck-dialog" });
        this.contentLayout.style = "spacing: 16px; padding: 22px 22px;";

        let title = new St.Label({ text: titleText, style: "font-weight: bold; color: white; font-size: 24px;" });
        this.contentLayout.add(title, { x_align: St.Align.START });

        let message = new St.Label({ text: messageText, style: "color: #cccccc; font-size: 16px; width: 380px;" });
        message.clutter_text.line_wrap = true;
        this.contentLayout.add(message);

        this.setButtons([
            { label: "Cancel", action: () => this.close() },
            {
                label: confirmLabel, focused: true, action: () => {
                    this.close();
                    onConfirm();
                }
            }
        ]);

        let children = this._buttonLayout.get_children();
        for (let button of children) {
            if (button.label === "Cancel") {
                button.style = "padding: 10px 16px; font-size: 15px; border-radius: 6px;";
            } else if (button.label === confirmLabel) {
                button.style = "padding: 10px 16px; font-size: 15px; border-radius: 6px; background-color: " + (confirmColor || "#e6194b") + ";";
            }
        }
    }
}

// Single-button informational dialog, styled like ConfirmDialog - used for messages
// that don't need a yes/no choice (e.g. "no slot available to move this button to").
class InfoDialog extends ModalDialog.ModalDialog {
    constructor(deskletPath, titleText, messageText) {
        super({ styleClass: "xtream-deck-dialog" });
        this.contentLayout.style = "spacing: 16px; padding: 22px 22px;";

        let title = new St.Label({ text: titleText, style: "font-weight: bold; color: white; font-size: 24px;" });
        this.contentLayout.add(title, { x_align: St.Align.START });

        let message = new St.Label({ text: messageText, style: "color: #cccccc; font-size: 16px; width: 380px;" });
        message.clutter_text.line_wrap = true;
        this.contentLayout.add(message);

        this.setButtons([
            { label: "OK", focused: true, action: () => this.close() }
        ]);

        for (let button of this._buttonLayout.get_children()) {
            button.style = "padding: 10px 16px; font-size: 15px; border-radius: 6px; background-color: #2D6DD9;";
        }
    }
}

// Dialog: edit a single button's label, command, icon and color.
class ButtonEditorDialog extends ModalDialog.ModalDialog {
    constructor(deskletPath, slot, onSave, onClear) {
        super({ styleClass: "xtream-deck-dialog" });
        this.contentLayout.style = "spacing: 22px; padding: 22px 22px;";
        this._deskletPath = deskletPath;
        this._slot = { label: slot.label || "", command: slot.command || "", icon: slot.icon || "", color: slot.color || "", showTitle: slot.showTitle !== false };
        this._onSave = onSave;
        this._onClear = onClear;

        let titleRow = new St.BoxLayout({ vertical: false });
        let title = new St.Label({ text: "Edit button", style: "font-weight: bold; color: white; font-size: 24px;" });
        titleRow.add(title, { expand: true, x_fill: true, x_align: St.Align.START, y_align: St.Align.MIDDLE });
        let closeBtn = new St.Button({ style: "width: 42px; height: 42px; border-radius: 21px; background-color: #2D6DD9; margin-right: 0; margin-top: 0;" });
        let closeGicon = makeWhiteIconFile(this._deskletPath, "solid", "xmark");
        if (closeGicon) closeBtn.set_child(new St.Icon({ gicon: closeGicon, icon_size: 22 }));
        closeBtn.connect("clicked", () => this.close());
        titleRow.add(closeBtn, { y_align: St.Align.START });
        this.contentLayout.add(titleRow);

        this._labelEntry = new St.Entry({ style_class: "xtream-deck-entry", hint_text: "Enter button label", style: "width: 300px;" });
        this._labelEntry.set_text(this._slot.label);
        this.setInitialKeyFocus(this._labelEntry.clutter_text);

        this._showTitleToggle = this._makeToggle(this._slot.showTitle, (value) => { this._slot.showTitle = value; }, 40);

        // Two BoxLayout columns side by side (not St.Table, which has an
        // uncontrollable default gap between columns) - each column has its own
        // header + control stacked vertically, so "Label"/"Show Title" line up
        // on the same row without any extra space between the two columns.
        let labelColumn = new St.BoxLayout({ vertical: true, style: "spacing: 6px;" });
        labelColumn.add(new St.Label({ text: "Label", style_class: "xtream-deck-field-label" }));
        labelColumn.add(this._labelEntry);

        let showTitleColumn = new St.BoxLayout({ vertical: true, style: "spacing: 6px;" });
        showTitleColumn.add(new St.Label({ text: "Show Title", style_class: "xtream-deck-field-label" }), { x_align: St.Align.MIDDLE });
        showTitleColumn.add(this._showTitleToggle, { x_align: St.Align.MIDDLE });

        let fieldRow = new St.BoxLayout({ vertical: false, style: "spacing: 18px;" });
        fieldRow.add(labelColumn);
        fieldRow.add(showTitleColumn, { y_align: St.Align.START });

        let labelGroup = new St.BoxLayout({ vertical: true, style: "spacing: 6px;" });
        labelGroup.add(fieldRow);
        labelGroup.add(new St.Label({ text: "This is the text that will appear on the button. \"Show Title\" controls whether it's drawn under the icon on the grid.", style_class: "xtream-deck-hint" }));
        this.contentLayout.add(labelGroup);

        this._commandEntry = new St.Entry({ style_class: "xtream-deck-entry", hint_text: "e.g. /home/user/scripts/my-script.sh" });
        this._commandEntry.set_text(this._slot.command);
        this.contentLayout.add(this._makeFieldGroup("Command", this._commandEntry, "Command or script to run when the button is clicked."));

        this._iconDropzone = new St.Button({
            style: "width: 460px; background-color: rgba(255,255,255,0.05); border: 2px solid rgba(255,255,255,0.5); border-radius: 8px; padding: 12px;"
        });
        let iconRow = new St.BoxLayout({ vertical: false, style: "spacing: 16px;" });
        this._iconPreview = new St.Bin({ style: "width: 44px; height: 44px; background-color: rgba(255,255,255,0.1); border-radius: 6px;" });
        iconRow.add(this._iconPreview, { y_align: St.Align.MIDDLE, y_fill: false });
        let pickIconLabelBin = new St.Bin({ y_align: St.Align.MIDDLE });
        pickIconLabelBin.set_child(new St.Label({ text: "Pick icon…", style: "color: white; font-size: 16px;" }));
        iconRow.add(pickIconLabelBin, { y_align: St.Align.MIDDLE, y_fill: false });
        this._iconDropzone.set_child(iconRow);
        this._iconDropzone.connect("clicked", () => {
            let picker = new IconPickerDialog(this._deskletPath, (iconRef) => {
                this._slot.icon = iconRef;
                this._updateIconPreview();
            }, this);
            picker.open();
        });
        this._updateIconPreview();
        this.contentLayout.add(this._makeFieldGroup("Icon", this._iconDropzone, "Choose an icon to represent this button."));

        let colorRow = new St.BoxLayout({ vertical: false, style: "spacing: 10px;" });
        let colorSwatches = [];

        // Every swatch (and the hex preview) always shows a 1px border matching the
        // main grid's own edit-mode button border, so they read as the same kind of
        // "slot" - the 3px white border on top of that is purely the selection marker.
        const applySwatchStyles = () => {
            for (let entry of colorSwatches) {
                let selected = entry.colorValue === this._slot.color;
                let border = selected
                    ? "border: 3px solid white;"
                    : "border: 1px solid " + GRID_EDIT_BORDER_COLOR + ";";
                let bg = entry.colorValue ? "background-color: " + entry.colorValue + ";" : "";
                entry.button.style = "width: 34px; height: 34px; border-radius: 8px; " + bg + " " + border;
            }
            this._hexPreview.style = "width: 34px; height: 34px; border-radius: 8px; border: 1px solid " +
                GRID_EDIT_BORDER_COLOR + ";" + (this._slot.color ? " background-color: " + this._slot.color + ";" : "");
        };

        // Palette/no-color swatches also mirror their value into the hex field, so
        // it always reflects whatever is actually selected.
        const selectColor = (value) => {
            this._slot.color = value;
            this._hexEntry.set_text(value);
            applySwatchStyles();
        };

        for (let c of PALETTE) {
            let swatch = new St.Button();
            swatch.connect("clicked", () => selectColor(c));
            colorRow.add(swatch, { y_align: St.Align.MIDDLE });
            colorSwatches.push({ button: swatch, colorValue: c });
        }
        let noColorBtn = new St.Button();
        noColorBtn.connect("clicked", () => selectColor(""));
        colorRow.add(noColorBtn, { y_align: St.Align.MIDDLE });
        colorSwatches.push({ button: noColorBtn, colorValue: "" });

        let customRow = new St.BoxLayout({ vertical: false, style: "spacing: 10px;" });
        this._hexEntry = new St.Entry({ style_class: "xtream-deck-entry", hint_text: "#RRGGBB", style: "width: 110px;" });
        this._hexEntry.set_text(this._slot.color || "");
        this._hexEntry.clutter_text.connect("text-changed", () => {
            let value = this._hexEntry.get_text().trim();
            if (/^#[0-9a-fA-F]{6}$/.test(value)) {
                this._slot.color = value;
                applySwatchStyles();
            }
        });
        customRow.add(this._hexEntry, { y_align: St.Align.MIDDLE });
        this._hexPreview = new St.Bin();
        customRow.add(this._hexPreview, { y_align: St.Align.MIDDLE });

        applySwatchStyles();

        // Palette and hex columns side by side, each with its own header label, so
        // "Color" and "Hex color:" sit on the same row instead of the hex label
        // trailing lower, stacked only above its own entry.
        let paletteColumn = new St.BoxLayout({ vertical: true, style: "spacing: 6px;" });
        paletteColumn.add(new St.Label({ text: "Color", style_class: "xtream-deck-field-label" }));
        paletteColumn.add(colorRow);
        paletteColumn.add(new St.Label({ text: "Select a color for the button, or enter a custom hex value.", style_class: "xtream-deck-hint" }));

        let divider = new St.Bin({ style: "width: 1px; background-color: rgba(255,255,255,0.15);" });

        let hexColumn = new St.BoxLayout({ vertical: true, style: "spacing: 6px;" });
        hexColumn.add(new St.Label({ text: "Hex color:", style_class: "xtream-deck-field-label" }));
        hexColumn.add(customRow);

        let colorGroup = new St.BoxLayout({ vertical: false, style: "spacing: 22px;" });
        colorGroup.add(paletteColumn);
        colorGroup.add(divider, { y_fill: true, y_align: St.Align.START });
        colorGroup.add(hexColumn);
        this.contentLayout.add(colorGroup);

        this.setButtons([
            { label: "Clear button", action: () => { onClear(); this.close(); } },
            { label: "Cancel", action: () => this.close() },
            {
                label: "Save", focused: true, action: () => {
                    this._slot.label = this._labelEntry.get_text();
                    this._slot.command = this._commandEntry.get_text();
                    this._onSave(this._slot);
                    this.close();
                }
            }
        ]);
        this._styleFooterButtons();
    }

    _makeFieldGroup(labelText, contentActor, hintText) {
        let group = new St.BoxLayout({ vertical: true, style: "spacing: 6px;" });
        group.add(new St.Label({ text: labelText, style_class: "xtream-deck-field-label" }));
        group.add(contentActor);
        group.add(new St.Label({ text: hintText, style_class: "xtream-deck-hint" }));
        return group;
    }

    // Pill-shaped ON/OFF toggle: green with "ON" + a white dot on the right when
    // on, red with a white dot + "OFF" on the left when off.
    _makeToggle(initialValue, onChange, height) {
        let value = !!initialValue;
        let btn = new St.Button();
        let h = height || 26;
        let thumbSize = h - 6;

        const render = () => {
            let bg = value ? "#19BC97" : "#e6194b";
            // Asymmetric padding (CSS "top right bottom left" shorthand): zero on
            // whichever side the thumb sits on, so it touches that edge exactly -
            // OFF's thumb sits left, ON's sits right. The far side keeps normal
            // padding for the ON/OFF text.
            let padding = value ? "0 0 0 6px" : "0 6px 0 0";
            btn.style = "width: 84px; height: " + h + "px; border-radius: " + (h / 2) + "px; padding: " + padding + "; background-color: " + bg + ";";

            let row = new St.BoxLayout({ vertical: false, style: "spacing: 6px;" });
            let thumb = new St.Bin({ style: "width: " + thumbSize + "px; height: " + thumbSize + "px; border-radius: " + (thumbSize / 2) + "px; background-color: white;" });
            let text = new St.Label({ text: value ? "ON" : "OFF", style: "color: white; font-size: 12px; font-weight: bold;" });
            let textBin = new St.Bin({ x_align: St.Align.MIDDLE, y_align: St.Align.MIDDLE });
            textBin.set_child(text);

            if (value) {
                row.add(textBin, { expand: true, x_fill: true, y_align: St.Align.MIDDLE });
                row.add(thumb, { y_align: St.Align.MIDDLE });
            } else {
                row.add(thumb, { y_align: St.Align.MIDDLE });
                row.add(textBin, { expand: true, x_fill: true, y_align: St.Align.MIDDLE });
            }
            btn.set_child(row);
        };
        render();

        btn.connect("clicked", () => {
            value = !value;
            render();
            onChange(value);
        });

        return btn;
    }

    _iconLabelButtonChild(iconName, text) {
        let box = new St.BoxLayout({ vertical: false, style: "spacing: 8px;" });
        let gicon = makeWhiteIconFile(this._deskletPath, "solid", iconName);
        if (gicon) box.add(new St.Icon({ gicon: gicon, icon_size: 18 }), { y_align: St.Align.MIDDLE });
        box.add(new St.Label({ text: text, style: "color: white; font-size: 18px; font-weight: normal;" }), { y_align: St.Align.MIDDLE });
        return box;
    }

    _styleFooterButtons() {
        this._buttonLayout.style = "spacing: 14px;";
        let children = this._buttonLayout.get_children();
        for (let button of children) {
            let originalLabel = button.label;
            styleFooterButton(button);
            if (originalLabel === "Clear button") {
                button.label = "";
                button.set_child(this._iconLabelButtonChild("trash", "Clear button"));
            } else if (originalLabel === "Save") {
                button.label = "";
                button.set_child(this._iconLabelButtonChild("floppy-disk", "Save"));
            }
        }
    }

    _updateIconPreview() {
        this._iconPreview.destroy_all_children();
        let gicon = resolveIconGicon(this._deskletPath, this._slot.icon);
        if (!gicon) {
            gicon = makeWhiteIconFile(this._deskletPath, "solid", "image");
        }
        if (gicon) {
            let opacity = this._slot.icon ? 255 : 130;
            this._iconPreview.set_child(new St.Icon({ gicon: gicon, icon_size: 22, opacity: opacity }));
        }
    }
}

// Recolor a Font Awesome SVG (fill="currentColor") - white by default, so icons stay
// legible on any background color, or an explicit hexColor (e.g. the donate coin) -
// and cache it. Cache filename only gets a color suffix for non-white recolors, so
// existing white icon caches stay untouched.
function makeWhiteIconFile(deskletPath, style, name, hexColor) {
    let color = hexColor || "#ffffff";
    try {
        let cacheDir = GLib.get_user_cache_dir() + "/xtream-desklet-deck/icons";
        GLib.mkdir_with_parents(cacheDir, 0o755);
        let suffix = color === "#ffffff" ? "" : "-" + color.replace("#", "");
        let cachedPath = cacheDir + "/" + style + "-" + name + suffix + ".svg";
        let cacheFile = Gio.File.new_for_path(cachedPath);
        if (!cacheFile.query_exists(null)) {
            let srcPath = deskletPath + "/icons/fontawesome/" + style + "/" + name + ".svg";
            let [ok, contents] = GLib.file_get_contents(srcPath);
            if (!ok) return null;
            let svg = ByteArray.toString(contents).replace(/currentColor/g, color);
            GLib.file_set_contents(cachedPath, svg);
        }
        return Gio.icon_new_for_string(cachedPath);
    } catch (e) {
        global.logError("xtream-desklet-deck: failed to prepare icon " + style + "/" + name + ": " + e);
        return null;
    }
}

// Same recolor-and-cache approach as makeWhiteIconFile, for one-off custom SVGs that
// live outside the bundled Font Awesome set (icons/custom/) - keeps those out of the
// Font Awesome folder so attribution/licensing there stays accurate.
function makeCustomIconFile(deskletPath, name, hexColor) {
    let color = hexColor || "#ffffff";
    try {
        let cacheDir = GLib.get_user_cache_dir() + "/xtream-desklet-deck/icons";
        GLib.mkdir_with_parents(cacheDir, 0o755);
        let cachedPath = cacheDir + "/custom-" + name + "-" + color.replace("#", "") + ".svg";
        let cacheFile = Gio.File.new_for_path(cachedPath);
        if (!cacheFile.query_exists(null)) {
            let srcPath = deskletPath + "/icons/custom/" + name + ".svg";
            let [ok, contents] = GLib.file_get_contents(srcPath);
            if (!ok) return null;
            let svg = ByteArray.toString(contents).replace(/currentColor/g, color);
            GLib.file_set_contents(cachedPath, svg);
        }
        return Gio.icon_new_for_string(cachedPath);
    } catch (e) {
        global.logError("xtream-desklet-deck: failed to prepare custom icon " + name + ": " + e);
        return null;
    }
}

// Perceived-brightness (YIQ) check, standard threshold - decides whether a slot's
// label needs dark or light text to stay readable against its own custom background.
function isLightColor(hex) {
    if (!hex || hex[0] !== "#" || hex.length !== 7) return false;
    let r = parseInt(hex.substr(1, 2), 16);
    let g = parseInt(hex.substr(3, 2), 16);
    let b = parseInt(hex.substr(5, 2), 16);
    let brightness = (r * 299 + g * 587 + b * 114) / 1000;
    return brightness > 150;
}

function labelColorForSlot(slot) {
    return (slot.color && isLightColor(slot.color)) ? "#1a1a1a" : "white";
}

// Resolve a stored icon reference to a Gio icon. Supports three formats:
//  - "fa:<style>:<name>"  -> bundled Font Awesome icon (recolored white, cached)
//  - "/absolute/path.png" -> user-provided image file
//  - "icon-name"          -> themed system icon
function resolveIconGicon(deskletPath, iconRef) {
    if (!iconRef) return null;
    try {
        if (iconRef.startsWith("fa:")) {
            let parts = iconRef.split(":");
            return makeWhiteIconFile(deskletPath, parts[1], parts[2]);
        }
        return Gio.icon_new_for_string(iconRef);
    } catch (e) {
        return null;
    }
}

// Opens the system's native file picker (zenity) filtered to PNG/JPG/GIF, as an async
// subprocess - never blocks the Cinnamon shell. Always calls onDone exactly once,
// with the chosen path or "" (cancelled or failed to launch) - callers rely on
// onDone always firing to restore UI state they suspended while the picker was up.
function pickImageFileAsync(onDone) {
    try {
        let proc = Gio.Subprocess.new(
            ["zenity", "--file-selection", "--title=Choose an icon", "--file-filter=*.png *.jpg *.jpeg *.gif"],
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE
        );
        proc.communicate_utf8_async(null, null, (source, res) => {
            let path = "";
            try {
                let [success, stdout] = source.communicate_utf8_finish(res);
                if (success && stdout) path = stdout.trim();
            } catch (e) {
                global.logError("xtream-desklet-deck: zenity file picker failed: " + e);
            }
            onDone(path);
        });
    } catch (e) {
        global.logError("xtream-desklet-deck: failed to launch zenity (is it installed?): " + e);
        onDone("");
    }
}

// Validates and copies a user-picked image into the desklet's own config dir (backed
// up alongside instance state, unlike ~/.cache) so it survives independently of
// wherever the user originally kept the source file. Returns the new absolute path
// via onImported(path), or a human-readable message via onError(message).
function importCustomImageIcon(sourcePath, onImported, onError) {
    try {
        if (!/\.(png|jpe?g|gif)$/i.test(sourcePath)) {
            onError("Only PNG, JPG or GIF files are supported.");
            return;
        }
        let sourceFile = Gio.File.new_for_path(sourcePath);
        sourceFile.query_info_async("standard::size", Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, null, (src, res) => {
            try {
                let info = src.query_info_finish(res);
                if (info.get_size() > CUSTOM_ICON_MAX_BYTES) {
                    onError("File is larger than 2MB.");
                    return;
                }

                let destDir = GLib.get_user_config_dir() + "/xtream-desklet-deck/custom_icons";
                GLib.mkdir_with_parents(destDir, 0o755);
                let baseName = GLib.path_get_basename(sourcePath).replace(/[^a-zA-Z0-9._-]/g, "_");
                let destPath = destDir + "/" + Date.now() + "-" + baseName;
                let destFile = Gio.File.new_for_path(destPath);
                src.copy_async(destFile, Gio.FileCopyFlags.OVERWRITE, GLib.PRIORITY_DEFAULT, null, null, (src2, res2) => {
                    try {
                        src2.copy_finish(res2);
                        onImported(destPath);
                    } catch (e) {
                        onError("Failed to import icon.");
                        global.logError("xtream-desklet-deck: failed to import custom icon '" + sourcePath + "': " + e);
                    }
                });
            } catch (e) {
                onError("Failed to import icon.");
                global.logError("xtream-desklet-deck: failed to import custom icon '" + sourcePath + "': " + e);
            }
        });
    } catch (e) {
        onError("Failed to import icon.");
        global.logError("xtream-desklet-deck: failed to import custom icon '" + sourcePath + "': " + e);
    }
}

class XtreamDeckDesklet extends Desklet.Desklet {
    constructor(metadata, desklet_id) {
        super(metadata, desklet_id);
        this._metadata = metadata;
        this._statePath = GLib.get_user_config_dir() + "/xtream-desklet-deck/instances/" + desklet_id + ".json";
        this._currentPage = 0;
        this._pages = [emptyPage()];

        this._loadState(() => this._buildUI());
    }

    _loadState(onDone) {
        this._loadStateFrom(this._statePath, (ok) => {
            if (ok) {
                if (this._currentPage >= this._pages.length) this._currentPage = 0;
                onDone();
                return;
            }
            // Cinnamon assigns a new instance id (desklet_id) every time this desklet
            // is removed and re-added to the desktop, so a fresh instance normally has
            // no state file of its own yet. Recover the most recently saved state from
            // any other instance instead of starting from empty, so the user's button
            // configuration survives a remove/re-add (e.g. done to force a stylesheet
            // reload) instead of appearing to reset.
            this._findMostRecentStateFile((fallback) => {
                if (!fallback) {
                    onDone();
                    return;
                }
                this._loadStateFrom(fallback, () => {
                    if (this._currentPage >= this._pages.length) this._currentPage = 0;
                    onDone();
                });
            });
        });
    }

    _loadStateFrom(path, callback) {
        let file = Gio.File.new_for_path(path);
        file.load_contents_async(null, (source, res) => {
            let ok = false;
            try {
                let [success, contents] = source.load_contents_finish(res);
                if (success) {
                    let data = JSON.parse(ByteArray.toString(contents));
                    if (data && Array.isArray(data.pages) && data.pages.length > 0) {
                        this._pages = data.pages;
                        if (typeof data.currentPage === "number") {
                            this._currentPage = data.currentPage;
                        }
                        ok = true;
                    }
                }
            } catch (e) {
                ok = false;
            }
            callback(ok);
        });
    }

    _findMostRecentStateFile(callback) {
        try {
            let dirPath = GLib.path_get_dirname(this._statePath);
            let dir = Gio.File.new_for_path(dirPath);
            dir.enumerate_children_async(
                "standard::name,time::modified",
                Gio.FileQueryInfoFlags.NONE,
                GLib.PRIORITY_DEFAULT,
                null,
                (source, res) => {
                    let newestPath = null;
                    try {
                        let enumerator = source.enumerate_children_finish(res);
                        let newestSeconds = 0;
                        let info;
                        while ((info = enumerator.next_file(null)) !== null) {
                            let name = info.get_name();
                            if (!name.endsWith(".json")) continue;
                            let seconds = info.get_modification_time().tv_sec;
                            if (seconds > newestSeconds) {
                                newestSeconds = seconds;
                                newestPath = dirPath + "/" + name;
                            }
                        }
                    } catch (e) {
                        // Directory doesn't exist yet (first run ever) - not an error.
                    }
                    callback(newestPath);
                }
            );
        } catch (e) {
            global.logError("xtream-desklet-deck: failed to scan instance state files: " + e);
            callback(null);
        }
    }

    _saveState() {
        try {
            let dirPath = GLib.path_get_dirname(this._statePath);
            GLib.mkdir_with_parents(dirPath, 0o755);
            let data = { pages: this._pages, currentPage: this._currentPage };
            let bytes = new GLib.Bytes(ByteArray.fromString(JSON.stringify(data, null, 2)));
            let file = Gio.File.new_for_path(this._statePath);
            file.replace_contents_bytes_async(bytes, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null, (source, res) => {
                try {
                    source.replace_contents_finish(res);
                } catch (e) {
                    global.logError("xtream-desklet-deck: failed to save state: " + e);
                }
            });
        } catch (e) {
            global.logError("xtream-desklet-deck: failed to save state: " + e);
        }
    }

    _runCommand(command) {
        try {
            Util.spawnCommandLine(command);
        } catch (e) {
            global.logError("xtream-desklet-deck: failed to run command '" + command + "': " + e);
        }
    }

    _openDonateLink() {
        try {
            Util.spawn(["xdg-open", DONATE_URL]);
        } catch (e) {
            global.logError("xtream-desklet-deck: failed to open donate link: " + e);
        }
    }

    _makeDonateButton() {
        let btn = new St.Button({ style: "width: 22px; height: 22px; border-radius: 11px;" });
        let gicon = makeCustomIconFile(this._metadata.path, "coin", DONATE_COIN_COLOR);
        if (gicon) {
            btn.set_child(new St.Icon({ gicon: gicon, icon_size: 16 }));
        }
        new Tooltips.Tooltip(btn, "Support development ❤");
        btn.connect("clicked", () => this._openDonateLink());
        return btn;
    }

    _buildUI() {
        let root = new St.BoxLayout({ reactive: true, vertical: true, style_class: "xtream-deck-root", style: "background-color: rgba(20,20,20,0.85); border-radius: 10px; padding: 6px;" });

        // The base Desklet class's own About/Remove/Support menu should only ever
        // open from a right-click on the gear - not from the grid, an empty slot, a
        // page dot, the donate coin, or blank header/footer space. Each of those
        // either consumes its own right-click already (non-empty slots, page dots
        // p>=1) or, lacking any handler of their own, simply bubbles the event up to
        // here - reactive root now catches whatever wasn't already claimed by a more
        // specific descendant and swallows it, except when it actually originated on
        // the gear button itself (event.get_source() stays stable through bubbling).
        const guardNativeMenu = (actor, event) => {
            return event.get_button() === 3 && event.get_source() !== this._editButton;
        };
        root.connect("button-press-event", guardNativeMenu);
        root.connect("button-release-event", guardNativeMenu);

        let header = new St.BoxLayout({ vertical: false, style: "padding: 2px 4px 6px 4px;" });
        this._titleLabel = new St.Label({ text: this._metadata.name, style: "font-weight: bold; color: white; font-size: 13px;" });
        header.add(this._titleLabel, { expand: true, x_fill: true, x_align: St.Align.START, y_align: St.Align.MIDDLE });

        this._editButton = new St.Button({ style: "width: 24px; height: 24px; border-radius: 4px;" });
        header.add(this._editButton, { x_align: St.Align.END, y_align: St.Align.MIDDLE });
        // Left click opens the same About/Remove/Support menu that a right-click
        // anywhere on the gear already does natively (see guardNativeMenu above) -
        // the gear no longer toggles any edit mode, since drag-to-reorder and the
        // right-click "Edit"/"Move to..." menu on each slot cover that already.
        this._editButton.connect("clicked", () => {
            this._menu.toggle();
        });

        root.add(header);

        this._gridBin = new St.Bin();
        root.add(this._gridBin);

        this._footer = new St.BoxLayout({ vertical: false });
        // Three zones in one row: an invisible spacer, the dots (expanded + centered
        // in whatever space remains), and the donate coin - the spacer matches the
        // coin's width so the dots stay exactly centered under the grid instead of
        // drifting left to make room for the coin on the right.
        let footerRow = new St.BoxLayout({ vertical: false, style: "padding: 6px 0 0 0;" });
        let footerSpacer = new St.Bin({ style: "width: 22px; height: 22px;" });
        footerRow.add(footerSpacer, { y_align: St.Align.MIDDLE });
        footerRow.add(this._footer, { expand: true, x_align: St.Align.MIDDLE, x_fill: false, y_align: St.Align.MIDDLE });
        footerRow.add(this._makeDonateButton(), { y_align: St.Align.MIDDLE });
        root.add(footerRow, { x_fill: true });

        // Right-click context menu item, added before finalizeContextMenu() runs (the
        // desklet manager calls it right after this constructor returns) so it lands
        // above the separator, ahead of the built-in "About..."/"Remove" items.
        let donateMenuItem = new PopupMenu.PopupMenuItem("❤ Support development");
        donateMenuItem.connect("activate", () => this._openDonateLink());
        this._menu.addMenuItem(donateMenuItem);

        this.setContent(root);
        this._render();
    }

    on_desklet_removed(deleteConfig) {
        this._closeSlotContextMenu();
    }

    _render() {
        this._renderGear();
        this._renderGrid();
        this._renderFooter();
    }

    _renderGear() {
        this._editButton.destroy_all_children();
        let gicon = makeWhiteIconFile(this._metadata.path, "solid", "gear");
        if (gicon) {
            this._editButton.set_child(new St.Icon({ gicon: gicon, icon_size: 14 }));
        } else {
            this._editButton.set_child(new St.Label({ text: "⚙", style: "color: white;" }));
        }
    }

    _renderGrid() {
        let grid = new St.Table({ homogeneous: false });
        let page = this._pages[this._currentPage];
        this._slotButtons = [];

        for (let i = 0; i < SLOTS_PER_PAGE; i++) {
            let row = Math.floor(i / COLUMNS);
            let col = i % COLUMNS;
            let slot = page.slots[i];
            grid.add(this._makeSlotButton(slot, i), { row: row, col: col, x_expand: false, y_expand: false });
        }

        this._gridBin.set_child(grid);
    }

    _makeSlotButton(slot, slotIndex) {
        let bgColor = slot.color || "rgba(255,255,255,0.06)";
        let hoverBgColor = slot.color || "rgba(255,255,255,0.16)";
        let borderColor = "rgba(255,255,255,0.5)";
        let hoverBorderColor = "white";

        const baseStyle = (borderOverride) => "width: " + BUTTON_SIZE + "px; height: " + BUTTON_SIZE + "px; background-color: " + bgColor + "; border-radius: 10px; border: 2px solid " + (borderOverride || borderColor) + ";";
        const hoverStyle = () => "width: " + BUTTON_SIZE + "px; height: " + BUTTON_SIZE + "px; background-color: " + hoverBgColor + "; border-radius: 10px; border: 2px solid " + hoverBorderColor + ";";
        const highlightStyle = () => "width: " + BUTTON_SIZE + "px; height: " + BUTTON_SIZE + "px; background-color: " + hoverBgColor + "; border-radius: 10px; border: 3px solid #2D6DD9;";

        // Outer button: fixed size, never scaled. It's the actual reactive/hoverable
        // actor, so its hover hit-test region always stays exactly BUTTON_SIZE - if it
        // were the thing scaling up on hover, Clutter's picking (which follows the
        // transformed box) would grow its hit region into the neighboring slot's
        // margin, making that neighbor flicker hover too. The chrome (background/
        // border) and the grow-on-hover live on an inner St.Bin instead, which is free
        // to visually overflow into the margin gap without affecting anyone's hit-test.
        let button = new St.Button({ style: "width: " + BUTTON_SIZE + "px; height: " + BUTTON_SIZE + "px; margin: " + SLOT_MARGIN + "px;" });
        let visual = new St.Bin({ style: baseStyle() });
        visual.set_pivot_point(0.5, 0.5);
        // Stashed on the actor so the drag-highlight (_setSlotHighlight) can restyle
        // it without needing to recompute bgColor/borderColor from scratch.
        visual._baseStyle = baseStyle;
        visual._highlightStyle = highlightStyle;
        button.set_child(visual);

        if (slot.label) {
            new Tooltips.Tooltip(button, slot.label);
        }

        // "Inchadinha": grows slightly and brightens on hover, same pattern used
        // across the gimmyclues app (.btn-secondary-purple:hover -> scale(1.04)).
        button.connect("notify::hover", () => {
            if (button.hover) {
                visual.scale_x = 1.04;
                visual.scale_y = 1.04;
                visual.style = hoverStyle();
            } else {
                visual.scale_x = 1.0;
                visual.scale_y = 1.0;
                visual.style = baseStyle();
            }
        });

        let box = new St.BoxLayout({ vertical: true, x_align: St.Align.MIDDLE });

        let gicon = resolveIconGicon(this._metadata.path, slot.icon);
        if (gicon) {
            box.add(new St.Icon({ gicon: gicon, icon_size: ICON_SIZE }), { x_fill: false, x_align: St.Align.MIDDLE });
        }
        if (slot.label && slot.showTitle !== false) {
            box.add(new St.Label({ text: slot.label, style: "font-size: 9px; color: " + labelColorForSlot(slot) + "; text-align: center;" }), { x_fill: false, x_align: St.Align.MIDDLE });
        }
        visual.set_child(box);

        this._slotButtons.push({ button: button, visual: visual, slotIndex: slotIndex });

        let desklet = this;

        // Right-click, any slot (empty or not): a small context menu with "Edit"
        // and, when there's more than one page and this slot actually has something
        // in it, "Move to next/previous page". Consumed at button-press-event (not
        // "clicked") for the same reason as the page dots' own right-click handling
        // below - stops St.Button's internal click tracking from also firing the
        // left-click action for this same press.
        button.connect("button-press-event", (actor, pressEvent) => {
            if (pressEvent.get_button() !== 3) return false;
            desklet._openSlotContextMenu(slotIndex, button);
            return true;
        });
        // The base Desklet class opens its own About/Remove menu from
        // 'button-release-event' on the desklet's root actor (an ancestor of this
        // button), not from 'button-press-event' - consuming just the press above
        // stops that menu from being *triggered* fresh, but the matching release
        // for the same right-click still bubbles up afterwards and toggles it open.
        // Needs consuming separately here too.
        button.connect("button-release-event", (actor, releaseEvent) => {
            return releaseEvent.get_button() === 3;
        });

        // Press-and-hold-to-drag-and-swap between slots. A plain click instead runs
        // the button's command (see the no-drag branch in _startSlotDrag below) -
        // configuring a slot only happens via the right-click "Edit" above now.
        // imports.ui.dnd was dropped: it left a stray blue placeholder overlay on
        // screen and never actually triggered the swap (see limitation #9 in memory
        // - superseded by this). Replaced with a hand-rolled drag: a Clutter.Clone
        // ghost follows the pointer via a stage-level "captured-event" listener, the
        // same low-level mechanism imports.ui.dnd itself uses internally. A short
        // move threshold keeps a plain click from being swallowed as a drag.
        button.connect("button-press-event", (actor, pressEvent) => {
            if (pressEvent.get_button() !== 1) return false;
            // Consume the press so St.Button never arms its own internal
            // press/click tracking (which appears to hold an implicit pointer
            // grab) - left uncontested, it was racing our own drag tracking and
            // swallowing the real release, leaving the ghost stuck "hanging"
            // until an unrelated later click (wrongly opening the editor) or a
            // right-click finally freed it. We now own the whole press-drag-
            // release lifecycle ourselves, including firing the click action.
            desklet._startSlotDrag(slotIndex, button, pressEvent);
            return true;
        });

        return button;
    }

    _startSlotDrag(sourceSlotIndex, sourceButton, pressEvent) {
        const DRAG_THRESHOLD = 6;
        let [startX, startY] = pressEvent.get_coords();
        let dragging = false;
        let ghost = null;
        let highlighted = null;
        let targetSlotIndex = -1;
        let desklet = this;

        let capturedId = global.stage.connect("captured-event", (actor, event) => {
            let type = event.type();

            if (type === Clutter.EventType.MOTION) {
                let [x, y] = event.get_coords();

                if (!dragging) {
                    if (Math.abs(x - startX) < DRAG_THRESHOLD && Math.abs(y - startY) < DRAG_THRESHOLD) {
                        return false;
                    }
                    dragging = true;
                    ghost = desklet._makeDragGhost(sourceButton);
                    Main.uiGroup.add_actor(ghost);
                }

                let [w, h] = ghost.get_size();
                ghost.set_position(x - w / 2, y - h / 2);

                let hovered = desklet._slotButtonAt(x, y);
                let hoveredButton = (hovered && hovered.slotIndex !== sourceSlotIndex) ? hovered.button : null;
                if (highlighted !== hoveredButton) {
                    if (highlighted) desklet._setSlotHighlight(highlighted, false);
                    if (hoveredButton) desklet._setSlotHighlight(hoveredButton, true);
                    highlighted = hoveredButton;
                }
                targetSlotIndex = hoveredButton ? hovered.slotIndex : -1;
                return true;
            }

            if (type === Clutter.EventType.BUTTON_RELEASE) {
                global.stage.disconnect(capturedId);
                if (highlighted) desklet._setSlotHighlight(highlighted, false);
                if (ghost) ghost.destroy();

                if (dragging) {
                    // Deferred to the next idle cycle: mutating slots + destroying/
                    // rebuilding the whole grid synchronously, while still inside this
                    // same captured-event dispatch, was leaving Clutter's click-tracking
                    // confused enough that the drop needed a second, unrelated click to
                    // actually settle - letting this event finish unwinding first avoids
                    // that.
                    if (targetSlotIndex !== -1) {
                        Mainloop.idle_add(() => {
                            desklet._swapSlots(sourceSlotIndex, targetSlotIndex);
                            return false;
                        });
                    }
                } else {
                    // No movement past the threshold: this was a plain click, and since
                    // we consumed the press ourselves (see button-press-event above),
                    // we're the ones responsible for running its command too. An empty
                    // slot has nothing to run, so a plain left-click there opens its
                    // editor directly instead - saves the right-click detour for the
                    // common case of configuring a never-used slot.
                    let slot = desklet._pages[desklet._currentPage].slots[sourceSlotIndex];
                    if (slot.command) {
                        desklet._runCommand(slot.command);
                    } else if (isEmptySlot(slot)) {
                        desklet._openEditor(sourceSlotIndex);
                    }
                }
                return true;
            }

            return false;
        });
    }

    _makeDragGhost(sourceButton) {
        let [w, h] = sourceButton.get_size();
        let ghost = new Clutter.Clone({ source: sourceButton, reactive: false, opacity: 200 });
        ghost.set_size(w, h);
        return ghost;
    }

    _slotButtonAt(x, y) {
        for (let i = 0; i < this._slotButtons.length; i++) {
            let entry = this._slotButtons[i];
            let [bx, by] = entry.button.get_transformed_position();
            let [bw, bh] = entry.button.get_transformed_size();
            if (x >= bx && x <= bx + bw && y >= by && y <= by + bh) {
                return entry;
            }
        }
        return null;
    }

    _setSlotHighlight(button, on) {
        let visual = button.get_child();
        visual.style = on ? visual._highlightStyle() : visual._baseStyle();
    }

    _swapSlots(a, b) {
        let page = this._pages[this._currentPage];
        let tmp = page.slots[a];
        page.slots[a] = page.slots[b];
        page.slots[b] = tmp;
        this._saveState();
        this._render();
    }

    _openEditor(slotIndex) {
        let page = this._pages[this._currentPage];
        let slot = page.slots[slotIndex];

        let dialog = new ButtonEditorDialog(
            this._metadata.path,
            slot,
            (updatedSlot) => {
                page.slots[slotIndex] = updatedSlot;
                this._saveState();
                this._render();
            },
            () => {
                page.slots[slotIndex] = emptySlot();
                this._saveState();
                this._render();
            }
        );
        dialog.open();
    }

    // Small hand-rolled context menu (not Cinnamon's PopupMenu/PopupMenuManager -
    // those are meant for one long-lived menu per owner, and every render here
    // destroys and recreates all slot buttons, which would leave stale menus
    // registered against dead source actors). Dismissed on any click outside it.
    _openSlotContextMenu(slotIndex, button) {
        this._closeSlotContextMenu();

        let page = this._pages[this._currentPage];
        let slot = page.slots[slotIndex];
        let hasContent = !isEmptySlot(slot);
        let canMoveNext = hasContent && this._findFreeSlotInDirection(1) !== null;
        let canMovePrevious = hasContent && this._findFreeSlotInDirection(-1) !== null;

        let menu = new St.BoxLayout({
            vertical: true,
            style: "background-color: #2b2b2b; border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; padding: 6px;"
        });

        const addItem = (text, onClick) => {
            // x_align/x_fill go on the button itself, not a wrapper around its
            // label - it's the button that gets stretched wide by the menu's own
            // x_fill (to match its widest sibling), so it's the button's own
            // alignment that decides where its label sits inside that wider box.
            let item = new St.Button({ style: "padding: 8px 18px; border-radius: 5px;", x_align: St.Align.START, x_fill: true });
            item.set_child(new St.Label({ text: text, style: "color: white; font-size: 14px;" }));
            item.connect("notify::hover", () => {
                item.style = "padding: 8px 18px; border-radius: 5px;" + (item.hover ? " background-color: rgba(255,255,255,0.12);" : "");
            });
            item.connect("clicked", () => {
                this._closeSlotContextMenu();
                onClick();
            });
            menu.add(item, { x_fill: true });
        };

        addItem("Edit", () => this._openEditor(slotIndex));
        if (hasContent && this._findNearestFreeSlot(slotIndex) !== null) {
            addItem("Duplicate", () => this._duplicateSlot(slotIndex));
        }
        if (canMoveNext) {
            addItem("Move to next page", () => this._moveSlotToNextAvailablePage(slotIndex));
        }
        if (canMovePrevious) {
            addItem("Move to previous page", () => this._moveSlotToPreviousAvailablePage(slotIndex));
        }
        if (hasContent) {
            addItem("Delete button", () => this._confirmDeleteSlot(slotIndex));
        }

        // addChrome (not uiGroup.add_actor) so the menu joins the stage input
        // region - otherwise the part outside the desklet's own area ignores hover/clicks.
        Main.layoutManager.addChrome(menu);
        let [x, y] = global.get_pointer();
        menu.set_position(x, y);
        this._slotContextMenu = menu;

        this._slotContextMenuCaptureId = global.stage.connect("captured-event", (actor, event) => {
            let type = event.type();
            if (type === Clutter.EventType.BUTTON_PRESS) {
                let [ex, ey] = event.get_coords();
                let [mx, my] = menu.get_transformed_position();
                let [mw, mh] = menu.get_transformed_size();
                if (ex < mx || ex > mx + mw || ey < my || ey > my + mh) {
                    this._closeSlotContextMenu();
                }
            } else if (type === Clutter.EventType.KEY_PRESS && event.get_key_symbol() === Clutter.KEY_Escape) {
                this._closeSlotContextMenu();
            }
            return false;
        });
    }

    _closeSlotContextMenu() {
        if (this._slotContextMenuCaptureId) {
            global.stage.disconnect(this._slotContextMenuCaptureId);
            this._slotContextMenuCaptureId = null;
        }
        if (this._slotContextMenu) {
            Main.layoutManager.removeChrome(this._slotContextMenu);
            this._slotContextMenu.destroy();
            this._slotContextMenu = null;
        }
    }

    // Searches page by page away from the current one (step +1 for later pages,
    // -1 for earlier ones) and returns the first { pageIndex, freeIndex } found, or
    // null if none of the pages in that direction have room. Used both to decide
    // whether the "Move to..." menu items should even appear and to carry out the
    // move itself.
    _findFreeSlotInDirection(step) {
        for (let p = this._currentPage + step; p >= 0 && p < this._pages.length; p += step) {
            let freeIndex = this._pages[p].slots.findIndex(isEmptySlot);
            if (freeIndex !== -1) return { pageIndex: p, freeIndex: freeIndex };
        }
        return null;
    }

    // Nearest empty slot to slotIndex on the current page, else the first free
    // one on later pages, else on earlier pages. Returns { pageIndex, freeIndex } or null.
    _findNearestFreeSlot(slotIndex) {
        let slots = this._pages[this._currentPage].slots;
        let best = -1;
        for (let i = 0; i < slots.length; i++) {
            if (!isEmptySlot(slots[i])) continue;
            if (best === -1 || Math.abs(i - slotIndex) < Math.abs(best - slotIndex)) best = i;
        }
        if (best !== -1) return { pageIndex: this._currentPage, freeIndex: best };
        return this._findFreeSlotInDirection(1) || this._findFreeSlotInDirection(-1);
    }

    _duplicateSlot(slotIndex) {
        let target = this._findNearestFreeSlot(slotIndex);
        if (!target) return;
        this._pages[target.pageIndex].slots[target.freeIndex] = Object.assign({}, this._pages[this._currentPage].slots[slotIndex]);
        this._saveState();
        this._render();
    }

    _confirmDeleteSlot(slotIndex) {
        let page = this._pages[this._currentPage];
        let name = page.slots[slotIndex].label;
        let dialog = new ConfirmDialog(
            this._metadata.path,
            "Delete button?",
            (name ? "\"" + name + "\" will be" : "This button will be") + " permanently removed. This cannot be undone.",
            "Delete",
            () => {
                page.slots[slotIndex] = emptySlot();
                this._saveState();
                this._render();
            }
        );
        dialog.open();
    }

    _moveSlotTo(slotIndex, target) {
        let sourcePage = this._pages[this._currentPage];
        let slot = sourcePage.slots[slotIndex];
        this._pages[target.pageIndex].slots[target.freeIndex] = slot;
        sourcePage.slots[slotIndex] = emptySlot();
        this._saveState();
        this._render();
    }

    // Not reachable from the menu itself (the menu item only appears when
    // _findFreeSlotInDirection already found room), but kept as a safety net.
    _moveSlotToNextAvailablePage(slotIndex) {
        let target = this._findFreeSlotInDirection(1);
        if (target) {
            this._moveSlotTo(slotIndex, target);
            return;
        }
        new InfoDialog(
            this._metadata.path,
            "No slot available",
            "There is no available slot on any later page to move this button to."
        ).open();
    }

    _moveSlotToPreviousAvailablePage(slotIndex) {
        let target = this._findFreeSlotInDirection(-1);
        if (target) {
            this._moveSlotTo(slotIndex, target);
            return;
        }
        new InfoDialog(
            this._metadata.path,
            "No slot available",
            "There is no available slot on any earlier page to move this button to."
        ).open();
    }

    _renderFooter() {
        this._footer.destroy_all_children();

        for (let p = 0; p < this._pages.length; p++) {
            let isCurrent = p === this._currentPage;
            let dot = new St.Button({
                style: "width: 22px; height: 22px; margin: 2px; border-radius: 11px; " +
                       (isCurrent
                           ? "background-color: rgba(255,255,255,0.9); color: #1a1a1a;"
                           : "background-color: rgba(255,255,255,0.2); color: white;"),
                label: String(p + 1)
            });
            dot.connect("clicked", () => {
                this._currentPage = p;
                this._saveState();
                this._render();
            });
            if (p >= 1) {
                // Swallow the right-click at button-press-event, before St.Button's own
                // handler ever runs, so it never arms its internal "pressed" click
                // detection. A suppressNextClick flag tried after the fact (post-release)
                // did not reliably stop "clicked" from also firing - it stacked a second
                // ConfirmDialog underneath (Cancel only closed the top one). Consuming the
                // press (return true) starves "clicked" at the source instead.
                dot.connect("button-press-event", (actor, event) => {
                    if (event.get_button() === 3) {
                        this._confirmRemovePage(p);
                        return true;
                    }
                    return false;
                });
            }
            this._footer.add(dot);
        }

        if (this._pages.length < MAX_PAGES) {
            let addBtn = new St.Button({ style: "width: 22px; height: 22px; margin: 2px; border-radius: 11px; background-color: rgba(255,255,255,0.2);", label: "+" });
            addBtn.connect("clicked", () => this._confirmAddPage());
            this._footer.add(addBtn);
        }
    }

    _confirmRemovePage(pageIndex) {
        let dialog = new ConfirmDialog(
            this._metadata.path,
            "Remove page " + (pageIndex + 1) + "?",
            "This will permanently delete all buttons configured on this page. This cannot be undone.",
            "Remove Page",
            () => this._removePage(pageIndex)
        );
        dialog.open();
    }

    _confirmAddPage() {
        let dialog = new ConfirmDialog(
            this._metadata.path,
            "Add page " + (this._pages.length + 1) + "?",
            "This will add a new page with 10 empty buttons.",
            "Add Page",
            () => {
                this._pages.push(emptyPage());
                this._currentPage = this._pages.length - 1;
                this._saveState();
                this._render();
            },
            "#2D6DD9"
        );
        dialog.open();
    }

    _removePage(pageIndex) {
        if (pageIndex === 0 || this._pages.length <= 1) return;
        this._pages.splice(pageIndex, 1);
        if (this._currentPage >= this._pages.length) {
            this._currentPage = this._pages.length - 1;
        } else if (this._currentPage > pageIndex) {
            this._currentPage -= 1;
        }
        this._saveState();
        this._render();
    }
}

function main(metadata, desklet_id) {
    return new XtreamDeckDesklet(metadata, desklet_id);
}
