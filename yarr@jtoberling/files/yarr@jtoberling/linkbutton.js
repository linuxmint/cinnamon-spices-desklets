const Lang = imports.lang;
const St = imports.gi.St;
const GObject = imports.gi.GObject;

// FIXEE: Reload should not redefine GType - needs a workaround
//        Desklet works only by restart cinnamon.

const YarrLinkButton = GObject.registerClass({
    }, 
    class YarrLinkButton extends St.Button {
    
        constructor(params) {
            super(params);
        }
        
        setUri(puri) {
            this.uri = puri;
        }
        
        getUri(uri) {
            return this.uri;
        }

});

