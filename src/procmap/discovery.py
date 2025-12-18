import logging
import re
import subprocess

import psutil

from procmap.model import Process, UnixDomainSocket, UnixDomainSocketProcRef

LOGGER = logging.getLogger(__name__)


def discover_processes() -> list[Process]:
    processes = []

    for proc in psutil.process_iter(["pid", "username", "cmdline"]):
        p = Process(pid=proc.info["pid"])
        p.user = proc.info["username"]
        p.command = (
            " ".join(proc.info["cmdline"]) if proc.info["cmdline"] else None
        )
        processes.append(p)

    return processes


def discover_unix_sockets() -> list[UnixDomainSocket]:
    result = subprocess.run(
        ["ss", "-xp"], capture_output=True, text=True, check=False
    )

    sockets = []

    # example line:
    # users:(("dbus-daemon",pid=1950,fd=12))
    def parse_proccess(s: str) -> list[UnixDomainSocketProcRef]:
        processes = []

        for match in re.finditer(
            r'\("(?P<name>[^"]+)",pid=(?P<pid>[0-9]+),fd=(?P<fd>[0-9]+)\)', s
        ):
            ref = UnixDomainSocketProcRef(pid=int(match.group("pid")))
            ref.name = match.group("name")
            ref.fd = int(match.group("fd"))
            processes.append(ref)

        return processes

    for line in result.stdout.splitlines()[1:]:
        segments = line.split(" ")
        segments = [s for s in segments if s]

        uds = UnixDomainSocket(
            local_inode=int(segments[5]),
            peer_inode=int(segments[7]),
        )
        uds.local_path = segments[4]
        uds.peer_path = segments[6]

        if len(segments) > 8:
            uds.processes = parse_proccess(segments[8])

        uds.state = segments[1]
        uds.type = segments[0]

        sockets.append(uds)

    LOGGER.info(f"found {len(sockets)} UDS")

    return sockets
