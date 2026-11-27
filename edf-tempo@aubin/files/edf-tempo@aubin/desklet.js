const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Soup = imports.gi.Soup;
const St = imports.gi.St;
const Clutter = imports.gi.Clutter;
const Mainloop = imports.mainloop;

const Gettext = imports.gettext;
const Desklet = imports.ui.desklet;
const Settings = imports.ui.settings;

const UUID = "edf-tempo@aubin";

const RTE_TOKEN_URL = "https://digital.iservices.rte-france.com/token/oauth/";
const RTE_CALENDAR_URL = "https://digital.iservices.rte-france.com/open_api/tempo_like_supply_contract/v1/tempo_like_calendars";

Gettext.bindtextdomain(UUID, GLib.build_filenamev([GLib.get_user_data_dir(), "locale"]));

let httpSession;
if (Soup.MAJOR_VERSION === 2) {
   httpSession = new Soup.SessionAsync();
   Soup.Session.prototype.add_feature.call(httpSession, new Soup.ProxyResolverDefault());
   httpSession.timeout = 10;
} else {
   httpSession = new Soup.Session({ timeout: 10 });
}

/**
 * Translation support.
 * @param {string} str
 * @returns {string}
 */
function _(str) {
   return Gettext.dgettext(UUID, str);
}

function pad2(n) {
   return String(Math.trunc(Math.abs(n))).padStart(2, "0");
}

function formatLocalDay(date) {
   return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function addLocalDays(date, days) {
   return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, 0, 0, 0, 0);
}

