const Desklet = imports.ui.desklet;
const St = imports.gi.St;

class MyDesklet extends Desklet.Desklet {
  constructor(metadata, deskletId) {
    super(metadata, deskletId);

    this.setHeader("Timer");
    this._setupInputLayout();
  }

  _setupInputLayout() {
    const box = new St.BoxLayout({ vertical: true });

    const labelRow = new St.BoxLayout();
    const timeLabel = new St.Label({ text: "00h 00m 00s", style_class: "timer-time-label", x_expand: true });
    labelRow.add_child(timeLabel);
    box.add_child(labelRow);

    // Input buttons 1-9
    for (let i = 0; i < 3; i++) {
      const row = new St.BoxLayout();
      for (let j = 1; j <= 3; j++) {
        const num = i * 3 + j;
        const button = new St.Button({ label: num.toString(), style_class: "timer-input-button" });
        row.add_child(button);
      }
      box.add_child(row);
    }

    const lastRow = new St.BoxLayout();
    lastRow.add_child(new St.Button({ label: "0", style_class: "timer-input-button" }));

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
    lastRow.add_child(editBtn);

    box.add_child(lastRow);

    this.setContent(box);
  }
}

function main(metadata, deskletId) {
  return new MyDesklet(metadata, deskletId);
}
