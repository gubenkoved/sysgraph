# TODO: add identity of the object as method
class BaseObject:
    pass


class Process(BaseObject):
    def __init__(self, pid: int):
        self.pid = pid
        self.user: str | None = None
        self.command: str | None = None

    def __repr__(self) -> str:
        return f"Process(pid={self.pid}, user={self.user}, command={self.command})"


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
        self.type: str | None = None

    def __repr__(self):
        return (
            f"UnixDomainSocket(local={self.local_inode}, peer={self.peer_inode}, "
            f"state={self.state}, type={self.type}, "
            f"local_path={self.local_path}, peer_path={self.peer_path}, "
            f"processes={self.processes})"
        )


class TcpConnection(BaseObject):
    pass


class PipeConnection(BaseObject):
    pass
