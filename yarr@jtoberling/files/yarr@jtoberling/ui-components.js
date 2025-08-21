// UI Components for Yarr desklet - dialogs and UI elements
// VERSION: Function-based approach v2.0 - NO CLASSES!
const Logger = require('./logger');

// Loading ui-components.js - Function-based version 2.0
Logger.debug('Loading ui-components.js - Function-based version 2.0');

// Deferred imports for Cinnamon compatibility with require()
function getSt() { return imports.gi.St; }
function getLang() { return imports.lang; }
function getClutter() { return imports.gi.Clutter; }
function getGettext() { return imports.gettext; }
function getSecret() { return imports.gi.Secret; }
function getPango() { return imports.gi.Pango; }
const ModalDialog = imports.ui.modalDialog;

// Helper function for internationalization
function _(str) {
    return getGettext().dgettext("yarr@jtoberling", str);
}

function createPasswordDialog(label, callback, parent) {
    Logger.debug('createPasswordDialog called');
    Logger.debug('ModalDialog type: ' + typeof ModalDialog);
    Logger.debug('ModalDialog.ModalDialog type: ' + typeof ModalDialog.ModalDialog);

    // Create dialog using the same pattern as working examples
    Logger.debug('About to create ModalDialog instance...');
    let dialog = new ModalDialog.ModalDialog();
    Logger.debug('ModalDialog instance created successfully');

    // Safely get password, handling case where STORE_SCHEMA might not be available
    let password = '';
    try {
        Logger.debug('About to lookup password...');
        password = getSecret().password_lookup_sync(parent.STORE_SCHEMA, {}, null);
        Logger.debug('Password lookup completed');
    } catch (e) {
        Logger.debug('Could not load existing password: ' + e);
    }

    Logger.debug('About to set dialog content...');
    dialog.contentLayout.set_style('width: auto; max-width: 500px;');
    dialog.contentLayout.add(new (getSt().Label)({ text: label }));
    Logger.debug('Dialog content set');

    Logger.debug('About to create UI elements...');
    let passwordBox = new (getSt().BoxLayout)({ vertical: false });
    let entry = new (getSt().Entry)({ style: 'background: green; color:yellow; max-width: 400px;' });
    entry.clutter_text.set_password_char('\u25cf');
    entry.clutter_text.set_text(password);
    passwordBox.add(entry);
    dialog.contentLayout.add(passwordBox);
    dialog.setInitialKeyFocus(entry.clutter_text);
    Logger.debug('UI elements created');

    Logger.debug('About to set buttons...');
    dialog.setButtons([
        {
            label: "Save",
            action: () => {
                const pwd = entry.get_text();
                callback(pwd);
                dialog.close();
            },
            key: getClutter().KEY_Return,
            focused: false
        },
        {
            label: "Show/Hide password",
            action: () => {
                if (entry.clutter_text.get_password_char()) {
                    entry.clutter_text.set_password_char('');
                } else {
                    entry.clutter_text.set_password_char('\u25cf');
                }
            },
            focused: false
        },
        {
            label: "Cancel",
            action: () => {
                dialog.close();
            },
            key: null,
            focused: false
        }
    ]);
    Logger.debug('Buttons set');

    Logger.debug('About to set custom open method...');
    // Store reference to original open method and override to focus password entry
    let originalOpen = dialog.open;
    dialog.open = function () {
        originalOpen.call(dialog);
        // Focus the password entry after dialog opens
        entry.grab_key_focus();
    };
    Logger.debug('Custom open method set');

    Logger.debug('createPasswordDialog completed successfully');
    return dialog;
}

