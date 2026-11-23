/*
 * Agenda - a Cinnamon desklet that keeps today's appointments in view.
 *
 * The layout is driven entirely by the configured width: below roughly
 * 300 pixels it folds into a single stacked column with abbreviated
 * detail, and as it widens it progressively reveals times alongside
 * titles, locations, durations and calendar names. The next appointment
 * is always the loudest thing on screen.
 */

const Cinnamon = imports.gi.Cinnamon;
const Clutter = imports.gi.Clutter;
const Desklet = imports.ui.desklet;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Mainloop = imports.mainloop;
const Pango = imports.gi.Pango;
const Settings = imports.ui.settings;
const St = imports.gi.St;
const Tooltips = imports.ui.tooltips;
const Util = imports.misc.util;

const UUID = 'agenda@ashex';
const DESKLET_DIR = imports.ui.deskletManager.deskletMeta[UUID].path;

imports.searchPath.unshift(DESKLET_DIR);

const Agenda = imports.lib.agenda;
const Feeds = imports.lib.feeds;
const Format = imports.lib.format;
const ICal = imports.lib.ical;
const ThemeLib = imports.lib.theme;

// Shadows Cinnamon's globals so our strings resolve against this
// desklet's own translation catalogue rather than Cinnamon's.
const _ = imports.lib.i18n._;
const ngettext = imports.lib.i18n.ngettext;

// Below this the two column rows stop fitting and everything stacks.
const NARROW_WIDTH = 300;
// Above this there is room for supporting detail beside each title.
const WIDE_WIDTH = 460;

function logError(message) {
    global.logError('[' + UUID + '] ' + message);
}

class AgendaDesklet extends Desklet.Desklet {
    constructor(metadata, deskletId) {
        super(metadata, deskletId);

        this._occurrences = [];
        this._feedErrors = [];
        this._calendarLabels = Object.create(null);
        this._calendarCount = 0;
        this._lastSuccessMs = 0;
        this._usingCache = false;
        this._refreshTimer = 0;
        this._tickTimer = 0;
        this._cancellable = null;
        this._destroyed = false;
        this._inFlight = false;

        this._bindSettings(deskletId);

        this._formatter = new Format.Formatter(this.time_format);
        this._theme = new ThemeLib.Theme(this._themeOptions());

        this._buildSkeleton();
        this.setHeader(_('Agenda'));

        this._menu.addAction(_('Refresh now'), () => this._refresh(true));
    }

    _bindSettings(deskletId) {
        this.settings = new Settings.DeskletSettings(this, UUID, deskletId);

        let reload = [
            'feeds',
        ];
        let refetch = [
            'refresh_minutes', 'http_timeout',
        ];
        let rerender = [
            'max_upcoming', 'keep_ongoing', 'show_all_day', 'hide_declined',
            'hide_transparent', 'show_location', 'show_countdown',
            'imminent_minutes', 'desklet_width', 'scale', 'density',
            'show_header', 'show_progress', 'color_mode', 'surface_opacity',
            'glow', 'tint_surface', 'dark_surface', 'show_feed_errors',
            'show_meeting_link', 'meeting_link_in_list', 'meeting_lead_minutes',
            'show_calendar_name',
        ];

        reload.forEach((key) => this.settings.bind(key, key, this._onFeedsChanged));
        refetch.forEach((key) => this.settings.bind(key, key, this._onScheduleChanged));
        rerender.forEach((key) => this.settings.bind(key, key, this._onStyleChanged));

        this.settings.bind('time_format', 'time_format', this._onTimeFormatChanged);
        this.settings.bind('click_action', 'click_action', () => {});
        this.settings.bind('calendar_command', 'calendar_command', () => {});
    }

    _themeOptions() {
        return {
            scale: this.scale,
            dark: this.dark_surface,
            opacity: this.surface_opacity,
            glow: this.glow,
            tint: this.tint_surface,
            density: this._effectiveDensity(),
            width: this.desklet_width,
        };
    }

    // 'Adapt to width' is the default because a desklet that has been
    // dragged narrow should tighten up rather than clip.
    _effectiveDensity() {
        if (this.density !== 'auto')
            return this.density;
        if (this.desklet_width < NARROW_WIDTH)
            return 'compact';
        if (this.desklet_width > WIDE_WIDTH)
            return 'spacious';
        return 'comfortable';
    }

    get _isNarrow() {
        return this.desklet_width < NARROW_WIDTH;
    }

