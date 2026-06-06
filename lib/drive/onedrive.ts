import { buildOAuthState, expiryFromSecondsIn, getBaseUrl } from "./oauth";
import type { DriveFileInfo } from "./types";

// ─── Constants ────────────────────────────────────────────────────────────────

// Using the "common" endpoint supports both personal and work/school accounts
const MS_AUTH_BASE    = "https://login.microsoftonline.com/common/oauth2/v2.0";
const MS_GRAPH_BASE   = "https://graph.microsoft.com/v1.0";

const GRAPH_SCOPES    = "Files.Read.All offline_access User.Read";

const SUPPORTED_EXTENSIONS = [".csv", ".xlsx", ".xls"];

// ─── Credentials ─────────────────────────────────────────────────────────────

function getCredentials() {
  const clientId     = process.env.ONEDRIVE_CLIENT_ID;
  const clientSecret = process.env.ONEDRIVE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("ONEDRIVE_CLIENT_ID and ONEDRIVE_CLIENT_SECRET must be set");
  }
  return { clientId, clientSecret };
}

function getRedirectUri(): string {
  return `${getBaseUrl()}/api/drive/auth/onedrive/callback`;
}

// ─── Auth URL ─────────────────────────────────────────────────────────────────

export function getOnedriveAuthUrl(orgId: string): string {
  const { clientId } = getCredentials();
  const { stateParam } = buildOAuthState(orgId, "onedrive");

  const params = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  getRedirectUri(),
    scope:         GRAPH_SCOPES,
    response_type: "code",
    state:         stateParam,
  });

  return `${MS_AUTH_BASE}/authorize?${params.toString()}`;
}

// ─── Token exchange ───────────────────────────────────────────────────────────

export type OneDriveTokens = {
  access_token:  string;
  refresh_token: string | null;
  expiry:        string;
};

export async function exchangeOnedriveCode(code: string): Promise<OneDriveTokens> {
  const { clientId, clientSecret } = getCredentials();

  const res = await fetch(`${MS_AUTH_BASE}/token`, {
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
    throw new Error(`OneDrive token exchange failed (${res.status}): ${body}`);
  }

  const data = await res.json() as {
    access_token:  string;
    refresh_token?: string;
    expires_in:    number;
  };

  return {
    access_token:  data.access_token,
    refresh_token: data.refresh_token ?? null,
    expiry:        expiryFromSecondsIn(data.expires_in ?? 3600),
  };
}

// ─── Token refresh ────────────────────────────────────────────────────────────

export async function refreshOnedriveToken(refreshToken: string): Promise<{ access_token: string; expiry: string }> {
  const { clientId, clientSecret } = getCredentials();

  const res = await fetch(`${MS_AUTH_BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type:    "refresh_token",
      scope:         GRAPH_SCOPES,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OneDrive token refresh failed (${res.status}): ${body}`);
  }

  const data = await res.json() as { access_token: string; expires_in: number };
  return {
    access_token: data.access_token,
    expiry:       expiryFromSecondsIn(data.expires_in ?? 3600),
  };
}

// ─── User info ────────────────────────────────────────────────────────────────

