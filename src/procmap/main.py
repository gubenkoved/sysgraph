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

    LOGGER.info("done")


if __name__ == "__main__":
    main()
