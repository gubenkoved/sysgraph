import abc


class BaseObject(abc.ABC):
    @abc.abstractmethod
    def identity(self) -> str:
        raise NotImplementedError

    @abc.abstractmethod
    def object_type(self) -> str:
        raise NotImplementedError

    def as_json(self) -> dict:
        data = self.__dict__.copy()
        data["identity"] = self.identity()
        data["type"] = self.object_type()
        return data


class Process(BaseObject):
    def __init__(self, pid: int):
        self.pid = pid
        self.user: str | None = None
        self.command: str | None = None
        self.executable: str | None = None  # name of the executable (e.g. 'python')

    def __repr__(self) -> str:
        return f"Process(pid={self.pid}, user={self.user}, executable={self.executable}, command={self.command})"

    def identity(self):
        return str(self.pid)

    def object_type(self):
        return "process"


class UnixDomainSocketProcRef:
    def __init__(self, pid: int):
        self.pid = pid
        self.name: str | None = None
        self.fd: int | None = None

    def __repr__(self):
        return f"ProcRef(pid={self.pid}, name={self.name}, fd={self.fd})"


class UnixDomainSocket(BaseObject):
    def __init__(self, local_inode: int, peer_inode: int):
        self.local_inode: int = local_inode
        self.peer_inode: int = peer_inode
        self.local_path: str | None = None
        self.peer_path: str | None = None
        self.processes: list[UnixDomainSocketProcRef] = []
        self.state: str | None = None
        self.uds_type: str | None = None

    def identity(self):
        return f"{self.local_inode} <-> {self.peer_inode}"

    def object_type(self):
        return "unix_domain_socket"

    def __repr__(self):
        return (
            f"UnixDomainSocket(local={self.local_inode}, peer={self.peer_inode}, "
            f"state={self.state}, uds_type={self.uds_type}, "
            f"local_path={self.local_path}, peer_path={self.peer_path}, "
            f"processes={self.processes})"
        )

class UnixDomainSocketConnection(BaseObject):
    def __init__(self, socket1: UnixDomainSocket, socket2: UnixDomainSocket):
        self.socket1 = socket1
        self.socket2 = socket2

    def identity(self):
        inodes = set()
        inodes.add(self.socket1.local_inode)
        inodes.add(self.socket1.peer_inode)
        inodes.add(self.socket2.local_inode)
        inodes.add(self.socket2.peer_inode)
        return ",".join(str(i) for i in sorted(inodes))

    def object_type(self):
        return "unix_domain_socket_connection"


class TcpConnection(BaseObject):
    pass


class PipeConnection(BaseObject):
    pass