    get _isWide() {
        return this.desklet_width >= WIDE_WIDTH;
    }

    // ------------------------------------------------------------------
    // Structure
    // ------------------------------------------------------------------

    _buildSkeleton() {
        this._root = new St.BoxLayout({ vertical: true, reactive: true, track_hover: true });
        this._root.connect('button-release-event',
            (actor, event) => this._onClicked(actor, event));

        this._headerBox = new St.BoxLayout({ vertical: false });
        this._headerTitle = new St.Label({ text: _('Today') });
        this._headerDate = new St.Label({ text: '' });
        this._headerSpacer = new St.Widget({ x_expand: true });

        this._headerBox.add_child(this._headerTitle);
        this._headerBox.add_child(this._headerSpacer);
        this._headerBox.add_child(this._headerDate);

        this._bodyBox = new St.BoxLayout({ vertical: true });

        this._root.add_child(this._headerBox);
        this._root.add_child(this._bodyBox);

        this.setContent(this._root);
    }

    _label(text, style, options) {
        let opts = options || {};
        let label = new St.Label({ text: text || '' });
        label.set_style(style);

        let clutterText = label.clutter_text;
        if (opts.wrap) {
            // Ellipsizing and wrapping are mutually exclusive in Pango:
            // leave ellipsizing on and the text is cut at one line no
            // matter how much vertical room it has.
            clutterText.set_ellipsize(Pango.EllipsizeMode.NONE);
            clutterText.set_line_wrap(true);
            clutterText.set_line_wrap_mode(Pango.WrapMode.WORD_CHAR);
        } else {
            clutterText.set_ellipsize(Pango.EllipsizeMode.END);
        }
        if (opts.expand)
            label.x_expand = true;
        return label;
    }

    _spacer(height) {
        return new St.Widget({ height: height });
    }

    /*
     * The usable text width inside the focused card. St will not wrap a
     * label that has been allowed to take its natural width, so anything
     * that needs to flow onto a second line has to be told how much room
     * it actually has. Deriving it from the configured width means it is
     * right on the very first paint rather than after a relayout.
     */
    _focusContentWidth(theme) {
        let width = this.desklet_width
            - theme.gap(14) * 2   // desklet padding
            - 2                   // desklet border
            - theme.gap(14) * 2   // card padding
            - 2                   // card border
            - theme.px(3)         // accent bar
            - theme.gap(12);      // gutter between bar and text column
        return Math.max(60, Math.round(width));
    }

    // ------------------------------------------------------------------
    // Calendars
    // ------------------------------------------------------------------

    /*
     * What to call the calendar an event came from. Resolved when the
     * feed was read, so it reflects the name the calendar publishes for
     * itself rather than anything derived from its secret URL.
     */
    _calendarLabelFor(occurrence) {
        if (!occurrence)
            return '';
        let label = this._calendarLabels[occurrence.calendarIndex];
        return label || occurrence.calendarName || '';
    }

    /*
     * With a single calendar the tag would say the same thing on every
     * line and earn nothing, so by default it appears only once there is
     * genuinely something to tell apart.
     */
    _calendarTagVisible(occurrence) {
        if (this.show_calendar_name === 'never')
            return false;
        if (this.show_calendar_name === 'multiple' && this._calendarCount < 2)
            return false;
        return this._calendarLabelFor(occurrence) !== '';
    }

    // ------------------------------------------------------------------
    // Meetings
    // ------------------------------------------------------------------

    /*
     * Whether an event's join button should be on screen. A button that
     * appears only when the meeting is close keeps the card calm for the
     * rest of the day, but an event already running always shows it.
     */
    _meetingVisible(occurrence, model) {
        if (!this.show_meeting_link || !occurrence || !occurrence.meeting)
            return false;

        let lead = this.meeting_lead_minutes;
        if (!lead)
            return true;
        if (occurrence.startMs <= model.nowMs)
            return true;
        return (occurrence.startMs - model.nowMs) <= lead * 60000;
    }

    /*
     * Opens the meeting in whatever handles web links. Deliberately uses
     * the URI launcher rather than a shell command: these URLs come from
     * a remote calendar feed, and nothing from a feed should ever reach a
     * command line.
     */
    _openMeeting(meeting) {
        if (!meeting || !meeting.url)
            return;
        if (!/^https?:\/\//i.test(meeting.url)) {
            logError('refusing to open a non-web meeting link');
            return;
        }

        try {
            Gio.AppInfo.launch_default_for_uri(meeting.url, null);
        } catch (e) {
            logError('could not open the meeting link: ' + e);
        }
    }

