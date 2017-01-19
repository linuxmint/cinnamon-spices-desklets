#!/usr/bin/python
#
# settings.py
# Copyright (C) 2013 Lars Mueller <cobinja@yahoo.de>
# 
# CobiAnalogClock is free software: you can redistribute it and/or modify it
# under the terms of the GNU General Public License as published by the
# Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
# 
# CobiAnalogClock is distributed in the hope that it will be useful, but
# WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
# See the GNU General Public License for more details.
# 
# You should have received a copy of the GNU General Public License along
# with this program.  If not, see <http://www.gnu.org/licenses/>.

from gi.repository import Gtk, GLib, Gio, GObject
import os, sys
import json
import collections

DESKLET_DIR = os.path.dirname(os.path.abspath(__file__))
UI_FILE = DESKLET_DIR + "/settings.ui"

UUID = "analog-clock@cobinja.de"

def getThemeNames(path):
  themeNames = [];
  for (path, dirs, files) in os.walk(path):
    if "metadata.json" in files:
      themeNames.append(os.path.basename(path))
  themeNames.sort()
  return themeNames

def getTimezones():
  lsZones = Gtk.ListStore(GObject.TYPE_INT, GObject.TYPE_STRING)
  regionNames = [];
  lsCities = Gtk.ListStore(GObject.TYPE_INT, GObject.TYPE_STRING, GObject.TYPE_STRING)
  
  _tzinfo_dir = os.getenv("TZDIR") or "/usr/share/zoneinfo"
  if _tzinfo_dir.endswith(os.sep):
    _tzinfo_dir = _tzinfo_dir[:-1]

  timeZones = [l.split()[2]
                      for l in open(os.path.join(_tzinfo_dir, "zone.tab"))
                      if l != "" and l[0] != "#"]\
    + ['GMT',
       'US/Alaska',
       'US/Arizona',
       'US/Central',
       'US/Eastern',
       'US/Hawaii',
       'US/Mountain',
       'US/Pacific',
       'UTC']
  timeZones.sort()
  
  i = 0
  for tz in timeZones:
    i += 1
    (region, sep, city) = tz.partition("/")
    if not region in regionNames:
      region = region.replace('_', ' ')
      regionNames.append(region)
      lsZones.append([len(regionNames), region])
    if city:
      city = city.replace ('_', ' ')
      lsCities.append([i, city, region])
  return (lsZones, lsCities)

def filterDetailFunc(model, iterator, regionCombo):
  rcIter = regionCombo.get_active_iter()
  if rcIter == None: return False
  
  rcModel = regionCombo.get_model()
  activeRegion = rcModel[rcIter][1]
  
  cityRegion = model[iterator][2]
  return activeRegion == cityRegion

class CobiSettings:
  def __init__(self, instanceId):
    self.instanceId = instanceId
    settingsDirName = GLib.get_user_config_dir()
    if not settingsDirName:
      settingsDirName = GLib.get_home_dir() + "/.config"
    settingsDirName += "/cobinja/" + UUID
    settingsDir = Gio.file_new_for_path(settingsDirName)
    
    if not settingsDir.query_exists(None):
      settingsDir.make_directory_with_parents(None)
    
    self.__settingsFile = settingsDir.get_child(instanceId + ".json")
    if not self.__settingsFile.query_exists(None):
      self.__getDefaultSettingsFile().copy(self.__settingsFile, 0, None, None, None)
    
    self.values = collections.OrderedDict()
    
    self.__loadSettings()
    
    self.__monitor = self.__settingsFile.monitor(Gio.FileMonitorFlags.NONE, None)
    self.__monitorChangedId = self.__monitor.connect("changed", self.__onSettingsChanged)
  
  def __getDefaultSettingsFile(self):
    return Gio.file_new_for_path(DESKLET_DIR + "/default_settings.json")
  
  def writeSettings(self):
    if self.changed():
      f = open(self.__settingsFile.get_path(), 'w')
      f.write(json.dumps(self.values, sort_keys=False, indent=2))
      f.close()
      self.__origSettings = collections.OrderedDict(self.values)
  
  def setEntry(self, key, value, writeToFile):
    if key in self.values.keys() and self.values[key] != value:
      self.values[key] = value
      if writeToFile:
        self.writeSettings()
  
  def __onSettingsChanged(self, monitor, thisFile, otherFile, eventType):
    self.__loadSettings()
  
  def __loadSettings(self):
    f = open(self.__settingsFile.get_path(), 'r')
    settings = json.loads(f.read(), object_pairs_hook=collections.OrderedDict)
    f.close()
    for key in settings:
      value = settings[key]
      oldValue = self.values[key] if key in self.values.keys() else None
      if value != oldValue:
        self.values[key] = value
    self.__origSettings = collections.OrderedDict(self.values)
  
  def changed(self):
    return self.values != self.__origSettings
  
  def __del__(self):
    self.__monitor.disconnect(self.__monitorChangedId)
    self.__monitor.cancel()

