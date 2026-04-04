ALTER TABLE value_category_rules
  ADD CONSTRAINT value_category_rules_unique_match
  UNIQUE (user_id, match_type, match_value);
