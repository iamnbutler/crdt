# WebGPU Bitonic Sort Spike

**Issue**: #189
**Parent**: #117 (GPU-accelerated sorting exploration)

## What this is

A standalone browser prototype that implements bitonic sort via WebGPU compute
shaders, measuring sort time + GPU↔CPU transfer overhead against an
`Array.sort()` baseline in the same browser tab.

## How to run

Open `index.html` in Chrome 113+ (or Edge 113+). No build step required.

```bash
# From repo root:
open experiments/webgpu-sort/index.html
# or
python3 -m http.server 8080 -d experiments/webgpu-sort
# then visit http://localhost:8080
```

WebGPU must be enabled. If `requestAdapter()` returns null:
- Chrome: navigate to `chrome://flags/#enable-unsafe-webgpu` and enable
- Edge: navigate to `edge://flags/#enable-unsafe-webgpu` and enable

## What it measures

For N = 1,000 / 10,000 / 50,000 `u32` elements:

| Metric | Method |
|--------|--------|
| CPU baseline | `Uint32Array.sort()` via `performance.now()` |
| GPU upload | `createBuffer` + `mappedAtCreation` timing |
| GPU sort | Timestamp queries if available, else wall clock |
| GPU download | `mapAsync` + `getMappedRange` timing |
| GPU total | upload + sort + download |

Median of 5 runs after 2 warmup runs.

## Key design notes

- **Bitonic sort** requires power-of-2 input; arrays are padded with `0xFFFFFFFF` sentinels
- **Workgroup size** is 256 threads; one dispatch per (stage, step) pair
- **Timestamp queries** (`timestamp-query` feature) give accurate GPU-side timing when available
- **`powerPreference: "high-performance"`** requests discrete GPU when present

## Architecture

```
index.html
├── WGSL shader (inline)
│   └── @compute @workgroup_size(256) bitonic compare-and-swap
├── GPU harness
│   ├── initGPU() — adapter, device, feature detection
│   ├── createPipeline() — shader module, bind group layout
│   └── gpuBitonicSort() — buffer creation, dispatch loop, readback
├── CPU baseline
│   └── cpuSort() — Uint32Array.sort() with timing
└── Benchmark runner
    └── warmup → measure → median → recommendation
```
