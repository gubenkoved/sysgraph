import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any

NodeId = str


@dataclass
class Node:
    id: NodeId
    type: str
    properties: dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict:
        return {
            "id": self.id,
            "type": self.type,
            "properties": self.properties,
        }


@dataclass
class Relationship:
    source_id: NodeId
    target_id: NodeId
    type: str
    properties: dict[str, Any] = field(default_factory=dict)
    id: str = ""

    def __post_init__(self):
        if not self.id:
            self.id = generate_id()

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
        self.edges: dict[NodeId, dict[NodeId, list[Relationship]]] = (
            defaultdict(lambda: defaultdict(list))
        )

    def add_node(
        self,
        node_id: NodeId,
        node_type: str,
        properties: dict[str, Any] | None = None,
    ) -> Node:
        node = Node(node_id, node_type, properties or {})
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
        rel = Relationship(
            source_id, target_id, rel_type, properties or {}, id or ""
        )
        self.edges[source_id][target_id].append(rel)
        return rel

    def as_dict(self) -> dict:
        edges = [
            edge.as_dict()
            for by_target in self.edges.values()
            for edge_list in by_target.values()
            for edge in edge_list
        ]
        return {
            "nodes": [node.as_dict() for node in self.nodes.values()],
            "edges": edges,
        }
