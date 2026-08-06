/*
 * theme.js - the soft neon rainbow palette and the Fluent surface rules
 * built on top of it.
 *
 * Cinnamon's CSS engine understands a useful subset of CSS: solid and
 * rgba colours, border radius, box shadows and two-stop background
 * gradients. Everything here is expressed within that subset, and the
 * per-event colours are emitted as inline style strings because they are
 * chosen at runtime rather than authored in the stylesheet.
 */

// Soft neon: saturated enough to glow against a photograph, desaturated
// enough that eight of them side by side do not fight each other.
var RAINBOW = [
    { name: 'rose', rgb: [255, 122, 183] },
    { name: 'coral', rgb: [255, 150, 110] },
    { name: 'amber', rgb: [255, 205, 112] },
    { name: 'lime', rgb: [168, 240, 140] },
    { name: 'mint', rgb: [116, 240, 190] },
    { name: 'cyan', rgb: [116, 224, 245] },
    { name: 'azure', rgb: [130, 170, 255] },
    { name: 'violet', rgb: [190, 150, 250] },
];

function rgba(rgb, alpha) {
    if (alpha >= 1)
        return 'rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')';
    return 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + alpha.toFixed(3) + ')';
}

function mix(a, b, amount) {
    return [
        Math.round(a[0] + (b[0] - a[0]) * amount),
        Math.round(a[1] + (b[1] - a[1]) * amount),
        Math.round(a[2] + (b[2] - a[2]) * amount),
    ];
}

function lighten(rgb, amount) {
    return mix(rgb, [255, 255, 255], amount);
}

function darken(rgb, amount) {
    return mix(rgb, [0, 0, 0], amount);
}

