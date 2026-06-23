// ─── Auth & Profile ────────────────────────────────────────────────────────
export type ExperienceLevel = 'fresher' | '1-3yr' | '3-5yr' | '5yr+'

export interface Profile {
  id: string
  email: string
  full_name: string | null
  avatar_url: string | null
  target_roles: string[]
  target_companies: string[]
  experience_level: ExperienceLevel | null
  created_at: string
  updated_at: string
}

// ─── Resume ────────────────────────────────────────────────────────────────
export interface ResumeExperience {
  company: string
  role: string
  duration: string
  bullets: string[]
}

export interface ResumeEducation {
  institution: string
  degree: string
  branch: string
  year: string
  gpa?: string
}

export interface ResumeProject {
  name: string
  description: string
  tech_stack: string[]
  impact?: string
}

export interface ParsedResume {
  skills: string[]
  experience: ResumeExperience[]
  education: ResumeEducation[]
  projects: ResumeProject[]
  certifications: string[]
  inferred_seniority_level: ExperienceLevel
  inferred_primary_role: string
}

export interface Resume {
  id: string
  user_id: string
  file_url: string
  file_name: string
  parsed_text: string
  extracted_skills: string[]
  extracted_experience: ResumeExperience[]
  extracted_education: ResumeEducation[]
  extracted_projects: ResumeProject[]
  parsed_at: string | null
  is_active: boolean
  created_at: string
}

// ─── Job Description ───────────────────────────────────────────────────────
export type CompanyTier = 'FAANG' | 'Indian Unicorn' | 'Global MNC' | 'Series B Startup'

export type RoleType =
  | 'Software Engineering'
  | 'Product Management'
  | 'Business & Strategy'
  | 'Design'
  | 'Data & Analytics'
  | 'Operations'

export interface JobDescription {
  id: string
  role_type: RoleType
  role_subtype: string
  company_name: string
  company_tier: CompanyTier
  industry: string
  jd_text: string
  required_skills: string[]
  nice_to_have_skills: string[]
  culture_tags: string[]
  is_sample: boolean
  created_at: string
}

// ─── Session ───────────────────────────────────────────────────────────────
export type SessionMode = 'jd_based' | 'general' | 'custom'
export type RoundType = 'technical' | 'founders' | 'hr'
export type SessionStatus = 'in_progress' | 'completed' | 'abandoned'

export interface Session {
  id: string
  user_id: string
  resume_id: string | null
  jd_id: string | null
  mode: SessionMode
  round_type: RoundType
  status: SessionStatus
  started_at: string
  completed_at: string | null
  total_duration_seconds: number | null
}

// ─── Messages ──────────────────────────────────────────────────────────────
export type MessageRole = 'interviewer' | 'candidate'

export interface AnswerEvaluation {
  star_compliance: number
  depth_score: number
  claims_made: string[]
  follow_up_worthy: boolean
  suggested_follow_up: string | null
  consistency_flags: string[]
  answer_summary: string
  strong_answer_example: string
}

export interface Message {
  id: string
  session_id: string
  role: MessageRole
  content: string
  timestamp: string
  question_type: string | null
  question_tags: string[]
  answer_evaluation: AnswerEvaluation | null
}

// ─── Scores ────────────────────────────────────────────────────────────────
export interface SessionScores {
  id: string
  session_id: string
  user_id: string
  // Technical
  technical_depth: number
  problem_decomposition: number
  experience_match: number
  gap_awareness: number
  scalability_thinking: number
  // Founders
  business_acumen: number
  first_principles: number
  ambiguity_handling: number
  ownership_signals: number
  communication_clarity: number
  // HR
  cultural_alignment: number
  self_awareness: number
  conflict_resolution: number
  motivation_authenticity: number
  verbal_fluency: number
  // Universal
  star_compliance: number
  answer_conciseness: number
  consistency: number
  // Aggregates
  overall_score: number
  percentile: number
  custom_metrics: Record<string, number>
  created_at: string
}

// ─── Resume Markers ────────────────────────────────────────────────────────
export type MarkerType = 'vague' | 'weak' | 'strong' | 'unexplored' | 'missing_from_jd'

export interface ResumeMarker {
  id: string
  session_id: string
  resume_line_text: string
  marker_type: MarkerType
  suggestion: string
  created_at: string
}

