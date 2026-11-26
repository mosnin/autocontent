export { createOnboarding, OnboardingError, CONFIRM_THRESHOLD, type Onboarding } from './engine.ts';
export { preselect, rankOptions, mergeSignals, isNoneOption, EMPTY_SIGNALS } from './preselect.ts';
export { renderStatement, missingPlaceholders } from './proof.ts';
export {
  oauthProfileEnricher,
  emailDomainEnricher,
  browserEnricher,
  websiteEnricher,
  emailDomain,
  isPersonalDomain,
  companyFromDomain,
  PERSONAL_EMAIL_DOMAINS,
  type FieldMap,
  type WebsiteScan,
} from './enrichers.ts';
export type * from './types.ts';
export { detectTech, extractSite, scanWebsite, TECH_SIGNATURES } from './site.ts';
export { decideWithin, classifyItems, rankItems, decisionEnricher, type DecisionAdapter, type DecisionQuestion, type DecisionAnswer, type DecisionAnswers } from './decisions.ts';
