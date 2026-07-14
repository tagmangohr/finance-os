-- FILE: 027_app_store_connector.sql
-- Add the Apple App Store connector type (App Store Server Notifications V2).
--
-- Why: AI Fiesta bills some customers through the Apple App Store. That revenue
-- never touches Stripe/Cashfree/Razorpay, so it is invisible to every existing
-- connector. Apple delivers it in real time via App Store Server Notifications
-- (a signed JWS POSTed to /api/webhooks/app-store); an `app_store` connector row
-- holds the app's bundle_id so the webhook can match the notification to an org.
--
-- Verification is cryptographic (the JWS chains to Apple's public root CA), so
-- unlike the gateway connectors this one needs NO client secret for inbound
-- webhooks. The config stores { bundle_id, app_apple_id?, environment? }.
--
-- connector_type is a Postgres ENUM (see 002/009/022). ADD VALUE is idempotent
-- with IF NOT EXISTS and must not be used by a literal in the same transaction —
-- this migration only extends the enum, so it is safe on its own.

ALTER TYPE connector_type ADD VALUE IF NOT EXISTS 'app_store';
