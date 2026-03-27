import logging
import os
import re
import subprocess
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from socket import AddressFamily

import psutil

from procmap.graph import Graph, Node
from procmap.model import (
    NetConnection,
    Process,
    ProcessOpenFile,
    SocketAddress,
    UnixDomainSocket,
    UnixDomainSocketConnection,
    UnixDomainSocketProcRef,
)

LOGGER = logging.getLogger(__name__)


def discover_processes() -> list[Process]:
    processes = []

    attrs = ["pid", "ppid", "username", "cmdline", "name", "cpu_times", "environ"]
    for proc in psutil.process_iter(attrs):
        info = proc.info
        p = Process(pid=info["pid"])
        p.parent_pid = info["ppid"]
        p.user = info["username"]
        p.command = (
            " ".join(info["cmdline"]) if info["cmdline"] else None
        )
        p.name = info.get("name")

        cpu_times = info.get("cpu_times")
        if cpu_times:
            p.cpu_user = cpu_times.user
            p.cpu_system = cpu_times.system

        p.environment = info.get("environ")

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


def get_processes_open_files() -> dict[int, list[ProcessOpenFile]]:
    """Read open file descriptors directly from /proc instead of spawning lsof."""
    result_map: dict[int, list[ProcessOpenFile]] = defaultdict(list)
    proc_path = Path("/proc")

    for pid_dir in proc_path.iterdir():
        if not pid_dir.name.isdigit():
            continue
        pid = int(pid_dir.name)
        fd_dir = pid_dir / "fd"
        try:
            fd_entries = list(fd_dir.iterdir())
        except (PermissionError, OSError):
            continue

        for fd_entry in fd_entries:
            if not fd_entry.name.isdigit():
                continue
            try:
                target = os.readlink(fd_entry)
            except (PermissionError, OSError):
                continue

            # only collect pipes (the only type used downstream)
            if not target.startswith("pipe:"):
                continue

            fd_num = int(fd_entry.name)
            # extract inode from "pipe:[12345]"
            inode = target[6:-1]

            # read mode from /proc/[pid]/fdinfo/[fd]
            mode = None
            try:
                fdinfo = (pid_dir / "fdinfo" / fd_entry.name).read_text()
                for line in fdinfo.splitlines():
                    if line.startswith("flags:"):
                        flags = int(line.split(":", 1)[1].strip(), 8)
                        access = flags & 0o3
                        mode = "r" if access == 0o0 else "w"
                        break
            except (PermissionError, OSError):
                pass

            open_file = ProcessOpenFile(fd_num, "FIFO", target)
            open_file.node = inode
            open_file.mode = mode
            result_map[pid].append(open_file)

    return result_map


def get_net_connections(pid: int) -> list[NetConnection]:
    proc = psutil.Process(pid)
    connections: list[NetConnection] = []
    for pcon in proc.net_connections(kind="all"):
        if pcon.family not in (AddressFamily.AF_INET, AddressFamily.AF_INET6):
            continue
        connections.append(
            NetConnection(
                pid=pid,
                local_address=SocketAddress(pcon.laddr.ip, pcon.laddr.port),
                remote_address=SocketAddress(pcon.raddr.ip, pcon.raddr.port)
                if pcon.raddr
                else None,
                socket_type=pcon.type.name,
                state=pcon.status,
            )
        )
    return connections


def get_all_net_connections() -> dict[int, list[NetConnection]]:
    """Fetch all network connections system-wide in a single call."""
    result: dict[int, list[NetConnection]] = defaultdict(list)
    for pcon in psutil.net_connections(kind="inet"):
        if pcon.pid is None:
            continue
        result[pcon.pid].append(
            NetConnection(
                pid=pcon.pid,
                local_address=SocketAddress(pcon.laddr.ip, pcon.laddr.port),
                remote_address=SocketAddress(pcon.raddr.ip, pcon.raddr.port)
                if pcon.raddr
                else None,
                socket_type=pcon.type.name,
                state=pcon.status,
            )
        )
    return result


