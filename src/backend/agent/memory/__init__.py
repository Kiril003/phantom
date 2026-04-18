"""
Agent episodic memory (Phase 9.2).

Reuses the Phase 3 ChromaDB instance (chroma_path) by adding a new collection
`agent_episodes`. Past tasks → summary text + embedding → similarity search
on new task start → injected into strategic planner prompt.
"""
