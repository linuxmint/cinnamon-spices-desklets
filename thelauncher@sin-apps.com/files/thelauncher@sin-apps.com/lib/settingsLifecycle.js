// Cinnamon destroys the old desklet after its replacement has registered the
// same UUID/instance. Finalizing the old settings normally unregisters the new
// settings too, leaving Configure's updateSetting D-Bus calls without a target.
function finalizeSettings(settings, manager) {
    if (!settings) {
        return;
    }
    const instances = manager.uuids[settings.uuid];
    if (instances && instances[settings.instanceId] === settings) {
        settings.finalize();
        return;
    }

    // Release only the old object's bindings and signals, preserving the live
    // instance's registration (or an already-unregistered instance).
    Object.keys(settings.bindings).forEach(key => settings.unbindAll(key));
    settings.disconnectAll();
}
