import uuid
from typing import Any

NodeId = str


class Node:
    def __init__(
        self,
        id: NodeId,
        type: str,
        properties: dict[str, Any] | None = None,
    ) -> None:
        self.id: NodeId = id
        self.type: str = type
        self.properties: dict[str, Any] = properties or {}

    def as_dict(self) -> dict:
        return {
            "id": self.id,
            "type": self.type,
            "properties": self.properties,
        }


class Relationship:
    def __init__(
        self,
        source_id: NodeId,
        target_id: NodeId,
        type: str,
        properties: dict[str, Any] | None = None,
        id: str | None = None,
    ) -> None:
        self.source_id: NodeId = source_id
        self.target_id: NodeId = target_id
        self.type = type
        self.properties: dict[str, Any] = properties or {}
        self.id: str = id or generate_id()

    def as_dict(self) -> dict:
        return {
            "id": self.id,
            "source_id": self.source_id,
            "target_id": self.target_id,
            "type": self.type,
            "properties": self.properties,
        }


def generate_id() -> str:
    return str(uuid.uuid4())


class Graph:
    def __init__(self):
        self.nodes: dict[NodeId, Node] = {}
        self.edges: dict[NodeId, dict[NodeId, list[Relationship]]] = {}

    def add_node(
        self,
        node_id: NodeId,
        node_type: str,
        properties: dict[str, Any] | None = None,
    ) -> Node:
        node = Node(node_id, node_type, properties)
        self.nodes[node_id] = node
        return node

    def add_edge(
        self,
        source_id: NodeId,
        target_id: NodeId,
        rel_type: str,
        properties: dict[str, Any] | None = None,
        id: str | None = None,
    ) -> Relationship:
        if source_id not in self.edges:
            self.edges[source_id] = {}

        by_source_map = self.edges[source_id]

        if target_id not in by_source_map:
            by_source_map[target_id] = []

        edge_list = by_source_map[target_id]

        rel = Relationship(source_id, target_id, rel_type, properties, id)
        edge_list.append(rel)

        return rel

    def as_dict(self) -> dict:
        edges = []

        for source_id in self.edges:
            for edge_list in self.edges[source_id].values():
                for edge in edge_list:
                    edges.append(edge.as_dict())

        return {
            "nodes": [node.as_dict() for node in self.nodes.values()],
            "edges": edges,
        }
