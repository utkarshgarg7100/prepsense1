'use client'

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'

interface ScorePoint {
  overall_score: number
  created_at: string
  sessions?: { round_type: string } | { round_type: string }[] | null
}

interface Props {
  scores: ScorePoint[]
}

export function ProgressChart({ scores }: Props) {
  const data = [...scores]
    .reverse()
    .map((s, i) => {
      const roundType = Array.isArray(s.sessions)
        ? s.sessions[0]?.round_type
        : s.sessions?.round_type
      return {
        session: `#${i + 1}`,
        score: s.overall_score,
        round: roundType ?? 'general',
        date: new Date(s.created_at).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }),
      }
    })

  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
        <XAxis
          dataKey="date"
          tick={{ fill: '#64748b', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          domain={[0, 100]}
          tick={{ fill: '#64748b', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: '#1e293b',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '8px',
            color: '#f1f5f9',
          }}
          formatter={(value: any) => [`${value}/100`, 'Score']}
        />
        <Line
          type="monotone"
          dataKey="score"
          stroke="#6366f1"
          strokeWidth={2}
          dot={{ fill: '#6366f1', r: 4 }}
          activeDot={{ r: 6 }}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
