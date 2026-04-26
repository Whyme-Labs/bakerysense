/**
 * Hierarchical reconciliation for multi-level forecasts.
 *
 * Problem: SKU-level forecasts produced independently don't sum to the
 * category-level forecast or the tenant-total forecast. Operators see
 * incoherent numbers ("we predict 130 baguettes for branch A but the
 * BREAD-category total is 125 — which is right?").
 *
 * Solution: project base forecasts onto the coherent subspace of the
 * hierarchy. Two methods supported:
 *
 * 1. **Bottom-up** — trust only the leaves; aggregate upward. Simple,
 *    optimal when leaf forecasts are unbiased and uncorrelated. Loses
 *    information that higher-level forecasts may carry.
 *
 * 2. **OLS-MinT** — solve a least-squares projection that minimises the
 *    sum of squared adjustments to all levels jointly. Produces coherent
 *    forecasts that respect both the leaf models AND any direct higher-
 *    level signal (e.g. seasonal totals from a separate FM).
 *
 * V1.5 uses bottom-up by default — we don't yet have separate higher-
 * level forecasters. When V2 lands, OLS-MinT becomes valuable: TimesFM
 * can produce a category-level forecast directly (its context window is
 * shorter than per-SKU sales but the aggregate is denser), and we
 * reconcile against the SKU-level prediction.
 *
 * Reference: Hyndman et al., "Optimal forecast reconciliation for
 * hierarchical and grouped time series", Computational Statistics & Data
 * Analysis 97 (2016).
 */

export interface Node {
  id: string;
  /** Children IDs. Empty array = leaf. */
  children: string[];
}

export interface Hierarchy {
  /** Root node ID (the tenant total). */
  root: string;
  /** All nodes keyed by id. Must include root and all leaves and every
   *  intermediate level. */
  nodes: Record<string, Node>;
}

/** Walks the tree from root and returns nodes in post-order (children
 *  before parents) — useful for bottom-up aggregation. */
export function postOrder(h: Hierarchy): string[] {
  const out: string[] = [];
  const visit = (id: string): void => {
    const n = h.nodes[id];
    if (!n) return;
    for (const c of n.children) visit(c);
    out.push(id);
  };
  visit(h.root);
  return out;
}

export function leaves(h: Hierarchy): string[] {
  return Object.values(h.nodes)
    .filter((n) => n.children.length === 0)
    .map((n) => n.id);
}

/**
 * Bottom-up reconciliation: take leaf forecasts, sum upward into all
 * ancestors. Any base forecast supplied for non-leaves is overwritten.
 */
export function bottomUp(
  h: Hierarchy,
  base: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of postOrder(h)) {
    const n = h.nodes[id];
    if (n.children.length === 0) {
      out[id] = base[id] ?? 0;
    } else {
      let sum = 0;
      for (const c of n.children) sum += out[c] ?? 0;
      out[id] = sum;
    }
  }
  return out;
}

/**
 * OLS-MinT reconciliation. Solves the closed form:
 *
 *   reconciled = S (S' S)^-1 S' base
 *
 * where S is the summing matrix mapping leaves → all levels and base is
 * the column vector of base forecasts at every node.
 *
 * Implementation note: for typical bakery hierarchies (≤ a few hundred
 * leaves) this is fine to compute in pure JS without a BLAS dependency.
 * If we ever forecast against thousands of leaves, port to wasm-blas.
 */
export function olsMinT(
  h: Hierarchy,
  base: Record<string, number>,
): Record<string, number> {
  const allIds = postOrder(h);
  const leafIds = leaves(h);
  const ancestorsOf = (leaf: string): string[] => {
    const out: string[] = [];
    for (const id of allIds) {
      const n = h.nodes[id];
      if (containsLeaf(h, n, leaf)) out.push(id);
    }
    return out;
  };

  // Build the FULL summing matrix S_full (m × n): rows = all nodes,
  // cols = leaves. S_full[i,j] = 1 iff node i is an ancestor of (or
  // equals) leaf j.
  const m = allIds.length;
  const n = leafIds.length;
  const S_full: number[][] = Array.from({ length: m }, () => Array(n).fill(0));
  const leafIndex = new Map(leafIds.map((id, j) => [id, j]));
  const nodeIndex = new Map(allIds.map((id, i) => [id, i]));
  for (const leaf of leafIds) {
    const j = leafIndex.get(leaf)!;
    for (const anc of ancestorsOf(leaf)) {
      const i = nodeIndex.get(anc);
      if (i != null) S_full[i][j] = 1;
    }
  }

  // OLS-MinT projects observed base forecasts onto the coherent
  // subspace. "Observed" means a base forecast was actually supplied —
  // missing values must NOT be treated as zero (that would pull every
  // unobserved level toward zero). Filter S to the rows where base is
  // defined; if only leaves are observed, the projection collapses to
  // the identity (== bottom-up).
  const observed: { id: string; rowIdx: number; value: number }[] = [];
  for (const id of allIds) {
    if (base[id] !== undefined) {
      observed.push({ id, rowIdx: nodeIndex.get(id)!, value: base[id] });
    }
  }

  // Defensive fallback — caller passed nothing useful; emit zeros.
  if (observed.length === 0) {
    const out: Record<string, number> = {};
    for (const id of allIds) out[id] = 0;
    return out;
  }

  const S_obs = observed.map((o) => S_full[o.rowIdx]);
  const y_obs = observed.map((o) => o.value);

  // Compute G = (S_obs' S_obs)^-1 S_obs'   →  shape (n × |observed|)
  const StS = matMul(transpose(S_obs), S_obs);   // n × n
  const StSinv = invertSmallMatrix(StS);          // n × n
  const G = matMul(StSinv, transpose(S_obs));     // n × |observed|

  // Reconciled bottom-level forecasts: b = G y_obs
  const b = matVec(G, y_obs);

  // Lift back to all levels via the FULL summing matrix.
  const r = matVec(S_full, b);

  const out: Record<string, number> = {};
  for (let i = 0; i < m; i++) out[allIds[i]] = r[i];
  return out;
}