    _buildJoinButton(occurrence, accent, theme, compact, extraStyle) {
        let meeting = occurrence.meeting;
        let suffix = extraStyle || '';
        let styleFor = compact
            ? (hovered) => theme.joinChipStyle(accent, hovered) + suffix
            : (hovered) => theme.joinButtonStyle(accent, hovered) + suffix;

        // An unrecognised service has no brand name worth repeating, so
        // the label falls back to a word that still reads as a sentence
        // rather than producing "Join Join".
        let text = compact
            ? _('Join')
            : _('Join %s').format(meeting.label);

        let button = new St.Button({
            label: text,
            reactive: true,
            track_hover: true,
            can_focus: true,
        });
        button.set_style(styleFor(false));

        button.connect('enter-event', () => {
            button.set_style(styleFor(true));
            global.set_cursor(Cinnamon.Cursor.POINTING_HAND);
        });
        button.connect('leave-event', () => {
            button.set_style(styleFor(false));
            global.unset_cursor();
        });
        // Re-rendering destroys a hovered button without ever sending
        // leave-event, which would strand the pointing-hand cursor across
        // the whole desktop. The tick timer re-renders every ten seconds
        // near an appointment, exactly when someone is reaching for this.
        button.connect('destroy', () => {
            if (button.get_hover())
                global.unset_cursor();
        });
        button.connect('clicked', () => {
            this._openMeeting(meeting);
        });

        new Tooltips.Tooltip(button,
            _('Open %s').format(meeting.providerName) + '\n' + meeting.url);

        return button;
    }

    // ------------------------------------------------------------------
    // Rendering
    // ------------------------------------------------------------------

    _render() {
        if (this._destroyed || !this._root)
            return;

        this._theme.update(this._themeOptions());
        let theme = this._theme;
        let nowMs = Date.now();

        let model = Agenda.buildModel(this._occurrences, nowMs, {
            maxUpcoming: this.max_upcoming,
            keepOngoing: this.keep_ongoing,
            showAllDay: this.show_all_day,
            hideDeclined: this.hide_declined,
            hideTransparent: this.hide_transparent,
            imminentMinutes: this.imminent_minutes,
        });
        this._model = model;

        this._root.set_style(theme.rootStyle());

        this._headerBox.visible = this.show_header;
        if (this.show_header)
            this._renderHeader(model, theme);

        this._bodyBox.destroy_all_children();

        if (model.allDay.length)
            this._renderAllDayStrip(model, theme);

        if (model.focus)
            this._renderFocusCard(model, theme);
        else
            this._renderEmptyState(model, theme);

        if (model.upcoming.length)
            this._renderUpcoming(model, theme);

        this._renderFooter(model, theme);
        this._scheduleTick(model, nowMs);
    }

    _renderHeader(model, theme) {
        this._headerTitle.set_style(theme.headerStyle());
        this._headerDate.set_style(theme.headerDateStyle());

        let counted = model.remainingCount + (model.focus ? 1 : 0);
        let heading = _('Today');
        if (!this._isNarrow && counted > 0) {
            heading = ngettext('Today  ·  %d left', 'Today  ·  %d left', counted)
                .format(counted);
        }
        this._headerTitle.set_text(heading);

        let dateText = this._formatter.date(new Date(model.nowMs));
        if (this._isNarrow) {
            // On a narrow desklet the weekday alone carries the meaning.
            dateText = dateText.split(/,|\s/)[0];
        }
        this._headerDate.set_text(dateText);
        this._headerBox.set_style('padding-bottom: ' + theme.gap(10) + 'px;');
    }

    _renderAllDayStrip(model, theme) {
        let strip = new St.BoxLayout({ vertical: false });
        strip.set_style('padding-bottom: ' + theme.gap(8) + 'px;');

        let shown = this._isNarrow ? 1 : (this._isWide ? 3 : 2);
        model.allDay.slice(0, shown).forEach((occurrence, position) => {
            let accent = ThemeLib.accentFor(this.color_mode, occurrence, position);
            let chip = this._label(occurrence.summary, theme.chipStyle(accent) +
                ' margin-right: ' + theme.px(6) + 'px;');
            strip.add_child(chip);
        });

        let overflow = model.allDay.length - shown;
        if (overflow > 0)
            strip.add_child(this._label('+' + overflow, theme.metaStyle()));

        this._bodyBox.add_child(strip);
    }

