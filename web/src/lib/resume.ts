const PLACE = "boxio-last-place";
const PAGE = "boxio-last-page";

let resumeUserId = 0;

export function setResumeUser(id: number) {
  resumeUserId = id;
}

export function resumeUser() {
  return resumeUserId;
}

export function placeKey(userId: number) {
  return `${PLACE}:${userId}`;
}

export function pageKey(userId: number, projectId: string) {
  return `${PAGE}:${userId}:${projectId}`;
}

export function isRestorablePath(path: string) {
  return (
    path === "/keys" ||
    path === "/admin" ||
    path === "/settings" ||
    path === "/license" ||
    /^\/projects\/\d+$/.test(path)
  );
}

/** A fresh load of the projects page returns to the screen this user last had open. */
export function restorePath(current: string, saved: string | null) {
  if (current !== "/") return null;
  if (!saved || !isRestorablePath(saved)) return null;
  return saved;
}

function storage() {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

export function readPlace(userId: number) {
  return storage()?.getItem(placeKey(userId)) ?? null;
}

export function writePlace(userId: number, path: string) {
  storage()?.setItem(placeKey(userId), path);
}

export function readPage(userId: number, projectId: string) {
  return storage()?.getItem(pageKey(userId, projectId)) ?? null;
}

export function writePage(userId: number, projectId: string, pageId: string) {
  storage()?.setItem(pageKey(userId, projectId), pageId);
}