class CobiAnalogClockSettings:
  def __init__(self):
    instanceId = sys.argv[1];
    self.__settings = CobiSettings(instanceId)
    
    self.builder = Gtk.Builder()
    self.builder.add_from_file(UI_FILE)
    self.builder.connect_signals(self)
    
    self.lsTheme = Gtk.ListStore(GObject.TYPE_INT, GObject.TYPE_STRING)
    cbTheme = self.builder.get_object("cbTheme")
    # Load theme names
    themeNames = getThemeNames(DESKLET_DIR + "/themes")
    activeIndex = 0
    for i in range(0, len(themeNames)):
      themeName = themeNames[i]
      self.lsTheme.append([i, themeName])
      if themeName == self.__settings.values["theme"]:
        activeIndex = i
    cbTheme.set_model(self.lsTheme)
    crRegions = Gtk.CellRendererText()
    cbTheme.pack_start(crRegions, True)
    cbTheme.add_attribute(crRegions, "text", 1)
    cbTheme.set_active(activeIndex)
    cbTheme.connect("changed", self.onThemeChanged)
    
    cbShowSeconds = self.builder.get_object("cbShowSeconds")
    cbShowSeconds.set_active(self.__settings.values["show-seconds"])
    cbShowSeconds.connect("toggled", self.onShowSecondsChanged)
    
    cbHideDecorations = self.builder.get_object("cbHideDecorations")
    cbHideDecorations.set_active(self.__settings.values["hide-decorations"])
    cbHideDecorations.connect("toggled", self.onHideDecorationsChanged)
    
    sbSize = self.builder.get_object("sbSize")
    sbSize.set_range(20, 1000)
    sbSize.set_increments(1, 1)
    sbSize.set_value(self.__settings.values["size"])
    sbSize.connect("value-changed", self.onSizeChanged)
    
    useTimezones = self.__settings.values["timezone-use"]
    
    cbUseTimezone = self.builder.get_object("cbUseTimezone")
    cbUseTimezone.set_active(useTimezones)
    cbUseTimezone.connect("toggled", self.onUseTimezoneChanged)
    
    self.cbTzRegion = self.builder.get_object("cbTzRegion")
    self.cbTzCity = self.builder.get_object("cbTzCity")
    
    (self.lsTimezoneRegions, self.lsTimezoneCities) = getTimezones()
    self.lsfCities = self.lsTimezoneCities.filter_new()
    self.lsfCities.set_visible_func(filterDetailFunc, self.cbTzRegion)
    self.cbTzCity.set_model(self.lsfCities)
    self.cbTzRegion.set_model(self.lsTimezoneRegions)
    
    crRegions = Gtk.CellRendererText()
    self.cbTzRegion.pack_start(crRegions, True)
    self.cbTzRegion.add_attribute(crRegions, "text", 1)
    crCity = Gtk.CellRendererText()
    self.cbTzCity.pack_start(crCity, True)
    self.cbTzCity.add_attribute(crCity, "text", 1)
    
    self.cbTzRegion.connect("changed", self.onTzRegionChanged)
    self.cbTzCity.connect("changed", self.onTzCityChanged)
    
    activeTimezone = self.__settings.values["timezone"]
    
    iterator = self.lsTimezoneRegions.get_iter_first()
    while iterator:
      if self.lsTimezoneRegions[iterator][1] == activeTimezone["region"]:
        self.cbTzRegion.set_active_iter(iterator)
        break
      iterator = self.lsTimezoneRegions.iter_next(iterator)
    
    iterator = self.lsfCities.get_iter_first()
    while iterator:
      if self.lsfCities[iterator][1] == activeTimezone["city"]:
        self.cbTzCity.set_active_iter(iterator)
        break
      iterator = self.lsfCities.iter_next(iterator)
    
    self.cbTzDisplayLabel = self.builder.get_object("cbTzDisplayLabel")
    self.cbTzDisplayLabel.set_active(self.__settings.values["timezone-display"])
    self.cbTzDisplayLabel.connect("toggled", self.onTzDisplayLabelChanged)
    
    self.cbTzRegion.set_sensitive(useTimezones)
    self.cbTzCity.set_sensitive(useTimezones)
    self.cbTzDisplayLabel.set_sensitive(useTimezones)
    self.builder.get_object("lblTzDisplayLabel").set_sensitive(useTimezones)
    
    self.updateApplyButtonSensitivity()

    window = self.builder.get_object("SettingsWindow")
    window.show_all()
    
  def destroy(self, window):
    Gtk.main_quit()
    
  def okPressed(self, button):
    self.applySettings(button)
    Gtk.main_quit()
  
  def applySettings(self, button):
    self.__settings.writeSettings()
    self.updateApplyButtonSensitivity()
  
  def cancel(self, button):
    Gtk.main_quit()
  
  def onThemeChanged(self, button):
    tree_iter = button.get_active_iter()
    if tree_iter != None:
      themeName = self.lsTheme[tree_iter][1]
    if themeName:
      self.__settings.setEntry("theme", themeName, False)
    self.updateApplyButtonSensitivity()
  
  def onSizeChanged(self, button):
    self.__settings.setEntry("size", int(button.get_value()), False)
    self.updateApplyButtonSensitivity()
  
  def onShowSecondsChanged(self, button):
    self.__settings.setEntry("show-seconds", button.get_active(), False)
    self.updateApplyButtonSensitivity()
  
  def onHideDecorationsChanged(self, button):
    self.__settings.setEntry("hide-decorations", button.get_active(), False)
    self.updateApplyButtonSensitivity()
  
  def onUseTimezoneChanged(self, button):
    active = button.get_active()
    self.__settings.setEntry("timezone-use", active, False)
    self.cbTzRegion.set_sensitive(active)
    self.cbTzCity.set_sensitive(active)
    self.cbTzDisplayLabel.set_sensitive(active)
    self.builder.get_object("lblTzDisplayLabel").set_sensitive(active)
    self.updateApplyButtonSensitivity()
  
  def onTzRegionChanged(self, button):
    tree_iter = button.get_active_iter()
    if tree_iter != None:
      region = self.lsTimezoneRegions[tree_iter][1]
    if region:
      self.lsfCities.refilter()
      self.cbTzCity.set_active_iter(self.lsfCities.get_iter_first())
      self.cbTzCity.set_sensitive(len(self.lsfCities) > 0)
    self.updateTzSetting()
    self.updateApplyButtonSensitivity()
  
  def onTzCityChanged(self, button):
    self.updateTzSetting()
    self.updateApplyButtonSensitivity()
  
  def onTzDisplayLabelChanged(self, button):
    active = button.get_active()
    self.__settings.setEntry("timezone-display", active, False)
    self.updateApplyButtonSensitivity()
  
  def updateTzSetting(self):
    newTz = {}
    regionIter = self.cbTzRegion.get_active_iter()
    if regionIter != None:
      region = self.lsTimezoneRegions[regionIter][1]
    if region:
      newTz["region"] = region
      newTz["city"] = ""
      cityIter = self.cbTzCity.get_active_iter()
      if cityIter:
        newTz["city"] = self.lsfCities[cityIter][1]
    self.__settings.setEntry("timezone", newTz, False)
  
  def updateApplyButtonSensitivity(self):
    btn = self.builder.get_object("buttonApply")
    changed = self.__settings.changed()
    btn.set_sensitive(changed)

def main():
  CobiAnalogClockSettings()
  Gtk.main()
    
if __name__ == "__main__":
  if len(sys.argv) != 2:
    print "Usage: settings.py <desklet_id>"
    exit(0);
  main()
