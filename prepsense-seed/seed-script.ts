/**
 * PrepSense Supabase Seed Script
 * Run this after your database migrations to populate all seed data.
 *
 * Usage:
 *   npx ts-node seed-script.ts
 *
 * Prerequisites:
 *   - NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY set in .env
 *   - All database migrations run
 */

import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'

dotenv.config({ path: path.join(__dirname, '..', '.env.local') })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // Service role bypasses RLS for seeding
)

async function loadJSON(filename: string) {
  const filepath = path.join(__dirname, 'data', filename)
  return JSON.parse(fs.readFileSync(filepath, 'utf-8'))
}

const ROLE_TYPE_MAP: Record<string, string> = {
  software_engineering: 'Software Engineering',
  product_management: 'Product Management',
  business_strategy: 'Business & Strategy',
  design: 'Design',
  data_analytics: 'Data & Analytics',
  operations: 'Operations',
}

async function seedJobDescriptions() {
  console.log('🌱 Seeding job descriptions...')
  const seJDs = await loadJSON('jd/software-engineering.json')
  const pmJDs = await loadJSON('jd/product-management.json')
  const bizJDs = await loadJSON('jd/business-design-data-ops.json')
  const allJDs = [...seJDs, ...pmJDs, ...bizJDs]

  for (const jd of allJDs) {
    const { error } = await supabase
      .from('job_descriptions')
      .upsert({
        id: jd.id,
        role_type: ROLE_TYPE_MAP[jd.role_type] ?? jd.role_type,
        role_subtype: jd.role_subtype,
        company_name: jd.company_name,
        company_tier: jd.company_tier,
        industry: jd.industry,
        seniority: jd.seniority,
        jd_text: jd.jd_text,
        required_skills: jd.required_skills,
        nice_to_have_skills: jd.nice_to_have_skills,
        culture_tags: jd.culture_tags,
        is_sample: true,
        created_at: jd.created_at
      }, { onConflict: 'id' })
    if (error) console.error(`❌ Error seeding JD ${jd.id}:`, error.message)
    else console.log(`  ✅ ${jd.company_name} — ${jd.role_subtype}`)
  }
  console.log(`✅ Seeded ${allJDs.length} job descriptions\n`)
}

async function seedCompanyProfiles() {
  console.log('🌱 Seeding company culture profiles...')
  const companies = await loadJSON('companies/culture-profiles.json')

  for (const company of companies) {
    const { error } = await supabase
      .from('company_culture_profiles')
      .upsert({
        id: company.id,
        name: company.name,
        tier: company.tier,
        industry: company.industry,
        founded: company.founded || null,
        hq: company.hq || null,
        size: company.size || null,
        culture_values: company.culture_values,
        interview_style: Array.isArray(company.interview_style)
          ? company.interview_style.join(' ')
          : company.interview_style,
        what_they_look_for: company.what_they_look_for,
        red_flags_for_them: company.red_flags_for_them,
        hr_round_focus: company.hr_round_focus,
        sample_hr_questions: company.sample_hr_questions,
        founders_round_focus: Array.isArray(company.founders_round_focus)
          ? company.founders_round_focus.join(' ')
          : company.founders_round_focus,
        key_products: company.key_products,
        competitors: company.competitors,
        recent_news_to_know: Array.isArray(company.recent_news_to_know)
          ? company.recent_news_to_know
          : [company.recent_news_to_know],
      }, { onConflict: 'id' })
    if (error) console.error(`❌ Error seeding company ${company.id}:`, error.message)
    else console.log(`  ✅ ${company.name}`)
  }
  console.log(`✅ Seeded ${companies.length} company profiles\n`)
}

async function seedBadges() {
  console.log('🌱 Seeding badges...')
  const badges = await loadJSON('badges/badges.json')

  for (const badge of badges) {
    const { error } = await supabase
      .from('badges')
      .upsert({
        id: badge.id,
        name: badge.name,
        description: badge.description,
        icon: badge.icon,
        category: badge.category,
        condition_type: badge.condition_type,
        condition_value: typeof badge.condition_value === 'number' ? badge.condition_value : 0,
        condition_metric: badge.condition_metric
          ?? (typeof badge.condition_value === 'string' ? badge.condition_value : null),
        condition_count: badge.condition_count || null,
        rarity: badge.rarity
      }, { onConflict: 'id' })
    if (error) console.error(`❌ Error seeding badge ${badge.id}:`, error.message)
    else console.log(`  ✅ ${badge.icon} ${badge.name}`)
  }
  console.log(`✅ Seeded ${badges.length} badges\n`)
}

