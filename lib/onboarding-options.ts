// Shared option lists for onboarding + settings so the two stay in sync.

export const COMPANY_SIZES = [
  { value: 'solo', label: 'Solo / Freelancer' },
  { value: '2-10', label: '2–10 employees' },
  { value: '11-50', label: '11–50 employees' },
  { value: '51-200', label: '51–200 employees' },
  { value: '201-1000', label: '201–1,000 employees' },
  { value: '1000+', label: '1,000+ employees' },
] as const

export const INDUSTRIES = [
  { value: 'software', label: 'Software / SaaS' },
  { value: 'ecommerce', label: 'E-commerce / Retail' },
  { value: 'finance', label: 'Finance / Fintech' },
  { value: 'healthcare', label: 'Healthcare' },
  { value: 'education', label: 'Education' },
  { value: 'marketing', label: 'Marketing / Agency' },
  { value: 'media', label: 'Media / Entertainment' },
  { value: 'real_estate', label: 'Real Estate' },
  { value: 'manufacturing', label: 'Manufacturing' },
  { value: 'consulting', label: 'Consulting' },
  { value: 'nonprofit', label: 'Nonprofit / Government' },
  { value: 'other', label: 'Other' },
] as const

export const REFERRAL_SOURCES = [
  { value: 'google', label: 'Google search' },
  { value: 'ai_assistant', label: 'ChatGPT / AI recommendation' },
  { value: 'twitter', label: 'Twitter / X' },
  { value: 'reddit', label: 'Reddit' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'friend', label: 'Friend / colleague' },
  { value: 'appsumo', label: 'AppSumo' },
  { value: 'blog', label: 'Blog / article' },
  { value: 'other', label: 'Other' },
] as const
