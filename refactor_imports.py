import os
import re

MOVED_FILES = [
    "runtime",
    "loop",
    "executor",
    "checkpoints",
    "rehydrate",
    "controls",
    "errors",
]

# Files/dirs remaining in src/backend/agent/
OTHER_AGENT_FILES = ["audit", "observations", "schemas", "proactive", "emotion", "needs", "self_model", "approve_on_phone", "long_running", "monologue_emitter", "reports", "proactive_triggers"]
AGENT_SUBDIRS = ["actions", "cognition", "governance", "localization", "mcp", "memory", "missions", "ops", "orchestrator", "planner", "safety", "standing_orders", "studio", "team", "will"]

def update_file(file_path):
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            content = f.read()
    except UnicodeDecodeError:
        print(f"Skipping (encoding error): {file_path}")
        return False

    new_content = content
    norm_path = file_path.replace("\\", "/")
    
    is_in_agent_tree = "/agent/" in norm_path
    is_moved = "/agent/kernel/" in norm_path

    for f_name in MOVED_FILES:
        # 1. from agent.runtime -> from agent.kernel.runtime
        new_content = re.sub(rf"from\s+agent\.{f_name}\b", f"from agent.kernel.{f_name}", new_content)
        new_content = re.sub(rf"import\s+agent\.{f_name}\b", f"import agent.kernel.{f_name}", new_content)
        
        # 2. from agent import runtime -> from agent.kernel import runtime
        new_content = re.sub(rf"from\s+agent\s+import\s+(.*)\b{f_name}\b", rf"from agent.kernel import \1{f_name}", new_content)
        
        # 3. Relative imports inside agent tree
        if is_in_agent_tree:
            if is_moved:
                # Inside agent/kernel/
                new_content = re.sub(rf"from\s+\.{f_name}\b", f"from agent.kernel.{f_name}", new_content)
                new_content = re.sub(rf"import\s+\.{f_name}\b", f"import agent.kernel.{f_name}", new_content)
            else:
                # Inside agent/ (but not kernel/) or agent/subdirs/
                new_content = re.sub(rf"from\s+\.\.?{f_name}\b", f"from agent.kernel.{f_name}", new_content)
                new_content = re.sub(rf"import\s+\.\.?{f_name}\b", f"import agent.kernel.{f_name}", new_content)
                
                # from . import runtime -> from .kernel import runtime
                new_content = re.sub(rf"from\s+\.\s+import\s+(.*)\b{f_name}\b", rf"from .kernel import \1{f_name}", new_content)

    # 4. If it's a moved file, it might have relative imports to things still in agent/
    if is_moved:
        for f_name in OTHER_AGENT_FILES:
            new_content = re.sub(rf"from\s+\.{f_name}\b", f"from agent.{f_name}", new_content)
        for d_name in AGENT_SUBDIRS:
            new_content = re.sub(rf"from\s+\.{d_name}\b", f"from agent.{d_name}", new_content)

    if new_content != content:
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(new_content)
        return True
    return False

def main():
    backend_dir = "src/backend"
    updated_count = 0
    for root, dirs, files in os.walk(backend_dir):
        # Skip venv and .venv
        if "venv" in root.split(os.sep) or ".venv" in root.split(os.sep):
            continue
            
        for file in files:
            if file.endswith(".py"):
                file_path = os.path.join(root, file)
                if update_file(file_path):
                    updated_count += 1
                    print(f"Updated: {file_path}")
    print(f"Total files updated: {updated_count}")

if __name__ == "__main__":
    main()
