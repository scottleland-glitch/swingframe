/** Narrow scope: only files this app creates or the user opens with it. */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

export const DRIVE_FOLDER_NAME = 'Swingframe';

/** 8 MiB. Google requires every chunk except the last to be a multiple of 256 KiB. */
export const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;

export function isDriveConfigured(clientId: string | undefined | null): boolean {
  return Boolean(clientId && clientId.trim());
}

export const GOOGLE_CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '').trim();

export const DRIVE_ENABLED = isDriveConfigured(GOOGLE_CLIENT_ID);

/** iOS home-screen apps cannot finish a Google popup. Use a full-page redirect there. */
export function prefersRedirectSignIn(ios: boolean, standalone: boolean): boolean {
  return ios && standalone;
}

export function googleRedirectUri(origin: string, base: string): string {
  return new URL(base || '/', origin).href;
}
