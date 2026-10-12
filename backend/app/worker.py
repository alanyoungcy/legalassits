"""RabbitMQ worker entrypoint — scaffold until durable queues are wired."""

from __future__ import annotations

import signal
import sys
import time

from loguru import logger


def main() -> None:
    logger.info("Capco Contract Assists worker started (scaffold)")
    stop = False

    def _handle_signal(signum: int, _frame: object) -> None:
        nonlocal stop
        logger.info("received signal {}; shutting down", signum)
        stop = True

    signal.signal(signal.SIGTERM, _handle_signal)
    signal.signal(signal.SIGINT, _handle_signal)

    while not stop:
        time.sleep(5)

    logger.info("worker stopped")
    sys.exit(0)


if __name__ == "__main__":
    main()