async function seedQuestionBank() {
  console.log('🌱 Seeding question bank...')
  const banks = await loadJSON('questions/question-banks.json')
  let count = 0

  // Flatten all questions from all role types and rounds
  const flattenQuestions = (data: Record<string, unknown>, roleType: string) => {
    const questions: unknown[] = []
    const processSection = (section: unknown, roundType: string, subtype?: string) => {
      if (Array.isArray(section)) {
        for (const q of section) {
          questions.push({
            id: q.id,
            role_type: roleType,
            role_subtype: subtype || null,
            round_type: roundType,
            question_text: q.question,
            tags: q.tags || [],
            follow_up_triggers: q.follow_up_triggers || [],
            ideal_length_words: q.ideal_length || '150-300',
            strong_answer_signals: q.strong_answer_signals || [],
            is_sample: true
          })
        }
      } else if (typeof section === 'object' && section !== null) {
        for (const [key, val] of Object.entries(section as Record<string, unknown>)) {
          processSection(val, roundType, key === 'universal' ? undefined : key)
        }
      }
    }
    for (const [round, content] of Object.entries(data as Record<string, unknown>)) {
      processSection(content, round)
    }
    return questions
  }

  const allQuestions: unknown[] = []

  // Process each role type
  for (const [roleType, roleData] of Object.entries(banks)) {
    if (roleType === 'universal_hr_questions') {
      const uq = banks.universal_hr_questions as Array<Record<string, unknown>>
      for (const q of uq) {
        allQuestions.push({
          id: q.id,
          role_type: 'universal',
          role_subtype: null,
          round_type: 'hr',
          question_text: q.question,
          tags: q.tags || [],
          follow_up_triggers: [],
          ideal_length_words: q.ideal_length || '150-250',
          strong_answer_signals: q.strong_answer_signals || [],
          is_sample: true
        })
      }
    } else if (roleType === 'fresher_specific') {
      const fq = banks.fresher_specific as Array<Record<string, unknown>>
      for (const q of fq) {
        allQuestions.push({
          id: q.id,
          role_type: 'fresher',
          role_subtype: null,
          round_type: 'general',
          question_text: q.question,
          tags: q.tags || [],
          follow_up_triggers: [],
          ideal_length_words: q.ideal_length || '150-300',
          strong_answer_signals: q.strong_answer_signals || [],
          is_sample: true
        })
      }
    } else {
      const qs = flattenQuestions(roleData as Record<string, unknown>, roleType)
      allQuestions.push(...qs)
    }
  }

  for (const q of allQuestions) {
    const { error } = await supabase
      .from('question_bank')
      .upsert(q as Record<string, unknown>, { onConflict: 'id' })
    if (error) console.error(`❌ Error seeding question ${(q as Record<string, unknown>).id}:`, error.message)
    else count++
  }
  console.log(`✅ Seeded ${count} questions\n`)
}

async function seedScoringConfig() {
  console.log('🌱 Seeding scoring configuration...')
  const config = await loadJSON('scoring-config.json')

  const { error } = await supabase
    .from('app_config')
    .upsert({
      key: 'scoring_config',
      value: config,
      updated_at: new Date().toISOString()
    }, { onConflict: 'key' })

  if (error) console.error('❌ Error seeding scoring config:', error.message)
  else console.log('✅ Seeded scoring configuration\n')
}

async function main() {
  console.log('🚀 PrepSense Seed Script Starting...\n')
  console.log(`📡 Connecting to: ${process.env.NEXT_PUBLIC_SUPABASE_URL}\n`)

  try {
    await seedJobDescriptions()
    await seedCompanyProfiles()
    await seedBadges()
    await seedQuestionBank()
    await seedScoringConfig()
    console.log('🎉 All seed data loaded successfully!')
    console.log('\nSummary:')
    console.log('  • Job Descriptions: Software Engineering (13) + PM (8) + Business/Design/Data/Ops (9) = 30 JDs')
    console.log('  • Company Profiles: 14 companies (Google, Amazon, Flipkart, Razorpay, Swiggy, Zepto, CRED, Groww, Meesho, PhonePe, Atlassian, Microsoft, Juspay, Paytm, Zomato)')
    console.log('  • Badges: 20 badges across milestone, streak, skill, achievement, and fun categories')
    console.log('  • Questions: Role-specific banks for SE, PM, BD across all 3 interview rounds')
    console.log('  • Scoring Config: Full metric rubrics, weights, and improvement suggestions')
  } catch (err) {
    console.error('❌ Seed script failed:', err)
    process.exit(1)
  }
}

main()
