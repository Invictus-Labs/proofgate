# Human drill sheet (AC-11)

**This drill is the only thing that can close acceptance criterion AC-11.** AC-11 says: *a fresh operator can execute the
synthetic smoke procedure using the release documentation.* No agent, script or automated harness can satisfy it, and
the automated run of the runbook (`npm run smoke:runbook`) is supplemental evidence only. Until a completed sheet from an
independent person is attached to the acceptance matrix, AC-11 stays `PENDING_HUMAN_RECEIPT`. No waiver exists.

## Who may do it

An **independent human**: someone who did not write ProofGate or its documentation, and who is not helped by its authors while
they work. Ask them to follow the written runbook and nothing else. If you (the maintainer) have to help, that is
not a failure of the person; it is a finding, and you record it.

## Before they start (the maintainer does this)

1. Give them, out of band (not inside the tarball): the release tarball, its SHA-256 that **you computed from that file**, the
   commit SHA it was built from, and [RUNBOOK-SMOKE.md](RUNBOOK-SMOKE.md) as a separate file (the tarball also carries the
   documents, but the operator needs the runbook before installing anything). Give them nothing else. Do not explain the
   product first. There are no published release notes yet, so the hash comes from you.
   - The tarball must be built from the **final** commit that is to be judged. A tarball rebuilt after any fix has a different
     hash, and a drill done on an earlier tarball proves nothing about the later one.
   - **A drill on any other commit does not count**, including a commit that differs from the reviewed one only by documents:
     `docs/qa/*` ships inside the tarball, so a docs-only commit changes the tarball bytes, and the drill would then prove
     something about a file that is not the one being released. After any commit, build a new tarball from the final commit,
     compute its checksum yourself, and run a new drill.
   - The maintainer builds the tarball and computes its SHA-256 personally and gives it out of band. Nobody else's checksum,
     and no checksum from a build on a different Node or npm version, may stand in for it.
   - Tell them that `PROOFGATE_TARBALL` must be an **absolute** path (the runbook changes directory before it uses it).
2. Tell them: a macOS or Linux terminal, Node.js 22.12 or newer, 15 to 30 minutes, a browser for one step. No account,
   no server and no data of their own are needed, but **step 4 needs network access** to the public package registry (it
   installs two dependencies); an offline machine fails there, and that is a setup problem to fix before the drill, not a
   documentation finding.
3. Note the wall-clock time from `date -u` when they begin.

## What they do

Follow [RUNBOOK-SMOKE.md](RUNBOOK-SMOKE.md) from step 1 to step 18 in order, in a fresh terminal, in a new empty directory.
For every step they write down what happened, in their own words: **passed** (output matched), **failed** (differed),
or **skipped** (and why). They must not retry a failing step until it works; they stop and write down the exact text.

## What must be recorded

Copy this block into a file and fill it in. Times come from `date -u` on their machine, never estimated.

```text
ProofGate human drill receipt (AC-11)
Release under test: version ______   tarball SHA-256 ____________________________________
Source commit the tarball was built from (40 characters): ________________________________________
Runbook revision:   commit or file hash ______________________________

Drill operator (name or handle as they wish to be credited): ______________
Relationship to the project: [ ] not involved  [ ] contributed (explain): ______________
Machine: OS and version ______   Node version ______   npm version ______
Start (UTC, from `date -u`): ______________________   End (UTC): ______________________

Assistance given (write NONE if none). One line each: time, who, what was said or shown, which step it affected:
  ______________________________________________________________________

Step outcomes (passed / failed / skipped, and any text that differed from the runbook):
  Step  1 Node check ........................ ____
  Step  2 Tarball variables ................. ____
  Step  3 Empty directory + checksum ........ ____
  Step  4 Install ........................... ____
  Step  5 PATH + version .................... ____
  Step  6 Demo fixtures ..................... ____
  Step  7 Happy path (exit 0) ............... ____
  Step  8 Files written ..................... ____
  Step  9 Explain a passing requirement ..... ____
  Step 10 Planted problems (exit 1) ......... ____
  Step 11 Explain a failing requirement ..... ____
  Step 12 Tampered artifact (exit 2) ........ ____
  Step 13 Duplicate id (exit 2) ............. ____
  Step 14 Bundle export ..................... ____
  Step 15 Verify, restore, reproduce ........ ____
  Step 16 Truncated bundle refused .......... ____
  Step 17 Static report in a browser ........ ____   (what did you see at desktop and at phone width?)
  Step 18 Cleanup ........................... ____

Unclear or missing documentation (quote it): ______________________________________

Cleanup receipt: I removed the working directory and unset the variables.  [ ] yes  [ ] no
  Output of `ls` in the parent directory after step 18 shows no proofgate-smoke:  [ ] yes  [ ] no

Overall, in my own words, could a newcomer complete this procedure unaided?  ______________

Evidence kept (a terminal transcript and/or screenshots of steps 7, 10 and 17): stored at ______________________
  held by ______________   retained until ______________

Signed (name or handle) ______________   Date (UTC) ______________
```

## Where to send it

Send the completed sheet to the person who gave you the tarball (the release maintainer). They attach it, unedited, to the
AC-11 row of [`qa/ac-matrix.md`](qa/ac-matrix.md) and record the date, the drilled commit and the tarball hash. Recording the receipt
(only that row, the drilled commit and the tarball hash) is the one permitted commit after a drill; it does not invalidate the drill, and
nothing else may change between the drilled commit and the release. The tarball that is then released is rebuilt from the receipt
commit and has its own hash (its `docs/qa/ac-matrix.md` differs); the AC-11 row states both hashes, the drilled one and the released
one (see `docs/RELEASE.md`). Only then may AC-11 be reconsidered; the maintainer
cannot mark it satisfied on the strength of anything except this sheet. A sheet that records unrecorded assistance,
retries until success, or a missing cleanup receipt does not count.

## After the drill

Every failed step and every unclear sentence becomes a documentation or product fix. Fix it, re-issue the tarball **from the final commit** (its hash will differ from the previous one), and
run a **new** drill with a **different** independent person; a person who has already done the drill is no longer fresh.
