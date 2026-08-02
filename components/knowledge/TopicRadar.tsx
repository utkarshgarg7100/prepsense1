'use client'

/**
 * The 15-topic mastery radar.
 *
 * Lifted out of `ReportView` so the same shape means the same thing everywhere: the
 * report's radar shows six per-session rubric dimensions, this one shows persistent
 * per-topic mastery. Both are radars, but they are different claims, so this component
 * takes generic `{ label, value }` points and the caller decides what they mean.
 *
 * Values are 0–1 probabilities scaled to 0–100 for display. The axis is pinned to
 * [0, 100] rather than auto-scaled: recharts would otherwise fit the domain to the data
 * and make a candidate at 0.2 across the board look identical to one at 0.9.
 */

import {
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
  ResponsiveContainer, Tooltip,
} from 'recharts'

export interface RadarPoint {
  label: string
  /** 0–1. */
  value: number
}

interface Props {
  points: RadarPoint[]
  height?: number
}

export function TopicRadar({ points, height = 300 }: Props) {
  const data = points.map(p => ({
    subject: p.label,
    value: Math.round(p.value * 100),
  }))

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data} outerRadius="72%">
          <PolarGrid stroke="rgba(255,255,255,0.1)" />
          <PolarAngleAxis dataKey="subject" tick={{ fill: '#94a3b8', fontSize: 10 }} />
          {/* Fixed domain — see the note above. `tick={false}` because the numbers are
              already in the tooltip and the labels, and a third copy is clutter. */}
          <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
          <Radar
            name="Mastery"
            dataKey="value"
            stroke="oklch(0.623 0.214 263.8)"
            fill="oklch(0.623 0.214 263.8)"
            fillOpacity={0.25}
          />
          <Tooltip
            // recharts types the value as possibly-undefined, so it is narrowed here
            // rather than asserted away.
            formatter={(v) => [`${typeof v === 'number' ? v : 0}%`, 'Mastery']}
            contentStyle={{
              background: '#1e293b',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 8,
            }}
            labelStyle={{ color: '#fff' }}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  )
}
