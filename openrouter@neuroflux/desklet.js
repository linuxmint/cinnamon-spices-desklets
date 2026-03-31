// OpenRouter Chat Assistant Desklet
const Desklet  = imports.ui.desklet;
const Settings = imports.ui.settings;
const St       = imports.gi.St;
const GLib     = imports.gi.GLib;
const Gio      = imports.gi.Gio;
const Clutter  = imports.gi.Clutter;
const Cinnamon = imports.gi.Cinnamon;
const Mainloop = imports.mainloop;
const Lang     = imports.lang;
const Pango    = imports.gi.Pango;
const Main     = imports.ui.main;
const Signals  = imports.signals;

const UUID = "openrouter@neuroflux";

function copyToClipboard(text) {
    try {
        let clipboard = St.Clipboard.get_default();
        clipboard.set_text(St.ClipboardType.CLIPBOARD, text);
        return true;
    } catch (e) {
        global.log(UUID + ": clipboard copy failed: " + e);
        return false;
    }
}

class RaisedBox {
    constructor() {
        this.stageEventIds = [];
        this.desklet = null;

        this.actor = new St.Group({ visible: false, x: 0, y: 0 });
        Main.uiGroup.add_actor(this.actor);

        let constraint = new Clutter.BindConstraint({
            source:     global.stage,
            coordinate: Clutter.BindCoordinate.POSITION | Clutter.BindCoordinate.SIZE
        });
        this.actor.add_constraint(constraint);

        this._backgroundBin = new St.Bin();
        this.actor.add_actor(this._backgroundBin);

        let monitor = Main.layoutManager.focusMonitor;
        this._backgroundBin.set_position(monitor.x, monitor.y);
        this._backgroundBin.set_size(monitor.width, monitor.height);

        let stack = new Cinnamon.Stack();
        this._backgroundBin.child = stack;

        this.eventBlocker = new Clutter.Group({ reactive: true });
        stack.add_actor(this.eventBlocker);

        this.groupContent = new St.Bin({
            x_align: St.Align.MIDDLE,
            y_align: St.Align.MIDDLE,
            x_fill:  false,
            y_fill:  false,
            width:   monitor.width,
            height:  monitor.height
        });
        stack.add_actor(this.groupContent);
    }

    add(desklet) {
        this.desklet = desklet;
        this.groupContent.add_actor(this.desklet.chatActor);

        this.actor.show();
        global.set_stage_input_mode(Cinnamon.StageInputMode.FOCUSED);
        global.stage.set_key_focus(this.actor);
        this.actor.grab_key_focus();
        global.set_stage_input_mode(Cinnamon.StageInputMode.FULLSCREEN);
        global.focus_manager.add_group(this.actor);

        this.stageEventIds.push(
            global.stage.connect("captured-event", Lang.bind(this, this._onStageEvent))
        );
    }

    remove() {
        for (let i = 0; i < this.stageEventIds.length; i++)
            global.stage.disconnect(this.stageEventIds[i]);
        this.stageEventIds = [];

        if (this.desklet)
            this.groupContent.remove_actor(this.desklet.chatActor);

        this.actor.destroy();
        global.set_stage_input_mode(Cinnamon.StageInputMode.NORMAL);
    }

    _onStageEvent(actor, event) {
        let type = event.type();

        if (type === Clutter.EventType.KEY_RELEASE) return true;

        if (type === Clutter.EventType.KEY_PRESS) {
            if (event.get_key_symbol() === Clutter.KEY_Escape) {
                this.emit("closed");
                return true;
            }
            return false;
        }

        if (type === Clutter.EventType.BUTTON_PRESS) {
            this.actor.show();
            global.set_stage_input_mode(Cinnamon.StageInputMode.FOCUSED);
            global.stage.set_key_focus(this.actor);
            this.actor.grab_key_focus();
            global.set_stage_input_mode(Cinnamon.StageInputMode.FULLSCREEN);
        }

        let target = event.get_source();
        if (this.desklet && this.desklet.chatActor &&
            (target === this.desklet.chatActor || this.desklet.chatActor.contains(target)))
            return false;

        if (type === Clutter.EventType.BUTTON_RELEASE) this.emit("closed");

        return true;
    }
}

