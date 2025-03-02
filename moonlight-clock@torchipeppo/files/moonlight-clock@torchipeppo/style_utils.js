const UUID = "moonlight-clock@torchipeppo";
const DESKLET_DIR = imports.ui.deskletManager.deskletMeta[UUID].path;
let CONSTANTS;
if (typeof require !== 'undefined') {
    CONSTANTS = require("./constants");
}
else {
    imports.searchPath.push(DESKLET_DIR);
    CONSTANTS = imports.constants;
}

function split_font_string(font_string) {
    let a = font_string.split(" ");
    let output = {};
    output.size = Number(a.pop());
    output.style = "normal";
    output.weight = 400;
    while (a.length > 0) {
        let last = a[a.length-1].toLowerCase();
        let match;
        if (CONSTANTS.FONT_STYLES.includes(last)) {
            output.style = last;
            a.pop();
        }
        else if (CONSTANTS.FONT_WEIGHTS.includes(last)) {
            output.weight = CONSTANTS.FONT_WEIGHTS_TO_NUMERIC[last];
            a.pop();
        }
        else if (match=/weight=([0-9]+)/.exec(last)) {
            output.weight = Number(match[1]);
            a.pop();
        }
        else {
            break;
        }
    }
    output.family = a.join(" ");
    return output;
}

function get_style_string(scale, align, vpadding, hpadding, font_dict, color) {
    let vpadding_dir = "top";
    if (vpadding < 0) {
        vpadding_dir = "bottom";
        vpadding = -vpadding;
    }
    let hpadding_dir = "right";
    if (hpadding < 0) {
        hpadding_dir = "left";
        hpadding = -hpadding;
    }
    return  (font_dict.family ? ("font-family: " + font_dict.family + "; ") : "") +
            "font-size: " + scale*font_dict.size + "px; " +
            "font-weight: " + font_dict.weight + "; " +
            "font-style: " + font_dict.style + "; " +
            "text-align: " + align + ";" +
            "padding-" + vpadding_dir + ": " + scale*vpadding + "px; " +
            "padding-" + hpadding_dir + ": " + scale*hpadding + "px; " +
            "color: " + color + ";";
}

function countdown_formatting(n) {
    let n_str = n.toString();
    if (n_str.length == 1) {
        return "  "+n_str;
    }
    else if (n_str.length == 2) {
        return n_str[0] + " " + n_str[1];
    }
    else {
        return n_str
    }
}
