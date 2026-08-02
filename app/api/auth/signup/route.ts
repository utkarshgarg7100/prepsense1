import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  const { email, password, full_name } = await request.json()

  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password are required' }, { status: 400 })
  }
  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
  }

  const supabase = await createClient()

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: full_name ?? null },
    },
  })

  if (error) {
    console.error('[signup] Supabase error:', error.message, error.status)
    return NextResponse.json(
      { error: error.message || 'Signup failed. Check Supabase Email provider is enabled.' },
      { status: error.status ?? 500 }
    )
  }

  const user = data.user
  if (!user) {
    return NextResponse.json({ error: 'User creation failed — no user returned' }, { status: 500 })
  }

  // Ensure profile exists — the DB trigger should handle this,
  // but upsert here as a safety net if trigger is slow or missing.
  if (data.session) {
    const { error: profileErr } = await supabase.from('profiles').upsert({
      id: user.id,
      email: user.email ?? email,
      full_name: full_name ?? user.user_metadata?.full_name ?? null,
      onboarding_completed: false,
    }, { onConflict: 'id' })

    if (profileErr) {
      console.error('[signup] Profile upsert error:', profileErr.message)
    }
  }

  return NextResponse.json({
    ok: true,
    hasSession: !!data.session,
    needsEmailVerification: !data.session && !!user.id,
  })
}
