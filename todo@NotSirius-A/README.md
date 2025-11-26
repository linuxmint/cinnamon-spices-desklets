# TODO Desklet

Themeable, customizable, and easy-to-use TODO desklet. Keep track of what you need to do without leaving your desktop.

### Who is it for?

* People who want a lightweight TODO app that's as easy to use as possible. No bloat, just a TODO list.

* Those who hate having to open a separate app for everything. This desklet it is literally on your desktop. It couldn't be simpler. No need to open any windows.

* People who often forget what they have to do. This desklet will refresh your memory every time you look at your desktop.


### Customization

You can make this desklet fit your desktop style. Customize the colors, fonts, icons etc. There are plenty of settings to tinker with.


### Usage

You can add/edit tasks in desklet settings or by interacting with the desklet itself. You might use the toolbar to interact with many tasks at once or use mouse shortcuts to affect single items.

- Left-click on the task name to edit it
- Left-click on the task icon to mark it done/not done
- Right-click to select multiple tasks or left-click on the edge (only relevant if using toolbar)
- Middle-click to remove a task 

If you want to add more tasks, right-click anywhere on the desklet and select the `Add new task` option inside the popup menu or use the toolbar. If you need to write something using multiple lines of text just press Shift+Enter while typing, which will give you a new line. 


### Tips

- You can add multiple lists by clicking the "+" icons in your desklet manager.
- You can backup your desklets by going to the settings. There you should find an icon in the top right corner. Select the `Export to a file` option or import to load your backup.
- You can add a transparent border to your tasks to make them look bigger.
- When you disable desklet decorations you can still grab the desklet by the invisible border around it.
- I did my best to accommodate users with many display/text scaling factors, but sometimes the desklet looks a bit different on some settings, so always adjust it to your liking. Make sure to restart cinnamon or reboot after changing the display scale. 


### Input methods ibus/fcitx (Chinese, Japanese etc.)

If you are using alternate input methods please note that it is impossible to use them while editing text directly on your desktop. In such case please use the toolbar edit button or desklet settings.

I have spent many hours trying to make ibus/fcitx work while directly editing tasks on the desktop, but I was unable to find a solution. I am not sure a fix even exists, but I have found a workaround. I added the edit button on the toolbar, which opens an edit dialog, that is using a different technology (Gtk) to that of the desklet (Clutter/St). This other technology fortunately does work with ibus/fcitx. 


### What can be improved?

* Fix the `clutter_focus` error.

* Somehow add alternate input methods support to St.Entry??

