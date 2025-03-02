const Settings = imports.ui.settings;
const GLib = imports.gi.GLib;

const UUID = "moonlight-clock@torchipeppo";
const DESKLET_DIR = imports.ui.deskletManager.deskletMeta[UUID].path;

class ColorScheme {
    constructor(uuid, desklet_id, file_handler) {
        this.file_handler = file_handler;
        this.p3corner_template_svg_data = this.file_handler.get_file_text(
            this.file_handler.get_path_to_file("p3corner-template.svgtemp")
        );
        let svg_attributes = /<svg([^>]*)>/.exec(this.p3corner_template_svg_data)[1];
        this.p3corner_width = Number(/width="([^"]*)"/.exec(svg_attributes)[1]);
        this.p3corner_height = Number(/height="([^"]*)"/.exec(svg_attributes)[1]);
    }

    load_color_scheme(color_scheme_name, custom_scheme, invert_bottom_colors) {
        // just "custom" would have looked too much like some reserved name
        if (color_scheme_name == "the-custom") {
            Object.assign(this, custom_scheme);
        }
        else {
            let schemes = JSON.parse(this.file_handler.get_file_text(
                this.file_handler.get_path_to_file("default_color_schemes.json")
            ));
            Object.assign(this, schemes[color_scheme_name]);
        }
        if (invert_bottom_colors) {
            [this.corner2, this.bottom] = [this.bottom, this.corner2];
        }
    }

    get_svg() {
        let svg_content = this.p3corner_template_svg_data;
        svg_content = svg_content.replace(/%corner1%/g, this.corner1);
        svg_content = svg_content.replace(/%corner2%/g, this.corner2);
        return [svg_content, this.p3corner_width, this.p3corner_height];
    }
}
