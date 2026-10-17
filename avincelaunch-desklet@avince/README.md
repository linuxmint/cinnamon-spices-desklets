# aVinceLaunch

**Organize · Access · Launch** – a lightweight desktop organizer with fences
and launcher groups for Linux Mint Cinnamon.

aVinceLaunch turns ordinary directories into tidy groups on your desktop:
applications, documents and folders, each group a panel you place where you
want it. The filesystem is the source of truth – copy a launcher into a
fence's folder and it appears.

## What it does

- **Fences** – several independent instances, each showing one directory.
  *Duplicate fence* adds the next one with the same look.
- **Starter layout** – on request, nine titled fences in a grid that fits your
  screen, with your installed applications suggested by category; you decide
  in a preview what goes where.
- **Applications, documents, folders** – in your own order or sorted by name,
  type or date; favourites can be pinned to the front.
- **Navigation inside a fence** – open a subfolder in place and walk back
  with a breadcrumb.
- **Folder portal** – a fence can show any existing folder, local or on a
  network share, as a pure view: nothing is created, changed or deleted there.
- **Item menu** – move an item to another fence, pin it, or remove it to the
  trash; the last move can be undone.
- **Snapping and arrangement** – fences snap to their neighbours with guide
  lines; recent arrangements can be restored, all fences realigned at once.
- **Title row, collapsing, search** – one search filters all fences.
- **Locks** for position, size and content; **automatic sizing** or a fixed
  window with scrolling.
- **Titles that stay readable** – their colour follows the brightness of the
  wallpaper behind them.
- **Settings backup** – recent states of each fence's settings are kept.
- **English and German**, with a quick start and a detailed help page.

Works in the X11 session and in Cinnamon's Wayland session.

## Getting started

Add the desklet. The quick start opens once by itself (later: right-click →
*Quick start…*); from there you can create the starter layout or open the
detailed help. Every fence has its own folder under
`~/.local/share/avincelaunch/`; *Configure* lets you point it at any other
folder.

aVinceLaunch has its own UUID and can be installed next to TheLauncher;
existing TheLauncher groups and their order are read, never changed.

## Optional add-on package

The desklet works on its own. A separate download, **aVinceLaunch helpers**,
adds what a desklet cannot do by itself: a watcher that offers newly
installed programs for a fence, **Super+Shift+D** to hide and show the
desktop, *Move to a fence…* in the desktop's context menu, and – optionally,
X11 only – a double-click on the free desktop. It installs into your own
folders only, never as root, with a backup and an uninstall script.

Download and instructions:
https://github.com/aVince-Industrietechnik/aVinceLaunch/releases

## Source, issues, support

Source code and issue tracker:
https://github.com/aVince-Industrietechnik/aVinceLaunch

aVinceLaunch is free and complete – no paid version, nothing held back. If
you would like to support its further development:
https://ko-fi.com/avince (entirely voluntary; the program itself never asks).

## Licence and thanks

aVinceLaunch is licensed under GPL-3.0-only. It is a fork of
**TheLauncher 1.0.3** by MHK924; the inherited parts remain under the MIT
licence (see `THIRD-PARTY-NOTICES.md` and `LICENSE` in the desklet folder).
TheLauncher in turn started from **Quick Links - Launcher** by NotSirius-A.

Many thanks to MHK924 for TheLauncher and for kindly allowing it to be built
upon.

Author: Angelo Vincenti – aVince Industrietechnik.