    /*
     * The spotlight. Everything here is sized generously and given the
     * accent treatment, because this is the one line someone forgetful
     * needs to catch out of the corner of their eye.
     */
    _renderFocusCard(model, theme) {
        let occurrence = model.focus;
        let accent = ThemeLib.accentFor(this.color_mode, occurrence, 0);
        let isNow = model.focusState === 'now';

        let card = new St.BoxLayout({ vertical: false });
        card.set_style(theme.focusCardStyle(accent, model.urgency));
        let contentWidth = this._focusContentWidth(theme);

        let barHeight = theme.px(this._isNarrow ? 44 : 56);
        let bar = new St.Widget();
        bar.set_style(theme.accentBarStyle(accent, barHeight));
        card.add_child(bar);

        let column = new St.BoxLayout({ vertical: true, x_expand: true });
        column.set_style('padding-left: ' + theme.gap(12) + 'px;' +
            ' width: ' + contentWidth + 'px;');

        let eyebrowRow = new St.BoxLayout({ vertical: false });
        let eyebrowText = isNow ? _('HAPPENING NOW') : _('NEXT UP');
        eyebrowRow.add_child(this._label(eyebrowText, theme.eyebrowStyle(accent)));

        // Riding alongside the eyebrow rather than on a line of its own,
        // so naming the calendar costs the card no extra height. Dropped
        // on narrow layouts, where the countdown already fills the row.
        if (!this._isNarrow && this._calendarTagVisible(occurrence)) {
            eyebrowRow.add_child(this._label(
                '  ·  ' + this._calendarLabelFor(occurrence),
                theme.calendarTagStyle()));
        }

        if (this.show_countdown) {
            eyebrowRow.add_child(new St.Widget({ x_expand: true }));
            let relative = isNow
                ? this._formatter.remaining(occurrence.endMs - model.nowMs)
                : this._formatter.countdown(occurrence.startMs - model.nowMs);
            eyebrowRow.add_child(this._label(relative,
                theme.countdownStyle(accent, isNow || model.urgency > 0.35)));
        }
        column.add_child(eyebrowRow);

        column.add_child(this._spacer(theme.gap(6)));

        // A long meeting name should wrap onto a second line rather than
        // being cut off, since the title is the whole point of the card.
        let title = this._label(occurrence.summary,
            theme.focusTitleStyle(this._isNarrow) + ' width: ' + contentWidth + 'px;',
            { wrap: !this._isNarrow });
        column.add_child(title);

        column.add_child(this._spacer(theme.gap(4)));

        let timeText = occurrence.allDay
            ? _('All day')
            : this._formatter.range(occurrence.start, occurrence.end);
        if (this._isWide && !occurrence.allDay)
            timeText += '  ·  ' + this._formatter.duration(occurrence.endMs - occurrence.startMs);

        column.add_child(this._label(timeText, theme.focusTimeStyle(accent)));

        let showJoin = this._meetingVisible(occurrence, model);

        if (this.show_location && occurrence.location && !this._isNarrow) {
            // When the "location" is just the meeting link, the join
            // button already says everything a raw URL would, and says it
            // better. Only show the line when it holds real information.
            let locationIsTheLink = showJoin &&
                occurrence.location.trim() === occurrence.meeting.url;

            if (!locationIsTheLink) {
                column.add_child(this._spacer(theme.gap(4)));
                let location = this._label(occurrence.location, theme.metaStyle());
                column.add_child(location);
                new Tooltips.Tooltip(location, occurrence.location);
            }
        }

        if (showJoin) {
            column.add_child(this._spacer(theme.gap(10)));

            // Kept in its own row so the button takes only the width it
            // needs rather than stretching across the whole card.
            let joinRow = new St.BoxLayout({ vertical: false });
            joinRow.add_child(this._buildJoinButton(occurrence, accent, theme, this._isNarrow));
            joinRow.add_child(new St.Widget({ x_expand: true }));
            column.add_child(joinRow);
        }

        if (this.show_progress && isNow) {
            column.add_child(this._spacer(theme.gap(10)));
            column.add_child(this._buildProgress(model, theme, accent, contentWidth));
        }

        card.add_child(column);
        this._bodyBox.add_child(card);

        let tooltipParts = [occurrence.summary];
        if (occurrence.location)
            tooltipParts.push(occurrence.location);
        if (occurrence.meeting)
            tooltipParts.push(occurrence.meeting.providerName + ': ' + occurrence.meeting.url);
        let calendarLabel = this._calendarLabelFor(occurrence);
        if (calendarLabel)
            tooltipParts.push(calendarLabel);
        if (occurrence.description)
            tooltipParts.push('', occurrence.description.substring(0, 400));
        new Tooltips.Tooltip(card, tooltipParts.join('\n'));
    }

