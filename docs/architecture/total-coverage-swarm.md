# PHANTOM OS — The Total Coverage Autonomous Swarm Blueprint

**Status**: Adopted (Phase: Swarm Transition)
**Scope**: Core OS Architecture, AI Orchestration, Security, and UI Generation
**Context**: This document formalizes the transition of Phantom OS from a traditional monolithic application overlay into a native, local-first "Digital State" governed by a multi-agent hierarchy known as the **Total Coverage Autonomous Swarm**.

---

## 1. The Paradigm of the Digital State

Phantom OS fundamentally subverts the traditional multi-agent system (MAS) paradigm. Instead of agents running *on top* of the OS, the intelligence *is* the OS. By embedding Large Language Models (LLMs) directly into the core architecture, we create an AIOS abstraction layer that manages scheduling, memory, hardware orchestration, and state synchronization.

To achieve autonomy without gridlock, hallucination, or catastrophic security failures, the swarm is structured into a specialized, redundant, and metacognitive 6-tier hierarchy.

---

## Tier 1: Core Substrate and Low-Level Operations

The foundational layer translates opaque hardware and POSIX/Windows APIs into semantically navigable environments for the LLM.

*   **Virtualization Sandbox Governor (The Isolationist):** Intercepts all hardware/filesystem intents and translates them into sandboxed MCP tool executions. Provisions ephemeral VMs (`bwrap` / Landlock) for untrusted code execution.
*   **Hardware Synergy Orchestrator (The Sceptical Empiricist):** Aggregates raw IoT/sensor data (ESP32, radar, GPS). Evaluates the physical world via Bayesian trust estimations (MATE framework), dynamically dropping compromised sensors to prevent physical-layer spoofing.
*   **LLM-Kernel Scheduler (The Metronome):** Manages context window allocation and precise prompt scheduling. Preempts background tasks for critical user-facing alerts, preventing context starvation.

## Tier 2: Advanced Cognitive Memory and Temporal Organization

Replaces static vector databases (RAG) with a unified, dual-layer graph topology to capture complex multi-hop contextual dependencies.

*   **Episodic-Semantic Graph Synthesizer (The Historian):** Transforms raw logs into interconnected dynamic graphs. Uses *Spreading Activation* to retrieve implicitly related context, filtered by a mathematical "feeling of knowing" to prevent hallucinations.
*   **Memory Compression Pruner (The Minimalist):** Continuously distills the graph. Executes edge-aware pruning and shifts older episodic memories into cold storage while keeping vital semantic nodes in active context window "RAM".
*   **Procedural Engram Encoder (The Instinct):** Observes user interactions to extract workflow habits. Dynamically synthesizes new operational heuristics and injects them into peer agents' instructions, enabling true self-evolution.

## Tier 3: Collaborative Metacognition and Quality Gates

Replaces chaotic free-form agent debates with a highly structured, role-based pipeline (based on the MARS framework).

*   **Tactical Meta-Reviewer (The Parliamentarian):** Sits at the apex of the cognitive triad. Synthesizes independent critiques, forcing iterative revisions and enforcing quality gates before output reaches the user.
*   **Algorithmic Conflict Resolver (The Neutral Logic Engine):** Detects deadlocks between specialized agents (e.g., Security vs. Performance). Engineers hybrid solutions or enforces priority overrides objectively.
*   **Philosophical Redundancy Triad:**
    *   *The Perfectionist:* Focuses on rigorous, mathematically proven, methodical generation.
    *   *The Improviser:* Focuses on lateral thinking and rapid prototyping.
    *   *The Sceptic:* Identifies edge cases and logical fallacies.

## Tier 4: Zero-Trust Security and Adversarial Resilience

Enforces rigorous internal boundaries to prevent compounding authorization failures and agent-hijacking via Prompt Injection (XPIA).

*   **Cryptographic Identity Gatekeeper (The Inquisitor):** Enforces mTLS and unique SPIFFE IDs for every inter-agent interaction. Prevents cross-agent impersonation.
*   **Delegation Chain Auditor (The Boundary Enforcer):** Enforces the "Permission Diminishment Rule". Evaluates upstream delegation chains and severs any thread exceeding strict depth limits.
*   **Continuous Adversarial Red Teamer (The Adversary):** Operates endlessly in the background, injecting malicious instructions and jailbreaks into shared memory to calculate the Attack Success Rate (ASR) and generate immediate countermeasures.
*   **PII Obfuscation Filter (The Veil):** Executes real-time redaction and cryptographic tokenization of sensitive data before it enters the semantic graph, guaranteeing absolute privacy.

## Tier 5: Sentience, Empathy, and Generative UX

Abandons permanent windows and static UIs in favor of generative, declarative constructs assembled in real-time.

*   **Generative UI Scenographer (The Architect):** Translates agent outputs into the declarative A2UI JSON component tree. Renders dynamic interfaces on demand, immune to traditional UI injection attacks.
*   **State Synchronization Weaver (The Diplomat):** Manages bidirectional synchronization via JSON Patch/Pointer (AG-UI protocol). Handles interrupt-driven flows, ensuring instantaneous human-on-the-loop control.
*   **Affective Resonance Engine (The Empath):** Drives the Emotional Gödel Machine (EGM). Analyzes user cadence and biometrics to dynamically modulate the swarm's tone, pacing, and visual complexity based on cognitive load.
*   **Visual Manifestation Director (The Familiar):** Orchestrates the physical "presence" of the OS (animations, motion choreography), anchoring the system's thought process into a socially legible construct.

## Tier 6: Hierarchical Management and Sovereignty

The overarching mechanism ensuring all microscopic specializations align into a unified macroscopic outcome.

*   **State Orchestrator (The Sovereign):** Translates ambiguous human intent into precise directives. Evaluates outputs against emotional parameters and security clearances. The final authority and single proxy to the human user.

---

## Implementation Strategy

We will integrate these tiers iteratively into the existing Phantom OS `src/backend/ai/agents` structure:

1.  **Phase A: Quality & Security (Tiers 3 & 4)**
    *   Implement the **MARS architecture** (Tier 3) within the chat orchestrator, spinning up the Redundancy Triad and Tactical Meta-Reviewer.
    *   Implement the **PII Obfuscation Filter** (Tier 4) via `output_safety.py` and input parsers.
2.  **Phase B: Sentience & UI (Tier 5)**
    *   Strengthen the **Generative UI Scenographer** connecting to the Sunrise React frontend.
    *   Integrate the **Affective Resonance Engine** using existing sensor telemetries.
3.  **Phase C: Advanced Memory & Substrate (Tiers 1 & 2)**
    *   Migrate from ChromaDB RAG to the **Episodic-Semantic Graph Synthesizer**.
    *   Formalize the **Sandbox Governor** around existing `bwrap` logic.
