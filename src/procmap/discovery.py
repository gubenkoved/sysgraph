import logging
import re
import subprocess

import psutil

from procmap.model import (
    Process,
    UnixDomainSocket,
    UnixDomainSocketProcRef,
    UnixDomainSocketConnection,
    ProcessOpenFile,
)
from procmap.graph import Graph, Node

import jc

LOGGER = logging.getLogger(__name__)


def discover_processes() -> list[Process]:
    processes = []

    # include 'name' so we can expose the executable name (e.g. 'python', 'bash')
    for proc in psutil.process_iter(["pid", "username", "cmdline", "name"]):
        p = Process(pid=proc.info["pid"])
        p.user = proc.info["username"]
        p.command = (
            " ".join(proc.info["cmdline"]) if proc.info["cmdline"] else None
        )
        p.name = proc.info.get("name")
        processes.append(p)

    return processes


def discover_unix_sockets() -> list[UnixDomainSocket]:
    """Discover Unix Domain Sockets as reported by kernel.

    Note however that connection with UDS will have at least 2 records reported
    with opposite local/peer inodes. They can be further groupped to
    find connected pairs of processes.

    Returns:
        list[UnixDomainSocket]: _description_
    """
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
        uds.uds_type = segments[0]

        sockets.append(uds)

    LOGGER.info(f"found {len(sockets)} UDS")

    return sockets


def discover_connected_uds(
    sockets: list[UnixDomainSocket],
) -> list[UnixDomainSocketConnection]:
    """Discover connected UDS pairs from the list of discovered UDS sockets.

    Each connection will have two UDS sockets with opposite local/peer inodes.

    Args:
        sockets (list[UnixDomainSocket]): List of discovered UDS sockets.
    Returns:
        list[UnixDomainSocketConnection]: List of connected UDS pairs.
    """

    inode_map = {}
    for uds in sockets:
        inode_map[(uds.local_inode, uds.peer_inode)] = uds

    connections = []
    visited = set()

    for uds in sockets:
        if (uds.peer_inode, uds.local_inode) in inode_map:
            peer_uds = inode_map[(uds.peer_inode, uds.local_inode)]
            if (uds.local_inode, uds.peer_inode) not in visited and (
                uds.peer_inode,
                uds.local_inode,
            ) not in visited:
                connection = UnixDomainSocketConnection(
                    socket1=uds, socket2=peer_uds
                )
                connections.append(connection)
                visited.add((uds.local_inode, uds.peer_inode))
                visited.add((uds.peer_inode, uds.local_inode))

    LOGGER.info(f"found {len(connections)} connected UDS pairs")
    return connections


def get_process_open_files() -> dict[int, list[ProcessOpenFile]]:
    result = subprocess.run(
        ["lsof", "-nP"], capture_output=True, text=True, check=False
    )

    _ = jc.parse("lsof", result.stdout)

    return {}


# TODO: should we use all processes or should be process list be passed in?
# def discover_pipe_connections() -> list[PipeConnection]:
#     pass


def build_graph() -> Graph:
    graph = Graph()

    pid_to_node: dict[int, Node] = {}

    for proc in discover_processes():
        proc_node_id = f"process::{proc.pid}"
        node = graph.add_node(proc_node_id, "process")
        node.properties["pid"] = proc.pid
        node.properties["command"] = proc.command
        node.properties["user"] = proc.user
        node.properties["name"] = proc.name
        pid_to_node[proc.pid] = node

    uds = discover_unix_sockets()
    for con in discover_connected_uds(uds):
        for p1_ref in con.socket1.processes:
            pid1 = p1_ref.pid
            for p2_ref in con.socket2.processes:
                pid2 = p2_ref.pid
                _ = graph.add_edge(
                    source_id=pid_to_node[pid1].id,
                    target_id=pid_to_node[pid2].id,
                    rel_type="unix_domain_socket",
                )

    return graph