    /*
     * The track is sized from the configured width rather than measured
     * from the allocation, so it is already correct on the first paint
     * instead of snapping into place a frame later.
     */
    _buildProgress(model, theme, accent, contentWidth) {
        let track = new St.BoxLayout({ vertical: false });
        track.set_style(theme.progressTrackStyle() + ' width: ' + contentWidth + 'px;');

        let fill = new St.Widget();
        fill.set_style(theme.progressFillStyle(accent, Math.max(2, contentWidth * model.progress)));
        track.add_child(fill);
        return track;
    }

    _renderUpcoming(model, theme) {
        this._bodyBox.add_child(this._spacer(theme.gap(10)));

        let list = new St.BoxLayout({ vertical: true });

        model.upcoming.forEach((occurrence, position) => {
            let accent = ThemeLib.accentFor(this.color_mode, occurrence, position + 1);
            list.add_child(this._buildUpcomingRow(occurrence, accent, theme, model));
            list.add_child(this._spacer(theme.gap(5)));
        });

        this._bodyBox.add_child(list);
    }

    _buildUpcomingRow(occurrence, accent, theme, model) {
        let row = new St.BoxLayout({ vertical: this._isNarrow, reactive: true, track_hover: true });
        row.set_style(theme.upcomingRowStyle(accent, false));
        row.connect('enter-event', () => {
            row.set_style(theme.upcomingRowStyle(accent, true));
        });
        row.connect('leave-event', () => {
            row.set_style(theme.upcomingRowStyle(accent, false));
        });

        // An event already running would otherwise show a start time in
        // the past, which reads as a mistake in a list of what is ahead.
        let inProgress = !occurrence.allDay &&
            occurrence.startMs <= model.nowMs && occurrence.endMs > model.nowMs;

        let timeText;
        if (occurrence.allDay)
            timeText = _('All day');
        else if (inProgress)
            timeText = _('Now');
        else
            timeText = this._formatter.time(occurrence.start);

        let time = this._label(timeText, theme.upcomingTimeStyle(accent));
        let showJoin = this.meeting_link_in_list && this._meetingVisible(occurrence, model);

        if (this._isNarrow) {
            // Stacked rows put the title on its own line, so the join chip
            // rides alongside the time rather than floating on a third
            // line of its own.
            let topLine = new St.BoxLayout({ vertical: false });
            topLine.add_child(time);
            if (showJoin) {
                topLine.add_child(new St.Widget({ x_expand: true }));
                topLine.add_child(this._buildJoinButton(occurrence, accent, theme, true));
            }
            row.add_child(topLine);
            row.add_child(this._label(occurrence.summary, theme.upcomingTitleStyle()));
            this._attachRowTooltip(row, occurrence);
            return row;
        }

        // A fixed time column keeps every title left-aligned with the one
        // above it, which is what makes the list scannable.
        time.set_style(theme.upcomingTimeStyle(accent) +
            ' width: ' + theme.px(this._formatter.hour12 ? 72 : 52) + 'px;');
        row.add_child(time);

        let title = this._label(occurrence.summary, theme.upcomingTitleStyle(), { expand: true });
        title.x_expand = true;
        row.add_child(title);

        // Between the title and the trailing detail, where it reads as an
        // aside rather than competing with the event itself.
        if (this._calendarTagVisible(occurrence)) {
            row.add_child(this._label(this._calendarLabelFor(occurrence),
                theme.calendarTagStyle() + ' margin-left: ' + theme.px(6) + 'px;'));
        }

        if (showJoin) {
            row.add_child(this._buildJoinButton(occurrence, accent, theme, true,
                ' margin-left: ' + theme.px(6) + 'px;'));
        }

        if (this._isWide) {
            let trailing = '';
            if (inProgress)
                trailing = this._formatter.remaining(occurrence.endMs - model.nowMs);
            else if (!occurrence.allDay)
                trailing = this._formatter.duration(occurrence.endMs - occurrence.startMs);
            if (trailing) {
                let meta = this._label(trailing, theme.metaStyle() +
                    ' margin-left: ' + theme.px(6) + 'px;');
                row.add_child(meta);
            }
        }

        this._attachRowTooltip(row, occurrence);
        return row;
    }