function createRssSearchDialog(title, callback, parent) {
    // Create dialog using the same pattern as working examples
    let dialog = new ModalDialog.ModalDialog();

    // Create the content area with proper styling
    let contentBox = new (getSt().BoxLayout)({
        style_class: 'rss-search-dialog-content',
        vertical: true
    });

    // Add title with proper styling
    let titleLabel = new (getSt().Label)({
        text: title,
        style_class: 'rss-search-dialog-title'
    });
    contentBox.add(titleLabel);

    // Add URL input field label
    let urlLabel = new (getSt().Label)({
        text: _("Enter website URL to search for RSS feeds:"),
        style_class: 'rss-search-url-label'
    });
    contentBox.add(urlLabel);

    // Create URL input field with proper styling
    let urlEntry = new (getSt().Entry)({
        name: 'rss-search-url-entry',
        style_class: 'rss-search-url-entry',
        can_focus: true,
        hint_text: _("e.g., example.com"),
        track_hover: true
    });
    contentBox.add(urlEntry);

    // Add content to dialog
    dialog.contentLayout.add(contentBox);

    // Add buttons with proper styling
    dialog.setButtons([
        {
            label: _("Cancel"),
            action: () => {
                callback(null);
                dialog.close();
            }
        },
        {
            label: _("Search"),
            action: () => {
                let url = urlEntry.get_text();
                if (url && url.trim() !== '') {
                    callback(url.trim());
                }
                dialog.close();
            }
        }
    ]);

    // Connect to key events
    urlEntry.connect('key-press-event', (actor, event) => {
        let symbol = event.get_key_symbol();
        if (symbol === getClutter().KEY_Return || symbol === getClutter().KEY_KP_Enter) {
            let url = urlEntry.get_text();
            if (url && url.trim()) {
                callback(url.trim());
            }
            dialog.close();
            return true;
        } else if (symbol === getClutter().KEY_Escape) {
            callback(null);
            dialog.close();
            return true;
        }
        return false;
    });

    // Store reference to original open method and override with proper focus
    let originalOpen = dialog.open;
    dialog.open = function () {
        originalOpen.call(dialog);
        global.stage.set_key_focus(urlEntry);
    };

    return dialog;
}

