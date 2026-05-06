-- Push subscription storage for member portal Web Push notifications
ALTER TABLE app_users ADD COLUMN push_subscription TEXT NOT NULL DEFAULT '';
