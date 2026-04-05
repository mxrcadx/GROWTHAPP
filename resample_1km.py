"""Resample 250m growth grid to 1km grid by averaging 4x4 blocks."""
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

# Bucket cells into 1km blocks using floor division
BLOCK = 1000.0
blocks: dict[tuple[int, int], list[dict]] = {}

for cid, c in cells_250.items():
    bx = int(math.floor(c["cx"] / BLOCK))
    by = int(math.floor(c["cy"] / BLOCK))
    key = (bx, by)
    if key not in blocks:
        blocks[key] = []
    blocks[key].append(c)

print(f"Total 1km blocks: {len(blocks)}")

# Build 1km cells: require >= 8 underlying 250m cells
MIN_CELLS = 8
cells_1km: dict[str, dict] = {}
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

    cells_1km[str(block_id)] = {
        "cx": round(cx, 1),
        "cy": round(cy, 1),
        "cz": round(cz, 1),
        "hf": round(hf, 2),
        "sl": round(sl, 2),
        "suit": round(suit, 4),
        "n250": n,  # how many 250m cells contributed
        "_bx": bx,
        "_by": by,
    }
    block_id += 1

print(f"Buildable 1km cells (>={MIN_CELLS} underlying): {len(cells_1km)}")
print(f"Total buildable area: {len(cells_1km) * 1.0:.0f} km²")

# Find seed (furthest SW with slope < 15) and target (highest suitability)
best_seed = None
best_seed_sum = float("inf")
best_target = None
best_target_suit = -1.0

for cid, c in cells_1km.items():
    if c["sl"] < 15.0:
        s = c["cx"] + c["cy"]
        if s < best_seed_sum:
            best_seed_sum = s
            best_seed = cid
    if c["suit"] > best_target_suit:
        best_target_suit = c["suit"]
        best_target = cid

print(f"Seed: {best_seed} ({cells_1km[best_seed]['cx']:.0f}, {cells_1km[best_seed]['cy']:.0f})")
print(f"Target: {best_target} ({cells_1km[best_target]['cx']:.0f}, {cells_1km[best_target]['cy']:.0f})")

# Build adjacency (8-connected, 1.5km threshold)
THRESHOLD = 1500.0
THRESHOLD_SQ = THRESHOLD * THRESHOLD

# Build spatial index using original block keys
coord_to_id: dict[tuple[int, int], str] = {}
for cid, c in cells_1km.items():
    coord_to_id[(c["_bx"], c["_by"])] = cid

adjacency: dict[str, list[str]] = {}
offsets = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]

for cid, c in cells_1km.items():
    bx, by = c["_bx"], c["_by"]
    neighbors = []
    for dx, dy in offsets:
        nkey = (bx + dx, by + dy)
        nid = coord_to_id.get(nkey)
        if nid is not None:
            nc = cells_1km[nid]
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

# Distribution
dist = {}
for x in nc:
    dist[x] = dist.get(x, 0) + 1
for k in sorted(dist):
    print(f"    {k} nbr: {dist[k]}")

# Strip internal keys before saving
for c in cells_1km.values():
    c.pop("_bx", None)
    c.pop("_by", None)

# Save
cell_out = {
    "count": len(cells_1km),
    "seed": int(best_seed),
    "target": int(best_target),
    "cell_size_m": 1000,
    "cell_area_km2": 1.0,
    "cells": cells_1km,
}

os.makedirs(OUT, exist_ok=True)

p1 = os.path.join(OUT, "growth_cell_data_1km.json")
with open(p1, "w") as f:
    json.dump(cell_out, f)

p2 = os.path.join(OUT, "growth_adjacency_1km.json")
with open(p2, "w") as f:
    json.dump(adjacency, f)

s1 = os.path.getsize(p1)
s2 = os.path.getsize(p2)

print(f"\nOutput:")
print(f"  {p1} ({s1/1e3:.1f} KB)")
print(f"  {p2} ({s2/1e3:.1f} KB)")
