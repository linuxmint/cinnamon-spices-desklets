const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Gettext = imports.gettext;
const Settings = imports.ui.settings;
const Cairo = imports.cairo;
const GdkPixbuf = imports.gi.GdkPixbuf;
const Gdk = imports.gi.Gdk;
const Clutter = imports.gi.Clutter;
const Cogl = imports.gi.Cogl;
const Gio = imports.gi.Gio;

const UUID = "picture-frames@KopfdesDaemons";
Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");

function _(str) {
  return Gettext.dgettext(UUID, str);
}

class MyDesklet extends Desklet.Desklet {
  constructor(metadata, deskletId) {
    super(metadata, deskletId);
    this.defaultImagePath = this.metadata.path + "/images/default.jpg";

    // Setup settings and bind them to properties
    const settings = new Settings.DeskletSettings(this, metadata["uuid"], deskletId);
    settings.bindProperty(Settings.BindingDirection.IN, "image-path", "imagePath", this._initUI.bind(this));
    settings.bindProperty(Settings.BindingDirection.IN, "shape", "shape", this._initUI.bind(this));
    settings.bindProperty(Settings.BindingDirection.IN, "size", "size", this._initUI.bind(this));
    settings.bindProperty(Settings.BindingDirection.IN, "show-border", "showBorder", this._initUI.bind(this));
    settings.bindProperty(Settings.BindingDirection.IN, "border-color", "borderColor", this._initUI.bind(this));
    settings.bindProperty(Settings.BindingDirection.IN, "border-width", "borderWidth", this._initUI.bind(this));
    settings.bindProperty(Settings.BindingDirection.IN, "waves-number", "wavesNumber", this._initUI.bind(this));
    settings.bindProperty(Settings.BindingDirection.IN, "spikes-number", "spikesNumber", this._initUI.bind(this));
    settings.bindProperty(Settings.BindingDirection.IN, "wave-depth", "waveDepth", this._initUI.bind(this));
    settings.bindProperty(Settings.BindingDirection.IN, "spikes-depth", "spikesDepth", this._initUI.bind(this));
    settings.bindProperty(Settings.BindingDirection.IN, "align-x", "alignX", this._initUI.bind(this));
    settings.bindProperty(Settings.BindingDirection.IN, "align-y", "alignY", this._initUI.bind(this));

    this.setHeader(_("Picture Frame"));
    this._initUI();
  }

  _initUI() {
    const mainContainer = new St.BoxLayout({ vertical: true });
    if (!this.imagePath) this.imagePath = this.defaultImagePath;

    const size = this.size;
    const finalImagePath = decodeURIComponent(this.imagePath.replace("file://", ""));
    const imageActor = this._createShapedImageActor(finalImagePath, size);

    mainContainer.add_child(imageActor);
    this.setContent(mainContainer);
  }

  _drawShapePath(cr, shape, centerX, centerY, radius) {
    switch (shape) {
      case "square":
        cr.rectangle(centerX - radius, centerY - radius, radius * 2, radius * 2);
        break;
      case "star":
        this._drawStarPath(cr, centerX, centerY, radius);
        break;
      case "wave":
        this._drawWavePath(cr, centerX, centerY, radius);
        break;
      case "heart":
        this._drawHeartPath(cr, centerX, centerY, radius);
        break;
      case "circle":
      default:
        cr.arc(centerX, centerY, radius, 0, 2 * Math.PI);
        cr.closePath();
        break;
    }
  }

  _drawWavePath(cr, centerX, centerY, radius, numWaves = this.wavesNumber, amplitude = this.waveDepth / 100) {
    const baseRadius = radius * (1 - amplitude);
    const waveAmplitude = radius * amplitude;
    const points = 100; // Number of points for a smooth curve

    // Move to the starting point
    const startAngle = 0;
    const startR = baseRadius + waveAmplitude * Math.sin(startAngle * numWaves);
    cr.moveTo(centerX + startR * Math.cos(startAngle), centerY + startR * Math.sin(startAngle));

    for (let i = 1; i <= points; i++) {
      const angle = (i / points) * 2 * Math.PI;
      const r = baseRadius + waveAmplitude * Math.sin(angle * numWaves);
      cr.lineTo(centerX + r * Math.cos(angle), centerY + r * Math.sin(angle));
    }
    cr.closePath();
  }

  _drawStarPath(cr, centerX, centerY, radius, numSpikes = this.spikesNumber) {
    const angleStep = (2 * Math.PI) / (numSpikes * 2);
    const outerRadius = radius;
    const innerRadius = (radius * (100 - this.spikesDepth)) / 100;

    cr.moveTo(centerX + outerRadius, centerY);

    for (let i = 1; i <= numSpikes * 2; i++) {
      const currentRadius = i % 2 === 1 ? innerRadius : outerRadius;
      const angle = i * angleStep;
      const x = centerX + currentRadius * Math.cos(angle);
      const y = centerY + currentRadius * Math.sin(angle);
      cr.lineTo(x, y);
    }
    cr.closePath();
  }

