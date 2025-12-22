import logging

import coloredlogs

from procmap import discovery

LOGGER = logging.getLogger(__name__)


def main():
    coloredlogs.install(level="DEBUG")

    processes = discovery.discover_processes()
    for proc in processes:
        LOGGER.info(proc)

    uds_connections = discovery.discover_unix_sockets()
    for con in uds_connections:
        LOGGER.info(con)

    open_files = discovery.get_processes_open_files()
    for pid, files in open_files.items():
        LOGGER.info(f"PID {pid} has {len(files)} open files")
        for f in files:
            LOGGER.info(f"  {f}")

    # pipe_connections = discovery.discover_pipe_connections()
    # for pipe in pipe_connections:
    #     LOGGER.info(pipe)

    tcp_conn = discovery.discover_tcp_connections(open_files)

    for tcp_con in tcp_conn:
        LOGGER.info(tcp_con)

    LOGGER.info("done")


if __name__ == "__main__":
    main()
