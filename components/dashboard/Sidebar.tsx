'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import {
  Brain, LayoutDashboard, Play, History, User, LogOut, ChevronLeft, ChevronRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { useState } from 'react'
import type { Profile } from '@/types'

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/practice', label: 'Practice', icon: Play },
  { href: '/history', label: 'History', icon: History },
  { href: '/profile', label: 'Profile', icon: User },
]

export default function DashboardSidebar({ profile }: { profile: Profile | null }) {
  const pathname = usePathname()
  const router = useRouter()
  const [collapsed, setCollapsed] = useState(false)

  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/')
    router.refresh()
    toast.success('Signed out')
  }

  return (
    <aside
      className={cn(
        'flex flex-col border-r border-white/10 bg-card transition-all duration-300',
        collapsed ? 'w-16' : 'w-64'
      )}
    >
      {/* Logo */}
      <div className={cn('flex items-center px-4 py-5 border-b border-white/10', collapsed ? 'justify-center' : 'gap-3')}>
        <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shrink-0">
          <Brain className="w-4 h-4 text-white" />
        </div>
        {!collapsed && <span className="font-bold text-lg">PrepSense</span>}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-4 space-y-1">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(href))
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                active
                  ? 'bg-primary/20 text-primary'
                  : 'text-slate-400 hover:text-white hover:bg-white/5',
                collapsed && 'justify-center'
              )}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {!collapsed && label}
            </Link>
          )
        })}
      </nav>

      {/* Collapse toggle */}
      <div className="px-2 pb-2">
        <Button
          variant="ghost"
          size="sm"
          className="w-full text-slate-400 hover:text-white"
          onClick={() => setCollapsed(c => !c)}
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <><ChevronLeft className="w-4 h-4 mr-2" />Collapse</>}
        </Button>
      </div>

      {/* User */}
      <div className={cn('border-t border-white/10 p-3 flex items-center gap-3', collapsed && 'justify-center')}>
        <Avatar className="w-8 h-8 shrink-0">
          <AvatarImage src={profile?.avatar_url ?? undefined} />
          <AvatarFallback className="bg-primary/20 text-primary text-xs">
            {profile?.full_name?.charAt(0) ?? profile?.email?.charAt(0) ?? 'U'}
          </AvatarFallback>
        </Avatar>
        {!collapsed && (
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{profile?.full_name ?? 'User'}</p>
            <p className="text-xs text-slate-400 truncate">{profile?.email}</p>
          </div>
        )}
        {!collapsed && (
          <Button
            variant="ghost"
            size="sm"
            className="text-slate-400 hover:text-white shrink-0 px-2"
            onClick={handleLogout}
          >
            <LogOut className="w-4 h-4" />
          </Button>
        )}
      </div>
    </aside>
  )
}
