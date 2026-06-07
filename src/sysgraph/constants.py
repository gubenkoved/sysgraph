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


def uds_node_id(key: str) -> str:
    return f"{NODE_UDS}::{key}"


def pipe_node_id(inode: str) -> str:
    return f"{NODE_PIPE}::{inode}"


def socket_node_id(address: str, socket_type: str) -> str:
    return f"{NODE_SOCKET}::{address}::{socket_type}"


def external_ip_node_id(ip: str) -> str:
    return f"{NODE_EXTERNAL_IP}::{ip}"


# -- Display settings --
# the backend drives the UI display identity (colors/widths) via the graph's
# "display" block, so the frontend no longer hardcodes a process-map palette

# default link opacity must match the frontend's defaultLinkOpacity
_LINK_OPACITY = 0.5


def hex_to_rgba(hex_color: str, alpha: float) -> dict[str, float]:
    value = hex_color.lstrip("#")
    if len(value) == 3:
        value = "".join(ch * 2 for ch in value)
    if len(value) != 6:
        raise ValueError(f"unsupported hex color: {hex_color}")
    return {
        "r": int(value[0:2], 16),
        "g": int(value[2:4], 16),
        "b": int(value[4:6], 16),
        "a": alpha,
    }


_NODE_COLOR_HEXES = {
    NODE_PROCESS: "#157fc8",
    NODE_SOCKET: "#dc4b2f",
    NODE_UDS: "#36bc7b",
    NODE_PIPE: "#a939f9",
    NODE_EXTERNAL_IP: "#ff6700",
}

_EDGE_COLOR_HEXES = {
    EDGE_UDS: "#1b7c4d",
    EDGE_UDS_CONNECTION: "#1b7c4d",
    EDGE_PIPE: "#cf6eff",
    EDGE_SOCKET_CONNECTION: "#ff4c28",
    EDGE_SOCKET: "#ff4c28",
    EDGE_CHILD_PROCESS: "#282828",
}

_EDGE_WIDTHS = {
    EDGE_CHILD_PROCESS: 1,
    EDGE_PIPE: 1,
    EDGE_SOCKET: 1,
    EDGE_SOCKET_CONNECTION: 1,
    EDGE_UDS: 1,
    EDGE_UDS_CONNECTION: 1,
}


def default_display() -> dict:
    """Display-settings override the backend embeds into the process graph.

    Mirrors a partial settings snapshot consumed by the frontend (same shape
    as a settings preset): per-type node/edge colors and edge widths.
    """
    return {
        "nodeColors": {
            node_type: hex_to_rgba(hex_color, 1.0)
            for node_type, hex_color in _NODE_COLOR_HEXES.items()
        },
        "edgeColors": {
            edge_type: hex_to_rgba(hex_color, _LINK_OPACITY)
            for edge_type, hex_color in _EDGE_COLOR_HEXES.items()
        },
        "edgeWidths": dict(_EDGE_WIDTHS),
    }