    _attachRowTooltip(row, occurrence) {
        let parts = [occurrence.summary];
        if (!occurrence.allDay)
            parts.push(this._formatter.range(occurrence.start, occurrence.end));
        if (occurrence.location)
            parts.push(occurrence.location);
        if (occurrence.meeting)
            parts.push(occurrence.meeting.providerName);
        // Always in the tooltip, even when the tag itself is hidden or
        // the layout is too narrow to show it.
        let calendarLabel = this._calendarLabelFor(occurrence);
        if (calendarLabel)
            parts.push(calendarLabel);
        new Tooltips.Tooltip(row, parts.join('\n'));
    }

    _renderEmptyState(model, theme) {
        let feeds = Feeds.parseFeedList(this.feeds);

        let message;
        if (!feeds.length) {
            message = _('No calendars yet. Add an ICS link in settings.');
        } else if (this._inFlight && !this._lastSuccessMs) {
            message = _('Checking your calendars…');
        } else if (this._feedErrors.length >= feeds.length && !this._occurrences.length) {
            // Every calendar failed and there is nothing cached to fall
            // back on. Saying "nothing scheduled" here would be a false
            // all-clear, which is the one thing this desklet must never
            // do to someone relying on it to remember for them.
            message = _('Could not reach your calendars.');
        } else if (model.totalToday === 0) {
            message = _('Nothing scheduled today.');
        } else {
            message = _('That is everything for today.');
        }
        let box = new St.BoxLayout({ vertical: true });
        box.add_child(this._label(message, theme.emptyStyle(), { wrap: true }));

        if (model.tomorrowFirst) {
            let occurrence = model.tomorrowFirst;
            let accent = ThemeLib.accentFor(this.color_mode, occurrence, 0);
            // Narrow desklets get the time alone. Dropping the hint
            // entirely would leave a single grey line of dead space,
            // which is the thing it exists to prevent.
            let hint = this._isNarrow
                ? _('Tomorrow at %s').format(this._formatter.time(occurrence.start))
                : _('Tomorrow starts at %s').format(
                    this._formatter.time(occurrence.start)) +
                    '  ·  ' + occurrence.summary;

            // A drawn bar rather than a CSS border, because the styling
            // subset here is narrower than a browser's.
            let hintRow = new St.BoxLayout({ vertical: false });
            let bar = new St.Widget();
            bar.set_style(theme.accentBarStyle(accent, theme.px(20)));
            hintRow.add_child(bar);

            let hintLabel = this._label(hint, theme.upcomingTitleStyle(), { wrap: true, expand: true });
            hintLabel.set_style(theme.upcomingTitleStyle() +
                ' padding-left: ' + theme.gap(10) + 'px;');
            hintRow.add_child(hintLabel);
            box.add_child(hintRow);
        }

        this._bodyBox.add_child(box);
    }

    _renderFooter(model, theme) {
        let notes = [];

        if (this.show_feed_errors && this._feedErrors.length) {
            let text = this._feedErrors.length === 1
                ? this._feedErrors[0]
                : ngettext('%d calendar could not be reached',
                    '%d calendars could not be reached',
                    this._feedErrors.length).format(this._feedErrors.length);
            let error = this._label(text, theme.errorStyle(), { wrap: true });
            new Tooltips.Tooltip(error, this._feedErrors.join('\n'));
            this._bodyBox.add_child(this._spacer(theme.gap(8)));
            this._bodyBox.add_child(error);
        }

        if (model.hiddenCount > 0)
            notes.push(ngettext('%d more today', '%d more today', model.hiddenCount)
                .format(model.hiddenCount));

        if (this._usingCache)
            notes.push(_('showing saved copy'));

        if (!notes.length)
            return;

        this._bodyBox.add_child(this._spacer(theme.gap(6)));
        this._bodyBox.add_child(this._label(notes.join('  ·  '), theme.footerStyle()));
    }

    // ------------------------------------------------------------------
    // Data
    // ------------------------------------------------------------------

    /*
     * The fetch window runs from the start of today to the end of
     * tomorrow. Today is what gets listed; tomorrow exists only so a
     * finished day can still say what is coming.
     */
    _window(nowMs) {
        let start = Agenda.startOfLocalDay(nowMs, 0);
        let end = Agenda.startOfLocalDay(nowMs, 2);
        return { start: start, end: end };
    }