Signals.addSignalMethods(RaisedBox.prototype);

function httpPostStream(url, payload, apiKey, onLine, onDone) {
    let json = JSON.stringify(payload);
    let argv = [
        "curl", "-s", "--no-buffer",
        "-X", "POST",
        "-H", "Content-Type: application/json"
    ];

    if (apiKey && apiKey.trim() !== "") {
        argv.push("-H", "Authorization: Bearer " + apiKey);
    }
    argv.push("-H", "HTTP-Referer: https://dummy.com/");
    argv.push("-H", "X-Title: OpenRouter.ai LLM Prompt Desklet");
    argv.push("-d", json, url);

    let pid, stdin_fd, stdout_fd, stderr_fd;
    try {
        [/* ok */, pid, stdin_fd, stdout_fd, stderr_fd] =
            GLib.spawn_async_with_pipes(
                null, argv, null,
                GLib.SpawnFlags.SEARCH_PATH | GLib.SpawnFlags.DO_NOT_REAP_CHILD,
                null
            );
    } catch (e) {
        onDone("Failed to spawn curl: " + e.message);
        return;
    }

    try { new Gio.UnixOutputStream({ fd: stdin_fd, close_fd: true }).close(null); } catch (e) {}

    let ch = GLib.IOChannel.unix_new(stdout_fd);
    try { ch.set_encoding("utf-8"); }  catch (e) {}
    try { ch.set_flags(GLib.IOFlags.NONBLOCK); } catch (e) {}

    GLib.io_add_watch(ch, GLib.PRIORITY_DEFAULT, GLib.IOCondition.IN | GLib.IOCondition.HUP,
        function (channel, condition) {
            if (condition & GLib.IOCondition.IN) {
                let go = true;
                while (go) {
                    try {
                        let r = channel.read_line();
                        if (r && r[0] === GLib.IOStatus.NORMAL) {
                            let line = r[1];
                            if (line && line.length > 0) {
                                try { onLine(line.replace(/\r$/, "")); } catch (e) { global.log(UUID + " onLine err: " + e); }
                            }
                        } else if (r && r[0] === GLib.IOStatus.AGAIN) {
                            go = false;
                        } else {
                            go = false;
                        }
                    } catch (e) {
                        global.log(UUID + " read_line error: " + e.message);
                        go = false;
                    }
                }
            }

            if (condition & GLib.IOCondition.HUP) {
                try {
                    let r = channel.read_line();
                    if (r && r[0] === GLib.IOStatus.NORMAL && r[1] && r[1].length > 0)
                        try { onLine(r[1].replace(/\r$/, "")); } catch (e) {}
                } catch (e) {}
                try { channel.shutdown(false); } catch (e) {}
                GLib.spawn_close_pid(pid);
                onDone(null);
                return false;
            }

            return true;
        }
    );
}

let desklet_raised = false;

class HFChatDesklet extends Desklet.Desklet {

