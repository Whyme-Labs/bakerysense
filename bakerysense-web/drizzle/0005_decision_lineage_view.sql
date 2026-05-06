-- Decision lineage convenience view (Tier 2).
--
-- Joins forecast_snapshots → model_versions → retrain_events into a single
-- row per snapshot for direct querying via `wrangler d1 execute`. The
-- application code uses src/lib/lineage.ts#getDecisionLineage which does
-- the same join in TypeScript; the view exists for ad-hoc audit / SOC2
-- reporting use cases where wiring up the Worker is overkill.
--
-- Pre-lineage rows (forecast_snapshots with NULL model_version_id) appear
-- with NULL columns from the joined sides — the view does not filter them
-- out, so a tenant can count "% of decisions with full lineage" trivially:
--
--     SELECT COUNT(*) FILTER (WHERE model_version_id IS NOT NULL) AS linked,
--            COUNT(*)                                              AS total
--     FROM decision_lineage_v
--     WHERE tenant_id = '<tid>';
CREATE VIEW `decision_lineage_v` AS
SELECT
    fs.id                          AS snapshot_id,
    fs.tenant_id,
    fs.branch_id,
    fs.family,
    fs.date,
    fs.bake_quantity,
    fs.served_at,
    fs.model_version_id,
    mv.model_kind,
    mv.version_number,
    mv.r2_key                      AS model_r2_key,
    mv.parent_model_id,
    mv.trained_at,
    mv.training_window_start,
    mv.training_window_end,
    mv.training_actuals_count,
    mv.validation_metrics_json,
    mv.status                      AS model_status,
    mv.activated_at                AS model_activated_at,
    mv.superseded_at               AS model_superseded_at,
    re.id                          AS retrain_event_id,
    re.triggered_by                AS retrain_triggered_by,
    re.triggered_by_user_id        AS retrain_triggered_by_user_id,
    re.trigger_metric              AS retrain_trigger_metric,
    re.trigger_value               AS retrain_trigger_value,
    re.trigger_threshold           AS retrain_trigger_threshold,
    re.status                      AS retrain_status,
    re.status_message              AS retrain_status_message,
    re.started_at                  AS retrain_started_at,
    re.completed_at                AS retrain_completed_at
FROM forecast_snapshots fs
LEFT JOIN model_versions mv  ON mv.id = fs.model_version_id
LEFT JOIN retrain_events re  ON re.output_model_id = mv.id;
