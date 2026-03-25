export const OWNER_ID = "837709594255425627";

export function isOwner(userId: string): boolean {
  return userId === OWNER_ID;
}
