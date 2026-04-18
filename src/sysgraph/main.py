#! /usr/bin/env python3

import logging

import coloredlogs

from sysgraph import discovery

LOGGER = logging.getLogger(__name__)


def main():
    coloredlogs.install(
        level="DEBUG",
        fmt="%(asctime)s.%(msecs)03d %(name)s[%(process)d] %(levelname)s %(message)s",
    )

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

    all_net_conns = discovery.get_all_net_connections()
    for pid, conns in all_net_conns.items():
        for conn in conns:
            LOGGER.info(conn)

    LOGGER.info("done")


if __name__ == "__main__":
    main()
