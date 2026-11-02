const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Settings = imports.ui.settings;
const Pango = imports.gi.Pango;

class WatermarkDesklet extends Desklet.Desklet {
    constructor(metadata, desklet_id) {
        super(metadata, desklet_id);

        this.settings = new Settings.DeskletSettings(this, this.metadata.uuid, desklet_id);

        const onSettingsChanged = this.on_settings_changed.bind(this);
        this.settings.bind("title_text", "title_text", onSettingsChanged);
        this.settings.bind("subtitle_text", "subtitle_text", onSettingsChanged);
        this.settings.bind("font_setting", "font_setting", onSettingsChanged);
        this.settings.bind("text_opacity", "text_opacity", onSettingsChanged);
        this.settings.bind("subtitle_scale", "subtitle_scale", onSettingsChanged);
        this.settings.bind("enable_shadow", "enable_shadow", onSettingsChanged);

        this.setupUI();
    }

    setupUI() {
        this.windowContainer = new St.BoxLayout({
            vertical: true,
        });

        this.title_label = new St.Label();
        this.subtitle_label = new St.Label();

        this.windowContainer.add_actor(this.title_label);
        this.windowContainer.add_actor(this.subtitle_label);

        this.setContent(this.windowContainer);
        this.on_settings_changed();
    }

    _applyTextStyle(label, text, fontFamily, fontSize) {
        const style =
            `font-family: '${fontFamily}'; ` +
            `font-size: ${fontSize}px; ` +
            `color: rgba(255, 255, 255, ${this.text_opacity}); ` +
            `${this.enable_shadow ? 'text-shadow: 0 0 2px rgba(0, 0, 0, 0.6);' : ''}`;

        label.set_text(text);
        label.set_style(style);
    }

    on_settings_changed() {
        const fontDescription = Pango.font_description_from_string(this.font_setting);
        const fontFamily = fontDescription.get_family();
        const fontSize = fontDescription.get_size() / Pango.SCALE;

        this._applyTextStyle(this.title_label, this.title_text, fontFamily, fontSize);

        const subtitleSize = Math.round(fontSize * this.subtitle_scale);
        this._applyTextStyle(this.subtitle_label, this.subtitle_text, fontFamily, subtitleSize);
    }
}

function main(metadata, desklet_id) {
    return new WatermarkDesklet(metadata, desklet_id);
}