# ProofGate diagram pack

Status: proposed topology for autonomous PRD drafting; not approved for implementation.

#### ◇ Diagram — Architecture
*The core works independently; adapters are optional.*

```mermaid
%%{init: {'theme':'base','themeVariables':{'background':'#0d1117','primaryColor':'#161b22','primaryBorderColor':'#00f0ff','primaryTextColor':'#e2e8f0','lineColor':'#94a3b8','fontFamily':'JetBrains Mono, monospace'}}}%%
graph LR
 subgraph Local["Self-hosted boundary"]
 A["Requirement manifest + test receipts + revision set"]:::hot
 B["Evidence verifier"]:::green
 C["Versioned evidence store"]:::hot
 D["Acceptance report"]:::green
 end
 E["Optional ecosystem adapter"]:::ext
 A ==> B
 B ==> C
 C ==> D
 D -.-> E

classDef hot fill:#0d1117,stroke:#00f0ff,stroke-width:2px,color:#e2e8f0;
classDef green fill:#0d1117,stroke:#10b981,stroke-width:1.5px,color:#e2e8f0;
classDef ext fill:#0d1117,stroke:#64748b,stroke-dasharray:4 3,color:#94a3b8;
linkStyle 0,1,2 stroke:#00f0ff,stroke-width:2px;
linkStyle 3 stroke:#64748b,stroke-width:1.5px;
```

> **THE POINT:** The core works independently; adapters are optional.

#### ◇ Diagram — Workflow
*Persist evidence at each boundary; unresolved outcomes remain visible.*

```mermaid
%%{init: {'theme':'base','themeVariables':{'background':'#0d1117','primaryColor':'#161b22','primaryBorderColor':'#00f0ff','primaryTextColor':'#e2e8f0','lineColor':'#94a3b8','fontFamily':'JetBrains Mono, monospace'}}}%%
graph TD
 N0["Load manifest"]:::hot
 N1["Validate receipt schema and hashes"]:::hot
 N2["Exact revision and environment match?"]:::hot
 N3["Required evidence complete and fresh?"]:::hot
 N4["PASS report"]:::hot
 N5["Unsatisfied report"]:::hot
 N0 ==> N1
 N1 ==> N2
 N2 ==> N3
 N3 ==> N4
 N4 ==> N5

classDef hot fill:#0d1117,stroke:#00f0ff,stroke-width:2px,color:#e2e8f0;
classDef green fill:#0d1117,stroke:#10b981,stroke-width:1.5px,color:#e2e8f0;
classDef ext fill:#0d1117,stroke:#64748b,stroke-dasharray:4 3,color:#94a3b8;
linkStyle 0,1,2,3,4 stroke:#00f0ff,stroke-width:2px;
```

> **THE POINT:** Persist evidence at each boundary; unresolved outcomes remain visible.

#### ◇ Diagram — Acceptance decision
*Completion and acceptance are separate; uncertainty cannot become success.*

```mermaid
%%{init: {'theme':'base','themeVariables':{'background':'#0d1117','primaryColor':'#161b22','primaryBorderColor':'#00f0ff','primaryTextColor':'#e2e8f0','lineColor':'#94a3b8','fontFamily':'JetBrains Mono, monospace'}}}%%
graph TD
 A["Evaluate evidence"]:::hot
 B{"All required checks satisfied?"}:::hot
 C["Record accepted result"]:::green
 D["Record failed or unknown result"]:::ext
 E["Operator sees reasons and next step"]:::hot
 A ==> B
 B ==>|Yes| C
 B -->|No or uncertain| D
 D --> E

classDef hot fill:#0d1117,stroke:#00f0ff,stroke-width:2px,color:#e2e8f0;
classDef green fill:#0d1117,stroke:#10b981,stroke-width:1.5px,color:#e2e8f0;
classDef ext fill:#0d1117,stroke:#64748b,stroke-dasharray:4 3,color:#94a3b8;
linkStyle 0,1 stroke:#00f0ff,stroke-width:2px;
```

> **THE POINT:** Completion and acceptance are separate; uncertainty cannot become success.

## Proposed decisions

Choose trusted receipt producers and signing policy for the pilot; decide whether branch-protection integration belongs after MVP.

## Risk flags

A forged trusted-runner receipt remains possible without attestation. MVP verifies consistency and declared provenance, not honesty of arbitrary test producers.
