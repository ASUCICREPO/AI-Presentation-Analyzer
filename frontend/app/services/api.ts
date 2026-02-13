import { API_BASE_URL, Persona, S3RequestType } from '../config/config';

// ─── Personas ────────────────────────────────────────────────────────

export async function fetchPersonas(): Promise<Persona[]> {
  const res = await fetch(`${API_BASE_URL}/personas`);
  if (!res.ok) throw new Error('Failed to fetch personas');
  const data = await res.json();
  return data.personas ?? [];
}

// ─── S3 Presigned URL ────────────────────────────────────────────────

interface PresignedUrlResponse {
  presigned_url: string;
  fields: Record<string, string>;
}

export async function getPresignedUrl(
  requestType: S3RequestType,
  sessionId: string,
): Promise<PresignedUrlResponse> {
  const res = await fetch(
    `${API_BASE_URL}/s3_urls?request_type=${requestType}&session_id=${sessionId}`,
  );
  if (!res.ok) throw new Error('Failed to get presigned URL');
  return res.json();
}

export function uploadFileWithPresignedUrl(
  file: File,
  presigned: PresignedUrlResponse,
  onProgress?: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const formData = new FormData();

    // Append all the fields from the presigned response first
    Object.entries(presigned.fields).forEach(([key, value]) => {
      formData.append(key, value);
    });

    // File must be last
    formData.append('file', file);

    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error('Failed to upload file'));
      }
    });

    xhr.addEventListener('error', () => reject(new Error('Upload network error')));
    xhr.addEventListener('abort', () => reject(new Error('Upload cancelled')));

    xhr.open('POST', presigned.presigned_url);
    xhr.send(formData);
  });
}

/**
 * Upload plain text content (e.g. custom persona instructions) using a presigned URL.
 */
export async function uploadTextWithPresignedUrl(
  text: string,
  presigned: PresignedUrlResponse,
): Promise<void> {
  const formData = new FormData();

  Object.entries(presigned.fields).forEach(([key, value]) => {
    formData.append(key, value);
  });

  const blob = new Blob([text], { type: 'text/plain' });
  formData.append('file', blob);

  const res = await fetch(presigned.presigned_url, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok && res.status >= 300) {
    throw new Error('Failed to upload persona customization');
  }
}

// ─── Persona Customization (read back from S3) ──────────────────────

interface PersonaCustomizationResponse {
  customization: string | null;
  exists: boolean;
}

/**
 * Fetch saved persona customization text for a given session.
 */
export async function getPersonaCustomization(
  sessionId: string,
): Promise<PersonaCustomizationResponse> {
  const res = await fetch(
    `${API_BASE_URL}/s3_urls?action=get_persona&session_id=${sessionId}`,
  );
  if (!res.ok) throw new Error('Failed to fetch persona customization');
  return res.json();
}
