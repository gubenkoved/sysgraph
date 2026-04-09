import unittest

from sysgraph.graph import Graph, Node, Relationship


class NodeTest(unittest.TestCase):
    def test_construction(self):
        node = Node(id="n1", type="process")
        self.assertEqual(node.id, "n1")
        self.assertEqual(node.type, "process")
        self.assertEqual(node.properties, {})

    def test_construction_with_properties(self):
        props = {"pid": 123, "name": "bash"}
        node = Node(id="n1", type="process", properties=props)
        self.assertEqual(node.properties, props)

    def test_as_dict(self):
        node = Node(id="n1", type="process", properties={"pid": 1})
        d = node.as_dict()
        self.assertEqual(d["id"], "n1")
        self.assertEqual(d["type"], "process")
        self.assertEqual(d["properties"], {"pid": 1})


class RelationshipTest(unittest.TestCase):
    def test_construction(self):
        rel = Relationship(source_id="a", target_id="b", type="child_process")
        self.assertEqual(rel.source_id, "a")
        self.assertEqual(rel.target_id, "b")
        self.assertEqual(rel.type, "child_process")
        self.assertEqual(rel.properties, {})

    def test_auto_generated_id(self):
        rel = Relationship(source_id="a", target_id="b", type="pipe")
        self.assertIsNotNone(rel.id)
        self.assertIsInstance(rel.id, str)
        self.assertGreater(len(rel.id), 0)

    def test_explicit_id(self):
        rel = Relationship(
            source_id="a", target_id="b", type="pipe", id="my-id"
        )
        self.assertEqual(rel.id, "my-id")

    def test_construction_with_properties(self):
        props = {"fd": 3, "mode": "r"}
        rel = Relationship(
            source_id="a", target_id="b", type="pipe", properties=props
        )
        self.assertEqual(rel.properties, props)

    def test_as_dict(self):
        rel = Relationship(
            source_id="a",
            target_id="b",
            type="pipe",
            properties={"fd": 3},
            id="edge-1",
        )
        d = rel.as_dict()
        self.assertEqual(d["id"], "edge-1")
        self.assertEqual(d["source_id"], "a")
        self.assertEqual(d["target_id"], "b")
        self.assertEqual(d["type"], "pipe")
        self.assertEqual(d["properties"], {"fd": 3})


class GraphTest(unittest.TestCase):
    def test_empty_graph(self):
        g = Graph()
        self.assertEqual(len(g.nodes), 0)
        self.assertEqual(len(g.edges), 0)

    def test_add_node(self):
        g = Graph()
        node = g.add_node("p1", "process", {"pid": 1})
        self.assertIsInstance(node, Node)
        self.assertEqual(node.id, "p1")
        self.assertEqual(node.type, "process")
        self.assertEqual(node.properties, {"pid": 1})
        self.assertIn("p1", g.nodes)

    def test_add_edge(self):
        g = Graph()
        g.add_node("a", "process")
        g.add_node("b", "process")
        rel = g.add_edge("a", "b", "child_process")
        self.assertIsInstance(rel, Relationship)
        self.assertEqual(rel.source_id, "a")
        self.assertEqual(rel.target_id, "b")
        self.assertEqual(rel.type, "child_process")

    def test_add_edge_with_explicit_id(self):
        g = Graph()
        g.add_node("a", "process")
        g.add_node("b", "process")
        rel = g.add_edge("a", "b", "pipe", id="e1")
        self.assertEqual(rel.id, "e1")

    def test_parallel_edges(self):
        g = Graph()
        g.add_node("a", "process")
        g.add_node("b", "process")
        g.add_edge("a", "b", "pipe", properties={"fd": 3})
        g.add_edge("a", "b", "pipe", properties={"fd": 4})
        self.assertEqual(len(g.edges["a"]["b"]), 2)

    def test_as_dict(self):
        g = Graph()
        g.add_node("a", "process", {"pid": 1})
        g.add_node("b", "process", {"pid": 2})
        g.add_edge("a", "b", "child_process")
        d = g.as_dict()
        self.assertEqual(len(d["nodes"]), 2)
        self.assertEqual(len(d["edges"]), 1)

    def test_as_dict_multiple_edges(self):
        g = Graph()
        g.add_node("a", "process")
        g.add_node("b", "process")
        g.add_node("c", "process")
        g.add_edge("a", "b", "child_process")
        g.add_edge("a", "c", "pipe")
        g.add_edge("b", "c", "socket")
        d = g.as_dict()
        self.assertEqual(len(d["nodes"]), 3)
        self.assertEqual(len(d["edges"]), 3)


if __name__ == "__main__":
    unittest.main()
