import { AppDatabase } from '../types';

export interface DriveFileItem {
  id: string;
  name: string;
  createdTime: string;
  modifiedTime?: string;
  size?: string;
  webViewLink?: string;
  description?: string;
  mimeType?: string;
}

export interface DriveStorageInfo {
  displayName: string;
  emailAddress: string;
  photoLink?: string;
  usageBytes: number;
  limitBytes: number;
}

const DEFAULT_BACKUP_FOLDER_NAME = 'نسخ احتياطية للمتجر - Store Backups';

/**
 * Fetch Google Drive user details and storage quota.
 */
export async function getDriveStorageInfo(accessToken: string): Promise<DriveStorageInfo> {
  const res = await fetch('https://www.googleapis.com/drive/v3/about?fields=user,storageQuota', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`تعذر جلب معلومات Google Drive: ${res.status} ${errorText}`);
  }

  const data = await res.json();
  return {
    displayName: data.user?.displayName || 'مستخدم Google',
    emailAddress: data.user?.emailAddress || '',
    photoLink: data.user?.photoLink,
    usageBytes: parseInt(data.storageQuota?.usage || '0', 10),
    limitBytes: parseInt(data.storageQuota?.limit || '0', 10),
  };
}

/**
 * Finds or creates the dedicated folder for app backups on Google Drive.
 */
export async function getOrCreateBackupFolder(accessToken: string, customFolderName?: string): Promise<string> {
  const folderName = customFolderName || DEFAULT_BACKUP_FOLDER_NAME;
  // Check if folder exists
  const query = encodeURIComponent(`name = '${folderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`);
  const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id, name)&spaces=drive`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!searchRes.ok) {
    const errorText = await searchRes.text();
    throw new Error(`فشل البحث عن مجلد Google Drive: ${searchRes.status} ${errorText}`);
  }

  const searchData = await searchRes.json();
  if (searchData.files && searchData.files.length > 0) {
    return searchData.files[0].id;
  }

  // Create folder if not found
  const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      description: 'مجلد مخصص لحفظ النسخ الاحتياطية الخاصة بتطبيق إدارة المتجر والمبيعات',
    }),
  });

  if (!createRes.ok) {
    const errorText = await createRes.text();
    throw new Error(`فشل إنشاء مجلد Google Drive: ${createRes.status} ${errorText}`);
  }

  const folderData = await createRes.json();
  return folderData.id;
}

/**
 * Uploads a full JSON database backup to the Google Drive backup folder.
 */
export async function uploadBackupToDrive(
  accessToken: string,
  db: AppDatabase,
  note?: string
): Promise<DriveFileItem> {
  const folderId = await getOrCreateBackupFolder(accessToken);

  const now = new Date();
  const dateStr = now.toISOString().replace(/[:.]/g, '-');
  const shopPrefix = (db.settings.shop || 'store').replace(/[^a-zA-Z0-9\u0600-\u06FF_-]/g, '_');
  const fileName = `backup_${shopPrefix}_${dateStr.slice(0, 19)}.json`;

  const metadata = {
    name: fileName,
    parents: [folderId],
    mimeType: 'application/json',
    description: note || `نسخة احتياطية لتطبيق ${db.settings.shop || 'المتجر'} (${db.products.length} صنف، ${db.invoices.length} فاتورة، ${db.shortages.length} نواقص)`,
  };

  const fileContent = JSON.stringify(db, null, 2);
  const boundary = '-------314159265358979323846';
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const multipartRequestBody =
    delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    delimiter +
    'Content-Type: application/json\r\n\r\n' +
    fileContent +
    closeDelimiter;

  const uploadRes = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,createdTime,modifiedTime,size,webViewLink,description',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: multipartRequestBody,
    }
  );

  if (!uploadRes.ok) {
    const errorText = await uploadRes.text();
    throw new Error(`فشل رفع النسخة الاحتياطية إلى Google Drive: ${uploadRes.status} ${errorText}`);
  }

  return await uploadRes.json();
}

/**
 * Uploads a text or markdown report directly to the Google Drive folder.
 */
export async function uploadTextReportToDrive(
  accessToken: string,
  fileName: string,
  content: string,
  description?: string
): Promise<DriveFileItem> {
  const folderId = await getOrCreateBackupFolder(accessToken);

  const metadata = {
    name: fileName,
    parents: [folderId],
    mimeType: 'text/plain; charset=UTF-8',
    description: description || 'تقرير صادر من مكتبة الطيب أحسن',
  };

  const boundary = '-------314159265358979323846';
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const multipartRequestBody =
    delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    delimiter +
    'Content-Type: text/plain; charset=UTF-8\r\n\r\n' +
    content +
    closeDelimiter;

  const uploadRes = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,createdTime,modifiedTime,size,webViewLink,description',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: multipartRequestBody,
    }
  );

  if (!uploadRes.ok) {
    const errorText = await uploadRes.text();
    throw new Error(`فشل رفع التقرير إلى Google Drive: ${uploadRes.status} ${errorText}`);
  }

  return await uploadRes.json();
}

/**
 * Lists all backup files in the Google Drive backup folder.
 */
export async function listDriveBackups(accessToken: string): Promise<DriveFileItem[]> {
  const folderId = await getOrCreateBackupFolder(accessToken);

  const query = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${query}&orderBy=createdTime desc&fields=files(id, name, createdTime, modifiedTime, size, webViewLink, description, mimeType)`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`فشل جلب ملفات Google Drive: ${res.status} ${errorText}`);
  }

  const data = await res.json();
  return data.files || [];
}

/**
 * Downloads and parses a backup file content from Google Drive.
 */
export async function downloadBackupFromDrive(
  accessToken: string,
  fileId: string
): Promise<AppDatabase> {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`فشل تنزيل ملف النسخة الاحتياطية من Google Drive: ${res.status} ${errorText}`);
  }

  const json = await res.json();
  if (!json || !Array.isArray(json.products)) {
    throw new Error('الملف المسترجع من Google Drive لا يحتوي على بنية بيانات صالحة للمكتبة');
  }

  return json as AppDatabase;
}

/**
 * Deletes a file from Google Drive.
 * WARNING: Calling code MUST obtain explicit user confirmation before calling this function!
 */
export async function deleteDriveFile(accessToken: string, fileId: string): Promise<void> {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`فشل حذف الملف من Google Drive: ${res.status} ${errorText}`);
  }
}
