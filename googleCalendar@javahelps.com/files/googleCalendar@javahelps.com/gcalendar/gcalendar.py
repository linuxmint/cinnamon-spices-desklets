#!/usr/bin/env python3
# gcalendar is a tool to read Google Calendar events from your terminal.

# Copyright (C) 2020  Gobinath

# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.

# You should have received a copy of the GNU General Public License
# along with this program.  If not, see <http://www.gnu.org/licenses/>.

import socket

from dateutil import parser
from googleapiclient import discovery
from httplib2 import Http
from oauth2client import client
from oauth2client import file
from oauth2client import tools

from gcalendar import GOOGLE_CALENDAR_SCOPE, AUTH_URI, TOKEN_URI


class GCalendar:
    def __init__(self, client_id, client_secret, account_id, storage_path):
        super().__init__()
        self.client_id = client_id
        self.client_secret = client_secret
        self.account_id = account_id
        self.storage_path = storage_path
        self.service = self.create_service()

    @staticmethod
    def is_authorized(storage_path):
        # Create a unique storage for the given account_id
        storage = file.Storage(storage_path)
        credentials = storage.get()

        return not (credentials is None or credentials.invalid)

    def create_service(self):
        # Prepare credentials, and authorize HTTP object with them.
        # If the credentials don"t exist or are invalid run through the native client
        # flow. The Storage object will ensure that if successful the good
        # credentials will get written back to a file.
        storage = file.Storage(self.storage_path)
        credentials = storage.get()

        # If credentials not found, authenticate
        if credentials is None or credentials.invalid:
            # Set up a Flow object to be used if we need to authenticate.
            flow = self.__flow_from_client_secrets()
            credentials = tools.run_flow(flow, storage, DefaultArg())

        http = credentials.authorize(http=Http())

        # Construct a service object via the discovery service.
        return discovery.build("calendar", "v3", http=http)

    def list_calendars(self):
        """List calendar names"""
        calendars = list()
        page_token = None
        while True:
            calendar_list = self.service.calendarList().list(pageToken=page_token).execute()
            for calendar_list_entry in calendar_list["items"]:
                calendars.append(calendar_list_entry["summary"])
            page_token = calendar_list.get("nextPageToken")
            if not page_token:
                break
        return calendars

    def list_events(self, calendars, start_time, end_time, time_zone):
        """List sorted calendar events"""
        calendar_events = list()
        all_calendars = "*" in calendars
        page_token = None
        while True:
            calendar_list = self.service.calendarList().list(pageToken=page_token).execute()
            for calendar_list_entry in calendar_list["items"]:
                if all_calendars or (calendar_list_entry["summary"].lower() in calendars):
                    events = self.retrieve_events(calendar_list_entry["id"], calendar_list_entry["backgroundColor"],
                                                  start_time, end_time, time_zone)
                    calendar_events.extend(events)
            page_token = calendar_list.get("nextPageToken")
            if not page_token:
                break

        return sorted(calendar_events, key=lambda event: event["start_date"] + event["start_time"])

    def retrieve_events(self, calendar_id, calendar_color, start_time, end_time, time_zone):
        page_token = None
        retrieved_events = []
        time_zone_str = str(time_zone)
        while True:
            events = self.service.events().list(calendarId=calendar_id,
                                                pageToken=page_token,
                                                timeMin=start_time,
                                                timeMax=end_time,
                                                timeZone=time_zone_str,
                                                singleEvents=True).execute()
            for event in events["items"]:
            
                calendar_event = {"calendar_color": calendar_color, "summary": event.get("summary", "NO_TITLE")}
                # Extract the start and end time
                if "dateTime" in event["start"]:
                    start_date_time = parser.isoparse(event["start"]["dateTime"]).astimezone(time_zone)
                    end_date_time = parser.isoparse(event["end"]["dateTime"]).astimezone(time_zone)
                    calendar_event["start_date"] = str(start_date_time.date())
                    calendar_event["start_time"] = str(start_date_time.time()).rsplit(":", 1)[0]
                    calendar_event["end_date"] = str(end_date_time.date())
                    calendar_event["end_time"] = str(end_date_time.time()).rsplit(":", 1)[0]
                else:
                    calendar_event["start_date"] = event["start"]["date"]
                    calendar_event["start_time"] = "00:00"
                    calendar_event["end_date"] = event["end"]["date"]
                    calendar_event["end_time"] = "00:00"

                # Extract the location
                if "location" in event:
                    calendar_event["location"] = event["location"]
                else:
                    calendar_event["location"] = ""
                    
                if "description" in event:
                    calendar_event["description"] = event["description"]
                else:
                    calendar_event["description"] = ""
                    
                if "organizer" in event:
                    calendar_event["organizer"] = event["organizer"]
                else:
                    calendar_event["organizer"] = ""
                    
                if "attendees" in event:
                    calendar_event["attendees"] = event["attendees"]
                else:
                    calendar_event["attendees"] = ""

                if "status" in event:
                    calendar_event["status"] = event["status"]
                else: 
                    calendar_event["status"] = ""
                    
                retrieved_events.append(calendar_event)
            page_token = events.get("nextPageToken")
            if not page_token:
                break
        return retrieved_events

    def __flow_from_client_secrets(self):
        constructor_kwargs = {
            "redirect_uri": None,
            "auth_uri": AUTH_URI,
            "token_uri": TOKEN_URI,
            "login_hint": None,
        }
        return client.OAuth2WebServerFlow(self.client_id, self.client_secret,
                                          GOOGLE_CALENDAR_SCOPE, **constructor_kwargs)


class DefaultArg:

    def __init__(self):
        self.auth_host_name = "localhost"
        self.noauth_local_webserver = False
        self.auth_host_port = DefaultArg.get_available_ports()
        self.logging_level = "ERROR"

    @staticmethod
    def get_available_ports():
        soc = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        soc.bind(("", 0))
        port = soc.getsockname()[1]
        soc.close()
        return [port, 8081, 8788, 8091, 8098]