  _drawHeartPath(cr, centerX, centerY, radius) {
    const yOffset = radius * 0.2; // Offset to center the heart vertically
    const topY = centerY - radius * 0.4 - yOffset;
    const bottomY = centerY + radius - yOffset;
    const rightX = centerX + radius;
    const leftX = centerX - radius;
    const rightCp1X = centerX + radius * 1.5;
    const leftCp1X = centerX - radius * 1.5;
    const cp2Y = centerY - radius - yOffset;

    // Start at the bottom point
    cr.moveTo(centerX, bottomY);
    // Right side
    cr.curveTo(rightCp1X, centerY, rightX, cp2Y, centerX, topY);
    // Left side
    cr.curveTo(leftX, cp2Y, leftCp1X, centerY, centerX, bottomY);
    cr.closePath();
  }

  _createShapedImageActor(imagePath, size) {
    const canvas = new Clutter.Canvas();
    canvas.set_size(size, size);
    const actor = new Clutter.Actor({ width: size, height: size, content: canvas });
    const file = Gio.file_new_for_path(imagePath);
    let pixbuf = null;

    canvas.connect("draw", (canvas, cr, width, height) => {
      // Clear the canvas
      cr.save();
      cr.setOperator(Cairo.Operator.CLEAR);
      cr.paint();
      cr.restore();
      cr.setOperator(Cairo.Operator.OVER);

      if (pixbuf === null) {
        // Draw loading text
        cr.setSourceRGBA(1.0, 1.0, 1.0, 0.7); // Semi-transparent white
        cr.selectFontFace("sans-serif", Cairo.FontSlant.NORMAL, Cairo.FontWeight.NORMAL);
        cr.setFontSize(20);
        const text = _("Loading...");
        const extents = cr.textExtents(text);
        cr.moveTo(width / 2 - extents.width / 2, height / 2);
        cr.showText(text);
      } else {
        // Draw the shaped image once pixbuf is loaded
        this._drawFinalImage(cr, pixbuf, width, height);
      }
      return true;
    });
    canvas.invalidate(); // Initial draw with "Loading..."

    file.read_async(GLib.PRIORITY_DEFAULT, null, (source, res) => {
      try {
        const stream = source.read_finish(res);
        GdkPixbuf.Pixbuf.new_from_stream_async(stream, null, (source, res) => {
          try {
            pixbuf = GdkPixbuf.Pixbuf.new_from_stream_finish(res);
            canvas.invalidate(); // Force a redraw now that the pixbuf is loaded
          } catch (e) {
            global.logError(`Error creating pixbuf from stream: ${e}`);
          }
        });
      } catch (e) {
        global.logError(`Error reading file async: ${e}`);
      }
    });
    return actor;
  }

  _drawFinalImage(cr, pixbuf, width, height) {
    try {
      // Preserve aspect ratio
      const originalWidth = pixbuf.get_width();
      const originalHeight = pixbuf.get_height();
      const aspect = originalWidth / originalHeight;

      let newWidth, newHeight;
      if (aspect > 1) {
        // Wider than tall
        newHeight = height;
        newWidth = height * aspect;
      } else {
        // Taller than wide or square
        newWidth = width;
        newHeight = width / aspect;
      }

      const scaledPixbuf = pixbuf.scale_simple(newWidth, newHeight, GdkPixbuf.InterpType.BILINEAR);
      const pixbufWithAlpha = scaledPixbuf.add_alpha(false, 0, 0, 0);

      cr.save();
      this._drawShapePath(cr, this.shape, width / 2, height / 2, width / 2);
      cr.clip();

      const drawX = (width - newWidth) * (this.alignX / 100);
      const drawY = (height - newHeight) * (this.alignY / 100);
      Gdk.cairo_set_source_pixbuf(cr, pixbufWithAlpha, drawX, drawY);
      cr.paint();
      cr.restore();

      if (this.showBorder) {
        const borderWidth = this.borderWidth;
        const [success, color] = Clutter.Color.from_string(this.borderColor);

        if (success) {
          cr.setSourceRGBA(color.red / 255, color.green / 255, color.blue / 255, color.alpha / 255);
        } else {
          // Fallback to white if color string is invalid
          cr.setSourceRGBA(1.0, 1.0, 1.0, 1.0);
        }
        cr.setLineWidth(borderWidth);
        this._drawShapePath(cr, this.shape, width / 2, height / 2, (width - borderWidth) / 2);
        cr.stroke();
      }
    } catch (e) {
      global.logError(`Error drawing shaped image: ${e}`);
    }
  }

  // Helper to create an actor from a Pixbuf
  _createActorFromPixbuf(pixBuf) {
    const pixelFormat = pixBuf.get_has_alpha() ? Cogl.PixelFormat.RGBA_8888 : Cogl.PixelFormat.RGB_888;
    const image = new Clutter.Image();
    image.set_data(pixBuf.get_pixels(), pixelFormat, pixBuf.get_width(), pixBuf.get_height(), pixBuf.get_rowstride());

    return new Clutter.Actor({
      content: image,
      width: pixBuf.get_width(),
      height: pixBuf.get_height(),
    });
  }

  _getImageAtScale(imageFileName, requestedWidth, requestedHeight) {
    try {
      const pixBuf = GdkPixbuf.Pixbuf.new_from_file_at_size(imageFileName, requestedWidth, requestedHeight);
      return this._createActorFromPixbuf(pixBuf);
    } catch (e) {
      global.logError(`Error loading image ${imageFileName}: ${e}`);
      return new St.Label({ text: "Error" + e.message, style_class: "picture-frame-error-label" });
    }
  }
}

function main(metadata, deskletId) {
  return new MyDesklet(metadata, deskletId);
}
