const Gettext = imports.gettext;
const GLib = imports.gi.GLib;

// hardcoded UUID for translation purposes only,
// fails silently w/ no ill effects if not exists
const UUID = "moonlight-clock@torchipeppo";
Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");

function _(text) {
	let locText = Gettext.dgettext(UUID, text);

	if (locText == text) {
		locText = window._(text);
	}

	return locText;
}
