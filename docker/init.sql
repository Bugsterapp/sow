-- Realistic SaaS database for testing seedb
-- Contains PII data that seedb should detect and sanitize

CREATE TABLE organizations (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(50) UNIQUE NOT NULL,
  plan VARCHAR(20) DEFAULT 'free',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  org_id INTEGER REFERENCES organizations(id),
  email VARCHAR(255) UNIQUE NOT NULL,
  full_name VARCHAR(200) NOT NULL,
  phone VARCHAR(30),
  password_hash VARCHAR(255) NOT NULL,
  date_of_birth DATE,
  ip_address INET,
  avatar_url TEXT,
  role VARCHAR(20) DEFAULT 'member',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);

CREATE TABLE addresses (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  street VARCHAR(200) NOT NULL,
  city VARCHAR(100) NOT NULL,
  state VARCHAR(50),
  zip VARCHAR(20),
  country VARCHAR(2) DEFAULT 'US',
  is_primary BOOLEAN DEFAULT true
);

CREATE TABLE products (
  id SERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  price_cents INTEGER NOT NULL,
  currency VARCHAR(3) DEFAULT 'USD',
  sku VARCHAR(50) UNIQUE,
  stock INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE orders (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  status VARCHAR(20) DEFAULT 'pending',
  total_cents INTEGER NOT NULL,
  currency VARCHAR(3) DEFAULT 'USD',
  shipping_address_id INTEGER REFERENCES addresses(id),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE order_items (
  id SERIAL PRIMARY KEY,
  order_id INTEGER REFERENCES orders(id),
  product_id INTEGER REFERENCES products(id),
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price_cents INTEGER NOT NULL
);

CREATE TABLE payments (
  id SERIAL PRIMARY KEY,
  order_id INTEGER REFERENCES orders(id),
  amount_cents INTEGER NOT NULL,
  currency VARCHAR(3) DEFAULT 'USD',
  method VARCHAR(30) NOT NULL,
  card_last_four VARCHAR(4),
  status VARCHAR(20) DEFAULT 'pending',
  stripe_payment_id VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE audit_log (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  action VARCHAR(50) NOT NULL,
  entity_type VARCHAR(50),
  entity_id INTEGER,
  ip_address INET,
  user_agent TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE api_keys (
  id SERIAL PRIMARY KEY,
  org_id INTEGER REFERENCES organizations(id),
  key_hash VARCHAR(255) NOT NULL,
  label VARCHAR(100),
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE _prisma_migrations (
  id VARCHAR(36) PRIMARY KEY,
  checksum VARCHAR(64) NOT NULL,
  finished_at TIMESTAMPTZ,
  migration_name VARCHAR(255) NOT NULL,
  logs TEXT,
  rolled_back_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  applied_steps_count INTEGER DEFAULT 0
);

-- Organizations
INSERT INTO organizations (name, slug, plan) VALUES
  ('Acme Corp', 'acme', 'pro'),
  ('Initech', 'initech', 'enterprise'),
  ('Umbrella Inc', 'umbrella', 'free'),
  ('Stark Industries', 'stark', 'pro'),
  ('Wayne Enterprises', 'wayne', 'enterprise');

-- Users with realistic PII
INSERT INTO users (org_id, email, full_name, phone, password_hash, date_of_birth, ip_address, role, last_login_at) VALUES
  (1, 'alice.johnson@acme.com', 'Alice Johnson', '+1-555-0101', '$2b$12$LJ3m4ys8kV2rNPa3stJ.BuQK2eAxzQe6TdXLkR1ej9E3vT1Gy0tKm', '1990-03-15', '192.168.1.42', 'admin', NOW() - INTERVAL '2 hours'),
  (1, 'bob.smith@acme.com', 'Bob Smith', '+1-555-0102', '$2b$12$xyz789abc', '1985-07-22', '10.0.0.5', 'member', NOW() - INTERVAL '1 day'),
  (2, 'carol.williams@initech.com', 'Carol Williams', '+44-20-7946-0958', '$2b$12$def456ghi', '1992-11-08', '203.0.113.42', 'admin', NOW() - INTERVAL '3 hours'),
  (2, 'david.brown@initech.com', 'David Brown', NULL, '$2b$12$jkl012mno', '1988-01-30', '198.51.100.7', 'member', NULL),
  (3, 'eve.davis@umbrella.io', 'Eve Davis', '+1-555-0105', '$2b$12$pqr345stu', '1995-06-12', '172.16.0.1', 'admin', NOW() - INTERVAL '5 days'),
  (3, 'frank.miller@umbrella.io', 'Frank Miller', '+49-30-12345678', '$2b$12$vwx678yza', NULL, NULL, 'member', NOW() - INTERVAL '12 hours'),
  (4, 'grace.wilson@stark.dev', 'Grace Wilson', '+1-555-0107', '$2b$12$bcd901efg', '1993-09-25', '192.0.2.100', 'admin', NOW()),
  (4, 'henry.taylor@stark.dev', 'Henry Taylor', '+81-3-1234-5678', '$2b$12$hij234klm', '1987-04-18', '100.64.0.1', 'member', NOW() - INTERVAL '6 hours'),
  (5, 'iris.anderson@wayne.co', 'Iris Anderson', '+1-555-0109', '$2b$12$nop567qrs', '1991-12-03', '203.0.113.99', 'admin', NOW() - INTERVAL '1 hour'),
  (5, 'jack.thomas@wayne.co', 'Jack Thomas', NULL, '$2b$12$tuv890wxy', '1986-08-14', NULL, 'member', NULL),
  (1, 'karen.lee@acme.com', 'Karen Lee', '+1-555-0111', '$2b$12$abc123def', '1994-02-28', '10.0.0.50', 'member', NOW() - INTERVAL '4 hours'),
  (2, 'leo.martinez@initech.com', 'Leo Martinez', '+34-91-123-4567', '$2b$12$ghi456jkl', '1989-10-17', '198.51.100.200', 'member', NOW() - INTERVAL '2 days'),
  (1, 'maria.garcia@acme.com', 'María García', '+1-555-0113', '$2b$12$mno789pqr', '1996-05-20', '192.168.1.100', 'member', NOW() - INTERVAL '30 minutes'),
  (3, 'noah.robinson@umbrella.io', 'Noah Robinson', '+61-2-1234-5678', '$2b$12$stu012vwx', '1983-07-09', '172.16.0.50', 'member', NULL),
  (4, 'olivia.clark@stark.dev', 'Olivia Clark', '+1-555-0115', '$2b$12$yza345bcd', '1997-01-11', '192.0.2.50', 'member', NOW() - INTERVAL '8 hours'),
  -- Edge cases
  (5, 'test+special@wayne.co', '日本語テスト', '+1-555-0116', '$2b$12$efg678hij', '2000-01-01', '127.0.0.1', 'member', NULL),
  (NULL, 'freelancer@gmail.com', 'Freelancer Bob 🚀', '+1-555-0000', '$2b$12$zzz000aaa', '1970-01-01', '::1', 'member', NOW()),
  (1, 'admin@acme.com', '', '+1-555-9999', '$2b$12$xxx111yyy', '1999-12-31', '255.255.255.255', 'admin', NOW());

-- Addresses
INSERT INTO addresses (user_id, street, city, state, zip, country) VALUES
  (1, '123 Main St, Apt 4B', 'San Francisco', 'CA', '94102', 'US'),
  (2, '456 Oak Avenue', 'San Francisco', 'CA', '94110', 'US'),
  (3, '10 Downing Street', 'London', NULL, 'SW1A 2AA', 'GB'),
  (5, '789 Pine Road', 'Austin', 'TX', '73301', 'US'),
  (7, '321 Elm Blvd', 'Seattle', 'WA', '98101', 'US'),
  (9, '654 Maple Lane', 'Chicago', 'IL', '60601', 'US'),
  (13, 'Calle Gran Vía 28', 'Madrid', NULL, '28013', 'ES'),
  (16, '1-2-3 Shibuya', 'Tokyo', NULL, '150-0002', 'JP'),
  -- Edge: empty string street
  (17, '', 'Nowhere', NULL, '', 'US');

-- Products
INSERT INTO products (name, description, price_cents, sku, stock) VALUES
  ('Pro Plan (Monthly)', 'Professional plan with unlimited branches', 2900, 'PLAN-PRO-M', 999999),
  ('Pro Plan (Annual)', 'Professional plan billed annually', 29000, 'PLAN-PRO-Y', 999999),
  ('Enterprise Plan', 'Custom enterprise plan', 99900, 'PLAN-ENT', 999999),
  ('Extra Storage (10GB)', 'Additional snapshot storage', 500, 'ADDON-STOR-10', 999999),
  ('Priority Support', 'Priority email + Slack support', 4900, 'ADDON-SUPPORT', 999999),
  ('Team Training', 'Live onboarding session (1h)', 29900, 'SVC-TRAINING', 50),
  ('Custom Integration', 'Custom database adapter development', 0, 'SVC-CUSTOM', 0),
  -- Edge cases
  ('Test Product 🧪', NULL, 0, 'TEST-001', 0),
  ('Über Lösung™', 'Special chars: <>&"''', 100, 'TEST-UNICODE', 1);

-- Orders
INSERT INTO orders (user_id, status, total_cents, shipping_address_id, notes, completed_at) VALUES
  (1, 'completed', 2900, 1, NULL, NOW() - INTERVAL '30 days'),
  (1, 'completed', 29000, 1, 'Annual upgrade', NOW() - INTERVAL '5 days'),
  (3, 'completed', 99900, 3, NULL, NOW() - INTERVAL '60 days'),
  (5, 'completed', 2900, 4, NULL, NOW() - INTERVAL '15 days'),
  (7, 'completed', 34400, 5, 'Pro + support bundle', NOW() - INTERVAL '10 days'),
  (9, 'pending', 2900, 6, NULL, NULL),
  (13, 'completed', 2900, 7, 'Nota en español', NOW() - INTERVAL '3 days'),
  (2, 'cancelled', 29000, 2, 'Changed mind', NULL),
  (11, 'completed', 500, NULL, NULL, NOW() - INTERVAL '7 days'),
  (15, 'refunded', 2900, NULL, 'Duplicate charge', NULL),
  -- Edge: zero-dollar order
  (17, 'completed', 0, 9, 'Free trial', NOW() - INTERVAL '1 day');

-- Order items
INSERT INTO order_items (order_id, product_id, quantity, unit_price_cents) VALUES
  (1, 1, 1, 2900),
  (2, 2, 1, 29000),
  (3, 3, 1, 99900),
  (4, 1, 1, 2900),
  (5, 1, 1, 2900),
  (5, 5, 1, 4900),
  (5, 4, 5, 500),
  (6, 1, 1, 2900),
  (7, 1, 1, 2900),
  (8, 2, 1, 29000),
  (9, 4, 1, 500),
  (10, 1, 1, 2900),
  (11, 8, 1, 0);

-- Payments
INSERT INTO payments (order_id, amount_cents, method, card_last_four, status, stripe_payment_id) VALUES
  (1, 2900, 'card', '4242', 'succeeded', 'pi_1234567890abcdef'),
  (2, 29000, 'card', '4242', 'succeeded', 'pi_2345678901bcdefg'),
  (3, 99900, 'wire_transfer', NULL, 'succeeded', NULL),
  (4, 2900, 'card', '1234', 'succeeded', 'pi_3456789012cdefgh'),
  (5, 34400, 'card', '5678', 'succeeded', 'pi_4567890123defghi'),
  (6, 2900, 'card', '9012', 'pending', 'pi_5678901234efghij'),
  (7, 2900, 'card', '3456', 'succeeded', 'pi_6789012345fghijk'),
  (8, 29000, 'card', '7890', 'refunded', 'pi_7890123456ghijkl'),
  (9, 500, 'card', '2468', 'succeeded', 'pi_8901234567hijklm'),
  (10, 2900, 'card', '1357', 'refunded', 'pi_9012345678ijklmn'),
  (11, 0, 'free', NULL, 'succeeded', NULL);

-- Audit log
INSERT INTO audit_log (user_id, action, entity_type, entity_id, ip_address, user_agent, metadata) VALUES
  (1, 'login', 'user', 1, '192.168.1.42', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', '{"method": "password"}'),
  (1, 'create', 'order', 1, '192.168.1.42', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', '{"total": 2900}'),
  (3, 'login', 'user', 3, '203.0.113.42', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', '{"method": "sso"}'),
  (3, 'create', 'order', 3, '203.0.113.42', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', '{"total": 99900}'),
  (7, 'update', 'user', 7, '192.0.2.100', 'curl/8.4.0', '{"field": "role", "from": "member", "to": "admin"}'),
  (17, 'login', 'user', 17, '::1', 'seedb-test/1.0', NULL),
  (1, 'delete', 'api_key', 1, '192.168.1.42', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', NULL);

-- API keys
INSERT INTO api_keys (org_id, key_hash, label) VALUES
  (1, '$2b$12$apikey1hashvalue', 'Production'),
  (1, '$2b$12$apikey2hashvalue', 'Staging'),
  (2, '$2b$12$apikey3hashvalue', 'CI/CD'),
  (4, '$2b$12$apikey4hashvalue', 'Development'),
  (5, '$2b$12$apikey5hashvalue', NULL);

-- Migrations table (seedb should auto-exclude this)
INSERT INTO _prisma_migrations (id, checksum, migration_name, finished_at, applied_steps_count) VALUES
  ('migration-001', 'abc123', '20240101_init', NOW() - INTERVAL '90 days', 1),
  ('migration-002', 'def456', '20240201_add_orders', NOW() - INTERVAL '60 days', 1),
  ('migration-003', 'ghi789', '20240301_add_audit_log', NOW() - INTERVAL '30 days', 1);
