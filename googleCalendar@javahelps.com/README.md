# Google Calendar Desklet

Google Calendar Desklet displays your agenda based on your Google Calendar in Cinnamon desktop.

You can configure the every aspect of the desklet using the configure dialog in terms of selecting calendars and configuring the look and feel. However, the agenda is displayed using text so there can be any minor issues with alignments.

For the moment, the desklet has not been tested with different displays or aspect ratios so there can be issues with scaling.

## Requirements

 - `gcalcli`

## Installation

  1. Install `gcalcli` using the following command:
  ```
  sudo apt install gcalcli
  ```

  2. Launch `gcalcli` with a parameter listfrom terminal and configure the user account
  ```
  gcalcli list
  ```
  Once you have execute the above command, `gcalcli` will open a web page and ask you to provide the permission to access your Google Calendar.

  3. Run the following command with current date in terminal and see whether `gcalcli` prints your events
  ```
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
  > Please note than I cannot help on `gcalcli` related issues. If you could not resolve it, please report at: [gcalcli GitHub Issues](https://github.com/insanum/gcalcli/issues).


  4. Add Google Calendar desklet and enjoy!!!


## Features

- Select events from multiple calendars of the same Google account
- Custom date range
- Customize update frequency
- Manually update the agenda by clicking on the desklet
- Customize the look and feel
