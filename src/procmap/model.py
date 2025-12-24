class Process:
    def __init__(self, pid: int):
        self.pid = pid
        self.parent_pid: int | None = None
        self.user: str | None = None
        self.command: str | None = None
        self.name: str | None = None
        self.cpu_user: float | None = None
        self.cpu_system: float | None = None
        self.environment: dict[str, str] | None = None

    def __repr__(self) -> str:
        return f"Process(pid={self.pid}, user={self.user}, name={self.name})"


# sample
# COMMAND   PID   USER   FD   TYPE DEVICE SIZE/OFF    NODE NAME
# python  26688 eugene    6w  FIFO   0,14      0t0   81903 pipe
class ProcessOpenFile:
    def __init__(self, fd: int, file_type: str, name: str):
        self.fd: int = fd
        self.file_type: str = file_type
        self.name: str = name
        self.node: str | None = None
        self.mode: str | None = None

    def __repr__(self) -> str:
        return (
            f"ProcessOpenFile(fd={self.fd}, type={self.file_type}, "
            f"node={self.node}, name={self.name}, mode={self.mode})"
        )


class UnixDomainSocketProcRef:
    def __init__(self, pid: int):
        self.pid = pid
        self.name: str | None = None
        self.fd: int | None = None

    def __repr__(self):
        return f"ProcRef(pid={self.pid}, name={self.name}, fd={self.fd})"


class UnixDomainSocket:
    def __init__(self, local_inode: int, peer_inode: int):
        self.local_inode: int = local_inode
        self.peer_inode: int = peer_inode
        self.local_path: str | None = None
        self.peer_path: str | None = None
        self.processes: list[UnixDomainSocketProcRef] = []
        self.state: str | None = None
        self.uds_type: str | None = None

    def __repr__(self):
        return (
            f"UnixDomainSocket(local={self.local_inode}, peer={self.peer_inode}, "
            f"state={self.state}, uds_type={self.uds_type}, "
            f"local_path={self.local_path}, peer_path={self.peer_path}, "
            f"processes={self.processes})"
        )


class UnixDomainSocketConnection:
    def __init__(self, socket1: UnixDomainSocket, socket2: UnixDomainSocket):
        self.socket1 = socket1
        self.socket2 = socket2


class PipeConnection:
    def __init__(self, node: int, write_pid: int, read_pid: int):
        self.node = node
        self.write_pid = write_pid
        self.read_pid: int = read_pid
        self.write_open_file: ProcessOpenFile | None = None
        self.read_open_file: ProcessOpenFile | None = None


class LocalInterface:
    def __init__(self, name: str, address: str):
        self.name = name
        self.address = address


class SocketAddress:
    def __init__(self, ip: str, port: int):
        self.ip = ip
        self.port = port

    def __hash__(self):
        return hash(self.ip) ^ hash(self.port)

    def __eq__(self, value: object) -> bool:
        if not isinstance(value, SocketAddress):
            raise NotImplementedError
        return self.ip == value.ip and self.port == value.port

    def __repr__(self):
        return f"SocketAddress({self.ip}, {self.port})"


# NOTE: models LISTEN sockets as well
class NetConnection:
    def __init__(
        self,
        pid: int,
        local_address: SocketAddress,
        remote_address: SocketAddress | None,
        socket_type: str,
        state: str,
    ) -> None:
        self.pid: int = pid
        self.local_address: SocketAddress = local_address
        self.remote_address: SocketAddress | None = remote_address
        self.socket_type: str = socket_type
        self.state: str = state

    def connection_id(self) -> str:
        if not self.remote_address:
            return f"{self.socket_type}::{self.local_address.ip}:{self.local_address.port}"
        return f"{self.socket_type}::{self.local_address.ip}:{self.local_address.port}::{self.remote_address.ip}:{self.remote_address.port}"
