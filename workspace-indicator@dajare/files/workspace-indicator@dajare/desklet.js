const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Settings = imports.ui.settings;


class WorkspaceIndicatorDesklet extends Desklet.Desklet {

    constructor(metadata, deskletId) {
        super(metadata, deskletId);

        this._workspaceManager = global.workspace_manager;
        this._signals = [];

        /*
         * Bind Cinnamon settings.
         */
        this.settings = new Settings.DeskletSettings(
            this,
            metadata.uuid,
            deskletId
        );

        this.settings.bindProperty(
            Settings.BindingDirection.IN,
            "font",
            "font",
            this._settingsChanged.bind(this)
        );

        this.settings.bindProperty(
            Settings.BindingDirection.IN,
            "font-size",
            "fontSize",
            this._settingsChanged.bind(this)
        );

        this.settings.bindProperty(
            Settings.BindingDirection.IN,
            "foreground-color",
            "foregroundColor",
            this._settingsChanged.bind(this)
        );

        this.settings.bindProperty(
            Settings.BindingDirection.IN,
            "foreground-opacity",
            "foregroundOpacity",
            this._settingsChanged.bind(this)
        );

        this.settings.bindProperty(
            Settings.BindingDirection.IN,
            "background-color",
            "backgroundColor",
            this._settingsChanged.bind(this)
        );

        this.settings.bindProperty(
            Settings.BindingDirection.IN,
            "show-total",
            "showTotal",
            this._settingsChanged.bind(this)
        );

        /*
         * The outer box is the actual desklet area, so the background
         * colour is restricted to the desklet rather than the desktop.
         */
        this._box = new St.BoxLayout({
            vertical: false,
            style_class: "workspace-number-box"
        });

        this._workspaceLabel = new St.Label({
            text: ""
        });

        this._totalLabel = new St.Label({
            text: ""
        });

        this._box.add_child(this._workspaceLabel);
        this._box.add_child(this._totalLabel);

        this.setContent(this._box);

        /*
         * Update when the active workspace changes.
         */
        this._signals.push(
            this._workspaceManager.connect(
                "workspace-switched",
                this._workspaceChanged.bind(this)
            )
        );

        /*
         * Also update if workspaces are added or removed.
         */
        this._signals.push(
            this._workspaceManager.connect(
                "workspace-added",
                this._workspaceChanged.bind(this)
            )
        );

        this._signals.push(
            this._workspaceManager.connect(
                "workspace-removed",
                this._workspaceChanged.bind(this)
            )
        );

        this._update();
    }


    _settingsChanged() {
        this._update();
    }


    _workspaceChanged() {
        this._update();
    }


    /*
     * Turn "rgb(255,255,255)" into "rgba(255,255,255,1.0)".
     *
     * Cinnamon's colour chooser normally supplies rgb(...) strings.
     */
    _withOpacity(color, opacity) {
        if (!color)
            return color;

        let match = color.match(
            /^rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/
        );

        if (match) {
            return "rgba(" +
                match[1] + "," +
                match[2] + "," +
                match[3] + "," +
                opacity +
                ")";
        }

        /*
         * If Cinnamon supplies some other CSS colour representation,
         * leave it alone rather than breaking the desklet.
         */
        return color;
    }


    /*
     * The font chooser returns a Pango-style description such as:
     *
     *     "DejaVu Sans 48"
     *
     * We only need the family name here because the size is controlled
     * separately by our font-size setting.
     */
    _fontFamily(fontDescription) {
        if (!fontDescription)
            return "Sans";

        /*
         * Remove the final numeric size from the font description.
         */
        let match = fontDescription.match(/^(.+?)\s+\d+(?:\.\d+)?$/);

        if (match)
            return match[1];

        return fontDescription;
    }


    _update() {
        let current =
            this._workspaceManager.get_active_workspace_index() + 1;

        let total =
            this._workspaceManager.get_n_workspaces();

        /*
         * Main number.
         */
        this._workspaceLabel.set_text(String(current));

        /*
         * Secondary /total number.
         *
         * Since "em" is the size of the main font, the secondary
         * text is 1.5em LESS than the main size, with a sensible
         * minimum of 6pt.
         */
        if (this.showTotal) {
            this._totalLabel.set_text("/" + total);
            this._totalLabel.show();
        } else {
            this._totalLabel.set_text("");
            this._totalLabel.hide();
        }

        this._applyStyle();
    }


    _applyStyle() {
        let family = this._fontFamily(this.font);

        let mainSize = Number(this.fontSize);

        if (!isFinite(mainSize) || mainSize < 6)
            mainSize = 48;

        /*
         * Secondary text is 1.5em smaller than the main text.
         *
         * A minimum size prevents it becoming invisible if somebody
         * chooses a very small main font.
         */
        let secondarySize =
            Math.max(6, mainSize - (mainSize * 1.5));
            secondarySize = Math.max(6, mainSize * 0.60);

        let foreground = this._withOpacity(
            this.foregroundColor,
            this.foregroundOpacity
        );

        let background = this._withOpacity(
            this.backgroundColor,
            this.backgroundOpacity
        );

        /*
         * Background belongs to _box, not the desktop.
         */
        this._box.set_style(
            "background-color: " + background + ";" +
            "padding: 4px;" +
            "border-radius: 4px;"
        );

        /*
         * Main workspace number.
         */
        this._workspaceLabel.set_style(
            "font-family: '" + family + "';" +
            "font-size: " + mainSize + "pt;" +
            "font-weight: bold;" +
            "color: " + foreground + ";"
        );

        /*
         * /total.
         */
        this._totalLabel.set_style(
            "font-family: '" + family + "';" +
            "font-size: " + secondarySize + "pt;" +
            "font-weight: normal;" +
            "color: " + foreground + ";"
        );
    }


    on_desklet_removed() {
        for (let signal of this._signals) {
            this._workspaceManager.disconnect(signal);
        }

        this._signals = [];
    }
}


function main(metadata, deskletId) {
    return new WorkspaceIndicatorDesklet(metadata, deskletId);
}
