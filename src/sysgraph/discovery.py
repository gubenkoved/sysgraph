import logging
import os
import re
import subprocess
import sys
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import psutil

from sysgraph.constants import (
    EDGE_CHILD_PROCESS,
    EDGE_EXTERNAL_SOCKET,
    EDGE_PIPE,
    EDGE_SOCKET,
    EDGE_SOCKET_CONNECTION,
    EDGE_UDS,
    EDGE_UDS_CONNECTION,
    NODE_EXTERNAL_IP,
    NODE_PIPE,
    NODE_PROCESS,
    NODE_SOCKET,
    NODE_UDS,
    external_ip_node_id,
    pipe_node_id,
    process_node_id,
    socket_node_id,
    uds_node_id,
)
from sysgraph.graph import Graph, Node
from sysgraph.model import (
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

    attrs = [
        "pid",
        "ppid",
        "username",
        "cmdline",
        "name",
        "cpu_times",
        "environ",
    ]
    for proc in psutil.process_iter(attrs):
        info = proc.info

        p = Process(pid=info["pid"])
        p.parent_pid = info["ppid"]
        p.user = info["username"]
        p.command = " ".join(info["cmdline"]) if info["cmdline"] else None
        p.name = info.get("name")

        cpu_times = info.get("cpu_times")
        if cpu_times:
            p.cpu_user = cpu_times.user
            p.cpu_system = cpu_times.system

        mem_info = proc.memory_info()
        if mem_info:
            p.memory_rss = mem_info.rss
            p.memory_vms = mem_info.vms
            p.memory_shared = getattr(mem_info, "shared", None)

        p.environment = info.get("environ")

        processes.append(p)

    return processes


def discover_unix_sockets() -> list[UnixDomainSocket]:
    """Discover Unix Domain Sockets by parsing ``ss -xp`` output.

    This is a Linux-only feature.  On other platforms an empty list is
    returned without raising an error.

    Returns:
        list[UnixDomainSocket]: Discovered UDS sockets.
    """
    if sys.platform != "linux":
        LOGGER.debug("UDS discovery skipped (only supported on Linux)")
        return []

    result = subprocess.run(
        ["ss", "-xp"], capture_output=True, text=True, check=False
    )

    sockets = []

    # example line:
    # users:(("dbus-daemon",pid=1950,fd=12))
    def parse_proccess(
        s: str,
    ) -> list[UnixDomainSocketProcRef]:
        processes = []

        for match in re.finditer(
            r'\("(?P<name>[^"]+)",pid=(?P<pid>[0-9]+),'
            r"fd=(?P<fd>[0-9]+)\)",
            s,
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

    Each connection will have two UDS sockets with opposite local/peer
    inodes.

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
            if (
                uds.local_inode,
                uds.peer_inode,
            ) not in visited and (
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
    """Read open file descriptors from /proc to discover pipes.

    This is a Linux-only feature that reads ``/proc/[pid]/fd`` and
    ``/proc/[pid]/fdinfo``.  On other platforms an empty mapping is
    returned without raising an error.
    """
    result_map: dict[int, list[ProcessOpenFile]] = defaultdict(list)

    if sys.platform != "linux":
        LOGGER.debug("pipe discovery skipped (only supported on Linux)")
        return result_map

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


def _add_process_nodes(
    graph: Graph,
    processes: list[Process],
) -> dict[int, Node]:
    """Create process nodes and parent-child edges."""
    pid_to_node: dict[int, Node] = {}

    for proc in processes:
        node = graph.add_node(
            process_node_id(proc.pid),
            NODE_PROCESS,
            properties={
                "pid": proc.pid,
                "command": proc.command,
                "user": proc.user,
                "name": proc.name,
                "cpu_user": proc.cpu_user,
                "cpu_system": proc.cpu_system,
                "memory_rss": proc.memory_rss,
                "memory_vms": proc.memory_vms,
                "memory_shared": proc.memory_shared,
                "environment": proc.environment,
            },
        )
        pid_to_node[proc.pid] = node

    for proc in processes:
        if proc.parent_pid is None:
            continue
        parent_node = pid_to_node.get(proc.parent_pid)
        if parent_node is not None:
            graph.add_edge(
                source_id=parent_node.id,
                target_id=pid_to_node[proc.pid].id,
                rel_type=EDGE_CHILD_PROCESS,
            )

    return pid_to_node


def _add_uds_nodes(
    graph: Graph,
    uds_sockets: list[UnixDomainSocket],
    pid_to_node: dict[int, Node],
    discover_connectivity: bool,
) -> None:
    """Create UDS nodes, process→UDS edges, and UDS connection edges."""
    uds_node_map: dict[int, Node] = {}

    def ensure_uds_node(uds_socket: UnixDomainSocket) -> Node:
        inode = uds_socket.local_inode
        if inode in uds_node_map:
            return uds_node_map[inode]

        if uds_socket.local_path and uds_socket.local_path != "*":
            label = uds_socket.local_path.rstrip("@")
        else:
            label = f"uds:[{inode}]"

        node = graph.add_node(
            uds_node_id(str(inode)),
            NODE_UDS,
            properties={
                "label": label,
                "local_inode": uds_socket.local_inode,
                "local_address": uds_socket.local_path,
                "peer_inode": uds_socket.peer_inode,
                "peer_address": uds_socket.peer_path,
                "state": uds_socket.state,
                "uds_type": uds_socket.uds_type,
            },
        )
        uds_node_map[inode] = node
        return node

    uds_process_edges: set[tuple[int, int]] = set()

    for uds_socket in uds_sockets:
        uds_node = ensure_uds_node(uds_socket)
        for p_ref in uds_socket.processes:
            edge_key = (p_ref.pid, uds_socket.local_inode)
            if p_ref.pid in pid_to_node and edge_key not in uds_process_edges:
                uds_process_edges.add(edge_key)
                graph.add_edge(
                    source_id=pid_to_node[p_ref.pid].id,
                    target_id=uds_node.id,
                    rel_type=EDGE_UDS,
                    properties={
                        "label": f"uds (fd={p_ref.fd})",
                        "fd": p_ref.fd,
                    },
                )

    if discover_connectivity:
        for con in discover_connected_uds(uds_sockets):
            uds_node1 = ensure_uds_node(con.socket1)
            uds_node2 = ensure_uds_node(con.socket2)
            graph.add_edge(
                uds_node1.id,
                uds_node2.id,
                EDGE_UDS_CONNECTION,
                properties={
                    "directional": False,
                    "dashed": True,
                },
            )


def _add_pipe_nodes(
    graph: Graph,
    open_files_map: dict[int, list[ProcessOpenFile]],
    pid_to_node: dict[int, Node],
) -> None:
    """Create pipe nodes and directional pipe edges."""
    pipe_nodes: dict[str, Node] = {}

    def ensure_pipe_node(file_node: str) -> Node:
        if file_node not in pipe_nodes:
            pipe_nodes[file_node] = graph.add_node(
                pipe_node_id(file_node),
                NODE_PIPE,
                properties={"label": f"pipe:[{file_node}]"},
            )
        return pipe_nodes[file_node]

    for pid, files in open_files_map.items():
        if pid not in pid_to_node:
            continue
        process_node = pid_to_node[pid]
        for file in files:
            if file.file_type != "FIFO":
                continue
            node = ensure_pipe_node(file.node)
            props = {
                "label": f"pipe (fd={file.fd})",
                "fd": file.fd,
                "mode": file.mode,
            }
            if file.mode == "r":
                graph.add_edge(
                    source_id=node.id,
                    target_id=process_node.id,
                    rel_type=EDGE_PIPE,
                    properties=props,
                )
            else:
                graph.add_edge(
                    source_id=process_node.id,
                    target_id=node.id,
                    rel_type=EDGE_PIPE,
                    properties=props,
                )


_SIMPLE_SOCKET_TYPE = {
    "SOCK_DGRAM": "UDP",
    "SOCK_STREAM": "TCP",
}


def _add_network_nodes(
    graph: Graph,
    processes: list[Process],
    all_net_connections: dict[int, list[NetConnection]],
    pid_to_node: dict[int, Node],
) -> None:
    """Create socket/external-IP nodes and their edges."""
    sock_to_pids: dict[tuple[SocketAddress, str], list[int]] = {}
    sock_to_node: dict[tuple[SocketAddress, str], Node] = {}
    connected_sockets: set[tuple[str, ...]] = set()

    def is_ipv6(address: str) -> bool:
        return ":" in address

    def ensure_socket(
        address: SocketAddress, sock_type: str, state: str
    ) -> Node:
        key = (address, sock_type)
        if key in sock_to_node:
            return sock_to_node[key]

        node = graph.add_node(
            socket_node_id(str(address), sock_type),
            NODE_SOCKET,
        )
        simple = _SIMPLE_SOCKET_TYPE.get(sock_type, sock_type)
        if is_ipv6(address.ip):
            node.properties["label"] = (
                f"[{address.ip}]:{address.port} ({simple})"
            )
        else:
            node.properties["label"] = (
                f"{address.ip}:{address.port} ({simple})"
            )
        node.properties["state"] = state
        node.properties["socket_type"] = sock_type
        sock_to_node[key] = node
        return node

    def ensure_sockets_connected(s1: Node, s2: Node) -> None:
        key = tuple(sorted([s1.id, s2.id]))
        if key in connected_sockets:
            return
        connected_sockets.add(key)
        graph.add_edge(
            s1.id,
            s2.id,
            EDGE_SOCKET_CONNECTION,
            {"directional": False, "dashed": True},
        )

    for proc in processes:
        net_connections = all_net_connections.get(proc.pid, [])
        if not net_connections:
            continue
        proc_node = pid_to_node.get(proc.pid)
        if proc_node is None:
            continue

        for net_con in net_connections:
            sock_key = (
                net_con.local_address,
                net_con.socket_type,
            )
            local_socket = ensure_socket(
                net_con.local_address,
                net_con.socket_type,
                net_con.state,
            )

            if proc.pid not in sock_to_pids.get(sock_key, []):
                sock_to_pids[sock_key] = sock_to_pids.get(sock_key, []) + [
                    proc.pid
                ]
                graph.add_edge(
                    source_id=proc_node.id,
                    target_id=local_socket.id,
                    rel_type=EDGE_SOCKET,
                )
                if net_con.remote_address:
                    remote_socket = ensure_socket(
                        net_con.remote_address,
                        net_con.socket_type,
                        net_con.state,
                    )
                    ensure_sockets_connected(local_socket, remote_socket)

    # sockets not connected to any process are remote endpoints
    external_ip_nodes: dict[str, Node] = {}

    for sock_key, sock_node in sock_to_node.items():
        if sock_to_pids.get(sock_key):
            continue
        ip = sock_key[0].ip
        if ip not in external_ip_nodes:
            external_ip_nodes[ip] = graph.add_node(
                external_ip_node_id(ip),
                NODE_EXTERNAL_IP,
                {"label": ip},
            )
        graph.add_edge(
            external_ip_nodes[ip].id,
            sock_node.id,
            EDGE_EXTERNAL_SOCKET,
        )


def build_graph(discover_uds_connectivity: bool = True) -> Graph:
    started_at = time.monotonic()

    graph = Graph()

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

    pid_to_node = _add_process_nodes(graph, processes)
    _add_uds_nodes(graph, uds, pid_to_node, discover_uds_connectivity)
    _add_pipe_nodes(graph, open_files_map, pid_to_node)
    _add_network_nodes(graph, processes, all_net_connections, pid_to_node)

    LOGGER.info(
        f"discovery completed in {time.monotonic() - started_at:.2f} seconds"
    )

    return graph
