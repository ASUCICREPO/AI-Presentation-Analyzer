import { API_BASE_URL, Persona, S3RequestType } from '../config/config';
import { SessionManifest } from '../hooks/useSessionManifest';

// ─── AI Feedback Types ───────────────────────────────────────────────

export interface AIFeedbackResponse {
  status: string;
  sessionId: string;
  persona: { id: string; title: string; description: string };
  keyRecommendations: { title: string; description: string }[];
  performanceSummary: {
    overallAssessment: string;
    contentStrengths: string[];
    deliveryFeedback: {
      speakingPace: string;
      volume: string;
      eyeContact: string;
      fillerWords: string;
      pauses: string;
    };
  };
  generatedAt: string;
  model: string;
  includedFiles: Record<string, boolean>;
  timestampedFeedback?: { timestamp: string; message: string }[];
}

export class AnalyticsProcessingError extends Error {
  constructor() {
    super('Analytics still processing');
    this.name = 'AnalyticsProcessingError';
  }
}

// ─── Helper: get auth headers if available ───────────────────────────
// The Cognito authorizer on API Gateway requires an Authorization header.
// We attempt to resolve the ID token lazily; callers that don't need auth
// can simply omit getIdToken.
type GetIdTokenFn = (() => Promise<string>) | null;

let _getIdToken: GetIdTokenFn = null;

/** Call once (from AuthContext provider) to wire up the token resolver. */
export function setAuthTokenResolver(fn: GetIdTokenFn) {
  _getIdToken = fn;
}

async function authHeaders(): Promise<Record<string, string>> {
  if (!_getIdToken) return {};
  try {
    const token = await _getIdToken();
    return { Authorization: token };
  } catch {
    return {};
  }
}

// ─── Personas ────────────────────────────────────────────────────────

