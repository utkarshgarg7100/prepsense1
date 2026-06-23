# PrepSense Seed Data

Complete seed data for the PrepSense AI Interview Coach platform. Drop this entire folder into your project root.

## Folder Structure

```
/data
  /jd
    software-engineering.json     → 13 JDs across SE subtypes
    product-management.json       → 8 JDs across PM subtypes
    business-design-data-ops.json → 9 JDs across BD, Design, Data, Ops
  /companies
    culture-profiles.json         → 15 company culture profiles
  /questions
    question-banks.json           → Question banks for all roles & rounds
  /badges
    badges.json                   → 20 badge definitions
  scoring-config.json             → Scoring rubrics, weights, and improvement tips
seed-script.ts                    → Supabase population script
```

## Coverage Summary

### Job Descriptions (30 total)
**Software Engineering (13)**
- Frontend: Razorpay (mid), Google (senior), Zepto (junior)
- Backend: Swiggy (mid), Amazon (senior), Groww (mid)
- Full Stack: CRED (mid)
- ML/AI Engineer: PhonePe (mid)
- DevOps/SRE: Atlassian (mid)
- Mobile Android: Meesho (mid)
- Security: Microsoft (senior)
- Data Engineering: Flipkart (mid)
- Blockchain/Web3: Navi (mid)

**Product Management (8)**
- Consumer PM: Swiggy (mid), Zepto (junior/APM)
- Growth PM: Groww (mid)
- B2B/Enterprise PM: Salesforce (senior)
- Technical PM: Razorpay (mid)
- AI/ML PM: Google (senior)
- 0-to-1 PM: CRED (senior)
- Platform/API PM: Juspay (mid)

**Business, Design, Data & Ops (9)**
- Business Development: Paytm (mid)
- Strategy & Ops: Ola (mid)
- Chief of Staff: Juspay (mid)
- Product Designer: CRED (mid)
- UX Researcher: Flipkart (mid)
- Data Scientist: PhonePe (mid)
- Data Analyst: Meesho (junior)
- Operations Manager: Zomato (mid)
- Program Manager: Microsoft (mid)

### Company Culture Profiles (15)
Razorpay, Swiggy, Zepto, Google, Amazon, Flipkart, CRED, Groww, Meesho, PhonePe, Atlassian, Microsoft, Juspay, Paytm, Zomato

Each profile includes:
- Culture values
- Interview style description
- What they look for
- Red flags for this company
- HR round focus areas
- 5 sample HR questions
- Founders round focus
- Key products and competitors
- Recent news to know (for prep brief)

### Question Banks
- Software Engineering: Technical (universal + FE/BE/ML specific), Founders, HR rounds
- Product Management: Technical (universal + Growth/TechPM specific), Founders, HR rounds
- Business Strategy: Technical, Founders, HR rounds
- Universal HR questions (8 questions applicable to all roles)
- Fresher-specific questions (4 questions for 0 experience candidates)

### Badges (20)
- Milestone: First Shot, All-Rounder, Role Master, Explorer, Mock Offer Earned
- Streak: On Fire (3d), Consistent (7d), Two-Week Warrior (14d)
- Skill: Deep Thinker, Data Driven, Smooth Talker, STAR Storyteller, Resume Pro, Crystal Clear, Ownership Master
- Achievement: Top 10%, Comeback Kid, Perfectionist
- Fun: Early Bird, Night Owl

### Scoring Config
Complete rubrics for all metrics across all 3 round types:
- Technical Round: Technical Depth, Problem Decomposition, Experience Match, Gap Awareness, Scalability Thinking
- Founders Round: Business Acumen, First Principles, Ambiguity Handling, Ownership Signals, Communication Clarity
- HR Round: Cultural Alignment, Self-Awareness, Conflict Resolution, Motivation Authenticity, Verbal Fluency
- Universal: STAR Compliance, Answer Conciseness, Consistency

Each metric includes scoring signals (high/medium/low), improvement suggestions, and weights.

## How to Run the Seed Script

```bash
# 1. Install dependencies
npm install @supabase/supabase-js ts-node typescript

# 2. Ensure env vars are set
export NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
export SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# 3. Run the seed script (from project root)
npx ts-node seed-script.ts
```

## Additional JDs to Add Later

The following role subtypes from the original spec need JDs added in the next data pass:

**Software Engineering**
- QA/SDET
- Embedded Systems

**Product Management**  
- Data PM

**Business & Strategy**
- Partnerships Manager

**Design**
- Design Systems

**Data & Analytics**
- Analytics Engineer
- BI Developer

**Operations**
- Project Manager (distinct from Program Manager)

## Company-Specific Expansion

Once the MVP is live, add company-specific JDs for:
- Tier 1 expansion: Stripe, Twilio, Uber, ByteDance, Coinbase
- Indian expansion: Delhivery, Porter, slice, OneCard, Fi Money, BharatPe, Nykaa, Urban Company, Cars24
- Consulting: McKinsey, BCG, Bain (for Strategy/CoS roles)