    _digest(results, nowMs) {
        let range = this._window(nowMs);
        let occurrences = [];
        let errors = [];
        let labels = Object.create(null);
        let anyLive = false;
        let anyStale = false;

        results.forEach((result) => {
            if (!result)
                return;
            if (result.error)
                errors.push(result.error);
            if (!result.body)
                return;

            if (result.stale)
                anyStale = true;
            else
                anyLive = true;

            try {
                let parsed = ICal.parseOccurrences(result.body, range.start, range.end, {
                    index: result.feed.index,
                    name: result.feed.name,
                });
                occurrences = occurrences.concat(parsed.occurrences);

                /*
                 * What to call this calendar on screen. A name the user
                 * typed wins, because they chose it deliberately. Failing
                 * that the feed's own published name, and failing that
                 * the site it came from, which is safe to show because it
                 * carries no part of the secret URL.
                 */
                labels[result.feed.index] = result.feed.name ||
                    parsed.calendarName ||
                    Feeds.feedLabel(result.feed);
            } catch (e) {
                // Never put the feed URL in a message or a log: a private
                // ICS link is a credential, and these end up in
                // ~/.xsession-errors and on the desktop.
                errors.push(_('%s: could not be read')
                    .format(Feeds.feedLabel(result.feed)));
                logError('failed to parse the calendar from ' +
                    Feeds.feedLabel(result.feed) + ': ' + e);
            }
        });

        this._occurrences = occurrences;
        this._feedErrors = errors;
        this._calendarLabels = labels;
        this._calendarCount = results.length;
        this._usingCache = anyStale && !anyLive;
        if (anyLive)
            this._lastSuccessMs = nowMs;
    }

    _refresh(force) {
        if (this._destroyed)
            return;

        let feeds = Feeds.parseFeedList(this.feeds);

        if (!feeds.length) {
            // Abandon anything already running before clearing, or a
            // response belonging to the feed the user just deleted lands
            // afterwards and puts its events back on the desktop.
            this._abandonFetch();
            this._occurrences = [];
            this._feedErrors = [];
            this._calendarLabels = Object.create(null);
            this._calendarCount = 0;
            this._render();
            return;
        }

        // A refresh already under way will deliver the same thing, so let
        // it finish rather than restarting the network work.
        if (this._inFlight && !force)
            return;

        this._abandonFetch();
        this._cancellable = new Gio.Cancellable();
        this._inFlight = true;

        let cancellable = this._cancellable;

        // Render now so a cold start says it is working, instead of
        // claiming the day is empty for as long as the fetch takes.
        this._render();

        Feeds.fetchAll(feeds, this.http_timeout, cancellable, (results) => {
            if (this._destroyed || cancellable.is_cancelled())
                return;
            this._inFlight = false;
            this._digest(results, Date.now());
            this._render();
        });
    }

    _abandonFetch() {
        if (this._cancellable) {
            this._cancellable.cancel();
            this._cancellable = null;
        }
        this._inFlight = false;
    }

    /*
     * Shows whatever is already on disk so the desklet has content the
     * moment it appears, instead of an empty box until the network
     * answers. Reading it is asynchronous, so a live response may well
     * arrive first; in that case the stale copy is simply dropped.
     */
    _loadCachedAgenda() {
        let feeds = Feeds.parseFeedList(this.feeds);
        if (!feeds.length)
            return;

        Feeds.loadAllFromCache(feeds, (results) => {
            if (this._destroyed || this._lastSuccessMs)
                return;
            this._digest(results, Date.now());
            this._feedErrors = [];
            this._render();
        });
    }

    // ------------------------------------------------------------------
    // Timers
    // ------------------------------------------------------------------

    _scheduleRefresh() {
        this._clearRefresh();
        // A settings change arriving after removal would otherwise install
        // a timer that re-arms itself forever on a dead desklet.
        if (this._destroyed)
            return;

        // A fixed interval, so let the source repeat itself rather than
        // tearing it down and building a new one on every tick.
        let seconds = Math.max(60, (this.refresh_minutes || 5) * 60);
        this._refreshTimer = Mainloop.timeout_add_seconds(seconds, () => {
            if (this._destroyed) {
                this._refreshTimer = 0;
                return GLib.SOURCE_REMOVE;
            }
            this._refresh(false);
            return GLib.SOURCE_CONTINUE;
        });
    }

    _clearRefresh() {
        if (this._refreshTimer) {
            Mainloop.source_remove(this._refreshTimer);
            this._refreshTimer = 0;
        }
    }