export async function fetchPersonas(): Promise<Persona[]> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE_URL}/personas`, { headers });
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
  const headers = await authHeaders();
  const res = await fetch(
    `${API_BASE_URL}/s3_urls?request_type=${requestType}&session_id=${sessionId}`,
    { headers },
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

/**
 * Save persona customization text via the guardrail-gated Lambda route.
 * POST /s3_urls?action=upload_persona&session_id={id}
 */
export async function savePersonaCustomization(
  sessionId: string,
  text: string,
): Promise<{ message: string; rejected?: boolean }> {
  const headers = await authHeaders();
  const res = await fetch(
    `${API_BASE_URL}/s3_urls?action=upload_persona&session_id=${sessionId}`,
    {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    },
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.message ?? 'Failed to save persona customization');
  return data;
}

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
  const headers = await authHeaders();
  const res = await fetch(
    `${API_BASE_URL}/s3_urls?action=get_persona&session_id=${sessionId}`,
    { headers },
  );
  if (!res.ok) throw new Error('Failed to fetch persona customization');
  return res.json();
}

// ─── Multipart Upload (video recording) ──────────────────────────────

interface InitiateMultipartResponse {
  uploadId: string;
  key: string;
}

interface GetPartUrlResponse {
  url: string;
  part_number: number;
}

/**
 * Initiate a new multipart upload for recording.webm.
 */
export async function initiateMultipartUpload(
  sessionId: string,
): Promise<InitiateMultipartResponse> {
  const headers = await authHeaders();
  const res = await fetch(
    `${API_BASE_URL}/s3_urls?action=initiate_multipart&session_id=${sessionId}`,
    { method: 'POST', headers },
  );
  if (!res.ok) throw new Error('Failed to initiate multipart upload');
  return res.json();
}

/**
 * Get a presigned PUT URL for a single multipart part.
 */
export async function getMultipartPartUrl(
  sessionId: string,
  uploadId: string,
  partNumber: number,
): Promise<GetPartUrlResponse> {
  const headers = await authHeaders();
  const res = await fetch(
    `${API_BASE_URL}/s3_urls?action=get_part_url&session_id=${sessionId}&upload_id=${encodeURIComponent(uploadId)}&part_number=${partNumber}`,
    { headers },
  );
  if (!res.ok) throw new Error(`Failed to get part URL for part ${partNumber}`);
  return res.json();
}

/**
 * Upload a single chunk (Blob) as one multipart part.
 * Returns the ETag from the response headers.
 *
 * NOTE: We wrap the blob in a new typeless Blob to prevent the browser
 * from auto-sending Content-Type (which isn't in the presigned signature
 * and would cause a 403 SignatureDoesNotMatch). The content type is
 * already set on the multipart upload itself via create_multipart_upload.
 */
export async function uploadMultipartPart(
  url: string,
  blob: Blob,
): Promise<string> {
  // Strip MIME type — a Blob with type causes the browser to send
  // Content-Type automatically, which breaks the presigned URL signature.
  const rawBlob = new Blob([blob]);

  const res = await fetch(url, {
    method: 'PUT',
    body: rawBlob,
  });
  if (!res.ok) throw new Error('Failed to upload multipart part');
  const etag = res.headers.get('ETag');
  if (!etag) throw new Error('No ETag returned from part upload');
  return etag;
}

/**
 * Complete a multipart upload by assembling all parts.
 */
export async function completeMultipartUpload(
  sessionId: string,
  uploadId: string,
  parts: { PartNumber: number; ETag: string }[],
): Promise<void> {
  const headers = {
    ...(await authHeaders()),
    'Content-Type': 'application/json',
  };
  const res = await fetch(
    `${API_BASE_URL}/s3_urls?action=complete_multipart&session_id=${sessionId}`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ upload_id: uploadId, parts }),
    },
  );
  if (!res.ok) throw new Error('Failed to complete multipart upload');
}

/**
 * Abort a multipart upload.
 */
export async function abortMultipartUpload(
  sessionId: string,
  uploadId: string,
): Promise<void> {
  const headers = {
    ...(await authHeaders()),
    'Content-Type': 'application/json',
  };
  const res = await fetch(
    `${API_BASE_URL}/s3_urls?action=abort_multipart&session_id=${sessionId}`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ upload_id: uploadId }),
    },
  );
  if (!res.ok) throw new Error('Failed to abort multipart upload');
}

// ─── JSON Upload Helper ──────────────────────────────────────────────

// ─── Video Playback URL ──────────────────────────────────────────────

export async function getVideoPlaybackUrl(sessionId: string): Promise<string | null> {
  const headers = await authHeaders();
  try {
    const res = await fetch(
      `${API_BASE_URL}/s3_urls?action=get_video_url&session_id=${sessionId}`,
      { headers },
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.url ?? null;
  } catch {
    return null;
  }
}

export async function getManifestData(sessionId: string): Promise<SessionManifest | null> {
  const headers = await authHeaders();
  try {
    const res = await fetch(
      `${API_BASE_URL}/s3_urls?action=get_manifest&session_id=${sessionId}`,
      { headers },
    );
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

/**
 * Upload a JSON object to S3 using a presigned POST URL.
 * Convenience wrapper around getPresignedUrl + POST with JSON body.
 */
export async function uploadJsonToS3(
  requestType: S3RequestType,
  sessionId: string,
  data: unknown,
): Promise<void> {
  const presigned = await getPresignedUrl(requestType, sessionId);
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });

  const formData = new FormData();
  Object.entries(presigned.fields).forEach(([key, value]) => {
    formData.append(key, value);
  });
  formData.append('file', blob);

  const res = await fetch(presigned.presigned_url, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok && res.status >= 300) {
    throw new Error(`Failed to upload ${requestType} JSON to S3`);
  }
}

// ─── Analytics API ────────────────────────────────────────────────────

/**
 * Single call to GET /analytics. Returns the AI feedback on 200,
 * throws AnalyticsProcessingError on 202, and a generic Error on failure.
 */
export async function fetchAnalytics(
  sessionId: string,
): Promise<AIFeedbackResponse> {
  const headers = await authHeaders();
  const res = await fetch(
    `${API_BASE_URL}/analytics?session_id=${encodeURIComponent(sessionId)}`,
    { headers },
  );

  if (res.status === 202) {
    throw new AnalyticsProcessingError();
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Analytics request failed (${res.status})`);
  }

  return res.json();
}

const POLL_INTERVAL_MS = 3_000;
const POLL_MAX_ATTEMPTS = 40; // ~120 seconds

/**
 * Polls GET /analytics until the backend returns a completed response.
 * Retries on 202 (processing) up to POLL_MAX_ATTEMPTS times.
 */
export async function pollAnalytics(
  sessionId: string,
): Promise<AIFeedbackResponse> {
  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
    try {
      return await fetchAnalytics(sessionId);
    } catch (err) {
      if (err instanceof AnalyticsProcessingError) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        continue;
      }
      // Retry on server errors (5xx) — the backend may recover on next attempt
      if (err instanceof Error && /\(5\d{2}\)/.test(err.message)) {
        console.warn(`[pollAnalytics] Server error on attempt ${attempt + 1}, retrying...`, err.message);
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        continue;
      }
      throw err;
    }
  }
  throw new Error('Analytics timed out — the AI analysis is taking longer than expected');
}
