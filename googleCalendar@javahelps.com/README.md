# Google Calendar Desklet

View your upcoming calendar events on your Cinnamon Desktop. This desklet uses `gcalcli` to pull events from Google Calendar. You can configure every aspect of the desklet using the configure dialog.

## Requirements

- Cinnamon 3.4, 3.6 or 3.8
- `gcalcli`

## Installation

1. Install `gcalcli` using the following command:
```bash
sudo apt install gcalcli
```

2. Launch `gcalcli` with a parameter listfrom terminal and configure the user account
```bash
gcalcli list
```
If this is the first time, once you have executed the above command, `gcalcli` will open a web page and ask you to provide the permission to access your Google Calendar. Give access to use your Google Calendar.

3. Run the following command with current date in terminal and see whether `gcalcli` prints your events
```bash
gcalcli agenda "2/11/2018" "2/18/2018" --nostarted --tsv
```
You should get an output similar to this:
```
2018-02-12	00:00	2018-02-13	00:00	Family Day (British Columbia)
2018-02-12	09:30	2018-02-12	11:30	Artificial Intelligence II
2018-02-12	12:30	2018-02-12	14:00	Weekly meeting
2018-02-13	00:00	2018-02-14	00:00	Alice's birthday
2018-02-13	00:00	2018-02-14	00:00	Mahasivarathri Day
2018-02-14	00:00	2018-02-15	00:00	Bob's birthday
2018-02-14	00:00	2018-02-15	00:00	Valentine's Day
2018-02-14	14:30	2018-02-14	16:30	Cloud Computing
2018-02-15	00:00	2018-02-16	00:00	Carol's birthday
2018-02-15	09:30	2018-02-15	10:30	Artificial Intelligence II
2018-02-16	00:00	2018-02-17	00:00	David's birthday
2018-02-16	14:30	2018-02-16	15:30	Cloud Computing
```
If not, your `gcalcli` has some issues. Without fixing them, Google Calendar Desklet cannot be used.

*Please note that I cannot help on `gcalcli` related issues. If you could not resolve them by yourself, please report at: [gcalcli GitHub Issues](https://github.com/insanum/gcalcli/issues).*


4. Add Google Calendar desklet and enjoy!!!


## Features

- Select events from multiple calendars of the same Google account
- Custom date range
- Customize update frequency
- Manually update the agenda by clicking on the desklet
- Customize the look and feel
