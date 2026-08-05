export interface CachedLicense {
  plan: string;
  features: string[];
  checkedAt: string;
  expiresAt: string;
  offlineGraceDays: number;
}

export interface EntitlementResult {
  enabled: boolean;
  reason: "open-source" | "licensed" | "offline-grace" | "expired" | "not-in-plan";
}

export function checkEntitlement(
  feature: string,
  license: CachedLicense | null,
  at = new Date()
): EntitlementResult {
  if (feature === "local-core") {
    return { enabled: true, reason: "open-source" };
  }
  if (!license || !license.features.includes(feature)) {
    return { enabled: false, reason: "not-in-plan" };
  }
  const expiry = new Date(license.expiresAt);
  if (at <= expiry) {
    return { enabled: true, reason: "licensed" };
  }
  const graceEnd = new Date(expiry.getTime() + license.offlineGraceDays * 86_400_000);
  return at <= graceEnd
    ? { enabled: true, reason: "offline-grace" }
    : { enabled: false, reason: "expired" };
}