// ──── small linear-algebra helpers (no external deps) ────────────────────

function transpose(A: number[][]): number[][] {
  const r = A.length;
  const c = A[0]?.length ?? 0;
  const out: number[][] = Array.from({ length: c }, () => Array(r).fill(0));
  for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) out[j][i] = A[i][j];
  return out;
}

function matMul(A: number[][], B: number[][]): number[][] {
  const r = A.length;
  const k = A[0]?.length ?? 0;
  const c = B[0]?.length ?? 0;
  const out: number[][] = Array.from({ length: r }, () => Array(c).fill(0));
  for (let i = 0; i < r; i++) {
    for (let j = 0; j < c; j++) {
      let s = 0;
      for (let l = 0; l < k; l++) s += A[i][l] * B[l][j];
      out[i][j] = s;
    }
  }
  return out;
}

function matVec(A: number[][], x: number[]): number[] {
  const r = A.length;
  const c = A[0]?.length ?? 0;
  const out = Array(r).fill(0);
  for (let i = 0; i < r; i++) {
    let s = 0;
    for (let j = 0; j < c; j++) s += A[i][j] * x[j];
    out[i] = s;
  }
  return out;
}

/** Gauss-Jordan inverse for small symmetric positive-definite matrices.
 *  Caller is expected to know the matrix is invertible (it is for any
 *  non-degenerate hierarchy). */
function invertSmallMatrix(A: number[][]): number[][] {
  const n = A.length;
  const M: number[][] = A.map((row, i) => [
    ...row,
    ...Array(n).fill(0).map((_, j) => (i === j ? 1 : 0)),
  ]);
  for (let i = 0; i < n; i++) {
    // Pivot selection
    let pivot = i;
    for (let k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[pivot][i])) pivot = k;
    if (pivot !== i) [M[i], M[pivot]] = [M[pivot], M[i]];
    const div = M[i][i];
    if (Math.abs(div) < 1e-12) throw new Error("singular matrix in olsMinT");
    for (let j = 0; j < 2 * n; j++) M[i][j] /= div;
    for (let k = 0; k < n; k++) {
      if (k === i) continue;
      const factor = M[k][i];
      for (let j = 0; j < 2 * n; j++) M[k][j] -= factor * M[i][j];
    }
  }
  return M.map((row) => row.slice(n));
}

function containsLeaf(h: Hierarchy, n: Node, leaf: string): boolean {
  if (n.id === leaf) return true;
  for (const c of n.children) {
    const child = h.nodes[c];
    if (!child) continue;
    if (containsLeaf(h, child, leaf)) return true;
  }
  return false;
}

// ──── builders for typical bakery hierarchies ────────────────────────────

/**
 * Build a tenant → branch → SKU hierarchy. Useful when you have base
 * forecasts at every level and want to reconcile across branches and
 * SKUs simultaneously.
 */
export function buildTenantHierarchy(
  tenantId: string,
  branchSkus: Record<string, string[]>,  // branchId → SKU IDs at that branch
): Hierarchy {
  const nodes: Record<string, Node> = {
    [tenantId]: { id: tenantId, children: Object.keys(branchSkus) },
  };
  for (const [branchId, skus] of Object.entries(branchSkus)) {
    nodes[branchId] = { id: branchId, children: skus };
    for (const sku of skus) {
      nodes[sku] = { id: sku, children: [] };
    }
  }
  return { root: tenantId, nodes };
}
