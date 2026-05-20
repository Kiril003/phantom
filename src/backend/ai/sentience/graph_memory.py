"""
PHANTOM OS - Tier 2: Episodic-Semantic Graph Synthesizer

Replaces flat RAG with a unified, dual-layer graph topology.
Implements the foundation for spreading activation and isolated-node
sampling for the Memory Compression Pruner.
"""
import logging
from enum import Enum
from typing import Any, List, Set, Dict
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

class GraphNodeType(str, Enum):
    EPISODIC = "episodic"
    SEMANTIC = "semantic"
    PROCEDURAL = "procedural"

class GraphNode(BaseModel):
    id: str
    node_type: GraphNodeType
    content: str
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    metadata: Dict[str, Any] = Field(default_factory=dict)
    
class GraphEdge(BaseModel):
    source_id: str
    target_id: str
    weight: float = Field(default=1.0, ge=0.0, le=1.0)
    relation: str

class SpreadingActivationResult(BaseModel):
    activated_nodes: List[GraphNode]
    activation_energies: Dict[str, float]

class EpisodicSemanticGraph:
    """
    Tier 2 Memory Weaver. Maintains the associative memory graph.
    """
    def __init__(self):
        self.nodes: Dict[str, GraphNode] = {}
        self.edges: List[GraphEdge] = []
        
    def add_node(self, node: GraphNode) -> None:
        self.nodes[node.id] = node
        
    def add_edge(self, edge: GraphEdge) -> None:
        self.edges.append(edge)
        
    def spreading_activation(
        self, 
        initial_nodes: List[str], 
        decay_factor: float = 0.8,
        threshold: float = 0.3, # The "feeling of knowing" mathematical gate
        max_steps: int = 3
    ) -> SpreadingActivationResult:
        """
        Executes spreading activation to retrieve implicitly related context.
        """
        activation = {nid: 1.0 for nid in initial_nodes if nid in self.nodes}
        active_set = set(initial_nodes)
        
        for _ in range(max_steps):
            new_activation = {}
            for edge in self.edges:
                if edge.source_id in active_set:
                    energy = activation[edge.source_id] * edge.weight * decay_factor
                    if energy >= threshold:
                        if edge.target_id not in activation or energy > activation.get(edge.target_id, 0):
                            new_activation[edge.target_id] = energy
                            
                # Bidirectional spread
                if edge.target_id in active_set:
                    energy = activation[edge.target_id] * edge.weight * decay_factor
                    if energy >= threshold:
                        if edge.source_id not in activation or energy > activation.get(edge.source_id, 0):
                            new_activation[edge.source_id] = energy
                            
            if not new_activation:
                break
                
            for nid, energy in new_activation.items():
                activation[nid] = max(activation.get(nid, 0), energy)
                active_set.add(nid)
                
        # Filter out anything below threshold
        final_nodes = []
        final_energies = {}
        for nid, energy in activation.items():
            if energy >= threshold and nid in self.nodes:
                final_nodes.append(self.nodes[nid])
                final_energies[nid] = energy
                
        # Sort by energy descending
        final_nodes.sort(key=lambda n: final_energies[n.id], reverse=True)
        
        return SpreadingActivationResult(
            activated_nodes=final_nodes,
            activation_energies=final_energies
        )

# Global graph instance for the Phase A transition
_graph_synthesizer = EpisodicSemanticGraph()

def get_graph_synthesizer() -> EpisodicSemanticGraph:
    return _graph_synthesizer
