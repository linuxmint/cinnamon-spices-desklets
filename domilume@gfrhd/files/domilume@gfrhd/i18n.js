// Translations (gettext, domain = UUID, .mo files in $XDG_DATA_HOME/locale as installed by
// Cinnamon Spices) and number formatting in the user's locale. No Cinnamon imports, so the
// modules using it can still be tested with plain gjs (untranslated English then).

const Gettext = imports.gettext;
const GLib = imports.gi.GLib;

const UUID = "domilume@gfrhd";

Gettext.bindtextdomain(UUID, GLib.build_filenamev([GLib.get_user_data_dir(), "locale"]));

function _(str) {
    return Gettext.dgettext(UUID, str);
}

// formatText(_("Boost for %s min"), 30): fills the placeholders %s in order; %% gives "%".
function formatText(str, ...args) {
    let i = 0;
    return str.replace(/%[s%]/g, m => (m === "%%" ? "%" : String(args[i++])));
}

// Number with a fixed number of decimals in the user's locale ("21,5" in German).
function num(n, digits) {
    return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