    /*
     * Re-renders on a sliding schedule so the countdown feels live near
     * an appointment without burning cycles the rest of the day. The tick
     * also handles midnight rollover, since the day boundary is recomputed
     * from scratch on every render.
     */
    _scheduleTick(model, nowMs) {
        this._clearTick();
        if (this._destroyed)
            return;

        let delay = Agenda.nextTickDelaySeconds(model, nowMs);

        // Never sleep past the end of the day, or a stale agenda would
        // linger into tomorrow morning.
        let untilMidnight = Math.ceil((model.dayEnd - nowMs) / 1000);
        if (untilMidnight > 0)
            delay = Math.min(delay, untilMidnight + 1);

        /*
         * One-shot rather than repeating, because the interval is not
         * fixed: the next render is scheduled from the one after it, with
         * a delay chosen from how close the next appointment now is.
         */
        this._tickTimer = Mainloop.timeout_add_seconds(Math.max(5, delay), () => {
            this._tickTimer = 0;
            if (this._destroyed)
                return GLib.SOURCE_REMOVE;
            this._render();
            return GLib.SOURCE_REMOVE;
        });
    }

    _clearTick() {
        if (this._tickTimer) {
            Mainloop.source_remove(this._tickTimer);
            this._tickTimer = 0;
        }
    }

    // ------------------------------------------------------------------
    // Settings reactions
    // ------------------------------------------------------------------

    _onFeedsChanged() {
        this._lastSuccessMs = 0;
        this._loadCachedAgenda();
        this._render();
        this._refresh(true);
    }

    _onScheduleChanged() {
        this._scheduleRefresh();
    }

    _onStyleChanged() {
        this._render();
    }

    _onTimeFormatChanged() {
        this._formatter.setTimeFormat(this.time_format);
        this._render();
    }

    // ------------------------------------------------------------------
    // Lifecycle
    // ------------------------------------------------------------------

    _onClicked(actor, event) {
        // A click on the join button is a click on the join button, not on
        // the card behind it. Without this, opening a meeting could also
        // fire the desklet's own click action.
        if (event && this._originatesFromButton(event))
            return Clutter.EVENT_PROPAGATE;

        // Right-click belongs to the context menu, which Cinnamon opens
        // from the parent actor. Acting on it too means every attempt to
        // reach "Remove this desklet" also kicks off a network refresh.
        if (event && typeof event.get_button === 'function' && event.get_button() !== 1)
            return Clutter.EVENT_PROPAGATE;

        switch (this.click_action) {
            case 'refresh':
                this._refresh(true);
                break;
            case 'open':
                this._openCalendarApp();
                break;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    /*
     * Starts whatever the user nominated as their calendar application.
     *
     * The command is split into an argument vector here and passed to
     * spawn as an array, so no shell ever sees it: nothing in the string
     * can act as a pipe, a redirect or a command separator.
     */
    _openCalendarApp() {
        let command = (this.calendar_command || '').trim();
        if (!command)
            return;

        let argv = null;
        try {
            let [parsed, args] = GLib.shell_parse_argv(command);
            if (parsed && args && args.length)
                argv = args;
        } catch (e) {
            logError('calendar command could not be parsed: ' + e);
            return;
        }

        if (!argv) {
            logError('calendar command is empty');
            return;
        }

        try {
            Util.trySpawn(argv);
        } catch (e) {
            logError('could not start the calendar application: ' + e);
        }
    }

    _originatesFromButton(event) {
        let source = null;
        try {
            source = event.get_source();
        } catch (e) {
            return false;
        }

        // Walk up to the desklet root; a button anywhere along that path
        // means the click was already spoken for.
        let depth = 0;
        while (source && depth < 12) {
            if (source instanceof St.Button)
                return true;
            if (source === this._root)
                return false;
            source = source.get_parent();
            depth++;
        }
        return false;
    }

    on_desklet_added_to_desktop() {
        this._loadCachedAgenda();
        this._render();
        this._refresh(true);
        this._scheduleRefresh();
    }

    on_desklet_removed() {
        this._destroyed = true;
        this._clearRefresh();
        this._clearTick();
        this._abandonFetch();

        // Without this the settings manager keeps a live reference to a
        // dead desklet and goes on invoking its callbacks.
        try {
            this.settings.finalize();
        } catch (e) {
            logError('could not release settings: ' + e);
        }
    }
}

function main(metadata, deskletId) {
    return new AgendaDesklet(metadata, deskletId);
}