    constructor(metadata, desklet_id) {
        super(metadata, desklet_id);

        try {
            this._raisedBox      = null;
            this._keybindingId   = null;
            this._changingState  = false;
            this.isProcessing    = false;
            this.isReloading     = false;
            this._history        = [];
            this._thinkingRow    = null;
            this._thinkingBubble = null;
            this._thinkingTimer  = null;
            this._thinkingDots   = 0;
            this.settings = new Settings.DeskletSettings(this, metadata["uuid"], desklet_id);
            this.settings.bindProperty(Settings.BindingDirection.IN, "apiKey",            "apiKey",            null);
            this.settings.bindProperty(Settings.BindingDirection.IN, "modelType",         "modelType",         null);
            this.settings.bindProperty(Settings.BindingDirection.IN, "maxTokens",         "maxTokens",         null);
            this.settings.bindProperty(Settings.BindingDirection.IN, "temperature",       "temperature",       null);
            this.settings.bindProperty(Settings.BindingDirection.IN, "systemPrompt",      "systemPrompt",      null);
            this.settings.bindProperty(Settings.BindingDirection.IN, "windowWidth",       "deskletWidth",      Lang.bind(this, this._onSizeChanged));
            this.settings.bindProperty(Settings.BindingDirection.IN, "windowHeight",      "deskletHeight",     Lang.bind(this, this._onSizeChanged));
            this.settings.bindProperty(Settings.BindingDirection.IN, "backgroundOpacity", "backgroundOpacity", Lang.bind(this, this._onSizeChanged));
            this.settings.bindProperty(Settings.BindingDirection.IN, "accentColor",       "accentColor",       Lang.bind(this, this._onAccentChanged));
            this.settings.bindProperty(Settings.BindingDirection.IN, "fontSize",          "fontSize",          Lang.bind(this, this._onSizeChanged));
            this.settings.bindProperty(Settings.BindingDirection.IN, "keybinding",        "keybinding",        Lang.bind(this, this._registerKeybinding));

            this._buildLauncher();
            this.actor.add_actor(this.launcherBtn);

            this._buildChatPanel();
            this._registerKeybinding();

            global.log(UUID + ": init OK");
        } catch (e) {
            global.logError(UUID + ": constructor error: " + e);
        }
    }

    _buildLauncher() {
        this.launcherBtn = new St.Button({
            label:       "💬",
            style_class: "janai-launcher",
            reactive:    true,
            can_focus:   true,
            track_hover: true,
            style:       "background-color:transparent;border:none;box-shadow:none;"
        });
        this.launcherBtn.set_size(44, 44);
        this.launcherBtn.connect("clicked", Lang.bind(this, this._toggleRaise));
    }

    _buildChatPanel() {
        let w  = this.deskletWidth      || 460;
        let h  = this.deskletHeight     || 540;
        let op = (this.backgroundOpacity !== undefined ? this.backgroundOpacity : 97) / 100;
        let fs = this.fontSize          || 12;

        this.chatActor = new St.BoxLayout({
            vertical:    true,
            style_class: "janai-root",
            reactive:    true,
            can_focus:   true,
            style: "min-width:"  + w  + "px;" +
                   "min-height:" + h  + "px;" +
                   "background-color:rgba(14,14,18," + op + ");" +
                   "border-radius:16px;" +
                   "font-size:" + fs + "px;"
        });

        let titleBar   = new St.BoxLayout({ style_class: "janai-titlebar" });
        let titleLabel = new St.Label({ text: "💬  OpenRouter.ai LLM Prompt", style_class: "janai-title" });
        let closeBtn   = new St.Button({
            label:       "✕",
            style_class: "janai-close-btn",
            reactive:    true,
            can_focus:   false
        });
        closeBtn.connect("clicked", Lang.bind(this, this._lower));
        titleBar.add(titleLabel, { expand: true });
        titleBar.add(closeBtn);
        this.chatActor.add(titleBar);

        this.scrollView = new St.ScrollView({
            style_class:       "janai-scroll",
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            reactive:          true,
            style: "min-height:" + (h - 140) + "px;"
        });
        this.messageBox = new St.BoxLayout({
            vertical:    true,
            style_class: "janai-messages",
            reactive:    true
        });
        this.scrollView.add_actor(this.messageBox);
        this.chatActor.add(this.scrollView, { expand: true });

        let inputRow = new St.BoxLayout({ style_class: "janai-input-row", x_expand: true });

        this.inputEntry = new St.Entry({
            hint_text:   "Enter prompt & press CTRL+Enter to send…",
            style_class: "janai-entry",
            can_focus:   true,
            reactive:    true,
            x_expand:    true
        });
        this.inputEntry.clutter_text.line_wrap       = false;
        this.inputEntry.clutter_text.ellipsize        = Pango.EllipsizeMode.NONE;
        this.inputEntry.clutter_text.single_line_mode = true;
        this.inputEntry.connect("key-press-event", Lang.bind(this, this._onEntryKeyPress));

        this.sendBtn = new St.Button({
            label:       "Send",
            style_class: "janai-send-btn",
            reactive:    true,
            can_focus:   false
        });
        this.sendBtn.connect("clicked", Lang.bind(this, this._sendMessage));

        this.clearBtn = new St.Button({
            label:       "Clear",
            style_class: "janai-clear-btn",
            reactive:    true,
            can_focus:   false
        });
        this.clearBtn.connect("clicked", Lang.bind(this, this._clearHistory));

        inputRow.add(this.inputEntry, { expand: true });
        inputRow.add(this.sendBtn);
        inputRow.add(this.clearBtn);
        this.chatActor.add(inputRow);

        this.statusLabel = new St.Label({ text: "● Ready", style_class: "janai-status" });
        this.chatActor.add(this.statusLabel);
    }

