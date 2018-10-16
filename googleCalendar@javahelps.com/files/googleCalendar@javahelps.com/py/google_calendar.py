#!/usr/bin/env python3
# -*- coding: utf-8 -*-
#
# Google Calendar Desklet displays your agenda based on your Google Calendar in Cinnamon desktop.
#
# Copyright (C) 2018  Gobinath
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
# along with this program.  If not, see <http:*www.gnu.org/licenses/>.

"""Simple command-line sample for the Calendar API.
Command-line application that retrieves the list of the user's calendars."""

import sys

import argparse
import json
from datetime import datetime, timezone
from dateutil.relativedelta import relativedelta
from oauth2client import client
from googleapiclient import sample_tools


def retrieve_events(service, calendar_id, calendar_color, start_time, end_time):
    try:
        page_token = None
        retrieved_events = []
        while True:
            events = service.events().list(calendarId=calendar_id,
                                           pageToken=page_token,
                                           timeMin=start_time,
                                           timeMax=end_time,
                                           singleEvents=True).execute()
            for event in events['items']:
                calendar_event = {'calendar_color': calendar_color, 'summary': event['summary'],
                                  'calendar_color': calendar_color, 'summary': event['summary'], }
                if 'dateTime' in event['start']:
                    startDateTime = datetime.strptime(
                        ''.join(event['start']['dateTime'].rsplit(':', 1)),  '%Y-%m-%dT%H:%M:%S%z')
                    endDateTime = datetime.strptime(
                        ''.join(event['end']['dateTime'].rsplit(':', 1)),  '%Y-%m-%dT%H:%M:%S%z')
                    calendar_event['start_date'] = str(startDateTime.date())
                    calendar_event['start_time'] = str(
                        startDateTime.time()).rsplit(':', 1)[0]
                    calendar_event['end_date'] = str(endDateTime.date())
                    calendar_event['end_time'] = str(
                        endDateTime.time()).rsplit(':', 1)[0]
                else:
                    calendar_event['start_date'] = event['start']['date']
                    calendar_event['start_time'] = '00:00'
                    calendar_event['end_date'] = event['end']['date']
                    calendar_event['end_time'] = '00:00'
                if 'location' in event:
                    calendar_event['location'] = event['location']
                else:
                    calendar_event['location'] = ''
                retrieved_events.append(calendar_event)
            page_token = events.get('nextPageToken')
            if not page_token:
                break
        return retrieved_events

    except client.AccessTokenRefreshError:
        # The credentials have been revoked or expired, please re-run the application to re-authorize.
        return -1


def main(argv):
    """
    Retrieve Google Calendar events.
    """
    parser = argparse.ArgumentParser(
        description='Retrieve Google Calendar events.')
    parser.add_argument('--no-of-days', type=str, default="7",
                        help='number of days to include')
    parser.add_argument('--calendar', type=str, default=['*'], nargs='*')
    parser.add_argument("--list-calendars", action='store_true')
    args = parser.parse_args()

    # Extract arguments
    no_of_days = int(args.no_of_days)
    selected_calendars = [x.lower() for x in args.calendar]
    all_calendars = '*' in selected_calendars

    current_time = datetime.now(timezone.utc).astimezone()
    start_time = str(current_time.isoformat())
    end_time = str((current_time + relativedelta(days=no_of_days)).isoformat())

    # Authenticate and construct service.
    service, flags = sample_tools.init(
        [], 'calendar', 'v3', __doc__, __file__,
        scope='https://www.googleapis.com/auth/calendar.readonly')

    calendar_events = []
    try:
        page_token = None
        while True:
            calendar_list = service.calendarList().list(pageToken=page_token).execute()
            for calendar_list_entry in calendar_list['items']:
                if args.list_calendars:
                    print(calendar_list_entry['summary'])
                    continue
                if all_calendars or (calendar_list_entry['summary'].lower() in selected_calendars):
                    events = retrieve_events(
                        service, calendar_list_entry['id'], calendar_list_entry['backgroundColor'], start_time, end_time)
                    if events == -1:
                        break
                    elif events:
                        calendar_events.extend(events)
            page_token = calendar_list.get('nextPageToken')
            if not page_token:
                break

        if calendar_events:
            calendar_events = sorted(
                calendar_events, key=lambda k: k['start_date'] + k['start_time'])
            print(json.dumps(calendar_events))
    except client.AccessTokenRefreshError:
        # The credentials have been revoked or expired, please re-run the application to re-authorize.
        return -1
    except Exception as e:
        return -2


if __name__ == '__main__':
    main(sys.argv)
