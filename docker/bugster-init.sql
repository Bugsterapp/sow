-- Bugster-like analytics schema for integration testing
-- Real-world pattern: UUID PKs, jsonb columns, no FK constraints, many tables

CREATE TABLE projects (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  user_id uuid NOT NULL,
  name character varying NOT NULL,
  posthog_host character varying DEFAULT 'https://us.posthog.com' NOT NULL,
  posthog_project_id character varying NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  review_required boolean DEFAULT true NOT NULL,
  deleted_at timestamptz,
  analysis_filters jsonb
);

CREATE TABLE project_access (
  project_id uuid NOT NULL,
  email text NOT NULL,
  user_id uuid,
  added_by uuid,
  created_at timestamptz DEFAULT now() NOT NULL,
  PRIMARY KEY (project_id, email)
);

CREATE TABLE project_context (
  project_id uuid NOT NULL PRIMARY KEY,
  product_description text,
  updated_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE project_credentials (
  project_id uuid NOT NULL PRIMARY KEY,
  posthog_api_key text NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE analysis_runs (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  project_id uuid NOT NULL,
  status character varying DEFAULT 'running' NOT NULL,
  sessions_total integer DEFAULT 0 NOT NULL,
  sessions_processed integer DEFAULT 0 NOT NULL,
  issues_found integer DEFAULT 0 NOT NULL,
  started_at timestamptz DEFAULT now() NOT NULL,
  completed_at timestamptz,
  sessions_with_issues integer DEFAULT 0 NOT NULL,
  sessions_without_issues integer DEFAULT 0 NOT NULL,
  groups_created integer DEFAULT 0 NOT NULL
);

CREATE TABLE issue_groups (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  project_id uuid NOT NULL,
  fingerprint character varying NOT NULL,
  type character varying NOT NULL,
  severity character varying DEFAULT 'warning' NOT NULL,
  title character varying NOT NULL,
  description text,
  affected_element text,
  first_seen timestamptz DEFAULT now() NOT NULL,
  last_seen timestamptz DEFAULT now() NOT NULL,
  occurrence_count integer DEFAULT 1 NOT NULL,
  session_count integer DEFAULT 1 NOT NULL,
  affected_users jsonb DEFAULT '[]' NOT NULL,
  sample_session_ids jsonb DEFAULT '[]' NOT NULL,
  sample_replay_url text,
  status character varying DEFAULT 'open' NOT NULL,
  linear_issue_id character varying,
  source character varying,
  created_at timestamptz DEFAULT now() NOT NULL,
  feedback character varying,
  feedback_note text,
  pinned boolean DEFAULT false NOT NULL
);

CREATE TABLE issues (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  project_id uuid NOT NULL,
  session_id character varying NOT NULL,
  type character varying NOT NULL,
  severity character varying NOT NULL,
  title character varying NOT NULL,
  description text,
  affected_element text,
  user_journey jsonb DEFAULT '[]' NOT NULL,
  technical_details jsonb DEFAULT '{}' NOT NULL,
  replay_url text,
  replay_embed_token text,
  session_metadata jsonb DEFAULT '{}' NOT NULL,
  status character varying DEFAULT 'open' NOT NULL,
  linear_issue_id character varying,
  created_at timestamptz DEFAULT now() NOT NULL,
  fingerprint character varying,
  source character varying,
  group_id uuid
);

CREATE TABLE pending_issues (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  project_id uuid NOT NULL,
  session_id character varying NOT NULL,
  type character varying NOT NULL,
  severity character varying NOT NULL,
  title character varying NOT NULL,
  description text,
  affected_element text,
  user_journey jsonb DEFAULT '[]' NOT NULL,
  technical_details jsonb DEFAULT '{}' NOT NULL,
  replay_url text,
  replay_embed_token text,
  session_metadata jsonb DEFAULT '{}' NOT NULL,
  fingerprint character varying,
  source character varying,
  recording_metadata jsonb DEFAULT '{}' NOT NULL,
  review_status character varying DEFAULT 'pending' NOT NULL,
  reviewed_at timestamptz,
  reviewed_by uuid,
  rejection_reason text,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE patterns (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  project_id uuid NOT NULL,
  name character varying NOT NULL,
  description text NOT NULL,
  severity character varying NOT NULL,
  pattern_type character varying NOT NULL,
  state character varying DEFAULT 'active' NOT NULL,
  embedding jsonb,
  first_seen_at timestamptz DEFAULT now() NOT NULL,
  last_seen_at timestamptz DEFAULT now() NOT NULL,
  resolved_at timestamptz,
  total_occurrence_count integer DEFAULT 0 NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE pattern_occurrences (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  pattern_id uuid NOT NULL,
  project_id uuid NOT NULL,
  session_id character varying NOT NULL,
  event_id character varying,
  run_id uuid,
  description character varying NOT NULL,
  embedding jsonb,
  "timestamp" timestamptz,
  current_url text,
  distinct_id character varying,
  person_display character varying,
  replay_url text,
  metadata jsonb,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE session_summaries (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  project_id uuid NOT NULL,
  session_id character varying NOT NULL,
  summary_text text NOT NULL,
  pages_visited jsonb DEFAULT '[]' NOT NULL,
  friction_points jsonb DEFAULT '[]' NOT NULL,
  drop_off_page text,
  drop_off_reason text,
  user_sentiment character varying,
  session_outcome character varying,
  session_duration numeric,
  distinct_id text,
  replay_url text,
  issues_found integer DEFAULT 0 NOT NULL,
  session_date date NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE event_session_summaries (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  project_id uuid NOT NULL,
  run_id uuid,
  session_id character varying NOT NULL,
  summary jsonb NOT NULL,
  url_mapping jsonb,
  event_ids_mapping jsonb,
  model_used character varying,
  video_validated boolean DEFAULT false NOT NULL,
  event_count integer DEFAULT 0 NOT NULL,
  session_metadata jsonb,
  replay_url text,
  created_at timestamptz DEFAULT now() NOT NULL,
  replay_embed_token character varying
);

CREATE TABLE session_processing_logs (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  project_id uuid NOT NULL,
  run_id uuid NOT NULL,
  session_id character varying NOT NULL,
  status character varying NOT NULL,
  issues_found integer DEFAULT 0 NOT NULL,
  error_message text,
  session_start_time timestamptz,
  session_end_time timestamptz,
  session_duration numeric,
  session_url text,
  replay_url text,
  processed_at timestamptz DEFAULT now() NOT NULL,
  processing_duration_ms integer,
  detection_source character varying,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE session_rules (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  project_id uuid NOT NULL,
  name character varying NOT NULL,
  posthog_event_name character varying NOT NULL,
  property_filters jsonb DEFAULT '{}' NOT NULL,
  verification_prompt text NOT NULL,
  window_before_ms integer DEFAULT 60000 NOT NULL,
  window_after_ms integer DEFAULT 420000 NOT NULL,
  active boolean DEFAULT true NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  output_categories jsonb
);

CREATE TABLE feedback_rules (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  project_id uuid NOT NULL,
  rule_type character varying NOT NULL,
  signal character varying NOT NULL,
  url_pattern text,
  element_pattern text,
  source_feedback character varying NOT NULL,
  source_group_id uuid,
  feedback_note text,
  match_count integer DEFAULT 0 NOT NULL,
  active boolean DEFAULT true NOT NULL,
  updated_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE insight_reports (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  project_id uuid NOT NULL,
  period_type character varying NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  headline_narrative text NOT NULL,
  top_friction_points jsonb DEFAULT '[]' NOT NULL,
  drop_off_highlights jsonb DEFAULT '[]' NOT NULL,
  critical_issues jsonb DEFAULT '[]' NOT NULL,
  session_stats jsonb DEFAULT '{}' NOT NULL,
  sessions_analyzed integer DEFAULT 0 NOT NULL,
  issues_found integer DEFAULT 0 NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE integrations (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  project_id uuid NOT NULL,
  type character varying NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE detector_run_metrics (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  run_id uuid NOT NULL,
  project_id uuid NOT NULL,
  session_id character varying NOT NULL,
  detector_name text NOT NULL,
  findings_raw_count integer DEFAULT 0 NOT NULL,
  findings_deduped_count integer DEFAULT 0 NOT NULL,
  signals jsonb DEFAULT '{}' NOT NULL,
  severity_counts jsonb DEFAULT '{}' NOT NULL,
  execution_time_ms integer,
  error text,
  created_at timestamptz DEFAULT now() NOT NULL
);

-- Indexes
CREATE INDEX idx_projects_user_id ON projects (user_id);
CREATE INDEX idx_issue_groups_project_id ON issue_groups (project_id);
CREATE INDEX idx_issue_groups_fingerprint ON issue_groups (fingerprint);
CREATE INDEX idx_issue_groups_status ON issue_groups (status);
CREATE INDEX idx_issues_project_id ON issues (project_id);
CREATE INDEX idx_issues_session_id ON issues (session_id);
CREATE INDEX idx_issues_fingerprint ON issues (fingerprint);
CREATE INDEX idx_issues_group_id ON issues (group_id);
CREATE INDEX idx_patterns_project_state ON patterns (project_id, state);
CREATE INDEX idx_pattern_occurrences_pattern ON pattern_occurrences (pattern_id);
CREATE INDEX idx_pattern_occurrences_session ON pattern_occurrences (session_id);
CREATE INDEX idx_analysis_runs_project_id ON analysis_runs (project_id);
CREATE INDEX idx_session_summaries_project_id ON session_summaries (project_id);
CREATE UNIQUE INDEX session_summaries_project_session ON session_summaries (project_id, session_id);
CREATE UNIQUE INDEX event_session_summaries_project_session ON event_session_summaries (project_id, session_id);
CREATE INDEX idx_session_processing_logs_run_id ON session_processing_logs (run_id);
CREATE INDEX idx_feedback_rules_project ON feedback_rules (project_id);
CREATE UNIQUE INDEX insight_reports_project_period ON insight_reports (project_id, period_type, period_start);
CREATE UNIQUE INDEX integrations_project_type ON integrations (project_id, type);
CREATE INDEX idx_detector_metrics_run ON detector_run_metrics (run_id);
CREATE INDEX idx_pending_issues_project_id ON pending_issues (project_id);
CREATE INDEX idx_project_access_user_id ON project_access (user_id);


-- ============================================================
-- Synthetic seed data (all fake -- no real user data)
-- ============================================================

-- Projects (owned by fake user UUIDs)
INSERT INTO projects (id, user_id, name, posthog_project_id) VALUES
  ('a1b2c3d4-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'Acme Dashboard', 'proj_acme_001'),
  ('a1b2c3d4-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000002', 'Widget Analytics', 'proj_widget_002'),
  ('a1b2c3d4-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000001', 'Mobile Tracker', 'proj_mobile_003'),
  ('a1b2c3d4-0000-4000-8000-000000000004', 'aaaaaaaa-0000-4000-8000-000000000003', 'E-Commerce Insights', 'proj_ecom_004'),
  ('a1b2c3d4-0000-4000-8000-000000000005', 'aaaaaaaa-0000-4000-8000-000000000004', 'Support Portal', 'proj_support_005');

-- Project access (with PII-like email addresses)
INSERT INTO project_access (project_id, email, user_id) VALUES
  ('a1b2c3d4-0000-4000-8000-000000000001', 'alice.fakerson@example.com', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('a1b2c3d4-0000-4000-8000-000000000001', 'bob.testington@example.com', 'aaaaaaaa-0000-4000-8000-000000000005'),
  ('a1b2c3d4-0000-4000-8000-000000000002', 'carol.mock@example.com', 'aaaaaaaa-0000-4000-8000-000000000002'),
  ('a1b2c3d4-0000-4000-8000-000000000002', 'dave.synthetic@example.com', 'aaaaaaaa-0000-4000-8000-000000000006'),
  ('a1b2c3d4-0000-4000-8000-000000000003', 'eve.placeholder@example.com', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('a1b2c3d4-0000-4000-8000-000000000004', 'frank.dummy@example.com', 'aaaaaaaa-0000-4000-8000-000000000003'),
  ('a1b2c3d4-0000-4000-8000-000000000005', 'grace.fixture@example.com', 'aaaaaaaa-0000-4000-8000-000000000004');

-- Project context
INSERT INTO project_context (project_id, product_description) VALUES
  ('a1b2c3d4-0000-4000-8000-000000000001', 'Internal dashboard for sales analytics and reporting'),
  ('a1b2c3d4-0000-4000-8000-000000000002', 'Widget configuration and performance monitoring tool'),
  ('a1b2c3d4-0000-4000-8000-000000000004', 'E-commerce checkout funnel analysis platform');

-- Project credentials (fake API keys)
INSERT INTO project_credentials (project_id, posthog_api_key) VALUES
  ('a1b2c3d4-0000-4000-8000-000000000001', 'phc_fake_key_acme_001_not_real'),
  ('a1b2c3d4-0000-4000-8000-000000000002', 'phc_fake_key_widget_002_not_real'),
  ('a1b2c3d4-0000-4000-8000-000000000003', 'phc_fake_key_mobile_003_not_real'),
  ('a1b2c3d4-0000-4000-8000-000000000004', 'phc_fake_key_ecom_004_not_real'),
  ('a1b2c3d4-0000-4000-8000-000000000005', 'phc_fake_key_support_005_not_real');

-- Analysis runs
INSERT INTO analysis_runs (project_id, status, sessions_total, sessions_processed, issues_found, sessions_with_issues, sessions_without_issues, groups_created, completed_at) VALUES
  ('a1b2c3d4-0000-4000-8000-000000000001', 'completed', 150, 150, 23, 18, 132, 5, now() - interval '1 hour'),
  ('a1b2c3d4-0000-4000-8000-000000000001', 'completed', 200, 200, 31, 25, 175, 7, now() - interval '2 days'),
  ('a1b2c3d4-0000-4000-8000-000000000002', 'completed', 80, 80, 12, 10, 70, 3, now() - interval '6 hours'),
  ('a1b2c3d4-0000-4000-8000-000000000002', 'running', 100, 45, 8, 6, 39, 2, NULL),
  ('a1b2c3d4-0000-4000-8000-000000000003', 'completed', 50, 50, 5, 4, 46, 1, now() - interval '12 hours'),
  ('a1b2c3d4-0000-4000-8000-000000000004', 'failed', 300, 120, 0, 0, 120, 0, now() - interval '3 hours');

-- Issue groups
INSERT INTO issue_groups (project_id, fingerprint, type, severity, title, description, affected_element, occurrence_count, session_count, status, source) VALUES
  ('a1b2c3d4-0000-4000-8000-000000000001', 'fp_btn_unresponsive_001', 'ux', 'critical', 'Submit button unresponsive on checkout', 'Users click submit but nothing happens for 3+ seconds', 'button#checkout-submit', 45, 32, 'open', 'auto'),
  ('a1b2c3d4-0000-4000-8000-000000000001', 'fp_form_error_002', 'ux', 'warning', 'Form validation error unclear', 'Error message does not indicate which field failed', 'form.signup-form', 23, 18, 'open', 'auto'),
  ('a1b2c3d4-0000-4000-8000-000000000001', 'fp_page_crash_003', 'error', 'critical', 'Dashboard crashes on date filter', 'React error boundary triggered when selecting custom date range', 'div.date-picker', 12, 12, 'resolved', 'auto'),
  ('a1b2c3d4-0000-4000-8000-000000000002', 'fp_slow_load_004', 'performance', 'warning', 'Widget config page loads slowly', 'Page takes over 5s to render due to unoptimized API calls', 'div#widget-config', 67, 45, 'open', 'auto'),
  ('a1b2c3d4-0000-4000-8000-000000000002', 'fp_dropdown_005', 'ux', 'info', 'Dropdown menu closes unexpectedly', 'Menu closes when hovering between items on mobile', 'nav.dropdown-menu', 8, 5, 'open', 'manual'),
  ('a1b2c3d4-0000-4000-8000-000000000004', 'fp_cart_empty_006', 'ux', 'critical', 'Cart empties after login redirect', 'Items added to cart disappear after OAuth login flow', 'div.shopping-cart', 90, 78, 'open', 'auto'),
  ('a1b2c3d4-0000-4000-8000-000000000004', 'fp_payment_007', 'error', 'critical', 'Payment fails silently', 'Stripe payment intent fails but no error shown to user', 'div.payment-form', 15, 15, 'open', 'auto');

-- Issues (individual occurrences)
INSERT INTO issues (project_id, session_id, type, severity, title, description, replay_url, status, fingerprint, source, group_id) VALUES
  ('a1b2c3d4-0000-4000-8000-000000000001', 'sess_abc001', 'ux', 'critical', 'Submit button unresponsive on checkout', 'User clicked submit 4 times', 'https://app.posthog.com/replay/sess_abc001', 'open', 'fp_btn_unresponsive_001', 'auto', NULL),
  ('a1b2c3d4-0000-4000-8000-000000000001', 'sess_abc002', 'ux', 'critical', 'Submit button unresponsive on checkout', 'User gave up after 10 seconds', 'https://app.posthog.com/replay/sess_abc002', 'open', 'fp_btn_unresponsive_001', 'auto', NULL),
  ('a1b2c3d4-0000-4000-8000-000000000001', 'sess_abc003', 'ux', 'warning', 'Form validation error unclear', 'User tried 3 different email formats', 'https://app.posthog.com/replay/sess_abc003', 'open', 'fp_form_error_002', 'auto', NULL),
  ('a1b2c3d4-0000-4000-8000-000000000002', 'sess_def001', 'performance', 'warning', 'Widget config page loads slowly', 'Page load took 7.2 seconds', 'https://app.posthog.com/replay/sess_def001', 'open', 'fp_slow_load_004', 'auto', NULL),
  ('a1b2c3d4-0000-4000-8000-000000000002', 'sess_def002', 'ux', 'info', 'Dropdown menu closes unexpectedly', 'Mobile Safari specific issue', 'https://app.posthog.com/replay/sess_def002', 'open', 'fp_dropdown_005', 'manual', NULL),
  ('a1b2c3d4-0000-4000-8000-000000000004', 'sess_ghi001', 'ux', 'critical', 'Cart empties after login redirect', 'Lost 3 items worth $249', 'https://app.posthog.com/replay/sess_ghi001', 'open', 'fp_cart_empty_006', 'auto', NULL),
  ('a1b2c3d4-0000-4000-8000-000000000004', 'sess_ghi002', 'error', 'critical', 'Payment fails silently', 'Stripe returned card_declined but UI showed spinner forever', 'https://app.posthog.com/replay/sess_ghi002', 'open', 'fp_payment_007', 'auto', NULL),
  ('a1b2c3d4-0000-4000-8000-000000000004', 'sess_ghi003', 'ux', 'critical', 'Cart empties after login redirect', 'User was logged out mid-checkout', NULL, 'open', 'fp_cart_empty_006', 'auto', NULL);

-- Patterns
INSERT INTO patterns (project_id, name, description, severity, pattern_type, state, total_occurrence_count) VALUES
  ('a1b2c3d4-0000-4000-8000-000000000001', 'Rage clicks on CTA buttons', 'Users rapidly clicking call-to-action buttons without response', 'critical', 'interaction', 'active', 34),
  ('a1b2c3d4-0000-4000-8000-000000000001', 'Form abandonment after error', 'Users leaving forms after seeing validation errors', 'warning', 'navigation', 'active', 19),
  ('a1b2c3d4-0000-4000-8000-000000000002', 'Excessive page reloads', 'Users reloading same page multiple times', 'warning', 'navigation', 'resolved', 8),
  ('a1b2c3d4-0000-4000-8000-000000000004', 'Cart recovery attempts', 'Users navigating back to cart after items disappear', 'critical', 'navigation', 'active', 56);

-- Pattern occurrences
INSERT INTO pattern_occurrences (pattern_id, project_id, session_id, description, current_url, distinct_id, person_display, replay_url) VALUES
  ((SELECT id FROM patterns WHERE name = 'Rage clicks on CTA buttons' LIMIT 1), 'a1b2c3d4-0000-4000-8000-000000000001', 'sess_po_001', 'Clicked checkout button 6 times in 2 seconds', 'https://app.example.com/checkout', 'user_anon_001', 'Anonymous User', 'https://app.posthog.com/replay/sess_po_001'),
  ((SELECT id FROM patterns WHERE name = 'Rage clicks on CTA buttons' LIMIT 1), 'a1b2c3d4-0000-4000-8000-000000000001', 'sess_po_002', 'Clicked save button 4 times rapidly', 'https://app.example.com/settings', 'user_anon_002', NULL, 'https://app.posthog.com/replay/sess_po_002'),
  ((SELECT id FROM patterns WHERE name = 'Form abandonment after error' LIMIT 1), 'a1b2c3d4-0000-4000-8000-000000000001', 'sess_po_003', 'Left signup form after email validation error', 'https://app.example.com/signup', 'user_anon_003', 'test.user@mail.com', NULL),
  ((SELECT id FROM patterns WHERE name = 'Cart recovery attempts' LIMIT 1), 'a1b2c3d4-0000-4000-8000-000000000004', 'sess_po_004', 'Navigated to cart 3 times trying to find lost items', 'https://shop.example.com/cart', 'user_anon_004', 'John D.', 'https://app.posthog.com/replay/sess_po_004');

-- Session summaries
INSERT INTO session_summaries (project_id, session_id, summary_text, pages_visited, friction_points, drop_off_page, user_sentiment, session_outcome, session_duration, distinct_id, replay_url, issues_found, session_date) VALUES
  ('a1b2c3d4-0000-4000-8000-000000000001', 'sess_ss_001', 'User browsed products, added items to cart, struggled with checkout form, eventually completed purchase after 3 attempts.', '["https://app.example.com/", "https://app.example.com/products", "https://app.example.com/cart", "https://app.example.com/checkout"]', '[{"page": "/checkout", "type": "form_error", "description": "Email validation failed twice"}]', NULL, 'frustrated', 'completed', 342.5, 'user_001', 'https://app.posthog.com/replay/sess_ss_001', 2, '2025-03-15'),
  ('a1b2c3d4-0000-4000-8000-000000000001', 'sess_ss_002', 'User visited dashboard, filtered by date range, encountered crash, left site.', '["https://app.example.com/dashboard"]', '[{"page": "/dashboard", "type": "crash", "description": "Page crashed on date filter"}]', '/dashboard', 'negative', 'bounced', 45.0, 'user_002', 'https://app.posthog.com/replay/sess_ss_002', 1, '2025-03-15'),
  ('a1b2c3d4-0000-4000-8000-000000000002', 'sess_ss_003', 'User configured new widget, waited for page load, completed setup successfully.', '["https://app.example.com/widgets", "https://app.example.com/widgets/new", "https://app.example.com/widgets/config"]', '[]', NULL, 'neutral', 'completed', 180.0, 'user_003', 'https://app.posthog.com/replay/sess_ss_003', 0, '2025-03-14'),
  ('a1b2c3d4-0000-4000-8000-000000000004', 'sess_ss_004', 'User added items to cart, redirected to login, lost cart contents, abandoned.', '["https://shop.example.com/", "https://shop.example.com/product/1", "https://shop.example.com/cart", "https://shop.example.com/login", "https://shop.example.com/cart"]', '[{"page": "/cart", "type": "data_loss", "description": "Cart emptied after login redirect"}]', '/cart', 'angry', 'abandoned', 210.0, 'user_004', 'https://app.posthog.com/replay/sess_ss_004', 1, '2025-03-16'),
  ('a1b2c3d4-0000-4000-8000-000000000004', 'sess_ss_005', 'User browsed products for 8 minutes, added nothing, left.', '["https://shop.example.com/", "https://shop.example.com/category/electronics", "https://shop.example.com/product/5"]', '[]', '/product/5', 'neutral', 'browsed', 480.0, NULL, NULL, 0, '2025-03-16');

-- Session rules
INSERT INTO session_rules (project_id, name, posthog_event_name, verification_prompt, active) VALUES
  ('a1b2c3d4-0000-4000-8000-000000000001', 'Checkout completion', '$pageview', 'Did the user complete the checkout flow?', true),
  ('a1b2c3d4-0000-4000-8000-000000000001', 'Signup flow', 'signup_started', 'Did the user successfully create an account?', true),
  ('a1b2c3d4-0000-4000-8000-000000000002', 'Widget creation', 'widget_created', 'Did the user successfully create and save a widget?', true),
  ('a1b2c3d4-0000-4000-8000-000000000004', 'Purchase funnel', 'add_to_cart', 'Did the user complete a purchase after adding to cart?', true),
  ('a1b2c3d4-0000-4000-8000-000000000004', 'Cart abandonment', 'cart_viewed', 'Did the user abandon the cart without completing purchase?', false);

-- Feedback rules
INSERT INTO feedback_rules (project_id, rule_type, signal, url_pattern, source_feedback, match_count, active) VALUES
  ('a1b2c3d4-0000-4000-8000-000000000001', 'auto_dismiss', 'rage_click', '/marketing/*', 'not_a_bug', 15, true),
  ('a1b2c3d4-0000-4000-8000-000000000001', 'auto_flag', 'error_boundary', '/checkout/*', 'critical_bug', 8, true),
  ('a1b2c3d4-0000-4000-8000-000000000002', 'auto_dismiss', 'slow_load', '/reports/*', 'known_issue', 30, true),
  ('a1b2c3d4-0000-4000-8000-000000000004', 'auto_flag', 'data_loss', '/cart', 'critical_bug', 45, true);

-- Insight reports
INSERT INTO insight_reports (project_id, period_type, period_start, period_end, headline_narrative, sessions_analyzed, issues_found) VALUES
  ('a1b2c3d4-0000-4000-8000-000000000001', 'weekly', '2025-03-10', '2025-03-16', 'Checkout friction increased 20% this week due to a new form validation bug. 18 out of 150 sessions showed issues, primarily around the submit button and email validation.', 150, 23),
  ('a1b2c3d4-0000-4000-8000-000000000002', 'weekly', '2025-03-10', '2025-03-16', 'Widget configuration page performance improved after CDN migration but still above 5s threshold for 15% of users.', 80, 12),
  ('a1b2c3d4-0000-4000-8000-000000000004', 'weekly', '2025-03-10', '2025-03-16', 'Critical cart data loss issue affecting 26% of sessions. Users who log in via OAuth lose cart contents. Payment error handling also needs attention.', 300, 35);

-- Integrations
INSERT INTO integrations (project_id, type) VALUES
  ('a1b2c3d4-0000-4000-8000-000000000001', 'linear'),
  ('a1b2c3d4-0000-4000-8000-000000000002', 'linear'),
  ('a1b2c3d4-0000-4000-8000-000000000004', 'slack'),
  ('a1b2c3d4-0000-4000-8000-000000000004', 'linear');

-- Detector run metrics
INSERT INTO detector_run_metrics (run_id, project_id, session_id, detector_name, findings_raw_count, findings_deduped_count, execution_time_ms) VALUES
  ((SELECT id FROM analysis_runs WHERE project_id = 'a1b2c3d4-0000-4000-8000-000000000001' AND status = 'completed' LIMIT 1), 'a1b2c3d4-0000-4000-8000-000000000001', 'sess_dm_001', 'rage_click_detector', 5, 3, 120),
  ((SELECT id FROM analysis_runs WHERE project_id = 'a1b2c3d4-0000-4000-8000-000000000001' AND status = 'completed' LIMIT 1), 'a1b2c3d4-0000-4000-8000-000000000001', 'sess_dm_001', 'error_boundary_detector', 1, 1, 85),
  ((SELECT id FROM analysis_runs WHERE project_id = 'a1b2c3d4-0000-4000-8000-000000000001' AND status = 'completed' LIMIT 1), 'a1b2c3d4-0000-4000-8000-000000000001', 'sess_dm_002', 'dead_click_detector', 2, 2, 95),
  ((SELECT id FROM analysis_runs WHERE project_id = 'a1b2c3d4-0000-4000-8000-000000000002' AND status = 'completed' LIMIT 1), 'a1b2c3d4-0000-4000-8000-000000000002', 'sess_dm_003', 'slow_page_detector', 3, 2, 200),
  ((SELECT id FROM analysis_runs WHERE project_id = 'a1b2c3d4-0000-4000-8000-000000000002' AND status = 'completed' LIMIT 1), 'a1b2c3d4-0000-4000-8000-000000000002', 'sess_dm_004', 'rage_click_detector', 1, 1, 110);

-- Session processing logs
INSERT INTO session_processing_logs (project_id, run_id, session_id, status, issues_found, session_url, replay_url, processing_duration_ms, detection_source) VALUES
  ((SELECT id FROM analysis_runs WHERE project_id = 'a1b2c3d4-0000-4000-8000-000000000001' AND status = 'completed' LIMIT 1), 'a1b2c3d4-0000-4000-8000-000000000001', 'sess_spl_001', 'completed', 2, 'https://app.example.com/checkout', 'https://app.posthog.com/replay/sess_spl_001', 1500, 'scheduled'),
  ((SELECT id FROM analysis_runs WHERE project_id = 'a1b2c3d4-0000-4000-8000-000000000001' AND status = 'completed' LIMIT 1), 'a1b2c3d4-0000-4000-8000-000000000001', 'sess_spl_002', 'completed', 0, 'https://app.example.com/dashboard', 'https://app.posthog.com/replay/sess_spl_002', 800, 'scheduled'),
  ((SELECT id FROM analysis_runs WHERE project_id = 'a1b2c3d4-0000-4000-8000-000000000001' AND status = 'completed' LIMIT 1), 'a1b2c3d4-0000-4000-8000-000000000001', 'sess_spl_003', 'error', 0, NULL, NULL, 5000, 'scheduled'),
  ((SELECT id FROM analysis_runs WHERE project_id = 'a1b2c3d4-0000-4000-8000-000000000002' AND status = 'completed' LIMIT 1), 'a1b2c3d4-0000-4000-8000-000000000002', 'sess_spl_004', 'completed', 1, 'https://app.example.com/widgets/config', 'https://app.posthog.com/replay/sess_spl_004', 2200, 'event_rule');

-- Pending issues
INSERT INTO pending_issues (project_id, session_id, type, severity, title, description, replay_url, fingerprint, source, review_status) VALUES
  ('a1b2c3d4-0000-4000-8000-000000000001', 'sess_pi_001', 'ux', 'warning', 'Tooltip overlaps input field', 'Help tooltip on mobile covers the input field making it hard to type', 'https://app.posthog.com/replay/sess_pi_001', 'fp_tooltip_010', 'auto', 'pending'),
  ('a1b2c3d4-0000-4000-8000-000000000001', 'sess_pi_002', 'ux', 'info', 'Logo image not loading', 'Company logo shows broken image icon', NULL, 'fp_logo_011', 'auto', 'pending'),
  ('a1b2c3d4-0000-4000-8000-000000000004', 'sess_pi_003', 'error', 'critical', 'Null reference in price calculation', 'TypeError when product has no variants', 'https://app.posthog.com/replay/sess_pi_003', 'fp_null_012', 'auto', 'approved'),
  ('a1b2c3d4-0000-4000-8000-000000000004', 'sess_pi_004', 'ux', 'warning', 'Search returns no results for valid query', 'Searching for existing product names returns empty', NULL, 'fp_search_013', 'auto', 'rejected');

-- Event session summaries
INSERT INTO event_session_summaries (project_id, session_id, summary, event_count, model_used, replay_url) VALUES
  ('a1b2c3d4-0000-4000-8000-000000000001', 'sess_ess_001', '{"events": ["pageview", "click", "form_submit", "error"], "duration_s": 120, "outcome": "error"}', 42, 'gpt-4o', 'https://app.posthog.com/replay/sess_ess_001'),
  ('a1b2c3d4-0000-4000-8000-000000000001', 'sess_ess_002', '{"events": ["pageview", "click", "purchase"], "duration_s": 300, "outcome": "success"}', 67, 'gpt-4o', 'https://app.posthog.com/replay/sess_ess_002'),
  ('a1b2c3d4-0000-4000-8000-000000000002', 'sess_ess_003', '{"events": ["pageview", "scroll", "click"], "duration_s": 60, "outcome": "bounced"}', 12, 'gpt-4o-mini', NULL),
  ('a1b2c3d4-0000-4000-8000-000000000004', 'sess_ess_004', '{"events": ["pageview", "add_to_cart", "login", "pageview"], "duration_s": 180, "outcome": "abandoned"}', 28, 'gpt-4o', 'https://app.posthog.com/replay/sess_ess_004');