    _onSizeChanged() {
        if (!this.chatActor) return;
        let w  = this.deskletWidth      || 460;
        let h  = this.deskletHeight     || 540;
        let op = (this.backgroundOpacity !== undefined ? this.backgroundOpacity : 97) / 100;
        let fs = this.fontSize          || 12;
        this.chatActor.style =
            "min-width:"  + w  + "px;" +
            "min-height:" + h  + "px;" +
            "background-color:rgba(14,14,18," + op + ");" +
            "border-radius:16px;" +
            "font-size:" + fs + "px;";
        if (this.scrollView)
            this.scrollView.style = "min-height:" + (h - 140) + "px;";
    }

    _onAccentChanged() {
        if (!this.sendBtn) return;
        let color = this.accentColor || "rgb(91,124,250)";
        this.sendBtn.style =
            "background:" + color + ";" +
            "border-radius:20px;padding:7px 14px;color:#ffffff;font-weight:bold;";
    }

    _registerKeybinding() {
        try {
            if (this._keybindingId) {
                Main.keybindingManager.removeHotKey(this._keybindingId);
                this._keybindingId = null;
            }
            let hotkey = this.keybinding || "<Super>h";
            this._keybindingId = UUID + "-raise";
            Main.keybindingManager.addHotKey(
                this._keybindingId, hotkey, Lang.bind(this, this._toggleRaise)
            );
        } catch (e) {
            global.log(UUID + ": keybinding failed: " + e);
        }
    }

    _toggleRaise() {
        if (desklet_raised) this._lower();
        else                this._raise();
    }

    _raise() {
        if (desklet_raised || this._changingState) return;
        this._changingState = true;

        this._raisedBox = new RaisedBox();
        this._raisedBox.add(this);
        this._raisedBox.connect("closed", Lang.bind(this, this._lower));

        desklet_raised      = true;
        this._changingState = false;

        this.statusLabel.text = "⌨  Active — Escape to dismiss";

        Mainloop.idle_add(Lang.bind(this, function () {
            if (this.inputEntry) this.inputEntry.clutter_text.grab_key_focus();
            return false;
        }));
    }

    _lower() {
        if (!desklet_raised || this._changingState) return;
        this._changingState = true;

        if (this._raisedBox) {
            this._raisedBox.remove();
            this._raisedBox = null;
        }

        desklet_raised      = false;
        this._changingState = false;

        this.statusLabel.text = "● Ready";
    }

