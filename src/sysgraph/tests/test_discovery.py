import unittest

from sysgraph import discovery


class DiscoveryTest(unittest.TestCase):
    def test_process_discovery(self):
        processes = discovery.discover_processes()
        self.assertGreater(len(processes), 0)

    def test_build_graph_smoke(self):
        graph = discovery.build_graph()

        self.assertIsNotNone(graph)
        self.assertGreater(len(graph.nodes), 0)


if __name__ == "__main__":
    unittest.main()
