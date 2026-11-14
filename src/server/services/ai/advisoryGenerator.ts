import { Type, Schema } from '@google/genai';
import { and, eq } from 'drizzle-orm';
import { db } from '../../../db/index.ts';
import { briefings, citizenAdvisories, statisticalRuns } from '../../../db/schema.ts';
import { ReadingLevel, SupportedLanguage } from '../../../shared/types.ts';
import { AppError } from '../../middleware/errorHandler.ts';
import { recordAuditLog } from '../auditService.ts';
import { getLLMProvider } from './llmProvider.ts';

interface AdvisoryContent {
  headline: string;
  currentConditionSummary: string;
  healthGuidance: string;
  childrenGuidance: string;
  olderAdultsGuidance: string;
  sensitiveGroupsGuidance: string;
  outdoorActivityGuidance: string;
}

const ADVISORY_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    headline: { type: Type.STRING },
    currentConditionSummary: { type: Type.STRING },
    healthGuidance: { type: Type.STRING },
    childrenGuidance: { type: Type.STRING },
    olderAdultsGuidance: { type: Type.STRING },
    sensitiveGroupsGuidance: { type: Type.STRING },
    outdoorActivityGuidance: { type: Type.STRING },
  },
  required: [
    'headline',
    'currentConditionSummary',
    'healthGuidance',
    'childrenGuidance',
    'olderAdultsGuidance',
    'sensitiveGroupsGuidance',
    'outdoorActivityGuidance',
  ],
};

const READING_LEVEL_INSTRUCTIONS: Record<ReadingLevel, string> = {
  simple:
    'Simple language for the general public (short everyday sentences, clear practical steps, avoid technical jargon).',
  standard:
    'Standard language for community members (clear civic tone, balances pollutant context with actionable precautions).',
  detailed:
    'Detailed language for informed readers (includes exact measured averages/peaks, exceedance context, and nuanced precautions).',
};

function verifyAdvisorySafety(content: AdvisoryContent): boolean {
  const combined = Object.values(content).join(' ');
  const prohibitedClaims = [
    /\bcures?\b/i,
    /\bdiagnos(e|es|is)\b/i,
    /\bguarantees?\s+no\s+harm\b/i,
    /\bprevents?\s+all\s+disease\b/i,
  ];
  return !prohibitedClaims.some((re) => re.test(combined));
}

export async function generateCitizenAdvisories(params: {
  organizationId: number;
  userId: number;
  briefingId: number;
  readingLevel: ReadingLevel;
  languages: SupportedLanguage[];
}): Promise<void> {
  const [briefing] = await db
    .select()
    .from(briefings)
    .where(
      and(
        eq(briefings.id, params.briefingId),
        eq(briefings.organizationId, params.organizationId),
      ),
    )
    .limit(1);

  if (!briefing) {
    throw new AppError(404, 'BRIEFING_NOT_FOUND', 'Briefing not found.');
  }

  const [statRun] = await db
    .select()
    .from(statisticalRuns)
    .where(eq(statisticalRuns.id, briefing.statisticalRunId))
    .limit(1);

  const llm = getLLMProvider();

  // Always synthesize verified English baseline first
  const enResult = await llm.generateStructuredJson<AdvisoryContent>({
    systemInstruction: [
      'You write clear, trustworthy public air quality citizen advisories.',
      `Reading level requirement: ${READING_LEVEL_INSTRUCTIONS[params.readingLevel]}`,
      'SAFETY RULES:',
      '1. Describe potential health concerns cautiously (e.g., "may irritate airways") — NEVER make diagnostic, curative, or unsupported medical claims.',
      '2. Include practical precautions for children, older adults, sensitive groups (asthma/heart/lung conditions), and outdoor activity timing.',
      '3. Base all air quality figures strictly on the provided briefing summary and statistics.',
    ].join('\n'),
    userPrompt: JSON.stringify({
      briefingTitle: briefing.title,
      executiveSummary: briefing.executiveSummary,
      risksAndUncertainties: JSON.parse(briefing.risksAndUncertaintiesJson),
      aqiStandard: statRun?.aqiStandard || 'CPCB_NAQI',
      summaryMetrics: statRun ? JSON.parse(statRun.summaryMetricsJson).global : {},
    }),
    responseSchema: ADVISORY_SCHEMA,
  });

  const enSafetyOk = verifyAdvisorySafety(enResult.data);

  const generatedMap = new Map<SupportedLanguage, { content: AdvisoryContent; safe: boolean }>();
  if (params.languages.includes('en')) {
    generatedMap.set('en', { content: enResult.data, safe: enSafetyOk });
  }

  if (params.languages.includes('hi')) {
    const hiResult = await llm.generateStructuredJson<AdvisoryContent>({
      systemInstruction: [
        'Translate the verified English citizen air quality advisory into natural, clear, formal civic Hindi (Devanagari script).',
        'CRITICAL SAFETY RULES:',
        '1. Preserve every health precaution, restriction, and uncertainty meaning faithfully.',
        '2. Preserve all numeric pollutant values and units (µg/m³, mg/m³) accurately.',
        '3. Maintain the same reading-level clarity appropriate for public communication.',
      ].join('\n'),
      userPrompt: JSON.stringify(enResult.data),
      responseSchema: ADVISORY_SCHEMA,
    });
    generatedMap.set('hi', { content: hiResult.data, safe: enSafetyOk });
  }

  db.transaction((tx) => {
    for (const [lang, entry] of generatedMap.entries()) {
      tx.insert(citizenAdvisories)
        .values({
          organizationId: params.organizationId,
          briefingId: params.briefingId,
          readingLevel: params.readingLevel,
          language: lang,
          headline: entry.content.headline,
          currentConditionSummary: entry.content.currentConditionSummary,
          healthGuidance: entry.content.healthGuidance,
          childrenGuidance: entry.content.childrenGuidance,
          olderAdultsGuidance: entry.content.olderAdultsGuidance,
          sensitiveGroupsGuidance: entry.content.sensitiveGroupsGuidance,
          outdoorActivityGuidance: entry.content.outdoorActivityGuidance,
          safetyCheckPassed: entry.safe,
        })
        .onConflictDoUpdate({
          target: [
            citizenAdvisories.briefingId,
            citizenAdvisories.readingLevel,
            citizenAdvisories.language,
          ],
          set: {
            headline: entry.content.headline,
            currentConditionSummary: entry.content.currentConditionSummary,
            healthGuidance: entry.content.healthGuidance,
            childrenGuidance: entry.content.childrenGuidance,
            olderAdultsGuidance: entry.content.olderAdultsGuidance,
            sensitiveGroupsGuidance: entry.content.sensitiveGroupsGuidance,
            outdoorActivityGuidance: entry.content.outdoorActivityGuidance,
            safetyCheckPassed: entry.safe,
          },
        })
        .run();
    }
  });

  await recordAuditLog({
    organizationId: params.organizationId,
    actorUserId: params.userId,
    action: 'CITIZEN_ADVISORY_GENERATED',
    resourceType: 'briefing',
    resourceId: params.briefingId,
    metadata: { readingLevel: params.readingLevel, languages: params.languages },
  });
}
