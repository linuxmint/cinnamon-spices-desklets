/**
 * Lightweight Clutter animations for PowerPulse.
 * Prefer short easings; avoid continuous timers.
 */

const Clutter = imports.gi.Clutter;

const DUR_EXPAND = 220;
const DUR_BAR = 280;

function easeActor(actor, props) {
    if (!actor || typeof actor.ease !== "function") {
        Object.keys(props).forEach((key) => {
            if (key === "onComplete" || key === "duration" || key === "mode") {
                return;
            }
            try {
                if (key === "opacity") {
                    actor.opacity = props[key];
                } else if (key === "height" && typeof actor.set_height === "function") {
                    actor.set_height(props[key]);
                } else if (key === "width" && typeof actor.set_width === "function") {
                    actor.set_width(props[key]);
                }
            } catch (e) {}
        });
        if (typeof props.onComplete === "function") {
            props.onComplete();
        }
        return;
    }

    const params = Object.assign({
        duration: DUR_EXPAND,
        mode: Clutter.AnimationMode.EASE_OUT_CUBIC
    }, props);
    actor.ease(params);
}

function fadeIn(actor, duration) {
    if (!actor) {
        return;
    }
    actor.show();
    actor.opacity = 0;
    easeActor(actor, {
        opacity: 255,
        duration: duration || DUR_EXPAND,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD
    });
}

function fadeOut(actor, duration, onDone) {
    if (!actor) {
        if (onDone) onDone();
        return;
    }
    easeActor(actor, {
        opacity: 0,
        duration: duration || DUR_EXPAND,
        mode: Clutter.AnimationMode.EASE_IN_QUAD,
        onComplete: () => {
            try { actor.hide(); } catch (e) {}
            if (onDone) onDone();
        }
    });
}

function animateWidth(actor, width, duration) {
    if (!actor) {
        return;
    }
    easeActor(actor, {
        width: Math.max(2, Math.round(width)),
        duration: duration || DUR_BAR,
        mode: Clutter.AnimationMode.EASE_OUT_CUBIC
    });
}

module.exports = {
    DUR_EXPAND,
    DUR_BAR,
    easeActor,
    fadeIn,
    fadeOut,
    animateWidth
};
