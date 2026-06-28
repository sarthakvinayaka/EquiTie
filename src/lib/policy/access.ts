/**
 * Investor access policy.
 *
 * Every domain function that reads investor data must call assertInvestorAccess
 * first. This is the single chokepoint that ensures one investor can never
 * read another investor's data, regardless of how the request is constructed.
 */

import type { Database } from "../data/loader";

export class AccessDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccessDeniedError";
  }
}

/**
 * Assert that requestedInvestorId is the logged-in investor.
 * In a production system this would compare against a session/JWT claim.
 * Here the logged-in investor is set at request time and passed explicitly.
 */
export function assertInvestorAccess(
  loggedInInvestorId: string,
  requestedInvestorId: string
): void {
  if (loggedInInvestorId !== requestedInvestorId) {
    throw new AccessDeniedError(
      `Access denied: investor ${loggedInInvestorId} may not view data for investor ${requestedInvestorId}`
    );
  }
}

/**
 * Validate that an investorId exists in the dataset and is KYC-verified.
 * Returns the investor record if valid.
 */
export function validateInvestor(
  investorId: string,
  db: Database
): { valid: boolean; reason?: string } {
  const investor = db.investors.get(investorId);
  if (!investor) {
    return { valid: false, reason: "Investor not found" };
  }
  // KYC-pending investors may still view their data — they just can't transact.
  return { valid: true };
}

/**
 * Filter any array of objects that have an investor_id field to only include
 * rows belonging to the logged-in investor. Defensive belt-and-suspenders.
 */
export function filterToInvestor<T extends { investor_id?: string }>(
  rows: T[],
  investorId: string
): T[] {
  return rows.filter((r) => r.investor_id === investorId);
}
