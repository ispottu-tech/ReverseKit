# ReverseKit — iOS Binary Analysis Platform

Professional iOS binary analysis platform with Ghidra decompilation, RetDec, radare2, YARA scanning, Frida dynamic analysis, and more.

## Features

- **Binary Inspector** — Full source code extraction with Ghidra + RetDec decompilation, ObjC headers, YARA threat scanning, ROP gadgets, and 20+ analysis tabs
- **Binary Diff** — Compare two iOS binary versions, find new APIs, privacy changes, and security regressions
- **Hex Viewer** — Low-level binary inspection
- **Script Arsenal** — Custom analysis scripts
- **Device Manager** — Frida-based dynamic analysis on real devices

## Tools Included

| Tool | Version | Purpose |
|------|---------|---------|
| Ghidra | 11.3.2 | Decompilation |
| RetDec | 5.0 | Decompilation |
| radare2 | 6.1.4 | Disassembly |
| YARA | 4.5.4 | Threat scanning |
| Frida | Latest | Dynamic analysis |

## Stack

- **Frontend:** React + Vite + TypeScript
- **Backend:** Node.js (ESM) + Express
- **Analysis Engine:** Python (lief, capstone, r2pipe, pwntools)

## Deployment

Deployed on Hugging Face Spaces (Docker) with 16GB RAM.

## License

Private — All rights reserved.

