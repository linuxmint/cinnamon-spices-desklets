const Desklet = imports.ui.desklet;
const St = imports.gi.St;

class MyDesklet extends Desklet.Desklet {
  constructor(metadata, deskletId) {
    super(metadata, deskletId);

    this.setHeader("Timer");
    this._inputDigits = "";
    this._setupInputLayout();
  }

  _setupInputLayout() {
    const box = new St.BoxLayout({ vertical: true });

    const labelRow = new St.BoxLayout();
    this._inputLabel = new St.Label({ text: "00h 00m 00s", style_class: "timer-input-label", x_expand: true });
    labelRow.add_child(this._inputLabel);
    box.add_child(labelRow);

    // Input buttons 1-9
    for (let i = 0; i < 3; i++) {
      const row = new St.BoxLayout();
      for (let j = 1; j <= 3; j++) {
        const num = i * 3 + j;
        const button = new St.Button({ label: num.toString(), style_class: "timer-input-button" });
        button.connect("clicked", () => this._onDigitPressed(num));
        row.add_child(button);
      }
      box.add_child(row);
    }

    const lastRow = new St.BoxLayout();
    const zeroBtn = new St.Button({ label: "0", style_class: "timer-input-button" });
    zeroBtn.connect("clicked", () => this._onDigitPressed(0));
    lastRow.add_child(zeroBtn);

    const playIcon = new St.Icon({
      icon_name: "media-playback-start-symbolic",
      icon_type: St.IconType.SYMBOLIC,
      icon_size: 16,
    });
    const playBtn = new St.Button({ child: playIcon, style_class: "timer-input-button" });
    lastRow.add_child(playBtn);

    const editIcon = new St.Icon({
      icon_name: "edit-clear-symbolic",
      icon_type: St.IconType.SYMBOLIC,
      icon_size: 16,
    });
    const editBtn = new St.Button({ child: editIcon, style_class: "timer-input-button" });
    editBtn.connect("clicked", () => this._onEditPressed());
    lastRow.add_child(editBtn);

    box.add_child(lastRow);

    this.setContent(box);
  }

  _onDigitPressed(num) {
    if (this._inputDigits.length < 6) {
      this._inputDigits += num.toString();
      this._updateInputLabel();
    }
  }

  _onEditPressed() {
    this._inputDigits = this._inputDigits.slice(0, -1);
    this._updateInputLabel();
  }

  _updateInputLabel() {
    const padded = this._inputDigits.padStart(6, "0");
    this._inputLabel.set_text(`${padded.slice(0, 2)}h ${padded.slice(2, 4)}m ${padded.slice(4, 6)}s`);
  }
}

function main(metadata, deskletId) {
  return new MyDesklet(metadata, deskletId);
}
