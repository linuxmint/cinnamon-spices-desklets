/*
 * i18n.js - translation setup.
 *
 * Cinnamon sets the process-wide text domain to "cinnamon", so a bare
 * gettext call looks our strings up in Cinnamon's own catalogue and never
 * finds them. Binding this desklet's UUID as its own domain is what makes
 * the shipped .po files actually reachable at runtime.
 */

const Gettext = imports.gettext;
const GLib = imports.gi.GLib;

const UUID = 'agenda@ashex';

// get_user_data_dir() honours XDG_DATA_HOME and otherwise resolves to the
// per-user data directory where Cinnamon installs xlet catalogues.
Gettext.bindtextdomain(UUID, GLib.build_filenamev([GLib.get_user_data_dir(), 'locale']));

function _(text) {
    return Gettext.dgettext(UUID, text);
}

function ngettext(singular, plural, count) {
    return Gettext.dngettext(UUID, singular, plural, count);
}
