import { AppDatabase } from '../types';
import { OWNER_EMAIL } from './firebase';
import { buildDailyBackupMimeEmail, getDailyBackupDateKey } from '../utils/backupTrashLogic';

export const GMAIL_BACKUP_META_STORAGE_KEY = 'tayeb_gmail_daily_backup_meta_v1';

export interface GmailDailyBackupMeta {
  lastSentDateKey: string | null;
  lastSentAt: string | null;
  lastMessageId?: string | null;
  recipient?: string | null;
  productCount?: number;
  invoiceCount?: number;
  shortageCount?: number;
}

export function readGmailDailyBackupMeta(): GmailDailyBackupMeta {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return { lastSentDateKey: null, lastSentAt: null };
  }
  try {
    const raw = localStorage.getItem(GMAIL_BACKUP_META_STORAGE_KEY);
    if (!raw) return { lastSentDateKey: null, lastSentAt: null };
    const parsed = JSON.parse(raw) as Partial<GmailDailyBackupMeta>;
    return {
      lastSentDateKey: typeof parsed.lastSentDateKey === 'string' ? parsed.lastSentDateKey : null,
      lastSentAt: typeof parsed.lastSentAt === 'string' ? parsed.lastSentAt : null,
      lastMessageId: typeof parsed.lastMessageId === 'string' ? parsed.lastMessageId : null,
      recipient: typeof parsed.recipient === 'string' ? parsed.recipient : null,
      productCount: typeof parsed.productCount === 'number' ? parsed.productCount : undefined,
      invoiceCount: typeof parsed.invoiceCount === 'number' ? parsed.invoiceCount : undefined,
      shortageCount: typeof parsed.shortageCount === 'number' ? parsed.shortageCount : undefined,
    };
  } catch {
    return { lastSentDateKey: null, lastSentAt: null };
  }
}

export function recordGmailDailyBackupMeta(meta: GmailDailyBackupMeta): GmailDailyBackupMeta {
  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(GMAIL_BACKUP_META_STORAGE_KEY, JSON.stringify(meta));
    } catch {
      // Ignore storage quota issues
    }
  }
  return meta;
}

export interface SendGmailBackupResult {
  messageId: string;
  threadId?: string;
  dateKey: string;
  filename: string;
  recipient: string;
  sentAt: string;
  productCount: number;
  categoryCount: number;
  invoiceCount: number;
  shortageCount: number;
}

export async function sendDailyBackupViaGmail(params: {
  dbState: AppDatabase;
  accessToken: string;
  recipientEmail?: string;
}): Promise<SendGmailBackupResult> {
  const recipient = String(params.recipientEmail || OWNER_EMAIL).trim().toLowerCase();
  if (recipient !== OWNER_EMAIL.toLowerCase()) {
    throw new Error('لا يُسمح بإرسال النسخة اليومية إلا إلى بريد المالك المعتمد فقط');
  }
  if (!params.accessToken) {
    throw new Error('AUTH_TOKEN_REQUIRED');
  }

  const now = new Date();
  const dateKey = getDailyBackupDateKey(now);
  const built = buildDailyBackupMimeEmail({
    to: recipient,
    shopName: params.dbState.settings?.shop || 'مكتبة الطيب أحسن',
    dateKey,
    snapshotDb: params.dbState,
    generatedAtIso: now.toISOString(),
  });

  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      raw: built.raw,
    }),
  });

  if (res.status === 401 || res.status === 403) {
    throw new Error('AUTH_TOKEN_EXPIRED_OR_MISSING_SCOPE');
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`فشل إرسال النسخة عبر Gmail: ${res.status} ${errText}`);
  }

  const data = await res.json();
  const sentAt = now.toISOString();

  recordGmailDailyBackupMeta({
    lastSentDateKey: dateKey,
    lastSentAt: sentAt,
    lastMessageId: data.id || null,
    recipient,
    productCount: built.productCount,
    invoiceCount: built.invoiceCount,
    shortageCount: built.shortageCount,
  });

  return {
    messageId: String(data.id || ''),
    threadId: typeof data.threadId === 'string' ? data.threadId : undefined,
    dateKey,
    filename: built.filename,
    recipient,
    sentAt,
    productCount: built.productCount,
    categoryCount: built.categoryCount,
    invoiceCount: built.invoiceCount,
    shortageCount: built.shortageCount,
  };
}
