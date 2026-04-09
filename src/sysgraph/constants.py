# -- Node types --
NODE_PROCESS = "process"
NODE_PIPE = "pipe"
NODE_SOCKET = "socket"
NODE_UDS = "uds"
NODE_EXTERNAL_IP = "external_ip"

# -- Edge types --
EDGE_CHILD_PROCESS = "child_process"
EDGE_UDS = "uds"
EDGE_UDS_CONNECTION = "uds_connection"
EDGE_PIPE = "pipe"
EDGE_SOCKET = "socket"
EDGE_SOCKET_CONNECTION = "socket_connection"
EDGE_EXTERNAL_SOCKET = "external_socket"


# -- Node ID helpers --
def process_node_id(pid: int) -> str:
    return f"{NODE_PROCESS}::{pid}"


def uds_node_id(inode: int) -> str:
    return f"{NODE_UDS}::{inode}"


def pipe_node_id(inode: str) -> str:
    return f"{NODE_PIPE}::{inode}"


def socket_node_id(address: str, socket_type: str) -> str:
    return f"{NODE_SOCKET}::{address}::{socket_type}"


def external_ip_node_id(ip: str) -> str:
    return f"{NODE_EXTERNAL_IP}::{ip}"
