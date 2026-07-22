const St = imports.gi.St;
const Desklet = imports.ui.desklet;
const Gio = imports.gi.Gio;
const Mainloop = imports.mainloop;
const Lang = imports.lang;
const GLib = imports.gi.GLib;
const Tweener = imports.ui.tweener;
const Clutter = imports.gi.Clutter;
const Settings = imports.ui.settings;
const Util = imports.misc.util;

// Try to import GExiv2 for EXIF support (optional)
let GExiv2 = null;
try {
    GExiv2 = imports.gi.GExiv2;
} catch (e) {
    global.log('GExiv2 not available - EXIF date will not be displayed');
}

class PhotoCarouselDesklet extends Desklet.Desklet {
    constructor(metadata, desklet_id) {
        super(metadata, desklet_id);

        this.metadata = metadata;
        this.update_id = 0;

        // Set up settings
        this.settings = new Settings.DeskletSettings(this, this.metadata.uuid, desklet_id);
        this.settings.bind('directory', 'dir', this.on_setting_changed);
        this.settings.bind('delay', 'delay', this.on_setting_changed);
        this.settings.bind('fade-delay', 'fade_delay', this.on_setting_changed);
        this.settings.bind('file-path-display', 'file_path_display');
        this.settings.bind('exif-date-display', 'exif_date_display');
        this.settings.bind('exif-description-display', 'exif_description_display');
        this.settings.bind('nav-buttons-display', 'nav_buttons_display');
        this.settings.bind('info-label-position', 'info_label_position');
        this.settings.bind('show-map-button', 'show_map_button');
        this.settings.bind('width', 'width', this.on_setting_changed);
        this.settings.bind('height', 'height', this.on_setting_changed);
        this.settings.bind('frame-width', 'frame_width', this.on_setting_changed);
        this.settings.bind('frame-color', 'frame_color', this.on_setting_changed);
        this.settings.bind('frame-opacity', 'frame_opacity', this.on_setting_changed);
        this.settings.bind('background-blur', 'background_blur', this.on_setting_changed);
        this.settings.bind('max-folders', 'maxFolders', this.on_setting_changed);
        this.settings.bind('max-depth', 'maxDepth', this.on_setting_changed);
        this.settings.bind('max-subfolders-per-dir', 'maxSubfoldersPerDir', this.on_setting_changed);

        // Create frame wrapper
        this._frameWrapper = new St.Bin({
            style_class: 'photocarousel-frame'
        });

        // Create a simple container for the photo (no layout manager)
        this._container = new Clutter.Actor();
        this._container.set_size(this.width, this.height);

        // Create background layer for blurred stretched image
        this._backgroundFrame = new Clutter.Actor();
        this._backgroundFrame.set_size(this.width, this.height);
        this._container.add_child(this._backgroundFrame);

        // Create colored overlay on top of blurred background
        this._colorOverlay = new Clutter.Actor({
            width: this.width,
            height: this.height
        });
        this._update_color_overlay();
        this._container.add_child(this._colorOverlay);

        // Create foreground photo frame - just a plain actor, we'll manually position children
        this._photoFrame = new Clutter.Actor();
        this._photoFrame.set_size(this.width, this.height);
        this._container.add_child(this._photoFrame);

        // Create overlay label for image path (initially hidden)
        this._pathLabel = new St.Label({
            text: '',
            style_class: 'path-label'
        });
        this._pathLabel.set_style('color: white; background-color: rgba(0,0,0,0.7); padding: 5px; font-size: 12px;');
        this._pathLabel.set_position(0, this.height - 30); // Position at bottom
        this._pathLabel.hide();
        this._container.add_child(this._pathLabel);

        // Create overlay label for EXIF date (initially hidden)
        this._dateLabel = new St.Label({
            text: '',
            style_class: 'date-label'
        });
        this._dateLabel.set_style('color: white; background-color: rgba(0,0,0,0.7); padding: 5px; font-size: 12px;');
        this._dateLabel.hide();
        this._container.add_child(this._dateLabel);

        // Create navigation buttons container
        this._navButtonsBox = new St.BoxLayout({
            vertical: false,
            style_class: 'nav-buttons-box'
        });
        this._navButtonsBox.set_style('background-color: rgba(0,0,0,0.7); padding: 5px; spacing: 10px;');
        this._navButtonsBox.hide();

        // Back button
        this._backButton = new St.Button({
            style_class: 'nav-button',
            style: 'transition-duration: 200ms;'
        });
        let backIcon = new St.Icon({
            icon_name: 'go-previous',
            icon_size: 24,
            style_class: 'nav-icon'
        });
        this._backButton.set_child(backIcon);
        this._backButton.connect('clicked', Lang.bind(this, this._on_back_clicked));
        this._backButton.connect('enter-event', Lang.bind(this, this._on_nav_button_enter));
        this._backButton.connect('leave-event', Lang.bind(this, this._on_nav_button_leave));
        this._navButtonsBox.add_child(this._backButton);

        // Folder button
        this._folderButton = new St.Button({
            style_class: 'nav-button',
            style: 'transition-duration: 200ms;'
        });
        let folderIcon = new St.Icon({
            icon_name: 'folder-open',
            icon_size: 24,
            style_class: 'nav-icon'
        });
        this._folderButton.set_child(folderIcon);
        this._folderButton.connect('clicked', Lang.bind(this, this._on_folder_clicked));
        this._folderButton.connect('enter-event', Lang.bind(this, this._on_nav_button_enter));
        this._folderButton.connect('leave-event', Lang.bind(this, this._on_nav_button_leave));
        this._navButtonsBox.add_child(this._folderButton);

        // Map button (initially hidden, shown only when GPS data exists)
        this._mapButton = new St.Button({
            style_class: 'nav-button',
            style: 'transition-duration: 200ms;'
        });
        let mapIcon = new St.Icon({
            icon_name: 'mark-location',
            icon_size: 24,
            style_class: 'nav-icon'
        });
        this._mapButton.set_child(mapIcon);
        this._mapButton.connect('clicked', Lang.bind(this, this._on_map_clicked));
        this._mapButton.connect('enter-event', Lang.bind(this, this._on_nav_button_enter));
        this._mapButton.connect('leave-event', Lang.bind(this, this._on_nav_button_leave));
        this._mapButton.hide();
        this._navButtonsBox.add_child(this._mapButton);

        // Open image button
        this._openImageButton = new St.Button({
            style_class: 'nav-button',
            style: 'transition-duration: 200ms;'
        });
        let openImageIcon = new St.Icon({
            icon_name: 'image-x-generic',
            icon_size: 24,
            style_class: 'nav-icon'
        });
        this._openImageButton.set_child(openImageIcon);
        this._openImageButton.connect('clicked', Lang.bind(this, this._on_open_image_clicked));
        this._openImageButton.connect('enter-event', Lang.bind(this, this._on_nav_button_enter));
        this._openImageButton.connect('leave-event', Lang.bind(this, this._on_nav_button_leave));
        this._navButtonsBox.add_child(this._openImageButton);

        // Forward button
        this._forwardButton = new St.Button({
            style_class: 'nav-button',
            style: 'transition-duration: 200ms;'
        });
        let forwardIcon = new St.Icon({
            icon_name: 'go-next',
            icon_size: 24,
            style_class: 'nav-icon'
        });
        this._forwardButton.set_child(forwardIcon);
        this._forwardButton.connect('clicked', Lang.bind(this, this._on_forward_clicked));
        this._forwardButton.connect('enter-event', Lang.bind(this, this._on_nav_button_enter));
        this._forwardButton.connect('leave-event', Lang.bind(this, this._on_nav_button_leave));
        this._navButtonsBox.add_child(this._forwardButton);

        // Position nav buttons at bottom center
        this._container.add_child(this._navButtonsBox);

        // Add container to frame wrapper
        this._frameWrapper.set_child(this._container);

        // Apply frame styling
        this._update_frame_style();

        this.setContent(this._frameWrapper);

        // Enable mouse events
        this.actor.set_reactive(true);
        this.actor.connect('enter-event', Lang.bind(this, this._on_mouse_enter));
        this.actor.connect('leave-event', Lang.bind(this, this._on_mouse_leave));

        // Track failed image loading attempts
        this.failedAttempts = 0;
        this.maxFailedAttempts = 5;

        // Track current image and update state
        this.currentPicture = null;
        this.currentBackground = null;
        this.currentImagePath = null;
        this.currentGPS = null;
        this.updateInProgress = false;
        this.isPaused = false;

        // Track timing for pause/resume
        this.lastUpdateTime = null;
        this.remainingDelay = null;

        // Track image history for back/forward navigation
        this.imageHistory = [];
        this.historyPosition = -1;
        this.maxHistorySize = 50; // Keep last 50 images in history

        // Initialize folders array and scan limits
        this._folders = [];
        this.maxFolders = 100; // Limit total folder count to prevent long delays
        this.maxDepth = 10; // Limit recursion depth
        this.maxSubfoldersPerDir = 20; // Limit subfolders scanned per directory

        // Set the base directory from settings
        // Handle URI vs path conversion (same as photoframe does)
        if (this.dir && this.dir.indexOf('://') === -1) {
            let file = Gio.file_new_for_path(this.dir);
            this.dir = file.get_uri();
        }

        // Default to Pictures folder if not set
        if (!this.dir || this.dir === ' ') {
            let file = Gio.file_new_for_path(GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_PICTURES));
            this.dir = file.get_uri();
        }

