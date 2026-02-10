import { API_BASE_URL, Persona } from '../config/config';

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
  object_name: string;
  fields: Record<string, string>;
}

export async function getPresignedUrl(requestType: 'ppt' | 'session'): Promise<PresignedUrlResponse> {
  const res = await fetch(`${API_BASE_URL}/s3_urls?request_type=${requestType}`);
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