function formatShortDate(date) {
   return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}`;
}

function formatIsoWithOffset(date) {
   const offsetMin = -date.getTimezoneOffset();
   const sign = offsetMin >= 0 ? "+" : "-";
   const hours = pad2(offsetMin / 60);
   const minutes = pad2(offsetMin % 60);
   return (
      `${formatLocalDay(date)}T${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}` +
      `${sign}${hours}:${minutes}`
   );
}

function resolveCredentialsFile(raw) {
   const trimmed = (raw || "").trim();
   if (trimmed === "") {
      return null;
   }
   if (trimmed.startsWith("file://")) {
      return Gio.File.new_for_uri(trimmed);
   }
   return Gio.File.parse_name(trimmed);
}

function loadFileTextAsync(file) {
   return new Promise((resolve, reject) => {
      file.load_contents_async(null, (source, result) => {
         try {
            const [ok, bytes] = source.load_contents_finish(result);
            if (!ok || !bytes) {
               resolve("");
               return;
            }
            resolve(new TextDecoder("utf-8").decode(bytes));
         } catch (err) {
            reject(err);
         }
      });
   });
}

function cleanBase64Secret(raw) {
   return (raw || "")
      .trim()
      .replace(/^["']|["']$/g, "")
      .replace(/^Basic\s+/i, "")
      .trim();
}

function parseEnvCredentialLine(line) {
   const idx = line.indexOf("=");
   if (idx <= 0) {
      return undefined;
   }
   const key = line.slice(0, idx).trim();
   if (!/^[A-Za-z_]\w*$/.test(key)) {
      return undefined;
   }
   return key === "RTE_CREDENTIALS_BASE64" ? cleanBase64Secret(line.slice(idx + 1)) || null : "";
}

function extractCredentialsFromText(content) {
   const plainLines = [];
   for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (line === "" || line.startsWith("#")) {
         continue;
      }
      const envVal = parseEnvCredentialLine(line);
      if (envVal === undefined) {
         plainLines.push(line);
      } else if (envVal !== "") {
         return envVal;
      }
   }
   return plainLines.length === 1 ? cleanBase64Secret(plainLines[0]) || null : null;
}

function isIgnorableFileError(err) {
   if (!err || typeof err.matches !== "function") {
      return false;
   }
   return err.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND) || err.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.IS_DIRECTORY);
}

function extractTempoDays(calJson) {
   const values = calJson && calJson.tempo_like_calendars && calJson.tempo_like_calendars.values;
   if (!Array.isArray(values)) {
      throw new Error("invalid RTE calendar payload");
   }
   const result = {};
   for (const entry of values) {
      if (
         entry &&
         typeof entry.start_date === "string" &&
         (entry.value === "BLUE" || entry.value === "WHITE" || entry.value === "RED")
      ) {
         result[entry.start_date.slice(0, 10)] = entry.value;
      }
   }
   return result;
}

class TempoDesklet extends Desklet.Desklet {
   constructor(metadata, desklet_id) {
      super(metadata, desklet_id);
      this.days = {};
      this.updatedTime = null;
      this.lastError = null;
      this.missingConfig = false;
      this.loading = true;
      this.fetching = false;
      this.removed = false;
      this.tokenCache = null;
      this.timeout = 0;

      this.setHeader(_("EDF Tempo"));
      this._menu.addAction(_("Refresh now"), () => {
         this.tokenCache = null;
         this.scheduleRefresh(true);
      });

      this.settings = new Settings.DeskletSettings(this, this.metadata["uuid"], desklet_id);
      this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "show-today", "show_today", () =>
         this.onDisplaySettingChanged(),
      );
      this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "hide-decorations", "hide_decorations", () =>
         this.onDisplaySettingChanged(),
      );
      this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "credentials-file", "credentials_file", () =>
         this.onSourceSettingChanged(),
      );
      this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "rte-credentials", "rte_credentials", () =>
         this.onSourceSettingChanged(),
      );
      this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "refresh-interval", "refresh_interval", () =>
         this.scheduleNextTick(),
      );

      this.toggleDecoration();
      this.render();
      this.scheduleRefresh(true);
   }

   toggleDecoration() {
      this.metadata["prevent-decorations"] = Boolean(this.hide_decorations);
      this._updateDecoration();
   }

   onDisplaySettingChanged() {
      this.toggleDecoration();
      this.render();
   }

   onSourceSettingChanged() {
      this.tokenCache = null;
      this.scheduleRefresh(true);
   }

   httpRequest(method, url, headers) {
      return new Promise((resolve, reject) => {
         try {
            const message = Soup.Message.new(method, url);
            if (!message) {
               reject(new Error(`Invalid URL: ${url}`));
               return;
            }
            if (Soup.MAJOR_VERSION === 2) {
               for (const [key, val] of Object.entries(headers)) {
                  message.request_headers.append(key, val);
               }
               if (method === "POST") {
                  message.set_request("application/x-www-form-urlencoded", Soup.MemoryUse.COPY, "");
               }
               httpSession.queue_message(message, (_session, response) => {
                  if (response.status_code >= 200 && response.status_code < 300) {
                     resolve(String(response.response_body.data || ""));
                  } else {
                     reject(new Error(`HTTP ${response.status_code}: ${response.reason_phrase}`));
                  }
               });
            } else {
               const reqHeaders = message.get_request_headers();
               for (const [key, val] of Object.entries(headers)) {
                  reqHeaders.append(key, val);
               }
               if (method === "POST") {
                  message.set_request_body_from_bytes("application/x-www-form-urlencoded", GLib.Bytes.new([]));
               }
               httpSession.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (session, res) => {
                  try {
                     const bytes = session.send_and_read_finish(res);
                     const status = message.get_status();
                     if (status >= 200 && status < 300) {
                        const raw = bytes ? bytes.get_data() : null;
                        resolve(raw ? new TextDecoder("utf-8").decode(raw) : "");
                     } else {
                        reject(new Error(`HTTP ${status}: ${message.get_reason_phrase()}`));
                     }
                  } catch (err) {
                     reject(err);
                  }
               });
            }
         } catch (err) {
            reject(err);
         }
      });
   }

   async resolveRteCredentials() {
      const direct = cleanBase64Secret(this.rte_credentials);
      if (direct !== "") {
         return direct;
      }
      const file = resolveCredentialsFile(this.credentials_file);
      if (!file) {
         return null;
      }
      try {
         const content = await loadFileTextAsync(file);
         return extractCredentialsFromText(content);
      } catch (err) {
         if (!isIgnorableFileError(err)) {
            global.logError(`[${UUID}] Failed to read credentials file: ${err}`);
         }
         return null;
      }
   }

   async getAccessToken(credentials) {
      const nowMs = Date.now();
      if (this.tokenCache && nowMs < this.tokenCache.expiresAtMs) {
         return this.tokenCache.accessToken;
      }
      const tokenOut = await this.httpRequest("POST", RTE_TOKEN_URL, {
         Authorization: `Basic ${credentials}`,
      });
      const tokenJson = JSON.parse(tokenOut);
      if (!tokenJson || typeof tokenJson.access_token !== "string") {
         throw new Error("invalid RTE OAuth response");
      }
      const expiresIn = typeof tokenJson.expires_in === "number" ? tokenJson.expires_in : 3600;
      this.tokenCache = {
         accessToken: tokenJson.access_token,
         expiresAtMs: nowMs + Math.max(60, expiresIn - 60) * 1000,
      };
      return tokenJson.access_token;
   }

   async fetchFromRte(credentials) {
      const token = await this.getAccessToken(credentials);
      const now = new Date();
      const start = addLocalDays(now, -1);
      const end = addLocalDays(now, 2);
      const url =
         `${RTE_CALENDAR_URL}?start_date=${encodeURIComponent(formatIsoWithOffset(start))}` +
         `&end_date=${encodeURIComponent(formatIsoWithOffset(end))}`;

      const calOut = await this.httpRequest("GET", url, {
         Authorization: `Bearer ${token}`,
         Accept: "application/json",
      });
      return extractTempoDays(JSON.parse(calOut));
   }

   async refreshData() {
      if (this.fetching || this.removed) {
         return;
      }
      this.fetching = true;
      const credentials = await this.resolveRteCredentials();
      try {
         if (!credentials) {
            this.missingConfig = true;
            this.lastError = null;
         } else {
            this.missingConfig = false;
            this.days = await this.fetchFromRte(credentials);
            this.lastError = null;
            const now = new Date();
            this.updatedTime = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
         }
      } catch (err) {
         global.logError(`[${UUID}] RTE refresh failed: ${err}`);
         this.tokenCache = null;
         this.lastError = String(err.message || err);
      } finally {
         this.loading = false;
         this.fetching = false;
         if (!this.removed) {
            this.render();
            this.scheduleNextTick();
         }
      }
   }

   badgeInfo(color) {
      if (color === "BLUE") {
         return { text: _("Blue"), style: "tempo-blue" };
      }
      if (color === "WHITE") {
         return { text: _("White"), style: "tempo-white" };
      }
      if (color === "RED") {
         return { text: _("Red"), style: "tempo-red" };
      }
      if (this.loading) {
         return { text: "…", style: "tempo-pending" };
      }
      if (this.missingConfig) {
         return { text: _("Not configured"), style: "tempo-error" };
      }
      if (this.lastError && Object.keys(this.days).length === 0) {
         return { text: _("Error"), style: "tempo-error" };
      }
      return { text: _("Pending"), style: "tempo-pending" };
   }

   createRow(title, date, color, emphasize) {
      const row = new St.BoxLayout({ vertical: false, style_class: "tempo-row" });
      const labelClass = emphasize ? "tempo-day-label-tomorrow" : "tempo-day-label";
      const badgeBase = emphasize ? "tempo-badge tempo-badge-tomorrow" : "tempo-badge";
      const badge = this.badgeInfo(color);

      row.add_actor(
         new St.Label({
            text: `${title} (${formatShortDate(date)})`,
            style_class: labelClass,
            y_align: Clutter.ActorAlign.CENTER,
         }),
      );
      row.add_actor(
         new St.Label({
            text: badge.text,
            style_class: `${badgeBase} ${badge.style}`,
            y_align: Clutter.ActorAlign.CENTER,
         }),
      );
      return row;
   }

   render() {
      const now = new Date();
      const todayDate = addLocalDays(now, 0);
      const tomorrowDate = addLocalDays(now, 1);
      const todayColor = this.days[formatLocalDay(todayDate)] || null;
      const tomorrowColor = this.days[formatLocalDay(tomorrowDate)] || null;

      const container = new St.BoxLayout({ vertical: false, style_class: "tempo-container" });
      container.add_actor(
         new St.Bin({
            style_class: "tempo-icon",
            y_align: Clutter.ActorAlign.CENTER,
         }),
      );

      const rows = new St.BoxLayout({ vertical: true, style_class: "tempo-rows" });
      rows.add_actor(this.createRow(_("Tomorrow"), tomorrowDate, tomorrowColor, true));
      if (this.show_today) {
         rows.add_actor(this.createRow(_("Today"), todayDate, todayColor, false));
      }

      if (this.missingConfig) {
         rows.add_actor(new St.Label({ text: _("Missing RTE credentials"), style_class: "tempo-footer" }));
      } else if (this.lastError) {
         const suffix = this.updatedTime ? ` (${this.updatedTime})` : "";
         rows.add_actor(new St.Label({ text: `${_("RTE error")}${suffix}`, style_class: "tempo-footer" }));
      } else if (this.updatedTime) {
         rows.add_actor(new St.Label({ text: `RTE · ${this.updatedTime}`, style_class: "tempo-footer" }));
      }

      container.add_actor(rows);
      this.setContent(container);
   }

   clearTimer() {
      if (this.timeout) {
         Mainloop.source_remove(this.timeout);
         this.timeout = 0;
      }
   }

   scheduleRefresh(immediate) {
      this.clearTimer();
      if (immediate) {
         void this.refreshData();
      } else {
         this.scheduleNextTick();
      }
   }

   scheduleNextTick() {
      this.clearTimer();
      if (this.removed) {
         return;
      }
      const now = new Date();
      const tomorrowKey = formatLocalDay(addLocalDays(now, 1));
      const waitingPublication = !this.days[tomorrowKey] && now.getHours() >= 10 && now.getHours() < 14;
      const configuredMinutes = Math.max(5, Number(this.refresh_interval) || 30);
      const minutes = waitingPublication ? Math.min(configuredMinutes, 10) : configuredMinutes;

      this.timeout = Mainloop.timeout_add_seconds(minutes * 60, () => {
         this.timeout = 0;
         void this.refreshData();
         return GLib.SOURCE_REMOVE;
      });
   }

   on_desklet_removed() {
      this.removed = true;
      this.clearTimer();
   }
}

function main(metadata, deskletId) {
   return new TempoDesklet(metadata, deskletId);
}