// WCAG relative luminance, used to keep accent text readable rather than
// merely pretty.
function relativeLuminance(rgb) {
    let channels = rgb.map(function (value) {
        let c = value / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(a, b) {
    let la = relativeLuminance(a);
    let lb = relativeLuminance(b);
    let lighter = Math.max(la, lb);
    let darker = Math.min(la, lb);
    return (lighter + 0.05) / (darker + 0.05);
}

var CONTRAST_TARGET = 4.5;

/*
 * Picks a colour for an occurrence. Three strategies, because which one
 * reads best depends entirely on how someone uses their calendars.
 */
function accentFor(mode, occurrence, position) {
    let index;

    switch (mode) {
        case 'position':
            index = position;
            break;
        case 'clock': {
            // Map the working day across the spectrum: early starts land
            // on warm colours, late afternoons on cool ones.
            let date = occurrence.start;
            let minutes = date.getHours() * 60 + date.getMinutes();
            let fraction = Math.min(0.9999, Math.max(0, (minutes - 6 * 60) / (15 * 60)));
            index = Math.floor(fraction * RAINBOW.length);
            break;
        }
        case 'calendar':
        default:
            index = occurrence.calendarIndex;
            break;
    }

    return RAINBOW[((index % RAINBOW.length) + RAINBOW.length) % RAINBOW.length];
}

/*
 * Palette derived from the user's light/dark preference. Fluent leans on
 * layered translucency rather than hard borders, so every surface here is
 * a low-alpha wash over whatever the desktop wallpaper happens to be.
 */
function surfacePalette(dark) {
    if (dark) {
        return {
            dark: true,
            base: [18, 18, 26],
            text: 'rgba(255,255,255,0.96)',
            textMuted: 'rgba(255,255,255,0.62)',
            textFaint: 'rgba(255,255,255,0.40)',
            stroke: 'rgba(255,255,255,0.10)',
            strokeStrong: 'rgba(255,255,255,0.16)',
            layer: 'rgba(255,255,255,0.055)',
            layerHover: 'rgba(255,255,255,0.095)',
            shadow: 'rgba(0,0,0,0.55)',
        };
    }
    return {
        dark: false,
        base: [246, 246, 250],
        text: 'rgba(16,16,24,0.94)',
        textMuted: 'rgba(16,16,24,0.62)',
        textFaint: 'rgba(16,16,24,0.42)',
        stroke: 'rgba(16,16,24,0.10)',
        strokeStrong: 'rgba(16,16,24,0.18)',
        layer: 'rgba(255,255,255,0.55)',
        layerHover: 'rgba(255,255,255,0.78)',
        shadow: 'rgba(0,0,0,0.22)',
    };
}

/*
 * Accent text needs different treatment on light and dark surfaces: the
 * same neon that sings on near-black is illegible on near-white. Rather
 * than guess at a fixed adjustment, walk the colour toward the far end of
 * the scale until it actually clears the contrast threshold. Hues vary
 * enormously in luminance, so a single factor would leave the yellows and
 * greens unreadable while over-darkening the pinks.
 */
function accentText(accent, palette) {
    let background = palette.base;
    if (contrastRatio(accent.rgb, background) >= CONTRAST_TARGET)
        return rgba(accent.rgb, 1);

    for (let step = 1; step <= 20; step++) {
        let amount = step * 0.05;
        let candidate = palette.dark
            ? lighten(accent.rgb, amount)
            : darken(accent.rgb, amount);
        if (contrastRatio(candidate, background) >= CONTRAST_TARGET)
            return rgba(candidate, 1);
    }

    return palette.dark ? 'rgb(255,255,255)' : 'rgb(0,0,0)';
}

function join(rules) {
    return rules.filter(function (rule) { return !!rule; }).join(' ');
}

var Theme = class Theme {
    constructor(options) {
        this.update(options);
    }

    update(options) {
        this.scale = options.scale || 1;
        this.dark = options.dark !== false;
        // A missing value would otherwise become NaN, which St rejects,
        // taking the whole style string with it and leaving the desklet
        // completely unstyled.
        let opacity = Number(options.opacity);
        this.opacity = isNaN(opacity) ? 0.72 : Math.max(0, Math.min(1, opacity));
        this.glow = options.glow !== false;
        this.tint = options.tint !== false;
        this.density = options.density || 'comfortable';
        this.width = options.width || 380;
        this.palette = surfacePalette(this.dark);
    }

    // Every dimension in the desklet flows through here, which is what
    // makes a single width or scale change reflow the whole layout.
    px(value) {
        return Math.max(0, Math.round(value * this.scale));
    }

    pt(value) {
        return Math.max(6, Math.round(value * this.scale * 10) / 10);
    }

    get densityFactor() {
        switch (this.density) {
            case 'compact': return 0.72;
            case 'spacious': return 1.35;
            default: return 1;
        }
    }

    gap(value) {
        return this.px(value * this.densityFactor);
    }

    rootStyle() {
        let p = this.palette;
        return join([
            'width: ' + Math.round(this.width) + 'px;',
            'background-color: ' + rgba(p.base, this.opacity) + ';',
            'border: 1px solid ' + p.stroke + ';',
            'border-radius: ' + this.px(14) + 'px;',
            'padding: ' + this.gap(14) + 'px;',
            'box-shadow: 0 ' + this.px(10) + 'px ' + this.px(28) + 'px 0 ' + p.shadow + ';',
            'color: ' + p.text + ';',
        ]);
    }

    headerStyle() {
        return join([
            'font-size: ' + this.pt(9.5) + 'pt;',
            'font-weight: bold;',
            'color: ' + this.palette.textMuted + ';',
        ]);
    }

    headerDateStyle() {
        return join([
            'font-size: ' + this.pt(9.5) + 'pt;',
            'color: ' + this.palette.textFaint + ';',
        ]);
    }

    /*
     * The focused card. This is the one element allowed to shout: a
     * tinted acrylic layer, an accent hairline, and an optional bloom
     * that intensifies as the appointment approaches.
     */
    focusCardStyle(accent, urgency) {
        let p = this.palette;
        let tintAmount = this.tint ? (0.10 + 0.06 * urgency) : 0;
        let background = this.tint
            ? rgba(mix(p.base, accent.rgb, tintAmount), Math.max(this.opacity * 0.55, 0.30))
            : p.layer;

        let glowRadius = this.px(10 + 16 * urgency);
        let glowAlpha = 0.20 + 0.30 * urgency;

        return join([
            'background-color: ' + background + ';',
            'border: 1px solid ' + rgba(accent.rgb, 0.30 + 0.30 * urgency) + ';',
            'border-radius: ' + this.px(12) + 'px;',
            'padding: ' + this.gap(14) + 'px;',
            this.glow
                ? 'box-shadow: 0 0 ' + glowRadius + 'px 0 ' + rgba(accent.rgb, glowAlpha) + ';'
                : '',
        ]);
    }

    accentBarStyle(accent, height) {
        return join([
            'background-color: ' + rgba(accent.rgb, 0.95) + ';',
            'width: ' + this.px(3) + 'px;',
            'height: ' + height + 'px;',
            'border-radius: ' + this.px(2) + 'px;',
            this.glow ? 'box-shadow: 0 0 ' + this.px(8) + 'px 0 ' + rgba(accent.rgb, 0.55) + ';' : '',
        ]);
    }

    eyebrowStyle(accent) {
        return join([
            'font-size: ' + this.pt(8) + 'pt;',
            'font-weight: bold;',
            'color: ' + accentText(accent, this.palette) + ';',
        ]);
    }

    focusTitleStyle(compact) {
        return join([
            'font-size: ' + this.pt(compact ? 13 : 16) + 'pt;',
            'font-weight: bold;',
            'color: ' + this.palette.text + ';',
        ]);
    }

    focusTimeStyle(accent) {
        return join([
            'font-size: ' + this.pt(11) + 'pt;',
            'color: ' + accentText(accent, this.palette) + ';',
        ]);
    }

    countdownStyle(accent, urgent) {
        return join([
            'font-size: ' + this.pt(10) + 'pt;',
            'font-weight: bold;',
            'color: ' + (urgent ? accentText(accent, this.palette) : this.palette.textMuted) + ';',
        ]);
    }

    metaStyle() {
        return join([
            'font-size: ' + this.pt(9) + 'pt;',
            'color: ' + this.palette.textMuted + ';',
        ]);
    }

    /*
     * The calendar an event belongs to. Quiet on purpose: it is context,
     * not content, and in calendar colour mode the accent already says
     * the same thing more subtly.
     */
    calendarTagStyle() {
        return join([
            'font-size: ' + this.pt(8) + 'pt;',
            'color: ' + this.palette.textFaint + ';',
        ]);
    }

    upcomingRowStyle(accent, hovered) {
        let p = this.palette;
        let background = hovered ? p.layerHover : p.layer;
        if (this.tint && hovered)
            background = rgba(mix(p.base, accent.rgb, 0.16), 0.55);

        return join([
            'background-color: ' + background + ';',
            'border-radius: ' + this.px(9) + 'px;',
            'padding: ' + this.gap(8) + 'px ' + this.gap(10) + 'px;',
            'border: 1px solid ' + (hovered ? rgba(accent.rgb, 0.28) : 'transparent') + ';',
        ]);
    }

    upcomingTimeStyle(accent) {
        return join([
            'font-size: ' + this.pt(9.5) + 'pt;',
            'font-weight: bold;',
            'color: ' + accentText(accent, this.palette) + ';',
        ]);
    }

    upcomingTitleStyle() {
        return join([
            'font-size: ' + this.pt(10) + 'pt;',
            'color: ' + this.palette.text + ';',
        ]);
    }

    chipStyle(accent) {
        return join([
            'background-color: ' + rgba(accent.rgb, 0.18) + ';',
            'border: 1px solid ' + rgba(accent.rgb, 0.35) + ';',
            'border-radius: ' + this.px(20) + 'px;',
            'padding: ' + this.px(2) + 'px ' + this.px(9) + 'px;',
            'font-size: ' + this.pt(8.5) + 'pt;',
            'color: ' + accentText(accent, this.palette) + ';',
        ]);
    }

    /*
     * The join button. Filled rather than outlined, because it is the one
     * thing on the card a person is meant to act on, and Fluent reserves
     * solid accent fills for exactly that.
     */
    joinButtonStyle(accent, hovered) {
        let p = this.palette;
        let fill = hovered ? lighten(accent.rgb, 0.12) : accent.rgb;
        // The label sits on the accent itself here, so it has to contrast
        // with the fill rather than with the card behind it.
        let onAccent = relativeLuminance(accent.rgb) > 0.45
            ? 'rgba(12,12,18,0.92)'
            : 'rgba(255,255,255,0.96)';

        return join([
            'background-color: ' + rgba(fill, hovered ? 1 : 0.92) + ';',
            'border: 1px solid ' + rgba(lighten(accent.rgb, 0.2), 0.9) + ';',
            'border-radius: ' + this.px(14) + 'px;',
            'padding: ' + this.px(4) + 'px ' + this.px(12) + 'px;',
            'font-size: ' + this.pt(9) + 'pt;',
            'font-weight: bold;',
            'color: ' + onAccent + ';',
            this.glow && hovered
                ? 'box-shadow: 0 0 ' + this.px(12) + 'px 0 ' + rgba(accent.rgb, 0.6) + ';'
                : '',
        ]);
    }

    // The compact form used in the list, where a filled pill on every row
    // would compete with the focused card.
    joinChipStyle(accent, hovered) {
        return join([
            'background-color: ' + rgba(accent.rgb, hovered ? 0.34 : 0.16) + ';',
            'border: 1px solid ' + rgba(accent.rgb, hovered ? 0.65 : 0.32) + ';',
            'border-radius: ' + this.px(12) + 'px;',
            'padding: ' + this.px(1) + 'px ' + this.px(8) + 'px;',
            'font-size: ' + this.pt(8) + 'pt;',
            'font-weight: bold;',
            'color: ' + accentText(accent, this.palette) + ';',
        ]);
    }

    // A two-stop gradient reads as a filled track; the same widget with a
    // flat low-alpha colour reads as the empty remainder behind it.
    progressTrackStyle() {
        return join([
            'background-color: ' + this.palette.stroke + ';',
            'height: ' + this.px(3) + 'px;',
            'border-radius: ' + this.px(2) + 'px;',
        ]);
    }

    progressFillStyle(accent, width) {
        return join([
            'background-gradient-direction: horizontal;',
            'background-gradient-start: ' + rgba(accent.rgb, 0.55) + ';',
            'background-gradient-end: ' + rgba(lighten(accent.rgb, 0.25), 1) + ';',
            'width: ' + Math.max(0, Math.round(width)) + 'px;',
            'height: ' + this.px(3) + 'px;',
            'border-radius: ' + this.px(2) + 'px;',
            this.glow ? 'box-shadow: 0 0 ' + this.px(6) + 'px 0 ' + rgba(accent.rgb, 0.5) + ';' : '',
        ]);
    }

    emptyStyle() {
        return join([
            'font-size: ' + this.pt(11) + 'pt;',
            'color: ' + this.palette.textMuted + ';',
            'padding: ' + this.gap(18) + 'px 0;',
        ]);
    }

    errorStyle() {
        return join([
            'font-size: ' + this.pt(8.5) + 'pt;',
            'color: ' + rgba([255, 150, 110], 0.95) + ';',
        ]);
    }

    footerStyle() {
        return join([
            'font-size: ' + this.pt(8) + 'pt;',
            'color: ' + this.palette.textFaint + ';',
        ]);
    }
};
