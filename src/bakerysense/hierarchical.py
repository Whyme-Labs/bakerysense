"""Hierarchical reconciliation for multi-level forecasts.

Python port of bakerysense-web/src/lib/hierarchical.ts (Sprint 4).
Same semantics, numpy for the linear algebra.

Two methods:

  1. bottom_up — trust leaves, aggregate upward. Optimal when leaf
     forecasts are unbiased and uncorrelated.

  2. ols_mint — closed-form OLS projection onto the coherent subspace.
     Reconciles base forecasts at every observed level into a coherent
     set. Filters S to observed rows so missing forecasts at higher
     levels aren't treated as zero (a real bug fixed in the TS port).

Reference: Hyndman et al., "Optimal forecast reconciliation for
hierarchical and grouped time series", CSDA 97 (2016).
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class Hierarchy:
    """Tree as (root_id, {node_id: [child_ids]})."""
    root: str
    nodes: dict[str, list[str]]

    def post_order(self) -> list[str]:
        """Children before parents — for bottom-up sums."""
        out: list[str] = []
        def visit(node_id: str) -> None:
            for c in self.nodes.get(node_id, []):
                visit(c)
            out.append(node_id)
        visit(self.root)
        return out

    def leaves(self) -> list[str]:
        return [nid for nid, kids in self.nodes.items() if not kids]

    def descendants(self, node_id: str) -> set[str]:
        """All leaves under a given node."""
        if node_id not in self.nodes:
            return set()
        kids = self.nodes[node_id]
        if not kids:
            return {node_id}
        out: set[str] = set()
        for c in kids:
            out |= self.descendants(c)
        return out


def bottom_up(h: Hierarchy, base: dict[str, float]) -> dict[str, float]:
    """Take leaf forecasts in `base`; compute every ancestor as the sum
    of its children. Any base value at a non-leaf is overwritten."""
    out: dict[str, float] = {}
    for nid in h.post_order():
        kids = h.nodes.get(nid, [])
        if not kids:
            out[nid] = float(base.get(nid, 0.0))
        else:
            out[nid] = float(sum(out.get(c, 0.0) for c in kids))
    return out


def ols_mint(h: Hierarchy, base: dict[str, float]) -> dict[str, float]:
    """OLS-MinT closed-form reconciliation:

        b̂  = (Sᵀ_obs S_obs)⁻¹ Sᵀ_obs y_obs
        ŷ  = S_full b̂

    where S_full maps leaves → all nodes (rows = nodes, cols = leaves;
    1 if node is an ancestor of leaf, else 0). S_obs is S_full filtered
    to rows for which `base` actually has a forecast — missing higher-
    level forecasts are NOT zeroed (which would bias every unobserved
    level toward zero)."""
    all_ids = h.post_order()
    leaf_ids = h.leaves()
    n_nodes = len(all_ids)
    n_leaves = len(leaf_ids)

    leaf_index = {lid: j for j, lid in enumerate(leaf_ids)}
    node_index = {nid: i for i, nid in enumerate(all_ids)}

    # S_full: (n_nodes, n_leaves), S[i,j]=1 iff node i is an ancestor of leaf j
    S_full = np.zeros((n_nodes, n_leaves))
    for nid in all_ids:
        i = node_index[nid]
        for desc in h.descendants(nid):
            j = leaf_index.get(desc)
            if j is not None:
                S_full[i, j] = 1.0

    # Filter to observed rows
    observed_idx = [node_index[nid] for nid in all_ids if nid in base]
    if not observed_idx:
        return {nid: 0.0 for nid in all_ids}

    S_obs = S_full[observed_idx, :]
    y_obs = np.array([float(base[all_ids[i]]) for i in observed_idx])

    # b̂ = (S_obsᵀ S_obs)⁻¹ S_obsᵀ y_obs  via least-squares for stability
    b_hat, *_ = np.linalg.lstsq(S_obs, y_obs, rcond=None)
    r = S_full @ b_hat
    return {all_ids[i]: float(r[i]) for i in range(n_nodes)}


def flat_hierarchy(leaves: list[str], root: str = "TOTAL") -> Hierarchy:
    """Single-level (root → leaves) hierarchy. Useful when you only have
    a tenant total and per-SKU leaves with no intermediate categories."""
    nodes = {root: list(leaves)}
    for lid in leaves:
        nodes[lid] = []
    return Hierarchy(root=root, nodes=nodes)


def two_level_hierarchy(
    families: dict[str, list[str]],
    root: str = "TOTAL",
) -> Hierarchy:
    """root → family → leaves. `families` maps family_name → [sku_ids]."""
    nodes: dict[str, list[str]] = {root: list(families.keys())}
    for fam, skus in families.items():
        nodes[fam] = list(skus)
        for sku in skus:
            nodes[sku] = []
    return Hierarchy(root=root, nodes=nodes)
