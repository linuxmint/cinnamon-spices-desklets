const Main = imports.ui.main;

// Share ownership across instances. Do not lower a layer the user raised with
// Cinnamon's Show desklets shortcut, or while another launcher is still hovered.
const owners = new Set();
let raisedByHover = false;

function raise(owner) {
    const actor = owner.actor;
    const parent = actor.get_parent();
    if (parent) {
        parent.set_child_above_sibling(actor, null);
    }
    if (owners.size === 0) {
        raisedByHover = !Main.deskletContainer.isModal;
    }
    owners.add(owner);
    if (raisedByHover && !Main.deskletContainer.isModal) {
        Main.deskletContainer.raise();
    }
}

function lower(owner) {
    owners.delete(owner);
    if (owners.size === 0 && raisedByHover) {
        raisedByHover = false;
        Main.deskletContainer.lower();
    }
}
