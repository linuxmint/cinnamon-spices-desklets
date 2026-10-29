#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later

import argparse
import datetime
import http.client
import json
import os
import sys
import threading
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed


SERVER_LIST_URL = "https://librespeed.org/backend-servers/servers.php"

USER_AGENT = "SpeedPup/0.1"
TIMEOUT = 15

PING_SAMPLES = 5
TEST_DURATION = 15
WORKERS = 3

DOWNLOAD_CHUNK_SIZE = 256 * 1024
UPLOAD_REQUEST_SIZE = 1024 * 1024
UPLOAD_CHUNK_SIZE = 64 * 1024


def endpoint_url(server, key, query=None):
    base = server["server"].rstrip("/") + "/"
    endpoint = urllib.parse.urljoin(base, server[key])

    if query:
        parsed = urllib.parse.urlsplit(endpoint)
        params = urllib.parse.parse_qs(parsed.query)
        params.update(query)

        endpoint = urllib.parse.urlunsplit(
            (
                parsed.scheme,
                parsed.netloc,
                parsed.path,
                urllib.parse.urlencode(
                    params,
                    doseq=True
                ),
                parsed.fragment
            )
        )

    return endpoint


def make_connection(url):
    parsed = urllib.parse.urlsplit(url)

    if parsed.scheme == "https":
        return http.client.HTTPSConnection(
            parsed.hostname,
            parsed.port,
            timeout=TIMEOUT
        )

    if parsed.scheme == "http":
        return http.client.HTTPConnection(
            parsed.hostname,
            parsed.port,
            timeout=TIMEOUT
        )

    raise ValueError(
        "Unsupported server URL scheme: %s"
        % parsed.scheme
    )


def request_path(url):
    parsed = urllib.parse.urlsplit(url)

    path = parsed.path or "/"

    if parsed.query:
        path += "?" + parsed.query

    return path


def fetch_servers():
    request = urllib.request.Request(
        SERVER_LIST_URL,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/json"
        }
    )

    with urllib.request.urlopen(
        request,
        timeout=TIMEOUT
    ) as response:
        servers = json.load(response)

    if not isinstance(servers, list):
        raise RuntimeError(
            "Speed test server list is invalid"
        )

    return servers


def ping_server(server, samples=PING_SAMPLES):
    url = endpoint_url(
        server,
        "pingURL"
    )

    path = request_path(url)
    connection = make_connection(url)

    results = []

    try:
        for _ in range(samples):
            start = time.monotonic()

            connection.request(
                "GET",
                path,
                headers={
                    "User-Agent": USER_AGENT,
                    "Accept-Encoding": "identity"
                }
            )

            response = connection.getresponse()
            response.read()

            if response.status != 200:
                raise RuntimeError(
                    "Ping endpoint returned HTTP %d"
                    % response.status
                )

            results.append(
                (time.monotonic() - start) * 1000
            )
    finally:
        connection.close()

    if len(results) > 1:
        results = results[1:]

    if not results:
        raise RuntimeError(
            "No ping samples returned"
        )

    return sum(results) / len(results)


def select_server(servers, server_id=None):
    if server_id is not None:
        for server in servers:
            try:
                current_id = int(server.get("id"))
            except (TypeError, ValueError):
                continue

            if current_id == server_id:
                ping = ping_server(server)
                return server, ping

        raise RuntimeError(
            "Speed test server %d was not found"
            % server_id
        )

    candidates = []

    def probe(server):
        return server, ping_server(
            server,
            samples=2
        )

    with ThreadPoolExecutor(
        max_workers=10
    ) as executor:
        futures = [
            executor.submit(probe, server)
            for server in servers
            if server.get("server")
            and server.get("pingURL")
        ]

        for future in as_completed(futures):
            try:
                server, ping = future.result()
            except Exception:
                continue

            candidates.append((ping, server))

    candidates.sort(
        key=lambda item: item[0]
    )

    for _probe_ping, server in candidates:
        try:
            ping = ping_server(server)
        except Exception:
            continue

        return server, ping

    raise RuntimeError(
        "No speed test server is currently available"
    )