        this.baseDir = Gio.file_new_for_uri(this.dir);

        // Validate that the directory exists
        if (!this.baseDir.query_exists(null)) {
            global.logError('Pictures directory does not exist: ' + this.dir);
            this._show_error_message('Pictures folder not found');
            return;
        }

        // Scan for subfolders
        this._scan_for_folders(this.baseDir, 0);

        // Check if we found any folders
        if (this._folders.length == 0) {
            global.logError('No folders found in Pictures directory');
            this._show_error_message('No folders found');
            return;
        }

        // Start the rotation loop
        this._update_loop();
    }

    _scan_for_folders(dir, depth) {
        // Check if we've hit our limits
        if (depth >= this.maxDepth) {
            global.log('Max depth reached at: ' + dir.get_path());
            return;
        }

        if (this._folders.length >= this.maxFolders) {
            global.log('Max folder count reached: ' + this.maxFolders);
            return;
        }

        // Add the directory itself to the folders list
        this._folders.push(dir);

        try {
            let fileEnum = dir.enumerate_children(
                'standard::type,standard::name,standard::is-hidden',
                Gio.FileQueryInfoFlags.NONE,
                null
            );

            // First, collect all subfolders
            let subfolders = [];
            let info;
            while ((info = fileEnum.next_file(null)) != null) {
                if (info.get_is_hidden()) {
                    continue;
                }

                let fileType = info.get_file_type();
                if (fileType == Gio.FileType.DIRECTORY) {
                    subfolders.push(info.get_name());
                }
            }
            fileEnum.close(null);

            // Shuffle the subfolders array randomly (Fisher-Yates shuffle)
            for (let i = subfolders.length - 1; i > 0; i--) {
                let j = Math.floor(Math.random() * (i + 1));
                [subfolders[i], subfolders[j]] = [subfolders[j], subfolders[i]];
            }

            // Now scan the first maxSubfoldersPerDir folders from shuffled list
            let subfoldersScanned = 0;
            for (let folderName of subfolders) {
                // Stop if we've hit folder limit
                if (this._folders.length >= this.maxFolders) {
                    break;
                }

                // Stop if we've scanned max subfolders in this directory
                if (subfoldersScanned >= this.maxSubfoldersPerDir) {
                    global.log('Max subfolders per directory reached at: ' + dir.get_path());
                    break;
                }

                let childDir = dir.get_child(folderName);
                subfoldersScanned++;
                this._scan_for_folders(childDir, depth + 1); // Recursive scan with depth tracking
            }
        } catch (e) {
            global.logError('Error scanning folder: ' + e);
        }
    }

    _is_image_file(filename) {
        // Check if file has an image extension (case-insensitive)
        let validExtensions = [
            '.jpg', '.jpeg', '.png', '.gif', '.bmp',
            '.tiff', '.tif', '.webp'
        ];

        let lowerFilename = filename.toLowerCase();
        return validExtensions.some(ext => lowerFilename.endsWith(ext));
    }

    _get_random_image() {
        if (this._folders.length == 0) {
            return null;
        }

        // Try up to 10 random folders to find an image
        for (let attempt = 0; attempt < 10; attempt++) {
            // Pick a random folder
            let randomFolderIndex = Math.floor(Math.random() * this._folders.length);
            let folder = this._folders[randomFolderIndex];

            try {
                // Get all files in this folder (non-recursive)
                let fileEnum = folder.enumerate_children(
                    'standard::type,standard::name,standard::is-hidden',
                    Gio.FileQueryInfoFlags.NONE,
                    null
                );

                let files = [];
                let info;
                while ((info = fileEnum.next_file(null)) != null) {
                    if (info.get_is_hidden()) {
                        continue;
                    }

                    let fileType = info.get_file_type();
                    if (fileType != Gio.FileType.DIRECTORY) {
                        let fileName = info.get_name();
                        // Only add files with valid image extensions
                        if (this._is_image_file(fileName)) {
                            files.push(fileName);
                        }
                    }
                }

                fileEnum.close(null);

                // If we found files, pick a random one
                if (files.length > 0) {
                    let randomFileIndex = Math.floor(Math.random() * files.length);
                    let fileName = files[randomFileIndex];
                    let filePath = folder.get_child(fileName);
                    return filePath.get_uri();
                }
            } catch (e) {
                global.logError('Error reading folder: ' + e);
            }
        }

        return null;
    }

    _update_loop() {
        this._update();
        // Track when this update happened
        this.lastUpdateTime = new Date().getTime();
        // Only schedule next update if not paused
        if (!this.isPaused) {
            this.update_id = Mainloop.timeout_add_seconds(this.delay, Lang.bind(this, this._update_loop));
        }
    }

    _update() {
        // Prevent overlapping transitions
        if (this.updateInProgress) {
            return;
        }
        this.updateInProgress = true;

        let imagePath = this._get_random_image();

        if (!imagePath) {
            this.failedAttempts++;
            global.logError('No image found, attempt ' + this.failedAttempts + ' of ' + this.maxFailedAttempts);

            if (this.failedAttempts >= this.maxFailedAttempts) {
                global.logError('Could not find any images after ' + this.maxFailedAttempts + ' attempts. Stopping rotation.');
                this._show_error_message('No photos found');

                // Stop the update loop
                if (this.update_id != 0) {
                    Mainloop.source_remove(this.update_id);
                    this.update_id = 0;
                }
            }
            this.updateInProgress = false;
            return;
        }

        try {
            global.log('========================================');
            global.log('PhotoCarousel: Loading new image: ' + imagePath);
            global.log('PhotoCarousel: Frame size: ' + this.width + 'x' + this.height);

            // Load background image (stretched to fill entire frame)
            let backgroundImage = St.TextureCache.get_default().load_uri_async(imagePath, this.width, this.height);

            // Load foreground image WITHOUT dimensions (will be sized to maintain aspect ratio)
            let foregroundImage = St.TextureCache.get_default().load_uri_async(imagePath, -1, -1);

            global.log('PhotoCarousel: Image created, initial size: ' + foregroundImage.width + 'x' + foregroundImage.height);

            let old_pic = this.currentPicture;
            let old_bg = this.currentBackground;

            this.currentPicture = foregroundImage;
            this.currentBackground = backgroundImage;
            this.currentImagePath = imagePath;

            // Add to history (remove any forward history if we're not at the end)
            if (this.historyPosition < this.imageHistory.length - 1) {
                this.imageHistory = this.imageHistory.slice(0, this.historyPosition + 1);
            }
            this.imageHistory.push(imagePath);
            this.historyPosition = this.imageHistory.length - 1;

            // Limit history size
            if (this.imageHistory.length > this.maxHistorySize) {
                this.imageHistory.shift();
                this.historyPosition--;
            }

            // Add blur effect to background image
            backgroundImage.clear_effects();
            for (let i = 0; i < this.background_blur; i++) {
                backgroundImage.add_effect(new Clutter.BlurEffect());
            }

            // Connect to size notification to maintain aspect ratio on foreground
            global.log('PhotoCarousel: Connecting notify::size callback');
            foregroundImage._notif_id = foregroundImage.connect('notify::size', Lang.bind(this, this._size_pic));

            // Function to swap images
            let swapImages = Lang.bind(this, function() {
                // Remove old images first
                if (old_pic) {
                    this._photoFrame.remove_child(old_pic);
                    old_pic.destroy();
                }
                if (old_bg) {
                    this._backgroundFrame.remove_child(old_bg);
                    old_bg.destroy();
                }

                // Add background image (stretched, blurred)
                global.log('PhotoCarousel: Adding background image to container');
                this._backgroundFrame.add_child(this.currentBackground);

                // Add foreground image to container IMMEDIATELY so notify::size can fire
                global.log('PhotoCarousel: Adding foreground image to container');
                this._photoFrame.add_child(this.currentPicture);

                // Show overlays that are set to "always"
                this._update_always_overlays();

                // Reset failed attempts counter on success
                this.failedAttempts = 0;
            });

            // Apply fade transition if fade_delay > 0
            if (this.fade_delay > 0) {
                Tweener.addTween(this._container, {
                    opacity: 0,
                    time: this.fade_delay,
                    transition: 'easeInSine',
                    onComplete: Lang.bind(this, function() {
                        swapImages();
                        Tweener.addTween(this._container, {
                            opacity: 255,
                            time: this.fade_delay,
                            transition: 'easeOutSine',
                            onComplete: Lang.bind(this, function() {
                                this.updateInProgress = false;
                            })
                        });
                    })
                });
            } else {
                // No fade - swap immediately
                swapImages();
                this.updateInProgress = false;
            }
        } catch (e) {
            global.logError('Error loading image: ' + e);
            this.failedAttempts++;
            this.updateInProgress = false;
        }
    }

    _size_pic(image) {
        // Disconnect the notification handler to avoid repeated calls
        image.disconnect(image._notif_id);

        global.log('----------------------------------------');
        global.log('PhotoCarousel: _size_pic CALLBACK TRIGGERED');

        // Get the natural (intrinsic) size of the loaded image
        let [minWidth, naturalWidth] = image.get_preferred_width(-1);
        let [minHeight, naturalHeight] = image.get_preferred_height(-1);

        global.log('PhotoCarousel: Natural image size: ' + naturalWidth + 'x' + naturalHeight);
        global.log('PhotoCarousel: Photo frame size: ' + this.width + 'x' + this.height);

        // If image hasn't loaded yet, skip
        if (naturalWidth <= 0 || naturalHeight <= 0) {
            global.log('PhotoCarousel: ERROR - Image not loaded yet!');
            return;
        }

        // Determine orientation and calculate new dimensions
        let newWidth, newHeight;
        let orientation;

        // Determine orientation for logging
        if (naturalWidth > naturalHeight) {
            orientation = 'LANDSCAPE';
        } else if (naturalHeight > naturalWidth) {
            orientation = 'PORTRAIT';
        } else {
            orientation = 'SQUARE';
        }

        // Calculate aspect ratios to determine which dimension to constrain
        let imageRatio = naturalWidth / naturalHeight;
        let frameRatio = this.width / this.height;

        if (imageRatio > frameRatio) {
            // Image is wider proportionally - constrain by width
            newWidth = this.width;
            newHeight = this.width / imageRatio;
        } else {
            // Image is taller proportionally - constrain by height
            newHeight = this.height;
            newWidth = this.height * imageRatio;
        }

        global.log('PhotoCarousel: Image orientation: ' + orientation);
        global.log('PhotoCarousel: Calculated display size: ' + Math.round(newWidth) + 'x' + Math.round(newHeight));

        // Remove the temporary full-size image
        this._photoFrame.remove_child(image);
        image.destroy();

        // Reload the image at the CORRECT size (not -1, -1)
        global.log('PhotoCarousel: Reloading image at calculated size...');
        let resizedImage = St.TextureCache.get_default().load_uri_async(
            this.currentImagePath,
            Math.round(newWidth),
            Math.round(newHeight)
        );

        // Update current picture reference
        this.currentPicture = resizedImage;

        // Add the properly-sized image to the frame
        this._photoFrame.add_child(resizedImage);

        // Manually center the image in the frame
        let xPos = (this.width - newWidth) / 2;
        let yPos = (this.height - newHeight) / 2;
        resizedImage.set_position(xPos, yPos);

        global.log('PhotoCarousel: Resized image loaded and positioned at (' + Math.round(xPos) + ',' + Math.round(yPos) + ')');
        global.log('========================================');
    }

    _get_exif_date(imagePath) {
        // Return null if GExiv2 is not available
        if (!GExiv2) {
            return null;
        }

        try {
            // Convert URI to file path using Gio (handles special characters properly)
            let file = Gio.file_new_for_uri(imagePath);
            let filePath = file.get_path();

            let metadata = new GExiv2.Metadata();
            metadata.open_path(filePath);

            // Try different EXIF date tags in order of preference
            let dateString = null;
            if (metadata.has_tag('Exif.Photo.DateTimeOriginal')) {
                dateString = metadata.get_tag_string('Exif.Photo.DateTimeOriginal');
            } else if (metadata.has_tag('Exif.Image.DateTime')) {
                dateString = metadata.get_tag_string('Exif.Image.DateTime');
            } else if (metadata.has_tag('Exif.Photo.DateTimeDigitized')) {
                dateString = metadata.get_tag_string('Exif.Photo.DateTimeDigitized');
            }

            if (dateString) {
                // EXIF date format is typically "YYYY:MM:DD HH:MM:SS"
                // Take only the date part (before space), convert to YYYY-MM-DD
                let parts = dateString.split(' ');
                if (parts.length >= 1) {
                    let datePart = parts[0].replace(/:/g, '-');

                    // Don't display if date is 0000-00-00 or invalid
                    if (datePart === '0000-00-00' || datePart === '0000-0-0') {
                        return null;
                    }

                    // Limit to 100 characters (date should never be that long, but just in case)
                    return datePart.length > 100 ? datePart.substring(0, 97) + '...' : datePart;
                }
            }
        } catch (e) {
            // Silently fail if no EXIF data or error reading
            global.log('Could not read EXIF data: ' + e);
        }
        return null;
    }

    _get_exif_description(imagePath) {
        // Return null if GExiv2 is not available
        if (!GExiv2) {
            return null;
        }

        try {
            // Convert URI to file path using Gio (handles special characters properly)
            let file = Gio.file_new_for_uri(imagePath);
            let filePath = file.get_path();

            let metadata = new GExiv2.Metadata();
            metadata.open_path(filePath);

            // Try different EXIF description tags
            let description = null;
            if (metadata.has_tag('Exif.Image.ImageDescription')) {
                description = metadata.get_tag_string('Exif.Image.ImageDescription');
            } else if (metadata.has_tag('Iptc.Application2.Caption')) {
                description = metadata.get_tag_string('Iptc.Application2.Caption');
            } else if (metadata.has_tag('Xmp.dc.description')) {
                description = metadata.get_tag_string('Xmp.dc.description');
            }

            // Limit to 100 characters
            if (description && description.length > 100) {
                description = description.substring(0, 97) + '...';
            }

            return description;
        } catch (e) {
            // Silently fail if no EXIF data or error reading
            global.log('Could not read EXIF description: ' + e);
        }
        return null;
    }

    _get_exif_gps(imagePath) {
        // Return null if GExiv2 is not available
        if (!GExiv2) {
            return null;
        }

        try {
            // Convert URI to file path using Gio (handles special characters properly)
            let file = Gio.file_new_for_uri(imagePath);
            let filePath = file.get_path();

            let metadata = new GExiv2.Metadata();
            metadata.open_path(filePath);

            // Check if GPS data exists
            if (!metadata.has_tag('Exif.GPSInfo.GPSLatitude') ||
                !metadata.has_tag('Exif.GPSInfo.GPSLongitude')) {
                return null;
            }

            // Get GPS coordinates
            let lat = metadata.get_gps_latitude();
            let lon = metadata.get_gps_longitude();

            // Check if coordinates are valid
            if (lat !== undefined && lon !== undefined && lat !== 0 && lon !== 0) {
                return { latitude: lat, longitude: lon };
            }
        } catch (e) {
            // Silently fail if no GPS data or error reading
            global.log('Could not read GPS data: ' + e);
        }
        return null;
    }

    _update_color_overlay() {
        // Update the color overlay with the frame color and 0.7 opacity
        if (this._colorOverlay) {
            // Parse the frame color and create a Clutter.Color with transparency
            let clutterColor;

            try {
                // Try to parse the color string - from_string returns [success, color]
                let result = Clutter.Color.from_string(this.frame_color);
                if (result && result[0]) {
                    clutterColor = result[1];
                } else {
                    // Fallback to black
                    clutterColor = new Clutter.Color({red: 0, green: 0, blue: 0, alpha: 255});
                }
            } catch (e) {
                // If parsing fails, use black
                clutterColor = new Clutter.Color({red: 0, green: 0, blue: 0, alpha: 255});
            }

            // Set alpha to 70% (0.7 * 255 = 178)
            clutterColor.alpha = 178;

            // Apply the color directly to the actor
            this._colorOverlay.set_background_color(clutterColor);
        }
    }

    _update_frame_style() {
        if (!this._frameWrapper) {
            return;
        }

        let color = this.frame_color || 'black';
        let opacity = this.frame_opacity || 0.7;
        let width = this.frame_width || 5;

        // Build the style string for frame border
        let styleString = '';
        if (width > 0) {
            // Convert color to rgba format with opacity
            let rgbaColor = this._color_to_rgba_css(color, opacity);
            styleString = `border: ${width}px solid ${rgbaColor}; border-radius: 0px;`;
        } else {
            styleString = 'border: none;';
        }

        this._frameWrapper.set_style(styleString);

        // Set background to match frame color
        if (this._frameBackground) {
            let bgColor = this._color_to_rgba_css(color, 1.0); // Full opacity for background
            this._frameBackground.set_style(`background-color: ${bgColor};`);
        }
    }

    _color_to_rgba_css(color, opacity) {
        // Common color names to RGB mapping (for CSS styling)
        const colorMap = {
            'black': '0, 0, 0',
            'white': '255, 255, 255',
            'red': '255, 0, 0',
            'green': '0, 255, 0',
            'blue': '0, 0, 255',
            'yellow': '255, 255, 0',
            'cyan': '0, 255, 255',
            'magenta': '255, 0, 255',
            'gray': '128, 128, 128',
            'grey': '128, 128, 128',
            'orange': '255, 165, 0',
            'purple': '128, 0, 128',
            'brown': '165, 42, 42',
            'pink': '255, 192, 203'
        };

        // Check if it's already in rgb/rgba format
        if (color.startsWith('rgb')) {
            // Extract RGB values and apply new opacity
            let match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
            if (match) {
                return `rgba(${match[1]}, ${match[2]}, ${match[3]}, ${opacity})`;
            }
        }

        // Check if it's a hex color
        if (color.startsWith('#')) {
            let hex = color.substring(1);
            if (hex.length === 3) {
                hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
            }
            let r = parseInt(hex.substring(0, 2), 16);
            let g = parseInt(hex.substring(2, 4), 16);
            let b = parseInt(hex.substring(4, 6), 16);
            return `rgba(${r}, ${g}, ${b}, ${opacity})`;
        }

        // Check if it's a named color
        let rgb = colorMap[color.toLowerCase()];
        if (rgb) {
            return `rgba(${rgb}, ${opacity})`;
        }

        // Default to black with opacity
        return `rgba(0, 0, 0, ${opacity})`;
    }

    _show_error_message(message) {
        let label = new St.Label({
            text: message,
            style_class: 'error-label'
        });
        label.set_style('color: white; background-color: rgba(0,0,0,0.7); padding: 10px; font-size: 14px;');
        this._photoFrame.set_child(label);
    }

    _on_back_clicked() {
        if (this.historyPosition > 0) {
            this.historyPosition--;
            let imagePath = this.imageHistory[this.historyPosition];
            this._load_specific_image(imagePath);
        }
    }

    _on_forward_clicked() {
        // Check if we can go forward in history
        if (this.historyPosition < this.imageHistory.length - 1) {
            this.historyPosition++;
            let imagePath = this.imageHistory[this.historyPosition];
            this._load_specific_image(imagePath);
        } else {
            // Load a new random image
            this._update();
        }
    }

    _on_folder_clicked() {
        if (this.currentImagePath) {
            // Get the directory URI (handles special characters properly)
            let file = Gio.file_new_for_uri(this.currentImagePath);
            let directory = file.get_parent();

            if (directory) {
                // Use URI for xdg-open (properly encoded, handles spaces and special chars)
                let dirUri = directory.get_uri();
                Util.spawn(['xdg-open', dirUri]);
            }
        }
    }

    _on_map_clicked() {
        if (this.currentGPS) {
            // Build OpenStreetMap URL with coordinates
            // Format: https://www.openstreetmap.org/?mlat=LAT&mlon=LON#map=ZOOM/LAT/LON
            let lat = this.currentGPS.latitude;
            let lon = this.currentGPS.longitude;
            let zoom = 15; // Good zoom level for photo locations
            let osmUrl = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=${zoom}/${lat}/${lon}`;

            // Open in default browser
            Util.spawn(['xdg-open', osmUrl]);
        }
    }

    _on_open_image_clicked() {
        if (this.currentImagePath) {
            // Open image in default image viewer using URI (handles special characters)
            Util.spawn(['xdg-open', this.currentImagePath]);
        }
    }

    _load_specific_image(imagePath) {
        // Load a specific image without adding to history (used for back/forward navigation)
        if (this.updateInProgress) {
            return;
        }
        this.updateInProgress = true;

        try {
            global.log('========================================');
            global.log('PhotoCarousel: Loading specific image: ' + imagePath);

            // Load background image (stretched to fill entire frame)
            let backgroundImage = St.TextureCache.get_default().load_uri_async(imagePath, this.width, this.height);

            // Load foreground image WITHOUT dimensions (will be sized to maintain aspect ratio)
            let foregroundImage = St.TextureCache.get_default().load_uri_async(imagePath, -1, -1);

            let old_pic = this.currentPicture;
            let old_bg = this.currentBackground;

            this.currentPicture = foregroundImage;
            this.currentBackground = backgroundImage;
            this.currentImagePath = imagePath;

            // Add blur effect to background image
            backgroundImage.clear_effects();
            for (let i = 0; i < this.background_blur; i++) {
                backgroundImage.add_effect(new Clutter.BlurEffect());
            }

            // Connect to size notification to maintain aspect ratio on foreground
            global.log('PhotoCarousel: Connecting notify::size callback');
            foregroundImage._notif_id = foregroundImage.connect('notify::size', Lang.bind(this, this._size_pic));

            // Function to swap images
            let swapImages = Lang.bind(this, function() {
                // Remove old images first
                if (old_pic) {
                    this._photoFrame.remove_child(old_pic);
                    old_pic.destroy();
                }
                if (old_bg) {
                    this._backgroundFrame.remove_child(old_bg);
                    old_bg.destroy();
                }

                // Add background image (stretched, blurred)
                global.log('PhotoCarousel: Adding background image to container');
                this._backgroundFrame.add_child(this.currentBackground);

                // Add foreground image to container IMMEDIATELY so notify::size can fire
                global.log('PhotoCarousel: Adding foreground image to container');
                this._photoFrame.add_child(this.currentPicture);

                // Show overlays that are set to "always"
                this._update_always_overlays();
            });

            // Apply fade transition if fade_delay > 0
            if (this.fade_delay > 0) {
                Tweener.addTween(this._container, {
                    opacity: 0,
                    time: this.fade_delay,
                    transition: 'easeInSine',
                    onComplete: Lang.bind(this, function() {
                        swapImages();
                        Tweener.addTween(this._container, {
                            opacity: 255,
                            time: this.fade_delay,
                            transition: 'easeOutSine',
                            onComplete: Lang.bind(this, function() {
                                this.updateInProgress = false;
                            })
                        });
                    })
                });
            } else {
                // No fade - swap immediately
                swapImages();
                this.updateInProgress = false;
            }
        } catch (e) {
            global.logError('Error loading image: ' + e);
            this.updateInProgress = false;
        }
    }

    on_setting_changed() {
        // Stop the current update loop
        if (this.update_id != 0) {
            Mainloop.source_remove(this.update_id);
            this.update_id = 0;
        }
        this.isPaused = false;

        // Reset timing tracking
        this.lastUpdateTime = null;
        this.remainingDelay = null;

        // Reset history when settings change
        this.imageHistory = [];
        this.historyPosition = -1;

        // Update container and frame sizes
        this._container.set_size(this.width, this.height);
        this._backgroundFrame.set_size(this.width, this.height);
        this._colorOverlay.set_size(this.width, this.height);
        this._photoFrame.set_size(this.width, this.height);
        this._pathLabel.set_position(0, this.height - 30);

        // Update frame styling and color overlay
        this._update_frame_style();
        this._update_color_overlay();

        // Handle directory change - re-scan folders
        if (this.dir && this.dir.indexOf('://') === -1) {
            let file = Gio.file_new_for_path(this.dir);
            this.dir = file.get_uri();
        }

        if (!this.dir || this.dir === ' ') {
            let file = Gio.file_new_for_path(GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_PICTURES));
            this.dir = file.get_uri();
        }

        this.baseDir = Gio.file_new_for_uri(this.dir);

        // Clear and rescan folders
        this._folders = [];
        if (this.baseDir.query_exists(null)) {
            this._scan_for_folders(this.baseDir, 0);
            // Restart the update loop
            this._update_loop();
        } else {
            global.logError('Directory does not exist: ' + this.dir);
            this._show_error_message('Folder not found');
        }
    }

    _update_always_overlays() {
        // Show overlays that are set to "always" (called after image load)
        if (!this.currentImagePath) {
            return;
        }

        // Check if any info items are set to "always"
        let hasAlwaysInfo = this.exif_date_display === 'always' ||
                           this.file_path_display === 'always' ||
                           this.exif_description_display === 'always';

        if (hasAlwaysInfo) {
            let infoLines = [];

            if (this.exif_date_display === 'always') {
                let exifDate = this._get_exif_date(this.currentImagePath);
                if (exifDate) {
                    infoLines.push(exifDate);
                }
            }

            if (this.file_path_display === 'always') {
                let file = Gio.file_new_for_uri(this.currentImagePath);
                let displayPath = file.get_path();
                let basePath = this.baseDir.get_path();
                if (displayPath.startsWith(basePath)) {
                    displayPath = displayPath.substring(basePath.length);
                    if (displayPath.startsWith('/')) {
                        displayPath = displayPath.substring(1);
                    }
                }
                infoLines.push(displayPath);
            }

            if (this.exif_description_display === 'always') {
                let exifDescription = this._get_exif_description(this.currentImagePath);
                if (exifDescription) {
                    infoLines.push(exifDescription);
                }
            }

            if (infoLines.length > 0) {
                let combinedText = infoLines.join('\n');
                this._dateLabel.set_text(combinedText);
                let textWidth = this._dateLabel.get_width();
                let xPos = (this.info_label_position === 'top-left') ? 10 : (this.width - textWidth - 10);
                this._dateLabel.set_position(xPos, 5);
                this._dateLabel.show();
            }
        }

        // Show nav buttons if set to "always"
        if (this.nav_buttons_display === 'always') {
            if (this.show_map_button) {
                this.currentGPS = this._get_exif_gps(this.currentImagePath);
                if (this.currentGPS) {
                    this._mapButton.show();
                } else {
                    this._mapButton.hide();
                }
            } else {
                this._mapButton.hide();
            }

            let navWidth = this._navButtonsBox.get_width();
            let xPos = (this.width - navWidth) / 2;
            let yPos = this.height - 40;
            this._navButtonsBox.set_position(xPos, yPos);
            this._navButtonsBox.show();

            this._backButton.set_reactive(this.historyPosition > 0);
            this._backButton.set_opacity(this.historyPosition > 0 ? 255 : 100);
        }
    }

    _update_overlays() {
        // Update info label (date, path, description) based on settings
        if (this.currentImagePath) {
            let infoLines = [];

            // Get and add EXIF date if enabled and available
            if (this.exif_date_display !== 'never') {
                let exifDate = this._get_exif_date(this.currentImagePath);
                if (exifDate) {
                    infoLines.push(exifDate);
                }
            }

            // Add file path if enabled
            if (this.file_path_display !== 'never') {
                // Convert URI to path for display using Gio (handles special characters properly)
                let file = Gio.file_new_for_uri(this.currentImagePath);
                let displayPath = file.get_path();

                // Shorten path to show only relative to base directory
                let basePath = this.baseDir.get_path();
                if (displayPath.startsWith(basePath)) {
                    displayPath = displayPath.substring(basePath.length);
                    if (displayPath.startsWith('/')) {
                        displayPath = displayPath.substring(1);
                    }
                }
                infoLines.push(displayPath);
            }

            // Add EXIF description if enabled
            if (this.exif_description_display !== 'never') {
                let exifDescription = this._get_exif_description(this.currentImagePath);
                if (exifDescription) {
                    infoLines.push(exifDescription);
                }
            }

            // Combine all info into one label at configured position
            if (infoLines.length > 0) {
                let combinedText = infoLines.join('\n');
                this._dateLabel.set_text(combinedText);
                // Position based on user setting - top-left or top-right
                let textWidth = this._dateLabel.get_width();
                let xPos = (this.info_label_position === 'top-left') ? 10 : (this.width - textWidth - 10);
                this._dateLabel.set_position(xPos, 5);
                this._dateLabel.show();
            } else {
                this._dateLabel.hide();
            }
        }

        // Update navigation buttons based on settings
        if (this.currentImagePath && this.nav_buttons_display !== 'never') {
            // Check for GPS data and show/hide map button (if enabled in settings)
            if (this.show_map_button) {
                this.currentGPS = this._get_exif_gps(this.currentImagePath);
                if (this.currentGPS) {
                    this._mapButton.show();
                } else {
                    this._mapButton.hide();
                }
            } else {
                this._mapButton.hide();
            }

            // Position nav buttons at bottom center
            let navWidth = this._navButtonsBox.get_width();
            let xPos = (this.width - navWidth) / 2;
            let yPos = this.height - 40;
            this._navButtonsBox.set_position(xPos, yPos);
            this._navButtonsBox.show();

            // Enable/disable back button based on history position
            this._backButton.set_reactive(this.historyPosition > 0);
            this._backButton.set_opacity(this.historyPosition > 0 ? 255 : 100);
        }
    }

    _on_mouse_enter(actor, event) {
        // Pause rotation on hover and calculate remaining time
        if (this.update_id != 0) {
            // Calculate how much time has elapsed since last update
            if (this.lastUpdateTime) {
                let currentTime = new Date().getTime();
                let elapsedSeconds = (currentTime - this.lastUpdateTime) / 1000;
                this.remainingDelay = Math.max(0, this.delay - elapsedSeconds);
            } else {
                this.remainingDelay = this.delay;
            }

            Mainloop.source_remove(this.update_id);
            this.update_id = 0;
            this.isPaused = true;
        }

        // Update overlays (show info and nav buttons based on settings)
        this._update_overlays();

        // Hide path label since we moved everything to date label
        this._pathLabel.hide();
    }

    _on_nav_button_enter(button, event) {
        // Increase brightness and size on hover
        let icon = button.get_child();
        if (icon) {
            icon.set_style('filter: brightness(1.5); transform: scale(1.15);');
        }
    }

    _on_nav_button_leave(button, event) {
        // Reset to normal on leave
        let icon = button.get_child();
        if (icon) {
            icon.set_style('');
        }
    }

    _on_mouse_leave(actor, event) {
        this._pathLabel.hide();

        // Only hide date label if none of the info items are set to "always"
        let hasAlwaysInfo = this.exif_date_display === 'always' ||
                           this.file_path_display === 'always' ||
                           this.exif_description_display === 'always';
        if (!hasAlwaysInfo) {
            this._dateLabel.hide();
        }

        // Only hide nav buttons if not set to "always"
        if (this.nav_buttons_display !== 'always') {
            this._navButtonsBox.hide();
        }

        // Clear GPS data
        this.currentGPS = null;

        // Resume rotation if it was paused, using remaining delay
        if (this.isPaused) {
            this.isPaused = false;

            // Use remaining delay if available, otherwise use full delay
            let delayToUse = (this.remainingDelay !== null) ? this.remainingDelay : this.delay;

            // Schedule the next update with the remaining time
            this.update_id = Mainloop.timeout_add_seconds(delayToUse, Lang.bind(this, this._update_loop));

            // Reset remaining delay
            this.remainingDelay = null;
        }
    }

    on_desklet_removed() {
        if (this.update_id != 0) {
            Mainloop.source_remove(this.update_id);
            this.update_id = 0;
        }
    }
}

function main(metadata, desklet_id) {
    return new PhotoCarouselDesklet(metadata, desklet_id);
}
