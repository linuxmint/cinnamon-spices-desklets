// Hello, this is a desklet I wrote using AI to show a christmas tree.
// Nic Nielsen - November 2026
// New Tecumseth, Ontario, Canada
// Merry Christmas!

// Universal module mapping context across Cinnamon 5.x and 6.x versions
let Desklet, St, GLib, Settings;

if (globalThis.imports) {
    // Legacy Cinnamon 5.x & Modern Cinnamon 6.x Native CJS/GIR tracking
    Desklet = globalThis.imports.ui.desklet;
    St = globalThis.imports.gi.St;
    GLib = globalThis.imports.gi.GLib;
    Settings = globalThis.imports.ui.settings;
} else {
    // Fallback context for strict isolated environments
    Desklet = globalThis.Desklet;
    St = globalThis.St;
    GLib = globalThis.GLib;
    Settings = globalThis.Settings;
}

class ChristmasTreeDesklet extends Desklet.Desklet {
    constructor(metadata, desklet_id) {
        super(metadata, desklet_id);
        this.metadata = metadata;

        this.deskletScale = 1.0; // Added tracking variable for slider scaling
        this.blinkSpeed = 500;
        this.numberOfLights = 20;
        this.treeColor = "#00FF00";
        this.treeOpacity = 1.0;
        this.showStar = true;
        this.starColor = "#FFFF00";

        try {
            this.settings = new Settings.DeskletSettings(this, this.metadata.uuid, desklet_id);
            // Bind scale setting to our new scale handler function
            this.settings.bind("desklet-scale", "deskletScale", this._onScaleChanged.bind(this));
            this.settings.bind("blink-speed", "blinkSpeed", this._onSettingsChanged.bind(this));
            this.settings.bind("number-of-lights", "numberOfLights", this._onSettingsChanged.bind(this));
            this.settings.bind("tree-color", "treeColor", this._onSettingsChanged.bind(this));
            this.settings.bind("tree-opacity", "treeOpacity", this._onSettingsChanged.bind(this));
            this.settings.bind("show-star", "showStar", this._onSettingsChanged.bind(this));
            this.settings.bind("star-color", "starColor", this._onSettingsChanged.bind(this));
        } catch (e) {
            if (globalThis.global && globalThis.global.logError) {
                globalThis.global.logError("Settings failed to load: " + e);
            }
        }

        this._timeoutId = null;
        
        // 1. Permanently construct the layout frame ONCE
        this._buildLayoutFramework();
    }

    // Cinnamon native lifecycle hook: Safely runs code AFTER mounting to the desktop environment
    on_desklet_added_to_desktop() {
        this._onScaleChanged(); // Set the initial scale upon mounting
        this._updateUIState();
        this._startAnimation();
    }

    _onScaleChanged() {
        // Multiplies X and Y bounding coordinates natively using the underlying Clutter window manager matrix
        if (this.actor) {
            this.actor.set_scale(this.deskletScale, this.deskletScale);
        }
    }

    _onSettingsChanged() {
        this._updateUIState();
        this._startAnimation(); 
    }

    _buildLayoutFramework() {
        // Setup your layout box container exactly as before
        this.content = new St.BoxLayout({
            vertical: true,
            x_align: St.Align.MIDDLE,
            y_align: St.Align.MIDDLE
        });

        // Link external user container stylesheet definitions
        this.content.add_style_class_name("desklet");

        // Instantiate Star
        this.starLabel = new St.Label({
            style: "font-size: 28px; text-align: center;"
        });
        this.content.add_actor(this.starLabel);

        // Instantiate Tree branch lines
        this.rows = [];
        this.totalRows = 8;
        for (let r = 0; r < this.totalRows; r++) {
            let label = new St.Label({
                style: "font-family: monospace; font-size: 16px; text-align: center;"
            });
            label.get_clutter_text().set_use_markup(true);
            this.rows.push(label);
            this.content.add_actor(label);
        }

        // Instantiate Trunk
        this.trunkLabel = new St.Label({
            text: "🛍️🎁  ██  📦🧸",
            style: "font-family: monospace; font-size: 18px; color: #8B4513; text-align: center;"
        });
        this.content.add_actor(this.trunkLabel);

        // 2. Direct injection bypass: Mount to Cinnamon's pre-existing container directly
        if (typeof this.setContent === 'function') {
            // Safe fallback path if the system container behaves
            try {
                this.setContent(this.content);
            } catch (e) {
                this.actor.add_actor(this.content);
            }
        } else {
            // Direct injection to the underlying Clutter Actor scene graph
            this.actor.add_actor(this.content);
        }
    }