    _onEntryKeyPress(actor, event) {
        let sym = event.get_key_symbol();
        if (sym === Clutter.KEY_Return || sym === Clutter.KEY_KP_Enter) {
            this._sendMessage();
            return Clutter.EVENT_STOP;
        }
        if (sym === Clutter.KEY_Escape) {
            this._lower();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _sendMessage() {
        if (this.isProcessing) return;
        let text = this.inputEntry.get_text().trim();
        if (!text) return;

        this.inputEntry.set_text("");
        this._addMessage(text, "user");
        this._history.push({ role: "user", content: text });

        this.isProcessing        = true;
        this.statusLabel.text    = "⟳ Thinking…";
        this.sendBtn.reactive    = false;
        this.inputEntry.reactive = false;

        this._addThinkingBubble();
        this._thinkingDots  = 0;
        this._thinkingTimer = Mainloop.timeout_add(500, Lang.bind(this, function () {
            if (!this._thinkingBubble) return false;
            this._thinkingDots = (this._thinkingDots + 1) % 4;
            let dots = "";
            for (let i = 0; i < this._thinkingDots + 1; i++) dots += "●";
            this._thinkingBubble.text = "Thinking " + dots;
            return true;
        }));

        Mainloop.idle_add(Lang.bind(this, function () { this._callApi(); return false; }));
    }

    _addThinkingBubble() {
        let row    = new St.BoxLayout({ style_class: "janai-row", reactive: false });
        let avatar = new St.Label({ text: "🤖", style_class: "janai-avatar" });
        let bubble = new St.Label({ text: "Thinking ●", style_class: "janai-bubble bot" });
        bubble.clutter_text.line_wrap      = true;
        bubble.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        bubble.clutter_text.ellipsize      = Pango.EllipsizeMode.NONE;

        row.add(avatar);
        row.add(bubble, { expand: true });
        this.messageBox.add(row);

        this._thinkingRow    = row;
        this._thinkingBubble = bubble;

        Mainloop.idle_add(Lang.bind(this, function () {
            let vbar = this.scrollView.get_vscroll_bar();
            if (vbar) {
                let adj = vbar.get_adjustment();
                adj.set_value(adj.get_upper() - adj.get_page_size());
            }
            return false;
        }));
    }

    _removeThinkingBubble() {
        if (this._thinkingTimer) {
            Mainloop.source_remove(this._thinkingTimer);
            this._thinkingTimer = null;
        }
        if (this._thinkingRow) {
            this._thinkingRow.destroy();
            this._thinkingRow    = null;
            this._thinkingBubble = null;
        }
    }

    _callApi() {
        let modelType = this.modelType  || "qwen/qwen3.6-plus-preview:free";
        let apiKey    = this.apiKey     || "";
        let url = "https://openrouter.ai/api/v1/chat/completions";

        let messages  = [];
        let sysPrompt = (this.systemPrompt || "You are a helpful assistant.").trim();
        if (sysPrompt) messages.push({ role: "system", content: sysPrompt });
        messages = messages.concat(this._history);

        let payload = {
            model:       modelType,
            messages:    messages,
            max_tokens:  this.maxTokens  || 2000,
            temperature: (this.temperature !== undefined && this.temperature !== null) ? this.temperature : 0.7,
            stream:      true
        };

        global.log(UUID + ": calling " + url + " model=" + modelType);

        let streamBubble  = null;
        let streamCopyBtn = null;
        let visibleText   = "";
        let rawAccum      = "";
        let inThink       = false;
        let thinkBuf      = "";
        let prefixBuf     = "";
        let self          = this;

		function markdownToPango(text) {
			if (!text) return "";

			// 1. Escape basic XML entities first so they don't break Pango tags
			let escaped = text
				.replace(/&/g, '&amp;')
				.replace(/</g, '&lt;')
				.replace(/>/g, '&gt;');

			// 2. Fenced Code Blocks (```lang ... ```)
			// We use a placeholder approach to prevent other rules from touching code
			let codeBlocks = [];
			escaped = escaped.replace(/```(\w*)\n?([\s\S]*?)```/g, function (_, lang, code) {
				let ph = "\x00CODE" + codeBlocks.length + "\x00";
				let header = lang ? `<b><span color='#888888' size='x-small'>${lang.toUpperCase()}</span></b>\n` : '';

				// Manual "box" simulation
				codeBlocks.push(
					`\n<span font_family='monospace' background='#222222' color='#c9d1d9'>` +
					header + code +
					`</span>\n`
				);
				return ph;
			});

			// 3. Inline formatting
			let res = escaped
				// Bold
				.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
				// Italic
				.replace(/\*([^\*\n]+)\*/g, '<i>$1</i>')
				// Inline Code
				.replace(/`([^`\n]+)`/g, '<span font_family="monospace" background="#333333" color="#e06c75"> $1 </span>')
				// Blockquotes
				.replace(/^&gt;\s?(.+)$/gm, '<span color="#888888"><i> | $1</i></span>')
				// Headings
				.replace(/^### (.+)$/gm, '<b><span size="large">$1</span></b>')
				.replace(/^## (.+)$/gm, '<b><span size="x-large">$1</span></b>')
				.replace(/^# (.+)$/gm, '<b><span size="xx-large">$1</span></b>')
				// Bullet points
				.replace(/^(\s*)[-*+] (.+)$/gm, ' • $2');

			// 4. Restore code blocks
			codeBlocks.forEach((block, i) => {
				res = res.replace("\x00CODE" + i + "\x00", block);
			});

			return res;
		}

        function ensureStreamBubble() {
            if (streamBubble) return;
            self._removeThinkingBubble();

            let row       = new St.BoxLayout({ style_class: "janai-row", reactive: false });
            let avatar    = new St.Label({ text: "🤖", style_class: "janai-avatar" });
            let bubbleCol = new St.BoxLayout({ vertical: true, x_expand: true });

            let bubble = new St.Label({ text: "▌", style_class: "janai-bubble bot" });
            bubble.clutter_text.line_wrap      = true;
            bubble.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
            bubble.clutter_text.ellipsize      = Pango.EllipsizeMode.NONE;
            bubbleCol.add(bubble, { expand: true });

            let copyBtn = new St.Button({
                label: "⎘ Copy", style_class: "janai-copy-btn",
                reactive: false, can_focus: false, visible: false
            });
            bubbleCol.add(copyBtn);

            row.add(avatar);
            row.add(bubbleCol, { expand: true });
            self.messageBox.add(row);

            streamBubble  = bubble;
            streamCopyBtn = copyBtn;
        }

        function processDelta(delta) {
            rawAccum += delta;
            let toProcess = prefixBuf + delta;
            prefixBuf = "";

            while (toProcess.length > 0) {
                if (inThink) {
                    let combined = thinkBuf + toProcess;
                    let closeIdx = combined.indexOf("</think>");
                    if (closeIdx !== -1) {
                        let after = combined.slice(closeIdx + "</think>".length);
                        if (after.charAt(0) === "\n") after = after.slice(1);
                        inThink = false; thinkBuf = ""; toProcess = after;
                    } else {
                        thinkBuf = combined.slice(-("</think>".length - 1));
                        toProcess = "";
                    }
                } else {
                    let openIdx = toProcess.indexOf("<think>");
                    if (openIdx === -1) {
                        if (toProcess.length > 6) {
                            visibleText += toProcess.slice(0, -6);
                            prefixBuf    = toProcess.slice(-6);
                        } else {
                            prefixBuf = toProcess;
                        }
                        toProcess = "";
                    } else {
                        visibleText += toProcess.slice(0, openIdx);
                        inThink = true; thinkBuf = "";
                        toProcess = toProcess.slice(openIdx + "<think>".length);
                    }
                }
            }

            if (streamBubble) streamBubble.text = visibleText + "▌";
        }

        function scrollBottom() {
            Mainloop.idle_add(Lang.bind(self, function () {
                let vbar = self.scrollView.get_vscroll_bar();
                if (vbar) {
                    let adj = vbar.get_adjustment();
                    adj.set_value(adj.get_upper() - adj.get_page_size());
                }
                return false;
            }));
        }

        httpPostStream(url, payload, apiKey,
            function (line) {
                if (!line.startsWith("data: ")) return;
                let jsonStr = line.slice(6).trim();
                if (!jsonStr || jsonStr === "[DONE]") return;
                let chunk;
                try { chunk = JSON.parse(jsonStr); } catch (e) { return; }
                let delta = "";
                try { delta = (chunk.choices && chunk.choices[0] && chunk.choices[0].delta && chunk.choices[0].delta.content) || ""; } catch(e){}
                if (delta) {
                    if (!streamBubble) { ensureStreamBubble(); self.statusLabel.text = "⟳ Receiving…"; }
                    processDelta(delta);
                    scrollBottom();
                }
            },
            function (err) {
                if (err) {
                    self._removeThinkingBubble();
                    self._addMessage("Request error: " + err, "bot");
                    self._resetUI();
                    return;
                }

                self._removeThinkingBubble();
                if (!streamBubble) {
                    self._addMessage("No response from model. Check API key and model.", "bot");
                } else {
                    let finalText = (visibleText + prefixBuf).trim() || rawAccum.trim();
                    if (!finalText) finalText = "Model returned empty response.";

                    streamBubble.clutter_text.set_markup(markdownToPango(finalText));

                    if (streamCopyBtn) {
                        let cap = finalText;
                        streamCopyBtn.reactive = true;
                        streamCopyBtn.visible  = true;
                        streamCopyBtn.connect("clicked", function () {
                            if (copyToClipboard(cap)) {
                                let prev = streamCopyBtn.label;
                                streamCopyBtn.label = "✓ Copied";
                                Mainloop.timeout_add(1500, function () { streamCopyBtn.label = prev; return false; });
                            }
                        });
                    }

                    self._history.push({ role: "assistant", content: finalText });
                }
                self._resetUI();
                scrollBottom();
            }
        );
    }

    _addMessage(text, sender) {
        let isUser = sender === "user";

        let row = new St.BoxLayout({ style_class: "janai-row", reactive: false, vertical: false });
        let avatar = new St.Label({ text: isUser ? "👤" : "🤖", style_class: "janai-avatar" });
        let bubbleCol = new St.BoxLayout({ vertical: true, x_expand: true });

        let bubble = new St.Label({ style_class: "janai-bubble " + sender });
        bubble.clutter_text.line_wrap      = true;
        bubble.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        bubble.clutter_text.ellipsize      = Pango.EllipsizeMode.NONE;

        if (isUser) { bubble.text = text; }
        else        { bubble.clutter_text.set_markup(text); }
        bubbleCol.add(bubble, { expand: true });

        let capturedText = text;
        let copyBtn = new St.Button({ label: "⎘ Copy", style_class: "janai-copy-btn", reactive: true, can_focus: false });
        copyBtn.connect("clicked", function () {
            if (copyToClipboard(capturedText)) {
                let prev = copyBtn.label;
                copyBtn.label = "✓ Copied";
                Mainloop.timeout_add(1500, function () { copyBtn.label = prev; return false; });
            }
        });

        let copyRow = new St.BoxLayout({ vertical: false });
        if (isUser) {
            copyRow.add(new St.Label({ text: "", x_expand: true }), { expand: true });
            copyRow.add(copyBtn);
        } else {
            copyRow.add(copyBtn);
        }
        bubbleCol.add(copyRow);

        if (isUser) { row.add(bubbleCol, { expand: true }); row.add(avatar); }
        else        { row.add(avatar); row.add(bubbleCol, { expand: true }); }

        this.messageBox.add(row);

        Mainloop.idle_add(Lang.bind(this, function () {
            let vbar = this.scrollView.get_vscroll_bar();
            if (vbar) { let adj = vbar.get_adjustment(); adj.set_value(adj.get_upper() - adj.get_page_size()); }
            return false;
        }));
    }

    _clearHistory() {
        this._history     = [];
        this.isProcessing = false;
        this.sendBtn.reactive    = true;
        this.inputEntry.reactive = true;
        this.statusLabel.text    = desklet_raised ? "⌨  Active — Escape to dismiss" : "● Ready";
        this.messageBox.destroy_all_children();
        this._addMessage("History cleared. Ask me anything!", "bot");
    }

    _resetUI() {
        this.isProcessing        = false;
        this.statusLabel.text    = desklet_raised ? "⌨  Active — Escape to dismiss" : "● Ready";
        this.sendBtn.reactive    = true;
        this.inputEntry.reactive = true;
        if (desklet_raised) {
            Mainloop.idle_add(Lang.bind(this, function () {
                this.inputEntry.clutter_text.grab_key_focus();
                return false;
            }));
        }
    }

    on_desklet_reloaded() {
        this.isReloading = true;
    }

    on_desklet_removed() {
        if (desklet_raised) this._lower();
        this._removeThinkingBubble();
        if (this._keybindingId) {
            Main.keybindingManager.removeHotKey(this._keybindingId);
            this._keybindingId = null;
        }
        if (this.settings && !this.isReloading) {
            this.settings.finalize();
        }
    }
}

function main(metadata, desklet_id) {
    return new HFChatDesklet(metadata, desklet_id);
}