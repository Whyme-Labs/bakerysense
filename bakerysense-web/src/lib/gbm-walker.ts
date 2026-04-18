export interface TreeArrays {
  split_feature: number[];
  threshold: number[];
  decision_type: number[];             // 2 = <=, 1 = <, 3 = == (categorical bitmask)
  left_child: number[];                // non-negative = internal idx; negative = ~leaf_idx
  right_child: number[];
  leaf_value: number[];
  default_left?: number[];             // 1 = NaN/missing goes left, 0 = goes right
  cat_threshold?: (number[] | null)[]; // per-node: sorted int[] for categorical (dt==3), null otherwise
}

export interface Model {
  feature_names: string[];
  num_trees: number;
  trees: TreeArrays[];
}

export function loadTrees(raw: unknown): Model {
  const m = raw as Model;
  if (!m || !Array.isArray(m.trees) || !Array.isArray(m.feature_names)) {
    throw new Error("invalid trees payload");
  }
  return m;
}

function featureVector(model: Model, row: Record<string, number>): number[] {
  const v = new Array<number>(model.feature_names.length);
  for (let i = 0; i < model.feature_names.length; i++) {
    const name = model.feature_names[i];
    v[i] = row[name] ?? 0;
  }
  return v;
}

export function predict(model: Model, row: Record<string, number>): number {
  const v = featureVector(model, row);
  let sum = 0;
  for (const t of model.trees) sum += walkTree(t, v);
  return sum;
}

function walkTree(t: TreeArrays, v: number[]): number {
  // Root-is-leaf case: no internal nodes, one leaf_value[0]
  if (t.split_feature.length === 0) {
    return t.leaf_value[0] ?? 0;
  }
  let node = 0;
  while (node >= 0) {
    const f = t.split_feature[node];
    const th = t.threshold[node];
    const dt = t.decision_type[node];
    const x = v[f];
    let goLeft: boolean;
    if (Number.isNaN(x) || x === undefined) {
      // NaN/missing: use default_left flag if present; default to right
      goLeft = t.default_left != null ? t.default_left[node] === 1 : false;
    } else if (dt === 3) {
      // Categorical split: check if x's integer code is in the allowed set
      const catSet = t.cat_threshold?.[node];
      goLeft = catSet != null ? catSet.includes(Math.round(x)) : false;
    } else {
      goLeft = dt === 1 ? x < th : x <= th;
    }
    const next = goLeft ? t.left_child[node] : t.right_child[node];
    if (next < 0) return t.leaf_value[~next];
    node = next;
  }
  throw new Error("unreachable tree walk");
}

/**
 * Approximate SHAP contributions: at each split along the chosen path,
 * attribute (chosen_subtree_avg - other_subtree_avg) / 2 to the split feature.
 *
 * This is not full TreeSHAP (which would be O(L^2 * depth)) — it's a
 * path-traversal heuristic. Directional and relative-magnitude are
 * reliable; exact contributions are not. For merchant-facing explanations
 * ("why is this forecast higher than usual?") this suffices.
 */
export function shapContribs(model: Model, row: Record<string, number>): Record<string, number> {
  const contribs: Record<string, number> = {};
  for (const name of model.feature_names) contribs[name] = 0;

  const v = featureVector(model, row);
  for (const t of model.trees) {
    if (t.split_feature.length === 0) continue;
    let node = 0;
    while (node >= 0) {
      const f = t.split_feature[node];
      const th = t.threshold[node];
      const dt = t.decision_type[node];
      const x = v[f];
      let goLeft: boolean;
      if (Number.isNaN(x) || x === undefined) {
        goLeft = t.default_left != null ? t.default_left[node] === 1 : false;
      } else if (dt === 3) {
        const catSet = t.cat_threshold?.[node];
        goLeft = catSet != null ? catSet.includes(Math.round(x)) : false;
      } else {
        goLeft = dt === 1 ? x < th : x <= th;
      }
      const chosen = goLeft ? t.left_child[node] : t.right_child[node];
      const other  = goLeft ? t.right_child[node] : t.left_child[node];
      const chosenVal = subtreeAvg(t, chosen);
      const otherVal  = subtreeAvg(t, other);
      contribs[model.feature_names[f]] += (chosenVal - otherVal) / 2;
      if (chosen < 0) break;
      node = chosen;
    }
  }
  return contribs;
}

function subtreeAvg(t: TreeArrays, node: number): number {
  if (node < 0) return t.leaf_value[~node];
  // BFS average of reachable leaves
  const stack: number[] = [node];
  let total = 0, count = 0;
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (n < 0) { total += t.leaf_value[~n]; count++; continue; }
    stack.push(t.left_child[n]);
    stack.push(t.right_child[n]);
  }
  return count === 0 ? 0 : total / count;
}
