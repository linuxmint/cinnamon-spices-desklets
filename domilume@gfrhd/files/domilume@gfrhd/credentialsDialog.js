// Modal dialog asking for the FRITZ!Box user name and password.
//
// Built from a plain ModalDialog instead of a subclass: GObject subclasses need a type
// registration that can only happen once per Cinnamon session, so reloading the desklet
// would fail with "type already registered".

const Clutter = imports.gi.Clutter;
const St = imports.gi.St;
const ModalDialog = imports.ui.modalDialog;
const Dialog = imports.ui.dialog;
const CinnamonEntry = imports.ui.cinnamonEntry;

// Own modules, see desklet.js.
const Me = imports.ui.extension.getCurrentExtension
    ? imports.ui.extension.getCurrentExtension().imports : null;
const I18n = Me ? Me.i18n : require('./i18n');
const _ = I18n._;

// onSave(username, password) is called with the entered values.
// Both empty means: remove the stored credentials.
function openCredentialsDialog(username, onSave) {
    let dialog = new ModalDialog.ModalDialog({ styleClass: "prompt-dialog" });

    dialog.contentLayout.add_child(new Dialog.MessageDialogContent({
        title: _("FRITZ!Box credentials"),
        description: _("A FRITZ!Box user with the “Smart Home” permission. The credentials are stored in the keyring, not in the desklet settings.\nLeave both fields empty to remove them."),
    }));

    let userEntry = new St.Entry({
        style_class: "prompt-dialog-password-entry",
        hint_text: _("User name"),
        text: username || "",
        can_focus: true,
        x_expand: true,
    });
    CinnamonEntry.addContextMenu(userEntry);
    dialog.contentLayout.add_child(userEntry);

    let passwordEntry = new St.PasswordEntry({
        style_class: "prompt-dialog-password-entry",
        hint_text: _("Password"),
        can_focus: true,
        x_expand: true,
    });
    CinnamonEntry.addContextMenu(passwordEntry);
    dialog.contentLayout.add_child(passwordEntry);
    dialog.contentLayout.add_child(new CinnamonEntry.CapsLockWarning());

    let save = () => {
        let user = userEntry.get_text().trim();
        let password = passwordEntry.get_text();
        dialog.close();
        onSave(user, password);
    };
    userEntry.clutter_text.connect("activate", () => passwordEntry.grab_key_focus());
    passwordEntry.clutter_text.connect("activate", save);

    dialog.setButtons([
        { label: _("Cancel"), action: () => dialog.close(), key: Clutter.KEY_Escape },
        { label: _("Save"), action: save, default: true },
    ]);
    // Known user name -> start in the password field.
    dialog.setInitialKeyFocus(username ? passwordEntry : userEntry);

    dialog.open();
    return dialog;
}