export async function getOnedriveUserInfo(accessToken: string): Promise<{ email: string | null; name: string | null }> {
  const res = await fetch(`${MS_GRAPH_BASE}/me?$select=mail,displayName`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return { email: null, name: null };
  const data = await res.json() as { mail?: string; displayName?: string };
  return { email: data.mail ?? null, name: data.displayName ?? null };
}

// ─── Parse folder URL ─────────────────────────────────────────────────────────

/** Returns a Graph API drive-item path fragment or item ID from a OneDrive URL.
 *  Handles several URL formats:
 *   - https://onedrive.live.com/?id=RESID&cid=CID  → itemId extraction
 *   - A plain folder path like /Documents/Finance   → passed through as-is
 *   - A Graph item ID (no slashes, only alphanumeric+!) → passed through as-is
 *
 * Returns { type: 'itemId' | 'path', value: string } | null
 */
export function parseOnedriveFolderUrl(
  input: string
): { type: "itemId" | "path"; value: string } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // onedrive.live.com URL — extract id query param
  const liveMatch = trimmed.match(/[?&](?:id|resid)=([^&]+)/i);
  if (liveMatch) {
    return { type: "itemId", value: decodeURIComponent(liveMatch[1]) };
  }

  // Looks like a plain path (starts with /)
  if (trimmed.startsWith("/")) {
    return { type: "path", value: trimmed };
  }

  // Looks like a Graph item ID (no slashes, only base64-safe chars)
  if (/^[A-Za-z0-9!_-]+$/.test(trimmed) && trimmed.length >= 16) {
    return { type: "itemId", value: trimmed };
  }

  // Fallback: treat as a path
  return { type: "path", value: trimmed };
}

// ─── List files in a folder ───────────────────────────────────────────────────

/** Lists CSV / Excel files in a OneDrive folder.
 *  folderId can be a drive item ID or a path string from parseOnedriveFolderUrl. */
export async function listOnedriveFolderFiles(
  accessToken: string,
  folderId: string,
  folderType: "itemId" | "path"
): Promise<DriveFileInfo[]> {
  const childrenUrl =
    folderType === "path"
      ? `${MS_GRAPH_BASE}/me/drive/root:${folderId}:/children`
      : `${MS_GRAPH_BASE}/me/drive/items/${folderId}/children`;

  const results: DriveFileInfo[] = [];
  let url: string | null =
    `${childrenUrl}?$select=id,name,file,lastModifiedDateTime,eTag&$top=200`;

  while (url && results.length < 1000) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`OneDrive list files failed (${res.status}): ${body}`);
    }

    const data = await res.json() as {
      value: Array<{
        id: string;
        name: string;
        file?: { mimeType?: string };
        lastModifiedDateTime?: string;
        eTag?: string;
      }>;
      "@odata.nextLink"?: string;
    };

    for (const item of data.value ?? []) {
      // Only include supported file types
      const nameLower = item.name.toLowerCase();
      if (!SUPPORTED_EXTENSIONS.some((ext) => nameLower.endsWith(ext))) continue;
      if (!item.file) continue; // skip folders

      results.push({
        id:         item.id,
        name:       item.name,
        mimeType:   item.file.mimeType ?? guessOnedriveMime(item.name),
        etag:       item.eTag ?? null,
        modifiedAt: item.lastModifiedDateTime ?? null,
      });
    }

    url = data["@odata.nextLink"] ?? null;
  }

  return results;
}

// ─── Get folder metadata ──────────────────────────────────────────────────────

export async function getOnedriveFolderName(
  accessToken: string,
  folderId: string,
  folderType: "itemId" | "path"
): Promise<string> {
  const metaUrl =
    folderType === "path"
      ? `${MS_GRAPH_BASE}/me/drive/root:${folderId}:?$select=name`
      : `${MS_GRAPH_BASE}/me/drive/items/${folderId}?$select=name`;

  const res = await fetch(metaUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return "OneDrive Folder";
  const data = await res.json() as { name?: string };
  return data.name ?? "OneDrive Folder";
}

// ─── Download file ────────────────────────────────────────────────────────────

export async function downloadOnedriveFile(
  accessToken: string,
  fileId: string,
  fileName: string
): Promise<{ buffer: Buffer; effectiveMime: string }> {
  const res = await fetch(`${MS_GRAPH_BASE}/me/drive/items/${fileId}/content`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OneDrive download failed (${res.status}): ${body}`);
  }

  const arrayBuf = await res.arrayBuffer();
  return {
    buffer:       Buffer.from(arrayBuf),
    effectiveMime: guessOnedriveMime(fileName),
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function guessOnedriveMime(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".csv"))  return "text/csv";
  if (lower.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (lower.endsWith(".xls"))  return "application/vnd.ms-excel";
  return "application/octet-stream";
}
