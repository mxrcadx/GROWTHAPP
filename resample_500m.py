"""Resample 250m growth grid to 500m grid by averaging 2x2 blocks."""
import json
import math
import os

BASE = "C:/BASE/DEV"
OUT = "C:/BASE/DEV/PROJECTS/GROWTH-APP/public/data"

# Load 250m cells
with open(os.path.join(BASE, "growth_cell_data.json"), "r") as f:
    raw = json.load(f)

cells_250 = raw["cells"]
print(f"Loaded {len(cells_250)} cells at 250m")

# Bucket cells into 500m blocks using floor division
BLOCK = 500.0
blocks: dict[tuple[int, int], list[dict]] = {}

for cid, c in cells_250.items():
    bx = int(math.floor(c["cx"] / BLOCK))
    by = int(math.floor(c["cy"] / BLOCK))
    key = (bx, by)
    if key not in blocks:
        blocks[key] = []
    blocks[key].append(c)

print(f"Total 500m blocks: {len(blocks)}")

# Build 500m cells: require >= 2 underlying 250m cells (out of max 4)
MIN_CELLS = 2
cells_500m: dict[str, dict] = {}
block_id = 0

for (bx, by), members in blocks.items():
    if len(members) < MIN_CELLS:
        continue

    n = len(members)
    cx = sum(m["cx"] for m in members) / n
    cy = sum(m["cy"] for m in members) / n
    cz = sum(m["cz"] for m in members) / n
    hf = sum(m["hf"] for m in members) / n
    sl = sum(m["sl"] for m in members) / n
    suit = sum(m["suit"] for m in members) / n

    cells_500m[str(block_id)] = {
        "cx": round(cx, 1),
        "cy": round(cy, 1),
        "cz": round(cz, 1),
        "hf": round(hf, 2),
        "sl": round(sl, 2),
        "suit": round(suit, 4),
        "n250": n,
        "_bx": bx,
        "_by": by,
    }
    block_id += 1

print(f"Buildable 500m cells (>={MIN_CELLS} underlying): {len(cells_500m)}")
print(f"Total buildable area: {len(cells_500m) * 0.25:.0f} km²")

# Find seed (furthest SW with slope < 15) and target (highest suitability)
best_seed = None
best_seed_sum = float("inf")
best_target = None
best_target_suit = -1.0

for cid, c in cells_500m.items():
    if c["sl"] < 15.0:
        s = c["cx"] + c["cy"]
        if s < best_seed_sum:
            best_seed_sum = s
            best_seed = cid
    if c["suit"] > best_target_suit:
        best_target_suit = c["suit"]
        best_target = cid

print(f"Seed: {best_seed} ({cells_500m[best_seed]['cx']:.0f}, {cells_500m[best_seed]['cy']:.0f})")
print(f"Target: {best_target} ({cells_500m[best_target]['cx']:.0f}, {cells_500m[best_target]['cy']:.0f})")

# Build adjacency (8-connected, 750m threshold for 500m grid)
THRESHOLD = 750.0
THRESHOLD_SQ = THRESHOLD * THRESHOLD

coord_to_id: dict[tuple[int, int], str] = {}
for cid, c in cells_500m.items():
    coord_to_id[(c["_bx"], c["_by"])] = cid

adjacency: dict[str, list[str]] = {}
offsets = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]

for cid, c in cells_500m.items():
    bx, by = c["_bx"], c["_by"]
    neighbors = []
    for dx, dy in offsets:
        nkey = (bx + dx, by + dy)
        nid = coord_to_id.get(nkey)
        if nid is not None:
            nc = cells_500m[nid]
            dist_sq = (c["cx"] - nc["cx"])**2 + (c["cy"] - nc["cy"])**2
            if dist_sq <= THRESHOLD_SQ:
                neighbors.append(nid)
    adjacency[cid] = neighbors

nc = [len(v) for v in adjacency.values()]
edges = sum(nc) // 2
avg_n = sum(nc) / len(nc) if nc else 0
iso = sum(1 for x in nc if x == 0)

print(f"\nAdjacency stats:")
print(f"  Edges: {edges}")
print(f"  Avg neighbors: {avg_n:.2f}")
print(f"  Isolated: {iso}")
print(f"  Min/Max: {min(nc)}/{max(nc)}")

dist = {}
for x in nc:
    dist[x] = dist.get(x, 0) + 1
for k in sorted(dist):
    print(f"    {k} nbr: {dist[k]}")

# Strip internal keys
for c in cells_500m.values():
    c.pop("_bx", None)
    c.pop("_by", None)

# Save
cell_out = {
    "count": len(cells_500m),
    "seed": int(best_seed),
    "target": int(best_target),
    "cell_size_m": 500,
    "cell_area_km2": 0.25,
    "cells": cells_500m,
}

os.makedirs(OUT, exist_ok=True)

p1 = os.path.join(OUT, "growth_cell_data_500m.json")
with open(p1, "w") as f:
    json.dump(cell_out, f)

p2 = os.path.join(OUT, "growth_adjacency_500m.json")
with open(p2, "w") as f:
    json.dump(adjacency, f)

s1 = os.path.getsize(p1)
s2 = os.path.getsize(p2)

print(f"\nOutput:")
print(f"  {p1} ({s1/1e3:.1f} KB)")
print(f"  {p2} ({s2/1e3:.1f} KB)")
