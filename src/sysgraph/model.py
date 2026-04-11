from dataclasses import dataclass, field


@dataclass
class Process:
    pid: int
    parent_pid: int | None = None
    user: str | None = None
    command: str | None = None
    name: str | None = None
    cpu_user: float | None = None
    cpu_system: float | None = None
    memory_rss: int | None = None
    memory_vms: int | None = None
    memory_shared: int | None = None
    environment: dict[str, str] | None = None

    def __repr__(self) -> str:
        return f"Process(pid={self.pid}, user={self.user}, name={self.name})"


@dataclass
class ProcessOpenFile:
    fd: int
    file_type: str
    name: str
    node: str | None = None
    mode: str | None = None

    def __repr__(self) -> str:
        return (
            f"ProcessOpenFile(fd={self.fd}, type={self.file_type}, "
            f"node={self.node}, name={self.name}, mode={self.mode})"
        )


@dataclass
class UnixDomainSocketProcRef:
    pid: int
    name: str | None = None
    fd: int | None = None

    def __repr__(self):
        return f"ProcRef(pid={self.pid}, name={self.name}, fd={self.fd})"


@dataclass
class UnixDomainSocket:
    local_inode: int
    peer_inode: int
    local_path: str | None = None
    peer_path: str | None = None
    processes: list[UnixDomainSocketProcRef] = field(default_factory=list)
    state: str | None = None
    uds_type: str | None = None


@dataclass
class UnixDomainSocketConnection:
    socket1: UnixDomainSocket
    socket2: UnixDomainSocket


@dataclass(frozen=True)
class SocketAddress:
    ip: str
    port: int

    def __hash__(self):
        return hash((self.ip, self.port))

    def __eq__(self, value: object) -> bool:
        if not isinstance(value, SocketAddress):
            return NotImplemented
        return self.ip == value.ip and self.port == value.port

    def __repr__(self):
        return f"SocketAddress({self.ip}, {self.port})"


@dataclass
class NetConnection:
    """Models both LISTEN and connected sockets."""

    pid: int
    local_address: SocketAddress
    remote_address: SocketAddress | None
    socket_type: str
    state: str

    def connection_id(self) -> str:
        if not self.remote_address:
            return (
                f"{self.socket_type}::"
                f"{self.local_address.ip}:"
                f"{self.local_address.port}"
            )
        return (
            f"{self.socket_type}::"
            f"{self.local_address.ip}:"
            f"{self.local_address.port}::"
            f"{self.remote_address.ip}:"
            f"{self.remote_address.port}"
        )
