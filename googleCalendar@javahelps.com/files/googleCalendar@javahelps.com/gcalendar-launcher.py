#!/usr/bin/env python3
# Launcher for the copy of gcalendar bundled with the Google Calendar desklet.
#
# The gcalendar/ package beside this file is an unmodified copy of
# https://github.com/slgobinath/gcalendar at commit 9986389, Copyright (C)
# Gobinath Loganathan, licensed GPL-3.0-or-later. See gcalendar/LICENSE.
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program.  If not, see <http://www.gnu.org/licenses/>.
"""Run the bundled gcalendar.

gcalendar's modules import each other as ``gcalendar.*``, so the package's
parent directory has to be on sys.path.  This launcher arranges that, and adds
the two conveniences the desklet needs on top of gcalendar's own command line:
``--check-dependencies`` and ``--authorize``.
"""

import importlib.util
import os
import sys

# Importing the bundled package must never leave __pycache__ directories
# behind in the desklet's installation directory.
sys.dont_write_bytecode = True

HERE = os.path.dirname(os.path.abspath(__file__))

# The Python modules gcalendar needs, and the distribution package that
# provides each one.
REQUIRED_PACKAGES = (
    ("googleapiclient", "python3-googleapi"),
    ("oauth2client", "python3-oauth2client"),
    ("httplib2", "python3-httplib2"),
    ("dateutil", "python3-dateutil"),
)


def missing_packages():
    """Return the distribution packages whose modules cannot be found."""
    missing = []
    for module, package in REQUIRED_PACKAGES:
        try:
            found = importlib.util.find_spec(module) is not None
        except (ImportError, ValueError):
            found = False
        if not found:
            missing.append(package)
    return missing


def main():
    argv = sys.argv[1:]

    # Report on the dependencies without importing anything that needs them.
    if "--check-dependencies" in argv:
        missing = missing_packages()
        if missing:
            print("MISSING " + " ".join(missing))
        else:
            print("OK")
        return

    # gcalendar has no --authorize flag: it runs the OAuth browser flow
    # implicitly whenever an account has no valid credentials.
    # --list-calendars is the cheapest command that triggers it, so map onto
    # that rather than modifying the bundled sources.
    argv = ["--list-calendars" if arg == "--authorize" else arg for arg in argv]

    sys.path.insert(0, HERE)
    sys.argv = [sys.argv[0]] + argv

    from gcalendar.__main__ import main as gcalendar_main

    # gcalendar's own entry point discards the return value of
    # process_request, so the command exits 0 even when it fails and reports
    # the failure on stdout instead.  The desklet relies on that: its
    # SpawnReader throws stdout away when the exit status is non-zero.  Do not
    # propagate the return value here.
    gcalendar_main()


if __name__ == "__main__":
    main()