def download_test(server):
    url = endpoint_url(
        server,
        "dlURL",
        {
            "ckSize": "100"
        }
    )

    path = request_path(url)

    total = 0
    total_lock = threading.Lock()

    start = time.monotonic()
    stop_at = start + TEST_DURATION

    def worker():
        nonlocal total

        while time.monotonic() < stop_at:
            connection = make_connection(url)

            try:
                connection.request(
                    "GET",
                    path,
                    headers={
                        "User-Agent": USER_AGENT,
                        "Accept-Encoding": "identity"
                    }
                )

                response = connection.getresponse()

                if response.status != 200:
                    return

                while (
                    time.monotonic()
                    < stop_at
                ):
                    chunk = response.read(
                        DOWNLOAD_CHUNK_SIZE
                    )

                    if not chunk:
                        break

                    with total_lock:
                        total += len(chunk)

            except Exception:
                pass
            finally:
                connection.close()

    threads = [
        threading.Thread(
            target=worker,
            daemon=True
        )
        for _ in range(WORKERS)
    ]

    for thread in threads:
        thread.start()

    for thread in threads:
        thread.join()

    return (
        total
        * 8
        / TEST_DURATION
        / 1_000_000
    )


def upload_test(server):
    url = endpoint_url(
        server,
        "ulURL"
    )

    path = request_path(url)

    payload = os.urandom(
        UPLOAD_REQUEST_SIZE
    )

    total = 0
    total_lock = threading.Lock()

    start = time.monotonic()
    stop_at = start + TEST_DURATION

    def worker():
        nonlocal total

        connection = make_connection(url)

        try:
            while (
                time.monotonic()
                < stop_at
            ):
                try:
                    connection.putrequest(
                        "POST",
                        path
                    )

                    connection.putheader(
                        "User-Agent",
                        USER_AGENT
                    )

                    connection.putheader(
                        "Accept-Encoding",
                        "identity"
                    )

                    connection.putheader(
                        "Content-Type",
                        "application/octet-stream"
                    )

                    connection.putheader(
                        "Content-Length",
                        str(
                            UPLOAD_REQUEST_SIZE
                        )
                    )

                    connection.endheaders()

                    offset = 0

                    while (
                        offset
                        < UPLOAD_REQUEST_SIZE
                    ):
                        if (
                            time.monotonic()
                            >= stop_at
                        ):
                            connection.close()
                            return

                        end = min(
                            offset
                            + UPLOAD_CHUNK_SIZE,
                            UPLOAD_REQUEST_SIZE
                        )

                        connection.send(
                            payload[offset:end]
                        )

                        with total_lock:
                            total += end - offset

                        offset = end

                    response = (
                        connection.getresponse()
                    )
                    response.read()

                except Exception:
                    connection.close()

                    if (
                        time.monotonic()
                        >= stop_at
                    ):
                        return

                    connection = (
                        make_connection(url)
                    )
        finally:
            connection.close()

    threads = [
        threading.Thread(
            target=worker,
            daemon=True
        )
        for _ in range(WORKERS)
    ]

    for thread in threads:
        thread.start()

    for thread in threads:
        thread.join()

    return (
        total
        * 8
        / TEST_DURATION
        / 1_000_000
    )


def run(server_id=None):
    servers = fetch_servers()

    server, ping = select_server(
        servers,
        server_id
    )

    download = download_test(server)
    upload = upload_test(server)

    result = {
        "timestamp": (
            datetime.datetime.now(
                datetime.timezone.utc
            )
            .isoformat()
            .replace("+00:00", "Z")
        ),
        "download": download,
        "upload": upload,
        "ping": ping,
        "server": {
            "id": server.get("id"),
            "name": server.get(
                "name",
                "--"
            )
        }
    }

    print(
        json.dumps(result),
        flush=True
    )


def main():
    parser = argparse.ArgumentParser(
        description=(
            "SpeedPup self-contained "
            "speed test helper"
        )
    )

    parser.add_argument(
        "--server",
        type=int,
        default=None,
        help="Speed test server ID"
    )

    # Accepted for compatibility with the previous
    # command-line interface. Output is always JSON.
    parser.add_argument(
        "--json",
        action="store_true",
        help=argparse.SUPPRESS
    )

    args = parser.parse_args()

    try:
        run(args.server)
    except Exception as error:
        print(
            "SpeedPup speed test error: %s"
            % error,
            file=sys.stderr
        )
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
