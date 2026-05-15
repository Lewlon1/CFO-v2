-- Session 13 — Action items goal link & ranking
--
-- Adds an optional goal_id foreign key to action_items so the CFO can attach
-- a goal context to actions it creates, and so get_action_items can rank
-- goal-matched actions ahead of others.
--
-- ON DELETE SET NULL — if a goal is hard-deleted, action items survive but
-- become unlinked. The category-match heuristic still ranks goal-adjacent
-- categories (goal_setting, savings_transfer) above unrelated actions.
-- Soft-delete (deleted_at IS NOT NULL on goals) does not cascade here;
-- ranking logic in the tool layer is responsible for filtering to active
-- goals before deciding tier 1 membership.

ALTER TABLE action_items
ADD COLUMN goal_id uuid REFERENCES goals(id) ON DELETE SET NULL;

CREATE INDEX idx_action_items_goal ON action_items (goal_id)
WHERE goal_id IS NOT NULL;
