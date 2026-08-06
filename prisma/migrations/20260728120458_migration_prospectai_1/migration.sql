-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'ADMIN', 'MANAGER', 'SDR', 'VIEWER');

-- CreateEnum
CREATE TYPE "PlanCode" AS ENUM ('FREE', 'START', 'PRO', 'AGENCY');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED');

-- CreateEnum
CREATE TYPE "ScrapeJobStatus" AS ENUM ('PENDING', 'QUEUED', 'RUNNING', 'NORMALIZING', 'SCORING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM ('GOOGLE_MAPS', 'CSV_IMPORT', 'MANUAL', 'MOCK');

-- CreateEnum
CREATE TYPE "SignalState" AS ENUM ('PRESENTE', 'AUSENTE', 'DESCONHECIDO');

-- CreateEnum
CREATE TYPE "WebsiteStatus" AS ENUM ('SEM_SITE', 'SITE_PRECARIO', 'SITE_PROPRIO', 'DESCONHECIDO');

-- CreateEnum
CREATE TYPE "WhatsAppStatus" AS ENUM ('UNKNOWN', 'LIKELY', 'VERIFIED');

-- CreateEnum
CREATE TYPE "ScoreLevel" AS ENUM ('BAIXA', 'MEDIA', 'ALTA', 'MUITO_ALTA');

-- CreateEnum
CREATE TYPE "ScoreReasonPolarity" AS ENUM ('POSITIVE', 'NEGATIVE', 'DISQUALIFYING');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('LEAD_CREATED', 'LEAD_UPDATED', 'PHONE_COPIED', 'MAP_OPENED', 'WHATSAPP_OPENED', 'WEBSITE_OPENED', 'SOCIAL_OPENED', 'STAGE_CHANGED', 'FAVORITED', 'UNFAVORITED', 'SUPPRESSED', 'SCORE_RECALCULATED', 'OUTREACH_GENERATED', 'CONTACT_REGISTERED', 'FOLLOWUP_CREATED', 'FOLLOWUP_COMPLETED', 'NOTE_ADDED');

-- CreateEnum
CREATE TYPE "ContactChannel" AS ENUM ('WHATSAPP', 'EMAIL', 'INSTAGRAM', 'PHONE', 'IN_PERSON', 'OTHER');

-- CreateEnum
CREATE TYPE "ContactDirection" AS ENUM ('SENT', 'RECEIVED');

-- CreateEnum
CREATE TYPE "FollowUpStatus" AS ENUM ('PENDING', 'COMPLETED', 'OVERDUE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FollowUpPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "OutreachTone" AS ENUM ('CONSULTIVO', 'DIRETO', 'INFORMAL', 'EXECUTIVO');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('HIGH_SCORE_LEAD', 'SEARCH_COMPLETED', 'SEARCH_FAILED', 'FOLLOWUP_OVERDUE', 'LIMIT_NEAR', 'WEEKLY_SUMMARY', 'LEAD_PROFILE_UPDATED');

-- CreateEnum
CREATE TYPE "SuppressionReason" AS ENUM ('USER_REQUEST', 'INVALID_DATA', 'COMPETITOR', 'ALREADY_CLIENT', 'OTHER');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('DRAFT', 'SENT', 'SIGNED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ExportStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'SDR',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" TEXT NOT NULL,
    "code" "PlanCode" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priceCents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "limits" JSONB NOT NULL,
    "features" JSONB NOT NULL DEFAULT '[]',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
    "currentPeriodStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currentPeriodEnd" TIMESTAMP(3),
    "trialEndsAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_usages" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "leadsReserved" INTEGER NOT NULL DEFAULT 0,
    "leadsSettled" INTEGER NOT NULL DEFAULT 0,
    "searchesCount" INTEGER NOT NULL DEFAULT 0,
    "aiGenerationsCount" INTEGER NOT NULL DEFAULT 0,
    "exportsCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plan_usages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_states" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "currentStep" INTEGER NOT NULL DEFAULT 1,
    "servicesSold" JSONB NOT NULL DEFAULT '[]',
    "targetNiches" JSONB NOT NULL DEFAULT '[]',
    "targetRegions" JSONB NOT NULL DEFAULT '[]',
    "preferredChannel" TEXT,
    "monthlyGoal" TEXT,
    "skipped" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "onboarding_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prospecting_searches" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdById" TEXT,
    "niche" TEXT NOT NULL,
    "stateUf" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "neighborhood" TEXT,
    "radiusKm" INTEGER NOT NULL DEFAULT 10,
    "requestedCount" INTEGER NOT NULL DEFAULT 5,
    "filters" JSONB NOT NULL DEFAULT '{}',
    "leadsFound" INTEGER NOT NULL DEFAULT 0,
    "duplicatesFound" INTEGER NOT NULL DEFAULT 0,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "prospecting_searches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scrape_jobs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "searchId" TEXT NOT NULL,
    "status" "ScrapeJobStatus" NOT NULL DEFAULT 'PENDING',
    "source" "LeadSource" NOT NULL DEFAULT 'GOOGLE_MAPS',
    "idempotencyKey" TEXT NOT NULL,
    "externalJobId" TEXT,
    "queueJobId" TEXT,
    "keyword" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "resultCount" INTEGER NOT NULL DEFAULT 0,
    "newLeadCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateCount" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "queuedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scrape_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "searchId" TEXT,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "phoneE164" TEXT,
    "phoneRaw" TEXT,
    "email" TEXT,
    "website" TEXT,
    "websiteStatus" "WebsiteStatus" NOT NULL DEFAULT 'DESCONHECIDO',
    "addressStreet" TEXT,
    "addressNeighborhood" TEXT,
    "addressCity" TEXT,
    "addressStateUf" TEXT,
    "addressPostalCode" TEXT,
    "addressFull" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "reviewCount" INTEGER,
    "reviewRating" DOUBLE PRECISION,
    "openHours" JSONB,
    "timezone" TEXT,
    "source" "LeadSource" NOT NULL DEFAULT 'GOOGLE_MAPS',
    "placeId" TEXT,
    "cid" TEXT,
    "sourceUrl" TEXT,
    "fingerprint" TEXT NOT NULL,
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "isDisqualified" BOOLEAN NOT NULL DEFAULT false,
    "suppressedAt" TIMESTAMP(3),
    "lastContactedAt" TIMESTAMP(3),
    "lastEnrichedAt" TIMESTAMP(3),
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_source_records" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "scrapeJobId" TEXT,
    "source" "LeadSource" NOT NULL DEFAULT 'GOOGLE_MAPS',
    "sourceId" TEXT,
    "payload" JSONB NOT NULL,
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_source_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_digital_presences" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "hasWebsite" "SignalState" NOT NULL DEFAULT 'DESCONHECIDO',
    "hasEmail" "SignalState" NOT NULL DEFAULT 'DESCONHECIDO',
    "hasPhone" "SignalState" NOT NULL DEFAULT 'DESCONHECIDO',
    "hasInstagram" "SignalState" NOT NULL DEFAULT 'DESCONHECIDO',
    "hasFacebook" "SignalState" NOT NULL DEFAULT 'DESCONHECIDO',
    "hasReviews" "SignalState" NOT NULL DEFAULT 'DESCONHECIDO',
    "whatsappStatus" "WhatsAppStatus" NOT NULL DEFAULT 'UNKNOWN',
    "instagramUrl" TEXT,
    "facebookUrl" TEXT,
    "websiteHasHttps" BOOLEAN,
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_digital_presences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_scores" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    "level" "ScoreLevel" NOT NULL DEFAULT 'BAIXA',
    "algorithmVersion" TEXT NOT NULL DEFAULT 'score-v1',
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_score_reasons" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "scoreId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "weight" INTEGER NOT NULL,
    "polarity" "ScoreReasonPolarity" NOT NULL,
    "evidence" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_score_reasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_stages" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#2F6BFF',
    "isTerminal" BOOLEAN NOT NULL DEFAULT false,
    "isWon" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pipeline_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_cards" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "ownerId" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "estimatedValue" INTEGER,
    "lostReason" TEXT,
    "enteredStageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pipeline_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_transitions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "fromStageId" TEXT,
    "toStageId" TEXT NOT NULL,
    "changedById" TEXT,
    "origin" TEXT NOT NULL DEFAULT 'manual',
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pipeline_transitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_activities" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "actorId" TEXT,
    "type" "ActivityType" NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_notes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "authorId" TEXT,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "lead_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_contact_records" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "authorId" TEXT,
    "channel" "ContactChannel" NOT NULL,
    "direction" "ContactDirection" NOT NULL,
    "outcome" TEXT,
    "notes" TEXT,
    "outreachId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "rectifiedById" TEXT,

    CONSTRAINT "lead_contact_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_follow_ups" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "ownerId" TEXT,
    "channel" "ContactChannel" NOT NULL DEFAULT 'WHATSAPP',
    "priority" "FollowUpPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "FollowUpStatus" NOT NULL DEFAULT 'PENDING',
    "dueAt" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_follow_ups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outreach_messages" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "authorId" TEXT,
    "channel" "ContactChannel" NOT NULL DEFAULT 'WHATSAPP',
    "tone" "OutreachTone" NOT NULL DEFAULT 'CONSULTIVO',
    "serviceOffered" TEXT,
    "objective" TEXT,
    "callToAction" TEXT,
    "extraNotes" TEXT,
    "prompt" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'mock',
    "model" TEXT,
    "tokensEstimated" INTEGER,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isSent" BOOLEAN NOT NULL DEFAULT false,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outreach_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppression_entries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "phoneE164" TEXT,
    "email" TEXT,
    "domain" TEXT,
    "reason" "SuppressionReason" NOT NULL DEFAULT 'USER_REQUEST',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suppression_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_settings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_flags" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposals" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leadId" TEXT,
    "title" TEXT NOT NULL,
    "status" "ProposalStatus" NOT NULL DEFAULT 'DRAFT',
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "validUntil" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposal_items" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitCents" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proposal_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contracts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "proposalId" TEXT,
    "title" TEXT NOT NULL,
    "status" "ContractStatus" NOT NULL DEFAULT 'DRAFT',
    "content" TEXT,
    "signedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#6B7A99',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_tags" (
    "leadId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_tags_pkey" PRIMARY KEY ("leadId","tagId")
);

-- CreateTable
CREATE TABLE "export_jobs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "requestedById" TEXT,
    "format" TEXT NOT NULL DEFAULT 'csv',
    "status" "ExportStatus" NOT NULL DEFAULT 'PENDING',
    "filters" JSONB NOT NULL DEFAULT '{}',
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "filePath" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "export_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE INDEX "memberships_tenantId_idx" ON "memberships"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_userId_tenantId_key" ON "memberships"("userId", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");

-- CreateIndex
CREATE INDEX "refresh_tokens_expiresAt_idx" ON "refresh_tokens"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "plans_code_key" ON "plans"("code");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_tenantId_key" ON "subscriptions"("tenantId");

-- CreateIndex
CREATE INDEX "subscriptions_planId_idx" ON "subscriptions"("planId");

-- CreateIndex
CREATE INDEX "plan_usages_tenantId_idx" ON "plan_usages"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "plan_usages_tenantId_periodStart_key" ON "plan_usages"("tenantId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_states_tenantId_key" ON "onboarding_states"("tenantId");

-- CreateIndex
CREATE INDEX "prospecting_searches_tenantId_createdAt_idx" ON "prospecting_searches"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "scrape_jobs_tenantId_status_idx" ON "scrape_jobs"("tenantId", "status");

-- CreateIndex
CREATE INDEX "scrape_jobs_searchId_idx" ON "scrape_jobs"("searchId");

-- CreateIndex
CREATE UNIQUE INDEX "scrape_jobs_tenantId_idempotencyKey_key" ON "scrape_jobs"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "leads_tenantId_createdAt_idx" ON "leads"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "leads_tenantId_addressStateUf_addressCity_idx" ON "leads"("tenantId", "addressStateUf", "addressCity");

-- CreateIndex
CREATE INDEX "leads_tenantId_websiteStatus_idx" ON "leads"("tenantId", "websiteStatus");

-- CreateIndex
CREATE INDEX "leads_searchId_idx" ON "leads"("searchId");

-- CreateIndex
CREATE UNIQUE INDEX "leads_tenantId_fingerprint_key" ON "leads"("tenantId", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "leads_tenantId_placeId_key" ON "leads"("tenantId", "placeId");

-- CreateIndex
CREATE UNIQUE INDEX "lead_source_records_leadId_key" ON "lead_source_records"("leadId");

-- CreateIndex
CREATE INDEX "lead_source_records_tenantId_idx" ON "lead_source_records"("tenantId");

-- CreateIndex
CREATE INDEX "lead_source_records_scrapeJobId_idx" ON "lead_source_records"("scrapeJobId");

-- CreateIndex
CREATE UNIQUE INDEX "lead_digital_presences_leadId_key" ON "lead_digital_presences"("leadId");

-- CreateIndex
CREATE INDEX "lead_digital_presences_tenantId_idx" ON "lead_digital_presences"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "lead_scores_leadId_key" ON "lead_scores"("leadId");

-- CreateIndex
CREATE INDEX "lead_scores_tenantId_value_idx" ON "lead_scores"("tenantId", "value");

-- CreateIndex
CREATE INDEX "lead_score_reasons_scoreId_idx" ON "lead_score_reasons"("scoreId");

-- CreateIndex
CREATE INDEX "lead_score_reasons_tenantId_code_idx" ON "lead_score_reasons"("tenantId", "code");

-- CreateIndex
CREATE INDEX "pipeline_stages_tenantId_order_idx" ON "pipeline_stages"("tenantId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_stages_tenantId_slug_key" ON "pipeline_stages"("tenantId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_cards_leadId_key" ON "pipeline_cards"("leadId");

-- CreateIndex
CREATE INDEX "pipeline_cards_tenantId_stageId_position_idx" ON "pipeline_cards"("tenantId", "stageId", "position");

-- CreateIndex
CREATE INDEX "pipeline_transitions_cardId_createdAt_idx" ON "pipeline_transitions"("cardId", "createdAt");

-- CreateIndex
CREATE INDEX "pipeline_transitions_tenantId_idx" ON "pipeline_transitions"("tenantId");

-- CreateIndex
CREATE INDEX "lead_activities_tenantId_leadId_createdAt_idx" ON "lead_activities"("tenantId", "leadId", "createdAt");

-- CreateIndex
CREATE INDEX "lead_notes_tenantId_leadId_createdAt_idx" ON "lead_notes"("tenantId", "leadId", "createdAt");

-- CreateIndex
CREATE INDEX "lead_contact_records_tenantId_leadId_occurredAt_idx" ON "lead_contact_records"("tenantId", "leadId", "occurredAt");

-- CreateIndex
CREATE INDEX "lead_follow_ups_tenantId_status_dueAt_idx" ON "lead_follow_ups"("tenantId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "lead_follow_ups_leadId_idx" ON "lead_follow_ups"("leadId");

-- CreateIndex
CREATE INDEX "outreach_messages_tenantId_leadId_createdAt_idx" ON "outreach_messages"("tenantId", "leadId", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_tenantId_readAt_createdAt_idx" ON "notifications"("tenantId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_createdAt_idx" ON "audit_logs"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "suppression_entries_tenantId_phoneE164_idx" ON "suppression_entries"("tenantId", "phoneE164");

-- CreateIndex
CREATE INDEX "suppression_entries_tenantId_email_idx" ON "suppression_entries"("tenantId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "app_settings_tenantId_key_key" ON "app_settings"("tenantId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "feature_flags_tenantId_key_key" ON "feature_flags"("tenantId", "key");

-- CreateIndex
CREATE INDEX "proposals_tenantId_status_idx" ON "proposals"("tenantId", "status");

-- CreateIndex
CREATE INDEX "proposal_items_proposalId_idx" ON "proposal_items"("proposalId");

-- CreateIndex
CREATE INDEX "contracts_tenantId_status_idx" ON "contracts"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "tags_tenantId_name_key" ON "tags"("tenantId", "name");

-- CreateIndex
CREATE INDEX "export_jobs_tenantId_status_idx" ON "export_jobs"("tenantId", "status");

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_usages" ADD CONSTRAINT "plan_usages_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_states" ADD CONSTRAINT "onboarding_states_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospecting_searches" ADD CONSTRAINT "prospecting_searches_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scrape_jobs" ADD CONSTRAINT "scrape_jobs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scrape_jobs" ADD CONSTRAINT "scrape_jobs_searchId_fkey" FOREIGN KEY ("searchId") REFERENCES "prospecting_searches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_searchId_fkey" FOREIGN KEY ("searchId") REFERENCES "prospecting_searches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_source_records" ADD CONSTRAINT "lead_source_records_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_source_records" ADD CONSTRAINT "lead_source_records_scrapeJobId_fkey" FOREIGN KEY ("scrapeJobId") REFERENCES "scrape_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_digital_presences" ADD CONSTRAINT "lead_digital_presences_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_scores" ADD CONSTRAINT "lead_scores_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_score_reasons" ADD CONSTRAINT "lead_score_reasons_scoreId_fkey" FOREIGN KEY ("scoreId") REFERENCES "lead_scores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_cards" ADD CONSTRAINT "pipeline_cards_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_cards" ADD CONSTRAINT "pipeline_cards_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_cards" ADD CONSTRAINT "pipeline_cards_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "pipeline_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_cards" ADD CONSTRAINT "pipeline_cards_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_transitions" ADD CONSTRAINT "pipeline_transitions_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "pipeline_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_transitions" ADD CONSTRAINT "pipeline_transitions_fromStageId_fkey" FOREIGN KEY ("fromStageId") REFERENCES "pipeline_stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_transitions" ADD CONSTRAINT "pipeline_transitions_toStageId_fkey" FOREIGN KEY ("toStageId") REFERENCES "pipeline_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_transitions" ADD CONSTRAINT "pipeline_transitions_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_notes" ADD CONSTRAINT "lead_notes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_notes" ADD CONSTRAINT "lead_notes_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_notes" ADD CONSTRAINT "lead_notes_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_contact_records" ADD CONSTRAINT "lead_contact_records_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_contact_records" ADD CONSTRAINT "lead_contact_records_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_contact_records" ADD CONSTRAINT "lead_contact_records_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_contact_records" ADD CONSTRAINT "lead_contact_records_outreachId_fkey" FOREIGN KEY ("outreachId") REFERENCES "outreach_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_follow_ups" ADD CONSTRAINT "lead_follow_ups_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_follow_ups" ADD CONSTRAINT "lead_follow_ups_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_follow_ups" ADD CONSTRAINT "lead_follow_ups_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_messages" ADD CONSTRAINT "outreach_messages_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_messages" ADD CONSTRAINT "outreach_messages_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_messages" ADD CONSTRAINT "outreach_messages_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppression_entries" ADD CONSTRAINT "suppression_entries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_items" ADD CONSTRAINT "proposal_items_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "proposals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tags" ADD CONSTRAINT "tags_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_tags" ADD CONSTRAINT "lead_tags_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_tags" ADD CONSTRAINT "lead_tags_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
