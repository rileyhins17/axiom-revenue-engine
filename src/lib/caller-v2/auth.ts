import { authenticateCaller, type CallerActor } from '../revenue-engine/caller-integration';
import { getM2OwnerIdentityActor } from '../revenue-engine/m2-owner-identity-actor';
import type { CallerDb } from './database';

export async function authenticateEngineCaller(db: CallerDb, authorization: string | null): Promise<CallerActor | null> {
  const tokenOwner = await authenticateCaller(db, authorization);
  if (!tokenOwner) return null;
  const user = await db.prepare('SELECT email,emailVerified,banned FROM User WHERE id=?').bind(tokenOwner.actorUserId).first<{ email: string; emailVerified: number; banned: number | null }>();
  if (!user || !user.emailVerified || user.banned || getM2OwnerIdentityActor(user.email) !== tokenOwner.actor) return null;
  return tokenOwner;
}