    _updateUIState() {
        let starColor = this.starColor || "#FFFF00";
        let showStar = this.showStar !== undefined ? this.showStar : true;
        let opacity = this.treeOpacity !== undefined ? this.treeOpacity : 1.0;

        // Dynamically inject the background-color style container using black (0, 0, 0) and your slider opacity
        this.content.set_style(`background-color: rgba(0, 0, 0, ${opacity}); padding: 15px; border-radius: 8px;`);

        this.starLabel.set_text(showStar ? "★" : " ");
        this.starLabel.set_style(`font-size: 28px; color: ${starColor}; text-align: center;`);

        this._redrawTree();
    }

    _redrawTree() {
        let totalRows = this.rows.length;
        let maxWidth = 15;
        let treeColor = this.treeColor || "#00FF00";

        let branchIndices = [];
        let rawTreeGrid = [];

        for (let r = 0; r < totalRows; r++) {
            let treeChars = 2 * r + 1;
            let pad = Math.floor((maxWidth - treeChars) / 2);
            let rowChars = [];

            for (let p = 0; p < pad; p++) rowChars.push(" ");
            
            for (let c = 0; c < treeChars; c++) {
                branchIndices.push({ row: r, col: pad + c });
                rowChars.push("*");
            }
            
            for (let p = 0; p < maxWidth - pad - treeChars; p++) rowChars.push(" ");
            
            rawTreeGrid.push(rowChars);
        }

        let lightsToPlace = Math.min(this.numberOfLights || 10, branchIndices.length);
        let lightPool = [...branchIndices];
        let chosenLightPositions = [];

        for (let i = 0; i < lightsToPlace; i++) {
            if (lightPool.length === 0) break;
            let randIndex = Math.floor(Math.random() * lightPool.length);
            // FIX: Extraction targets the structural inner item [0] directly
            chosenLightPositions.push(lightPool.splice(randIndex, 1)[0]);
        }

        let bulbStyles = ["*", "*", "*"];
        let lightColors = ["#0000FF", "#FFFFFF", "#00FFFF", "#FF0000", "#FFA500", "#FFEA00"];

        chosenLightPositions.forEach(pos => {
            if (pos && typeof pos.row === 'number' && typeof pos.col === 'number') {
                let targetRow = rawTreeGrid[pos.row];
                if (targetRow && targetRow[pos.col] !== undefined) {
                    let randomChar = bulbStyles[Math.floor(Math.random() * bulbStyles.length)];
                    let randomColor = lightColors[Math.floor(Math.random() * lightColors.length)];
                    targetRow[pos.col] = `<span foreground="${randomColor}">${randomChar}</span>`;
                }
            }
        });

        for (let r = 0; r < totalRows; r++) {
            let finalMarkupRow = "";
            for (let c = 0; c < maxWidth; c++) {
                let char = rawTreeGrid[r][c];
                if (char === "*") {
                    finalMarkupRow += `<span foreground="${treeColor}">*</span>`;
                } else {
                    finalMarkupRow += char;
                }
            }
            this.rows[r].get_clutter_text().set_markup(finalMarkupRow);
        }
    }

    _startAnimation() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = null;
        }

        let speed = this.blinkSpeed || 500;
        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, speed, () => {
            this._redrawTree(); 
            return true; 
        });
    }

    on_desklet_removed() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
        }
    }
}

function main(metadata, desklet_id) {
    return new ChristmasTreeDesklet(metadata, desklet_id);
}

// Satisfy all Cinnamon compilation standards via global namespace hooks
globalThis.main = main;

