#! /usr/bin/env python3

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

    for proc in processes:
        try:
            net_conns = discovery.get_net_connections(proc.pid)
            for conn in net_conns:
                LOGGER.info(conn)
        except Exception as e:
            LOGGER.warning(
                f"Could not get net connections for PID {proc.pid}: {e}"
            )

    LOGGER.info("done")


if __name__ == "__main__":
    main()
