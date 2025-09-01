// Importa las librerías necesarias de Cinnamon y Gjs
const Desklet = imports.ui.desklet;
const GLib = imports.gi.GLib;
const Clutter = imports.gi.Clutter;
const St = imports.gi.St;

const Util = imports.misc.util;
const Tooltips = imports.ui.tooltips;
const PopupMenu = imports.ui.popupMenu;
const Main = imports.ui.main;
const ModalDialog = imports.ui.modalDialog;
var APPS = []; // Inicializa un array vacío para las aplicaciones


/* const APPS = [
    { name: 'Navegador', icon: 'firefox', command: 'firefox' },
    { name: 'Terminal', icon: 'utilities-terminal', command: 'gnome-terminal' },
    { name: 'Archivos', icon: 'nemo', command: 'nemo' },
    // Agrega más aplicaciones aquí
]; */

function TopbarDesklet(metadata, desklet_id) {
    this._init(metadata, desklet_id);
}

TopbarDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function(metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);
        this._expanded = false;
        this._focused_index = -1;

// Lista de aplicaciones personalizables
let deskletPath = this.metadata.path; // dentro de la clase del desklet
let filePath = deskletPath + '/apps_bar.json';
let [ok, contents, etag] = GLib.file_get_contents(filePath);
if (ok) {
     APPS = JSON.parse(contents.toString());
    // Ahora apps es un array con tus aplicaciones
}


         // El contenedor principal fue eliminado para evitar conflictos de parentesco. 


        // Tab para mostrar/ocultar barra
        this.tab = new St.Button({
            style_class: 'topbar-tab',
            reactive: true,
            can_focus: true,
            track_hover: true
        });
        let tabIcon = new St.Icon({
            icon_name: 'applications-science',
            icon_size: 24
        });
        this.tab.set_child(tabIcon);
        this.tab.connect('clicked', () => this._toggleBar());


        this.mainTabIcon = new St.Button({
            style_class: 'topbar-tab',
            reactive: true,
            can_focus: true,
            track_hover: true
        });

        let mainIcon = new St.Icon({
            icon_name: 'applications-science',
            icon_size: 24
        });
        this.mainTabIcon.set_child(mainIcon);
        this.mainTabIcon.connect('clicked', () => this._toggleBar());

        // Agrega opción al menú contextual estándar del desklet
        let self = this;
        let configMenuItem = new PopupMenu.PopupMenuItem('Configurar aplicaciones');
        configMenuItem.connect('activate', () => {
            // Ventana flotante NO modal, centrada y editable
            let floatBox = new St.BoxLayout({
                vertical: true,
                style_class: 'app-config-float',
                reactive: true,
                x_expand: false,
                y_expand: false
            });
            // Centrar en pantalla
            let width = 500;
            let height = 300;
            floatBox.set_size(width, height);
            floatBox.set_position(Math.floor((global.screen_width - width) / 2), Math.floor((global.screen_height - height) / 2));
            floatBox.set_style('background-color: rgba(30,30,30,0.97); border-radius: 16px; padding: 24px;');

            let title = new St.Label({ text: 'Configurar aplicaciones', style_class: 'dialog-title' });
            let closebtn = new St.Button({
                style_class: 'close-button',
                reactive: true,
                can_focus: true,
                track_hover: true
            });
            closebtn.set_child(new St.Icon({
                icon_name: 'window-close',
                icon_size: 16,
                style_class: 'close-icon'
            }));
            closebtn.connect('clicked', () => {
                Main.layoutManager.removeChrome(floatBox);
            });

     /*        // Área de texto editable (una sola línea) con St.Entry
            let textarea = new St.Entry({
                style_class: 'dialog-entry',
                text: JSON.stringify(APPS, null, 2).replace(/\n/g, ' '),
                x_expand: true,
                y_expand: true,
                can_focus: true,
                track_hover: true,
                hint_text: 'Edita el JSON de tus aplicaciones aquí'
            }); */
            // Permitir edición y guardar cambios al cerrar
            closebtn.connect('clicked', () => {
        /*         try {
                    APPS = JSON.parse(textarea.get_text());
                    GLib.file_set_contents(filePath, JSON.stringify(APPS, null, 2));
                } catch (e) {
                    global.logError('Error al parsear JSON: ' + e.message);
                } */
                Main.layoutManager.removeChrome(floatBox);
            });

      /*       // Permitir Ctrl+Enter para guardar y cerrar
            textarea.clutter_text.connect('key-press-event', (actor, event) => {
                let symbol = event.get_key_symbol();
                if ((event.get_state() & Clutter.ModifierType.CONTROL_MASK) && symbol === Clutter.KEY_Return) {
                    closebtn.emit('clicked');
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            }); */

            // Botón para abrir el JSON en el editor de texto predeterminado
            let openJsonBtn = new St.Button({
                style_class: 'open-json-btn',
                label: 'Abrir JSON en editor',
                reactive: true,
                can_focus: true,
                track_hover: true
            });
            openJsonBtn.connect('clicked', () => {
                Util.spawnCommandLine('xdg-open ' + filePath);
            });

            floatBox.add(title);
            floatBox.add(closebtn);
            floatBox.add(openJsonBtn);
     /*        floatBox.add(textarea); */
            floatBox.add(new St.Label({ text: 'Configura las aplicaciones que aparecerán en la barra superior.' }));
            floatBox.add(new St.Label({ text: 'Puedes agregar o eliminar aplicaciones según tus preferencias.' }));
            floatBox.add(new St.Label({ text: 'Ejemplo: { name: "Navegador", icon: "firefox", command: "firefox" }' }));
            

            // Mostrar la ventana flotante correctamente
            Main.layoutManager.addChrome(floatBox);
            floatBox.raise_top();
            // El foco automático se elimina para evitar el warning de Clutter
        });
        this._menu.addMenuItem(configMenuItem, 0);

        // Barra de aplicaciones (inicialmente oculta)
        this.bar = new St.BoxLayout({
            vertical: false, // Corrected: horizontal layout
            style_class: 'topbar-desklet',
            visible: false,
            width: 0, // Initial width for horizontal animation
            height: 80, // Fixed height for horizontal layout
        //    x_align: St.Align.START,
            reactive: true,
            can_focus: true
        });


        //
        /*  this.tab = new St.Button({
            style_class: 'topbar-tab',
            reactive: true,
            can_focus: true,
            track_hover: true
        }); */
        this.Maintab = new St.BoxLayout({
            style_class: 'desklet', // Clase de estilo base para desklets
            vertical: true,        // Los elementos dentro de 'tab' se apilarán verticalmente
            reactive: true         // Para que pueda recibir eventos de clic y arrastre
        });
        this._refreshBar();

        this.bar.connect('key-press-event', this._onKeyPress.bind(this));

    
        this.bar.add(this.tab);
 

        this.Maintab.add(this.mainTabIcon);
        
       this.setContent(this.Maintab);

        Main.keybindingManager.addHotKey(
            'toggle-topbar',
            metadata.keybindings['toggle-topbar'].value,
            () => this._toggleBar()
        );
    },

    _toggleBar: function() {
        this._expanded = !this._expanded;
        if (this._expanded) {
            this._showBar();
        } else {
            this._hideBar();
        }
    },

    _showBar: function() {
        this.bar.visible = true;
        Main.layoutManager.addChrome(this.bar);
        
        this.bar.raise_top();
        Main.pushModal(this.bar);
        this.bar.ease({ 
            opacity: 255, 
            width: this._getBarWidth(), 
            duration: 200, 
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                this._updateFocus(0);
            }
        });
    },

    _hideBar: function() {
        Main.popModal(this.bar);
        this.bar.ease({ 
            opacity: 0, 
            width: 0, 
            duration: 200, 
            mode: Clutter.AnimationMode.EASE_OUT_QUAD, 
            onComplete: () => {
                this.bar.hide();
                Main.layoutManager.removeChrome(this.bar);
                this._updateFocus(-1);
            }
        });
    },

    _onKeyPress: function(actor, event) {
        let symbol = event.get_key_symbol();
        let children = this.bar.get_children();
        if (children.length === 0) return Clutter.EVENT_PROPAGATE;

        let new_index = this._focused_index;

        if (symbol === Clutter.KEY_Left) {
            new_index = (this._focused_index - 1 + children.length) % children.length;
        } else if (symbol === Clutter.KEY_Right) {
            new_index = (this._focused_index + 1) % children.length;
        } else if (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter) {
            if (this._focused_index !== -1) {
                children[this._focused_index].emit('clicked', children[this._focused_index]);
            }
        } else if (symbol === Clutter.KEY_Escape) {
            this._toggleBar();
        }
        else {
            return Clutter.EVENT_PROPAGATE;
        }

        if (new_index !== this._focused_index) {
            this._updateFocus(new_index);
        }
        return Clutter.EVENT_STOP;
    },

    _updateFocus: function(new_index) {
        let children = this.bar.get_children();
        if (this._focused_index !== -1 && this._focused_index < children.length) {
            children[this._focused_index].remove_style_class_name('focused');
        }
        this._focused_index = new_index;
        if (this._focused_index !== -1 && this._focused_index < children.length) {
            children[this._focused_index].add_style_class_name('focused');
        }
    },

    _getBarWidth: function() {
        // 48px icono + 8px margen a cada lado (total 16px por icono) + 20px padding a cada lado de la barra (total 40px)
        return APPS.length * (48 + 16) + 40;
    },

    _refreshBar: function() {
        this.bar.destroy_all_children();
        APPS.forEach(app => {
            let btn = new St.Button({ style_class: 'topbar-app-btn', reactive: true, can_focus: true });
            let icon = new St.Icon({ icon_name: app.icon, icon_size: 36, style_class: 'topbar-app-icon' });
            btn.set_child(icon);
            btn.connect('clicked', () => {
                Util.spawnCommandLine(app.command);
            });
            new Tooltips.Tooltip(btn, app.name);
            this.bar.add_actor(btn);
        });
    },

    on_desklet_removed: function() {
        if (this._expanded) {
            Main.popModal(this.bar);
            Main.layoutManager.removeChrome(this.bar);
        }
    }
};

function main(metadata, desklet_id) {
    return new TopbarDesklet(metadata, desklet_id);
}
// Ventana de configuración para agregar aplicaciones a la barra
const Mainloop = imports.mainloop;