<p align="center">
  <img src="https://cinnamon-spices.linuxmint.com/git/desklets/workspace-switcher-desklet@mgldvd/banner.png" alt="Workspace Switcher Desklet" width="100%">
</p>

<p align="center">
  One translucent rectangle per workspace, right on your Cinnamon desktop.<br>
  Click or scroll to switch.
</p>

<p align="center">
  <img src="https://cinnamon-spices.linuxmint.com/git/desklets/workspace-switcher-desklet@mgldvd/screenshot.png" alt="Two instances on the desktop: a row with custom names at the top and a numbered row at the bottom" width="100%">
</p>

## Features

- **One rectangle per workspace**, updated live as workspaces are added or removed
- **Click** to switch, **scroll** to move to the previous or next workspace
- **Any layout**: horizontal, vertical, or a grid (N per row or column)
- **9 screen positions** (corners, edges, center) or free drag, with an edge margin
- **Multi-monitor**: show it on the primary monitor, a specific one, or all of them
- **Multiple instances**: for example one at the top and one at the bottom of the screen
- **Full styling**: size, border width, corner radius, shadow, and separate colors for normal, hover and active
- **Labels**: numbers, Roman numerals, letters (upper or lower case), or workspace names, with custom names per workspace

## Usage

Right-click the desktop → **Add Desklets** → **Workspace Switcher Desklet**. To change it, right-click the desklet → **Configure**.

| Tab | Options |
|---|---|
| **Layout** | Monitor · Position · Margin · Orientation · Rectangles per row/column · Spacing |
| **Rectangles** | Width · Height · Drop shadow · Border width (normal / active) · Corner radius |
| **Colors** | Background and border, each for normal, hover and active workspace (with transparency) |
| **Label** | None · 1 2 3 · I II III · i ii iii · A B C · a b c · Workspace name · Custom names per workspace · Font size · Bold · Text colors |
| **Behavior** | Scroll to switch · Wrap around at first/last workspace |

## Recreate the screenshot

The screenshot uses two instances of the desklet with the default colors: names along the top, numbers along the bottom. Both use the same size and spacing, so their rectangles line up.

1. Set up 6 workspaces. The desklet always shows every workspace.
2. Add the desklet **twice** (right-click the desktop → **Add Desklets**).
3. Right-click each one → **Configure** and set these options. Anything not listed keeps its default.

| Tab | Setting | Top instance | Bottom instance |
|---|---|---|---|
| Layout | Position | Top center | Bottom center |
| Layout | Margin from screen edge | 48 px | 48 px |
| Layout | Spacing between rectangles | 12 px | 12 px |
| Rectangles | Width × Height | 132 × 60 px | 132 × 60 px |
| Rectangles | Border width (normal and active) | 2 px | 2 px |
| Rectangles | Corner radius | 0 px | 0 px |
| Label | Show | Workspace name | Number (1, 2, 3) |
| Label | Custom names | 1 Web · 2 Code · 3 Chat · 4 Music · 5 Mail · 6 Files | — |
| Label | Font size | 18 px | 22 px |

**Tip:** want the pair on every screen? Set **Monitor** to **All monitors** on both instances.

## Translations

Español · Português (Brasil) · Deutsch · Français · Русский · Italiano · Polski · 简体中文

## Links

Source code, issues and changelog: [github.com/Mgldvd/workspace-switcher-desklet](https://github.com/Mgldvd/workspace-switcher-desklet)
