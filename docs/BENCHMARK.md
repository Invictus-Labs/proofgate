# Performance experiment: 1,000-record workload and fan-out shapes

PRD target: the deterministic core finishes 1,000 records in under 30 seconds on 2 CPU / 4 GB, excluding I/O setup
and provider I/O. The PRD asks for this to be recorded as an experiment before any external SLA is fixed; this is
that record. **It is not an SLA.**

## What was measured

`node scripts/benchmark.mjs [shape]` (or `npm run benchmark`, which builds first) generates a synthetic workload, then
times the library `evaluatePaths` end to end (load, hash every artifact, decide, render and write the report directory
atomically), five repetitions, plus bundle export, and bundle restore-with-re-evaluation. Workload generation is excluded
from the timings. Shapes:

| Shape | Requirements | Repositories | Decisions | Receipt files | Notes |
| --- | --- | --- | --- | --- | --- |
| `default-limits` | 1,000 | 1 | 1,000 | 450 (2-3 requirements each) + 450 artifacts of 4 KiB | Fits the default 1,000-entry import limit. |
| `stress` | 1,000 | 1 | 1,000 | 1,000 + 1,000 artifacts of 4 KiB (2,000 files) | Needs the file-count limit raised (library option). |
| `fanout-1000x20` | 1,000 | 20 | 20,000 | 600 + 600 artifacts | Every requirement applies to every repository. |
| `fanout-1000x50` | 1,000 | 50 | 50,000 | 600 + 600 artifacts | |
| `fanout-2000x40` | 2,000 | 40 | 80,000 | 600 + 600 artifacts | About the largest report the readers accept (see below). |

The fan-out shapes leave most requirement-repository pairs without evidence, so their verdict is `unsatisfied`; the cost
being measured is deciding, serialising and rendering `requirements x repositories` decisions.

## Result: container measurements, recorded 2026-09-29

Environment: `node:22.12` container started with `--cpus=2 --memory=4g --network none`, the `dist` build of the fix
branch, Docker Desktop (engine 29.8) on an Apple M4 Pro macOS host. The workload lives in the container's own filesystem.
Three rounds of five repetitions each (15 timings per shape), one fresh container per shape and round:
`docker run --rm --cpus=2 --memory=4g --network none -v <repo>:/src:ro node:22.12 node /src/scripts/benchmark.mjs <shape>`.

`evaluate` wall time, all 15 timings, and rounds 2 and 3 only (30 s is the target for the 1,000-record shapes):

| Shape | min | median | max | rounds 2-3: min / median / max |
| --- | --- | --- | --- | --- |
| `default-limits` | 384 ms | 744 ms | **50.6 s** | 384 ms / 488 ms / 872 ms |
| `stress` | 668 ms | 901 ms | **15.8 s** | 668 ms / 793 ms / 1.5 s |
| `fanout-1000x20` | 726 ms | 982 ms | 1.4 s | 726 ms / 915 ms / 1.4 s |
| `fanout-1000x50` | 1.1 s | 1.5 s | 2.1 s | 1.1 s / 1.5 s / 1.9 s |
| `fanout-2000x40` | 1.9 s | 2.5 s | 4.3 s | 1.9 s / 2.5 s / 4.1 s |

The two large maxima are real observations, not typos. Both occurred in round 1, when another container that was not part
of this experiment was running on the same Docker VM (the five `default-limits` timings of that round were 1.5, 6.2, 6.8,
50.6 and 2.8 s; rounds 2 and 3 of the same image never exceeded 0.9 s). Contention is the likely cause, but I did not
isolate it. What the figures do support: on a busy host a run can exceed the 30 s reference by a wide margin, and on the
quiet VM every 1,000-record timing in rounds 2 and 3 was under 1.6 s. How much slower a contended host gets is not
characterised beyond these observations.

Other timings per shape (one figure per round: rounds 1, 2, 3):

| Shape | `report.json` size | Bundle export | Bundle restore + verify + re-evaluate | Peak process RSS after runs |
| --- | --- | --- | --- | --- |
| `default-limits` | 1.3 MB | 1.4 s, 0.8 s, 0.8 s | 1.8 s, 0.6 s, 0.7 s | up to 163 MB |
| `stress` | 1.8 MB | 1.8 s, 1.5 s, 1.3 s | 1.3 s, 1.3 s, 1.1 s | up to 175 MB |
| `fanout-1000x20` | 6.5 MB | 2.0 s, 1.4 s, 1.6 s | 1.7 s, 1.1 s, 1.3 s | up to 261 MB |
| `fanout-1000x50` | 14.5 MB | 3.2 s, 3.4 s, 2.4 s | 1.9 s, 2.0 s, 2.2 s | up to 438 MB |
| `fanout-2000x40` | 23 MB | 4.1 s, 5.0 s, 7.3 s | 2.5 s, 2.6 s, 5.8 s | up to 554 MB |

The packaged CLI (`node dist/cli.js evaluate ...`) for `default-limits` took 3.7 s (round 1), 0.9 s and 0.8 s wall time
including Node start-up.

From the figures above alone, a benign 1,000-record run takes about one to a few seconds on a quiet host, roughly ten times
under the 30 s target (an earlier single-run laptop figure, since replaced, suggested a hundredfold). This document reports only what this repository's
own script measured.

The figures on this page were recorded before the round-2 rewrite of `src/redact.ts` (a redactor made of linear-time steps with
chunked Unicode folding) and before the later changes to it (redaction repeated until the text stops changing, at most six rounds;
more steps, a wider assignment reader, a shared quoted-value reader for options, user information, pairs and lists, and a second
read of percent-decoded text; the file grew by about 500 lines in round 5 and by about 260 more in round 6, which added a per-call work budget, memoised scans of long runs and more readers). Those changes remove some work and add some: about
11% more evaluate time was measured on one shape after round 3, far from the 30 s target, and the tables have **not** been re-measured; the redaction scaling itself is checked by
`tests/unit/round3-redaction-scaling.test.ts`, not by these tables.

## Fan-out limits

Decisions grow with `requirements x repositories`, and so does `report.json` (about 0.29 KB per decision in the shapes
above). The readers (`explain`, `bundle export`) refuse a report larger than the 25 MB metadata limit, so `evaluate` measures
the serialised report **before rendering the HTML page and before writing anything**, and refuses a report that no command
could open (`limit_metadata_bytes`, exit 2). That puts the ceiling at about 80,000 requirement-repository pairs (2,000
requirements across 40 repositories produced a 23 MB report); 5,000 requirements across 50 repositories (250,000 pairs)
is refused up front. Split a larger policy into several manifests.

Before this check, an evaluation inside the declared input limits could write an 85 MB `report.json` and a 153 MB
`index.html` that `explain` and `bundle export` then refused, using most of a 4 GB container's memory on the way.

## Reading the result honestly

- Evaluation is single-threaded (synchronous hashing on the main thread plus sequential file reads), so the core count of the
  host matters little; that is reasoning, and 2 CPUs is the only measured configuration.
- The workload is tiny artifacts on the container filesystem. Large artifacts (up to the 250 MB blob cap) are dominated by
  disk read and SHA-256 throughput, not by the decision engine, and were not benchmarked.
- Hostile input is a different question from this benign workload: redaction and the credential scan are bounded but not free
  (see the redaction section of `docs/INTERFACES.md`), and YAML manifests are capped at 4 MiB and 150,000 nodes.
- Three rounds of five repetitions on one machine; no confidence interval is claimed, and the outliers above are shown as
  they occurred.
- To reproduce: build (`npm run build`), run the container command above for a shape, and compare medians, not single runs.
