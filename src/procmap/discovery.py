import logging
import re
import subprocess

import psutil
from collections import defaultdict
from socket import AddressFamily

from procmap.model import (
    Process,
    UnixDomainSocket,
    UnixDomainSocketProcRef,
    UnixDomainSocketConnection,
    ProcessOpenFile,
    SocketAddress,
    NetConnection,
)
from procmap.graph import Graph, Node

LOGGER = logging.getLogger(__name__)


def discover_processes() -> list[Process]:
    processes = []

    # include 'name' so we can expose the executable name (e.g. 'python', 'bash')
    for proc in psutil.process_iter(["pid", "username", "cmdline", "name"]):
        p = Process(pid=proc.info["pid"])
        p.parent_pid = proc.ppid()
        p.user = proc.info["username"]
        p.command = (
            " ".join(proc.info["cmdline"]) if proc.info["cmdline"] else None
        )
        p.name = proc.info.get("name")

        cpu_times = proc.cpu_times()
        p.cpu_user = cpu_times.user
        p.cpu_system = cpu_times.system

        try:
            p.environment = proc.environ()
        except (psutil.AccessDenied, psutil.ZombieProcess):
            p.environment = None

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
    result = subprocess.run(
        [
            "lsof",
            "-nP",
            "-Ki",  # suppress duplicates per each thread
            "-Fpfnita",  # use machine parsable output
        ],
        capture_output=True,
        text=True,
        check=False,
    )

    result_map: dict[int, list[ProcessOpenFile]] = defaultdict(list)

    pid = None
    file_tags: dict[str, str] = {}

    fd_re = re.compile(r'^[0-9]+$')

    def handle_buffer():
        if not fd_re.match(file_tags['f']):
            return
        open_file = ProcessOpenFile(
            int(file_tags['f']),
            file_tags['t'],
            file_tags.get('n')
        )
        open_file.mode = file_tags.get('a')
        open_file.node = file_tags.get('i')
        result_map[pid].append(open_file)

    for line in result.stdout.splitlines():
        tag = line[0]
        value = line[1:]

        if tag == 'p':
            pid = int(value)
            if file_tags:
                handle_buffer()
        elif tag == 'f':
            if file_tags:
                handle_buffer()
            file_tags = {}
            file_tags['f'] = value
        else:
            file_tags[tag] = value

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


# TODO: add TCP connections (support local process, external process)
def build_graph() -> Graph:
    graph = Graph()

    pid_to_node: dict[int, Node] = {}

    processes = discover_processes()
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
                    properties={
                        "directional": False,
                    },
                )

    # capture open file descriptors
    open_files_map = get_processes_open_files()

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
                )
            else:
                _ = graph.add_edge(
                    source_id=process_node.id,
                    target_id=node.id,
                    rel_type="pipe",
                )

    socket_to_process: dict[tuple[SocketAddress, str], int] = {}
    socket_to_node: dict[tuple[SocketAddress, str], Node] = {}

    def is_ipv6(address: str) -> bool:
        return ':' in address

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
        try:
            net_connections = get_net_connections(proc.pid)
            proc_node = pid_to_node[proc.pid]

            for net_con in net_connections:
                socket_id = (net_con.local_address, net_con.socket_type)
                socket_to_process[socket_id] = proc.pid

                # add sockets to graph
                local_socket = ensure_socket(
                    net_con.local_address,
                    net_con.socket_type,
                    net_con.state,
                )

                # process connection
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
        except Exception as err:
            LOGGER.warning(
                "error processing connections for PID %d: %s", proc.pid, err
            )

    return graph
