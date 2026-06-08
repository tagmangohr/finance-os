import { buildOAuthState, expiryFromSecondsIn, getBaseUrl } from "./oauth";
import type { DriveFileInfo } from "./types";

// ─── Constants ────────────────────────────────────────────────────────────────

const GOOGLE_AUTH_BASE  = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL  = "https://oauth2.googleapis.com/token";
const GOOGLE_DRIVE_BASE = "https://www.googleapis.com/drive/v3";
const GOOGLE_USER_INFO  = "https://www.googleapis.com/oauth2/v3/userinfo";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";

// MIME types we care about
const SUPPORTED_MIME_TYPES = [
  "text/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.google-apps.spreadsheet",
];

// ─── Credentials ─────────────────────────────────────────────────────────────

function getCredentials() {
  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set");
  }
  return { clientId, clientSecret };
}

function getRedirectUri(): string {
  return `${getBaseUrl()}/api/drive/auth/google/callback`;
}

// ─── Auth URL ─────────────────────────────────────────────────────────────────

/**
 * Returns the Google OAuth redirect URL together with the stateParam and nonce
 * generated for this request.  The caller MUST set a cookie with the nonce
 * before redirecting to `url` — this is the CSRF token the callback verifies.
 *
 * Returning all three values from a single call guarantees that the stateParam
 * embedded in `url` and the nonce stored in the cookie are always from the
 * same buildOAuthState() invocation (previously they were separate calls that
 * produced mismatched nonces, causing every callback to fail with csrf_invalid).
 */
export function getGoogleAuthUrl(orgId: string): {
  url: string;
  stateParam: string;
  nonce: string;
} {
  const { clientId } = getCredentials();
  const { stateParam, nonce } = buildOAuthState(orgId, "google_drive");

  const params = new URLSearchParams({
    client_id:    clientId,
    redirect_uri: getRedirectUri(),
    scope:        DRIVE_SCOPE,
    response_type:"code",
    access_type:  "offline",
    prompt:       "consent",            // always ask for refresh_token
    state:        stateParam,
  });

  return { url: `${GOOGLE_AUTH_BASE}?${params.toString()}`, stateParam, nonce };
}

// ─── Token exchange ───────────────────────────────────────────────────────────

export type GoogleTokens = {
  access_token:  string;
  refresh_token: string | null;
  expiry:        string;
};

export async function exchangeGoogleCode(code: string): Promise<GoogleTokens> {
  const { clientId, clientSecret } = getCredentials();

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id:     clientId,
      client_secret: clientSecret,
      redirect_uri:  getRedirectUri(),
      grant_type:    "authorization_code",
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google token exchange failed (${res.status}): ${body}`);
  }

  const data = await res.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  return {
    access_token:  data.access_token,
    refresh_token: data.refresh_token ?? null,
    expiry:        expiryFromSecondsIn(data.expires_in ?? 3600),
  };
}

// ─── Token refresh ────────────────────────────────────────────────────────────

export async function refreshGoogleToken(refreshToken: string): Promise<{ access_token: string; expiry: string }> {
  const { clientId, clientSecret } = getCredentials();

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type:    "refresh_token",
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google token refresh failed (${res.status}): ${body}`);
  }

  const data = await res.json() as { access_token: string; expires_in: number };
  return {
    access_token: data.access_token,
    expiry:       expiryFromSecondsIn(data.expires_in ?? 3600),
  };
}

// ─── User info ────────────────────────────────────────────────────────────────

export async function getGoogleUserInfo(accessToken: string): Promise<{ email: string | null; name: string | null }> {
  const res = await fetch(GOOGLE_USER_INFO, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return { email: null, name: null };
  const data = await res.json() as { email?: string; name?: string };
  return { email: data.email ?? null, name: data.name ?? null };
}

// ─── Parse folder URL ─────────────────────────────────────────────────────────

/** Extracts the folder ID from any known Google Drive folder URL format.
 *  Returns null if the URL doesn't look like a Drive folder. */
export function parseGoogleFolderUrl(url: string): string | null {
  // Matches: /folders/{id} optionally followed by ?... or end-of-string
  const match = url.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  return match?.[1] ?? null;
}

// ─── List files in a folder ───────────────────────────────────────────────────

/** Returns all CSV / Excel / Google Sheets files in the given Drive folder.
 *  Handles pagination automatically (max 1 000 files per folder as a safety cap). */
export async function listGoogleFolderFiles(
  accessToken: string,
  folderId: string
): Promise<DriveFileInfo[]> {
  const mimeQuery = SUPPORTED_MIME_TYPES.map((m) => `mimeType='${m}'`).join(" or ");
  const q = encodeURIComponent(`'${folderId}' in parents and (${mimeQuery}) and trashed=false`);
  const fields = "files(id,name,mimeType,md5Checksum,modifiedTime),nextPageToken";
  const results: DriveFileInfo[] = [];
  let pageToken: string | undefined;

  do {
    const url = `${GOOGLE_DRIVE_BASE}/files?q=${q}&fields=${encodeURIComponent(fields)}&pageSize=100${
      pageToken ? `&pageToken=${pageToken}` : ""
    }`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Google Drive list files failed (${res.status}): ${body}`);
    }

    const data = await res.json() as {
      files: Array<{
        id: string;
        name: string;
        mimeType: string;
        md5Checksum?: string;
        modifiedTime?: string;
      }>;
      nextPageToken?: string;
    };

    for (const f of data.files ?? []) {
      results.push({
        id:         f.id,
        name:       f.name,
        mimeType:   f.mimeType,
        etag:       f.md5Checksum ?? null,
        modifiedAt: f.modifiedTime ?? null,
      });
    }

    pageToken = data.nextPageToken;
  } while (pageToken && results.length < 1000);

  return results;
}

// ─── Get folder metadata ──────────────────────────────────────────────────────

export async function getGoogleFolderName(
  accessToken: string,
  folderId: string
): Promise<string> {
  const res = await fetch(
    `${GOOGLE_DRIVE_BASE}/files/${folderId}?fields=name`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) return "Google Drive Folder";
  const data = await res.json() as { name?: string };
  return data.name ?? "Google Drive Folder";
}

// ─── Download file content as Buffer ─────────────────────────────────────────

/** Downloads a file from Google Drive as a raw binary Buffer.
 *  Google Sheets are exported as CSV; all other types are downloaded directly. */
export async function downloadGoogleFile(
  accessToken: string,
  fileId: string,
  mimeType: string
): Promise<{ buffer: Buffer; effectiveMime: string }> {
  const isGoogleSheet = mimeType === "application/vnd.google-apps.spreadsheet";

  const url = isGoogleSheet
    ? `${GOOGLE_DRIVE_BASE}/files/${fileId}/export?mimeType=text%2Fcsv`
    : `${GOOGLE_DRIVE_BASE}/files/${fileId}?alt=media`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google Drive download failed (${res.status}): ${body}`);
  }

  const arrayBuf = await res.arrayBuffer();
  return {
    buffer:       Buffer.from(arrayBuf),
    effectiveMime: isGoogleSheet ? "text/csv" : mimeType,
  };
}
