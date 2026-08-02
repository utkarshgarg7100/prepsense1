-- ─── Missing columns ───────────────────────────────────────────────────────

-- Add file_name to resumes (if 002 was never run)
ALTER TABLE resumes ADD COLUMN IF NOT EXISTS file_name TEXT NOT NULL DEFAULT '';

-- Add total_sessions to user_streaks
ALTER TABLE user_streaks ADD COLUMN IF NOT EXISTS total_sessions INTEGER DEFAULT 0;

-- ─── Test helper functions (SECURITY DEFINER = service role can bypass RLS) ──

-- Creates a minimal auth.users row for testing (no email is sent)
CREATE OR REPLACE FUNCTION create_test_auth_user(
  p_id   UUID,
  p_email TEXT
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO auth.users (
    id,
    instance_id,
    email,
    encrypted_password,
    email_confirmed_at,
    created_at,
    updated_at,
    raw_user_meta_data,
    raw_app_meta_data,
    aud,
    role
  ) VALUES (
    p_id,
    '00000000-0000-0000-0000-000000000000',
    p_email,
    crypt('Test@12345', gen_salt('bf')),
    NOW(),
    NOW(),
    NOW(),
    '{"full_name": "PrepSense Tester"}'::jsonb,
    '{"provider": "email", "providers": ["email"]}'::jsonb,
    'authenticated',
    'authenticated'
  )
  ON CONFLICT (id) DO NOTHING;
END;
$$;

-- Deletes the test auth user (cascades to all user data via FK constraints)
CREATE OR REPLACE FUNCTION delete_test_auth_user(p_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM auth.users WHERE id = p_id;
END;
$$;
