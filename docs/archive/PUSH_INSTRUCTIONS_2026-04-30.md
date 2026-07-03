# Push Instructions — 2026-04-30

The branch `autonomous-run` is **ready to push** to `https://github.com/Kiril003/phantom.git`. The session that produced these 30+ commits could not push directly because:

1. The repository at `https://github.com/Kiril003/phantom.git` returned **404 Repository not found** when probed — either it doesn't exist yet, is private without our credentials, or sits under a different name.
2. No `gh` CLI is installed on this Radxa.
3. No personal access token (PAT) was available to the session.

## What you need to do

### 1. Confirm the repo exists
On GitHub, ensure `Kiril003/phantom` (or whatever the canonical name is) exists. If not, create it — empty (no README, no .gitignore, no LICENSE — those exist locally and would conflict).

### 2. Push from the Radxa

Already configured: `origin → https://github.com/Kiril003/phantom.git`. You only need to authenticate. Two options:

**Option A — Personal Access Token (fastest):**
```bash
cd /home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os
# Create a PAT at https://github.com/settings/tokens with `repo` scope.
# Then push, providing the PAT as the password when prompted:
git push -u origin autonomous-run
git push origin phase-5-redesign-baseline   # the tag for this milestone
```

**Option B — SSH key:**
```bash
# Generate key on Radxa if you don't have one:
ssh-keygen -t ed25519 -C "phantom-radxa@kiril003"
cat ~/.ssh/id_ed25519.pub   # paste into GitHub → Settings → SSH keys

# Switch remote to SSH and push:
git -C /home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os \
    remote set-url origin git@github.com:Kiril003/phantom.git
git -C /home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os \
    push -u origin autonomous-run
git -C /home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os \
    push origin phase-5-redesign-baseline
```

### 3. Open a Pull Request

After push:
- Go to `https://github.com/Kiril003/phantom/pulls`
- Click **New pull request**
- Base: whatever your default branch is (`main`/`master`) · Compare: `autonomous-run`
- Title: `Phase-5 sunrise redesign + Familiar character + identity fusion + sandbox + tools-as-skills`
- Body: paste the contents of `docs/morning-2026-04-30-report.md`
- **Do NOT auto-merge.** Review first, then merge yourself.

## Branch state at push-time

- HEAD: `b0720ea phase-5-R1-NUITKA: _phantom_entry.py`
- Tag: `phase-5-redesign-baseline`
- Commits since `master`: ~338 (every overnight + day-5 audit + day-4 wave commit)
- Working tree: clean
- Tests: vitest 323/323 ✓ · pytest 1662/1663 ✓ (1 cross-test pollution flake; passes in isolation)

## What the push contains

See `docs/morning-2026-04-30-report.md` for the full commit list. Highlights:

- **Visual:** sunrise/amber-night/cyberdeck-cold themes, repainted Shadow/Focus/Dialogue/Sentinel/Map/Operator layouts, glass design DNA in `phantom-dna.css`
- **Auth:** ProfileSelector + 6-dot PIN-pad + RFID waiting-ring with shake-on-error
- **Familiar:** wisp character with 7 SVG poses, Bezier float, AI-summonable via `phantom_manifest` chat scene (operator design batch-3 prompt in `docs/PHANTOM_FAMILIAR.md`)
- **Identity:** 4-modality fusion (voice 0.35 · face 0.30 · rfid 0.20 · context 0.15), per-user ChromaDB collections (closes audit C-4 P0)
- **Sandbox:** ROOT-gated subprocess executor, dangerous-pattern blocklist, kill-switch, WS streaming, full-screen FE
- **Tools-as-skills:** 9 backend services (timer/alarm/calendar/file_manager/wardriving/location_history/audit/checkpoint) exposed as conversational tools; 8 inline ChatScene types
- **Settings:** 1546-line single-screen accordion, 10 groups, 3-theme picker, Familiar rarity slider