def build_graph() -> Graph:
    graph = Graph()

    pid_to_node: dict[int, Node] = {}

    # run independent discovery steps in parallel (all I/O-bound)
    with ThreadPoolExecutor() as executor:
        processes_future = executor.submit(discover_processes)
        uds_future = executor.submit(discover_unix_sockets)
        open_files_future = executor.submit(get_processes_open_files)
        net_connections_future = executor.submit(get_all_net_connections)

        processes = processes_future.result()
        uds = uds_future.result()
        open_files_map = open_files_future.result()
        all_net_connections = net_connections_future.result()

    for proc in processes:
        proc_node_id = f"process::{proc.pid}"
        node = graph.add_node(
            proc_node_id,
            "process",
            properties={
                "pid": proc.pid,
                "command": proc.command,
                "user": proc.user,
                "name": proc.name,
                "cpu_user": proc.cpu_user,
                "cpu_system": proc.cpu_system,
                "environment": proc.environment,
            },
        )
        pid_to_node[proc.pid] = node

    # add parent-child relationships
    for proc in processes:
        proc_node = pid_to_node[proc.pid]
        parent_proc_node = None
        if proc.parent_pid is not None:
            parent_proc_node = pid_to_node.get(proc.parent_pid)
        if parent_proc_node is not None:
            _ = graph.add_edge(
                source_id=parent_proc_node.id,
                target_id=proc_node.id,
                rel_type="child_process",
            )

    for con in discover_connected_uds(uds):
        for p1_ref in con.socket1.processes:
            pid1 = p1_ref.pid
            if pid1 not in pid_to_node:
                continue
            for p2_ref in con.socket2.processes:
                pid2 = p2_ref.pid
                if pid2 not in pid_to_node:
                    continue
                _ = graph.add_edge(
                    source_id=pid_to_node[pid1].id,
                    target_id=pid_to_node[pid2].id,
                    rel_type="unix_domain_socket",
                    properties={
                        "directional": False,
                        "inodes": (
                            con.socket1.local_inode,
                            con.socket1.peer_inode,
                        ),
                        "paths": (
                            con.socket1.local_path,
                            con.socket2.peer_path,
                        ),
                    },
                )

    pipe_node_to_node = {}

    def ensure_pipe_node(file_node):
        if file_node not in pipe_node_to_node:
            pipe_node_to_node[file_node] = graph.add_node(
                f"pipe::{file_node}",
                "pipe",
                properties={
                    "label": f"pipe:[{file_node}]",
                },
            )
        return pipe_node_to_node[file_node]

    for pid, files in open_files_map.items():
        if pid not in pid_to_node:
            continue
        process_node = pid_to_node[pid]
        for file in files:
            # so far just show the pipes
            if file.file_type != "FIFO":
                continue
            node = ensure_pipe_node(file.node)

            if file.mode == "r":
                _ = graph.add_edge(
                    source_id=node.id,
                    target_id=process_node.id,
                    rel_type="pipe",
                    properties={
                        "label": f"pipe (fd={file.fd})",
                        "fd": file.fd,
                        "mode": file.mode,
                    },
                )
            else:
                _ = graph.add_edge(
                    source_id=process_node.id,
                    target_id=node.id,
                    rel_type="pipe",
                    properties={
                        "label": f"pipe (fd={file.fd})",
                        "fd": file.fd,
                        "mode": file.mode,
                    },
                )

    socket_to_pids: dict[tuple[SocketAddress, str], list[int]] = {}
    socket_to_node: dict[tuple[SocketAddress, str], Node] = {}

    def is_ipv6(address: str) -> bool:
        return ":" in address

    def ensure_socket(address: SocketAddress, socket_type, state: str):
        key = (address, socket_type)
        if key in socket_to_node:
            return socket_to_node[key]
        socket_node_id = f"socket::{address}::{socket_type}"
        socket_node = graph.add_node(socket_node_id, "socket")

        simple_socket_type = {
            "SOCK_DGRAM": "UDP",
            "SOCK_STREAM": "TCP",
        }

        simple_type = simple_socket_type.get(socket_type, socket_type)

        if is_ipv6(address.ip):
            socket_node.properties["label"] = (
                f"[{address.ip}]:{address.port} ({simple_type})"
            )
        else:
            socket_node.properties["label"] = (
                f"{address.ip}:{address.port} ({simple_type})"
            )

        socket_node.properties["state"] = state
        socket_node.properties["socket_type"] = socket_type

        socket_to_node[key] = socket_node
        return socket_node

    connected_sockets = set()

    def ensure_sockets_connected(socket1: Node, socket2: Node):
        key = tuple(sorted([socket1.id, socket2.id]))
        if key in connected_sockets:
            return
        connected_sockets.add(key)
        _ = graph.add_edge(
            socket1.id,
            socket2.id,
            "socket_connection",
            {
                "directional": False,
                "dashed": True,
            },
        )

    for proc in processes:
        net_connections = all_net_connections.get(proc.pid, [])
        if not net_connections:
            continue
        proc_node = pid_to_node.get(proc.pid)
        if proc_node is None:
            continue

        for net_con in net_connections:
            socket_id = (net_con.local_address, net_con.socket_type)

            # ensure socket in graph
            local_socket = ensure_socket(
                net_con.local_address,
                net_con.socket_type,
                net_con.state,
            )

            # process connection
            if proc.pid not in socket_to_pids.get(socket_id, []):
                socket_to_pids[socket_id] = socket_to_pids.get(
                    socket_id, []
                ) + [proc.pid]
                graph.add_edge(
                    source_id=proc_node.id,
                    target_id=local_socket.id,
                    rel_type="socket",
                )

                if net_con.remote_address:
                    remote_socket = ensure_socket(
                        net_con.remote_address,
                        net_con.socket_type,
                        net_con.state,
                    )
                    ensure_sockets_connected(local_socket, remote_socket)

    # post-process all sockets which are NOT connected to any process -- these
    # are remote endpoints, group the by IP address
    external_ip_to_node = {}

    def ensure_external_ip(address):
        if address not in external_ip_to_node:
            external_ip_to_node[address] = graph.add_node(
                f"external_ip::{address}",
                "external_ip",
                {
                    "label": address,
                },
            )
        return external_ip_to_node[address]

    for socket, socket_node in socket_to_node.items():
        pids = socket_to_pids.get(socket)

        if pids:
            continue

        external_ip = socket[0].ip
        external_ip_node = ensure_external_ip(external_ip)

        # add connection
        graph.add_edge(
            external_ip_node.id,
            socket_node.id,
            "external_socket",
        )

    return graph
