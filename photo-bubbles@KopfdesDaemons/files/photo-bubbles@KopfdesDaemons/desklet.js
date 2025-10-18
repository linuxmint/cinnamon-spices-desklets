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

const UUID = "photo-bubbles@KopfdesDaemons";
Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");

function _(str) {
  return Gettext.dgettext(UUID, str);
}

class MyDesklet extends Desklet.Desklet {
  constructor(metadata, deskletId) {
    super(metadata, deskletId);
    this.defaultImagePath = this.metadata.path + "/images/default-1.png";

    // Setup settings and bind them to properties
    const settings = new Settings.DeskletSettings(this, metadata["uuid"], deskletId);
    settings.bindProperty(Settings.BindingDirection.IN, "image-path", "imagePath", this._initUI.bind(this));
    settings.bindProperty(Settings.BindingDirection.IN, "shape", "shape", this._initUI.bind(this));

    this.setHeader(_("Photo Bubble"));
    this._initUI();
  }

  _initUI() {
    const mainContainer = new St.BoxLayout({ vertical: true });
    if (!this.imagePath) this.imagePath = this.defaultImagePath;

    const size = 150;
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
      case "triangle":
        cr.moveTo(centerX, centerY - radius); // Top point
        cr.lineTo(centerX + radius, centerY + radius); // Bottom right
        cr.lineTo(centerX - radius, centerY + radius); // Bottom left
        cr.closePath();
        break;
      case "star":
        this._drawStarPath(cr, centerX, centerY, radius);
        break;
      case "wave":
        this._drawWavePath(cr, centerX, centerY, radius);
        break;
      case "circle":
      default:
        cr.arc(centerX, centerY, radius, 0, 2 * Math.PI);
        cr.closePath();
        break;
    }
  }

  _drawWavePath(cr, centerX, centerY, radius, numWaves = 10, amplitude = 0.05) {
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

  _drawStarPath(cr, centerX, centerY, radius, numPetals = 8) {
    const angleStep = (2 * Math.PI) / (numPetals * 2);
    const outerRadius = radius;
    const innerRadius = radius * 0.6;

    cr.moveTo(centerX + outerRadius, centerY);

    for (let i = 1; i <= numPetals * 2; i++) {
      const currentRadius = i % 2 === 1 ? innerRadius : outerRadius;
      const angle = i * angleStep;
      const x = centerX + currentRadius * Math.cos(angle);
      const y = centerY + currentRadius * Math.sin(angle);
      cr.lineTo(x, y);
    }
    cr.closePath();
  }

  _createShapedImageActor(imagePath, size) {
    const canvas = new Clutter.Canvas();
    canvas.set_size(size, size);

    canvas.connect("draw", (canvas, cr, width, height) => {
      try {
        // Clear the canvas before drawing
        cr.save();
        cr.setOperator(Cairo.Operator.CLEAR);
        cr.paint();
        cr.restore();
        cr.setOperator(Cairo.Operator.OVER);

        const pixbuf = GdkPixbuf.Pixbuf.new_from_file(imagePath);

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

        const drawX = (width - newWidth) / 2;
        const drawY = (height - newHeight) / 2;
        Gdk.cairo_set_source_pixbuf(cr, pixbufWithAlpha, drawX, drawY);
        cr.paint();
        cr.restore();

        const borderWidth = 4.0;
        cr.setSourceRGBA(1.0, 1.0, 1.0, 1.0); // White color
        cr.setLineWidth(borderWidth);
        this._drawShapePath(cr, this.shape, width / 2, height / 2, (width - borderWidth) / 2);
        cr.stroke();
      } catch (e) {
        global.logError(`Error drawing circular image: ${e}`);
      }
      return true;
    });

    const actor = new Clutter.Actor({ width: size, height: size, content: canvas });
    actor.get_content().invalidate(); // Force a redraw
    return actor;
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
      return new St.Label({ text: "Error" + e.message, style_class: "photo-bubble-error-label" });
    }
  }
}

function main(metadata, deskletId) {
  return new MyDesklet(metadata, deskletId);
}