// ─── Speech Feedback ───────────────────────────────────────────────────────
export interface SpeechFeedback {
  id: string
  session_id: string
  filler_word_count: number
  filler_words: Record<string, number>
  avg_answer_length_seconds: number
  ideal_range_min: number
  ideal_range_max: number
  deflection_count: number
  hedging_count: number
  pace_assessment: string
}

// ─── Question Performance & RL ─────────────────────────────────────────────
export interface QuestionPerformance {
  id: string
  user_id: string
  question_id: string
  question_tags: string[]
  score: number
  session_id: string
  created_at: string
}

export interface UserWeakArea {
  id: string
  user_id: string
  tag: string
  avg_score: number
  session_count: number
  last_seen_at: string
  updated_at: string
  // RL bandit params
  alpha: number
  beta: number
}

// ─── Achievements ──────────────────────────────────────────────────────────
export interface Badge {
  id: string
  name: string
  description: string
  icon: string
  condition_type: string
  condition_value: number
}

export interface UserAchievement {
  id: string
  user_id: string
  badge_id: string
  earned_at: string
  badge?: Badge
}

export interface UserStreak {
  id: string
  user_id: string
  current_streak: number
  longest_streak: number
  last_session_date: string
}

// ─── AI Provider Interface ─────────────────────────────────────────────────
export interface InterviewContext {
  session_id: string
  round_type: RoundType
  company_name: string
  role_name: string
  resume_text: string
  jd_text: string
  gap_matrix: GapMatrix
  conversation_history: ConversationTurn[]
  claims_history: string[]
  question_plan: QuestionPlan
  current_question_index: number
}

export interface ConversationTurn {
  question: string
  question_type: string
  question_tags: string[]
  answer: string
  evaluation: AnswerEvaluation | null
}

export interface GapMatrix {
  matched_skills: string[]
  missing_skills: string[]
  partial_match_skills: string[]
  gap_severity: 'low' | 'medium' | 'high'
  recommended_focus_areas: string[]
}

export interface QuestionPlan {
  total_questions: number
  distribution: {
    base_role: number
    jd_specific: number
    resume_specific: number
    gap_questions: number
  }
  planned_questions: PlannedQuestion[]
}

export interface PlannedQuestion {
  index: number
  category: 'base_role' | 'jd_specific' | 'resume_specific' | 'gap'
  question_type: string
  question_tags: string[]
  source_hint: string
}

export interface Question {
  content: string
  question_type: string
  question_tags: string[]
  follow_up_trigger: boolean
  reasoning: string
}

export interface SessionReport {
  overall_score: number
  strengths: ReportStrength[]
  improvement_areas: ReportImprovement[]
  practice_questions: string[]
  resume_rewrites: ResumeRewrite[]
  model_answers: ModelAnswer[]
}

export interface ReportStrength {
  area: string
  quote: string
  explanation: string
}

export interface ReportImprovement {
  area: string
  advice: string
  specific_example: string
}

export interface ResumeRewrite {
  original_line: string
  suggested_rewrite: string
  reason: string
}

export interface ModelAnswer {
  question: string
  model_answer: string
  key_elements: string[]
}

// ─── Interview State (Zustand) ─────────────────────────────────────────────
export type InterviewMode = 'text' | 'voice'

export interface InterviewState {
  session: Session | null
  messages: Message[]
  currentQuestion: Question | null
  context: InterviewContext | null
  isLoading: boolean
  isVoiceMode: InterviewMode
  isRecording: boolean
  transcript: string
  timer: number
  questionIndex: number
  totalQuestions: number
}

// ─── Company Culture ───────────────────────────────────────────────────────
export interface CompanyCulture {
  company_name: string
  culture_values: string[]
  interview_style: string
  what_they_look_for: string[]
  red_flags_for_them: string[]
  example_hr_questions: string[]
}

// ─── Cold Start ────────────────────────────────────────────────────────────
export interface ColdStartData {
  college: string
  branch: string
  graduation_year: string
  skills: string[]
  projects: ColdStartProject[]
  internships: ColdStartInternship[]
  target_role: string
}

export interface ColdStartProject {
  name: string
  description: string
  tech_stack: string[]
}

export interface ColdStartInternship {
  company: string
  role: string
  duration: string
  description: string
}

// ─── API Response Types ────────────────────────────────────────────────────
export interface ApiResponse<T> {
  data: T | null
  error: string | null
}

export interface PaginatedResponse<T> {
  data: T[]
  count: number
  page: number
  per_page: number
}
