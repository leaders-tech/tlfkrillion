/*
This file saves the active room code in a short-lived browser cookie.
Edit it when room-resume cookie rules change; copy its helper pattern for another small client session value.
*/

const ROOM_CODE_COOKIE = "krillion_room_code";
const ROOM_COOKIE_SECONDS = 24 * 60 * 60;

export function getSavedRoomCode(): string {
  const cookie = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${ROOM_CODE_COOKIE}=`));
  const code = cookie ? decodeURIComponent(cookie.slice(ROOM_CODE_COOKIE.length + 1)).toUpperCase() : "";
  return /^[A-Z2-9]{6}$/.test(code) ? code : "";
}

export function saveRoomCode(code: string): void {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${ROOM_CODE_COOKIE}=${encodeURIComponent(code.toUpperCase())}; Max-Age=${ROOM_COOKIE_SECONDS}; Path=/; SameSite=Lax${secure}`;
}

export function clearSavedRoomCode(): void {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${ROOM_CODE_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax${secure}`;
}