function createFeedSelectionDialog(title, feeds, callback, parent) {
    // Create dialog using the same pattern as working examples
    let dialog = new ModalDialog.ModalDialog();
    let selectedFeeds = new Set();

    // Create the content area with proper styling - BIGGER SIZE
    let contentBox = new (getSt().BoxLayout)({
        vertical: true,
        style_class: 'feed-selection-dialog-content',
        style: 'spacing: 15px; padding: 15px; width: 600px;'
    });

    // Add title with proper styling
    let titleLabel = new (getSt().Label)({
        text: title,
        style_class: 'feed-selection-dialog-title',
        style: 'font-weight: bold; font-size: 14px;'
    });
    contentBox.add(titleLabel);

    // Add instruction text
    let instructionLabel = new (getSt().Label)({
        text: _("Select the RSS feeds you want to add:"),
        style_class: 'feed-selection-instruction'
    });
    contentBox.add(instructionLabel);

    // Create scrollable container for feed items
    let scrollView = new (getSt().ScrollView)({
        style_class: 'feed-selection-scrollview',
        x_fill: true,
        y_fill: true,
        style: 'max-height: 400px;'
    });

    let feedContainer = new (getSt().BoxLayout)({
        vertical: true,
        style_class: 'feed-selection-container',
        style: 'spacing: 12px;'
    });

    // Add a selectable item for each feed
    feeds.forEach((feed, index) => {
        // Create a container for each item - BIGGER SPACING
        let itemBox = new (getSt().BoxLayout)({
            vertical: false,
            style: 'spacing: 12px; padding: 10px;'
        });

        // Custom checkbox using an icon - BIGGER SIZE
        let checkIcon = new (getSt().Icon)({
            icon_name: 'checkbox-checked',
            icon_type: getSt().IconType.SYMBOLIC,
            icon_size: 20
        });

        // Create a vertical container for feed details - BIGGER SPACING
        let feedDetailsBox = new (getSt().BoxLayout)({
            vertical: true,
            style: 'spacing: 4px;'
        });

        // Feed title (primary display) - BIGGER FONT
        let titleLabel = new (getSt().Label)({
            text: feed.title || 'Untitled Feed',
            style: 'font-weight: bold; padding-top: 4px; font-size: 16px; color: #2c3e50;'
        });
        titleLabel.clutter_text.set_line_wrap(true);
        titleLabel.clutter_text.set_line_wrap_mode(getPango().WrapMode.WORD_CHAR);

        // Feed URL (secondary display) - BIGGER FONT
        let urlLabel = new (getSt().Label)({
            text: feed.url,
            style: 'font-size: 14px; color: #3498db; padding-top: 2px;'
        });
        urlLabel.clutter_text.set_line_wrap(true);
        urlLabel.clutter_text.set_line_wrap_mode(getPango().WrapMode.WORD_CHAR);

        // Feed type indicator - BIGGER FONT
        let typeLabel = new (getSt().Label)({
            text: `📡 Type: ${feed.type || 'Unknown'}`,
            style: 'font-size: 13px; color: #e74c3c; font-weight: bold; padding-top: 2px;'
        });

        // Category (if available) - BIGGER FONT
        let categoryLabel = null;
        if (feed.category) {
            categoryLabel = new (getSt().Label)({
                text: `🏷️ Category: ${feed.category}`,
                style: 'font-size: 13px; color: #27ae60; font-weight: bold; padding-top: 2px;'
            });
        }

        // Description (if available) - BIGGER FONT
        let descLabel = null;
        if (feed.description) {
            descLabel = new (getSt().Label)({
                text: `📝 ${feed.description}`,
                style: 'font-size: 13px; color: #34495e; font-style: italic; padding-top: 2px; line-height: 1.3;'
            });
            descLabel.clutter_text.set_line_wrap(true);
            descLabel.clutter_text.set_line_wrap_mode(getPango().WrapMode.WORD_CHAR);
        }

        // Add feed size/length info if available
        let sizeLabel = null;
        if (feed.contentLength) {
            sizeLabel = new (getSt().Label)({
                text: `📊 Size: ${feed.contentLength} characters`,
                style: 'font-size: 12px; color: #95a5a6; padding-top: 2px;'
            });
        }

        // Add last updated info if available
        let updatedLabel = null;
        if (feed.lastUpdated) {
            updatedLabel = new (getSt().Label)({
                text: `🕒 Updated: ${feed.lastUpdated}`,
                style: 'font-size: 12px; color: #f39c12; padding-top: 2px;'
            });
        }

        // Add all labels to the details box
        feedDetailsBox.add(titleLabel);
        feedDetailsBox.add(urlLabel);
        feedDetailsBox.add(typeLabel);
        if (categoryLabel) feedDetailsBox.add(categoryLabel);
        if (descLabel) feedDetailsBox.add(descLabel);
        if (sizeLabel) feedDetailsBox.add(sizeLabel);
        if (updatedLabel) feedDetailsBox.add(updatedLabel);

        // Store the selected state
        let isSelected = true;

        // Add elements to the item container
        itemBox.add(checkIcon);
        itemBox.add(feedDetailsBox);

        // Make the entire row clickable
        let button = new (getSt().Button)({
            style_class: 'feed-selection-item-button',
            style: 'border-radius: 4px; padding: 0;'
        });
        button.set_child(itemBox);

        // Toggle selection on click
        button.connect('clicked', () => {
            isSelected = !isSelected;
            checkIcon.icon_name = isSelected ? 'checkbox-checked' : 'checkbox-symbolic';

            // Add visual feedback for selection state
            button.style = isSelected ?
                'background-color: rgba(100, 200, 255, 0.1); border-radius: 4px; padding: 0;' :
                'border-radius: 4px; padding: 0;';

            // Update selected feeds set
            if (isSelected) {
                selectedFeeds.add(feed);
            } else {
                selectedFeeds.delete(feed);
            }
        });

        feedContainer.add(button);
    });

    // Add feed container to scroll view
    scrollView.add_actor(feedContainer);
    contentBox.add(scrollView);

    // Add content to dialog
    dialog.contentLayout.add(contentBox);

    // Add buttons with proper styling
    dialog.setButtons([
        {
            label: _("Cancel"),
            action: () => {
                callback([]);
                dialog.close();
            }
        },
        {
            label: _("Add Selected"),
            action: () => {
                callback(Array.from(selectedFeeds));
                dialog.close();
            }
        }
    ]);

    return dialog;
}

// Verify we're exporting functions, not classes
Logger.debug('Exporting functions: createPasswordDialog=' + typeof createPasswordDialog);
Logger.debug('Exporting functions: createRssSearchDialog=' + typeof createRssSearchDialog);
Logger.debug('Exporting functions: createFeedSelectionDialog=' + typeof createFeedSelectionDialog);

module.exports = {
    createPasswordDialog,
    createRssSearchDialog,
    createFeedSelectionDialog
};
