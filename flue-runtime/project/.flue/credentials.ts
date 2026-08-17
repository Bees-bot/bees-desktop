const brokerUrl = process.env.BEES_CREDENTIAL_BROKER_URL ?? "";
const brokerToken = process.env.BEES_CREDENTIAL_BROKER_TOKEN ?? "";

async function brokerSecret(secretRef: string, query: URLSearchParams): Promise<string> {
  if (!brokerUrl || !brokerToken) throw new Error("The credential broker is unavailable");
  const response = await fetch(`${brokerUrl}/secrets/${encodeURIComponent(secretRef)}?${query}`, {
    headers: { authorization: `Bearer ${brokerToken}` },
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error(`The connection credential is unavailable (${response.status})`);
  const body = (await response.json()) as { token?: string };
  if (!body.token) throw new Error("The connection credential is empty");
  return body.token;
}

/** Resolve a rotating credential from Rust's OS-vault broker without persisting it in Flue. */
export async function connectionSecret(
  secretRef: string,
  context: { teamId: string; connectionId: string; executionId?: string }
): Promise<string> {
  const query = new URLSearchParams({
    teamId: context.teamId,
    connectionId: context.connectionId,
    ...(context.executionId ? { executionId: context.executionId } : { purpose: "discovery" })
  });
  return brokerSecret(secretRef, query);
}

/** Resolve a model-provider credential scoped to the organization running this sidecar. */
export function aiConnectionSecret(
  secretRef: string,
  organizationId: string,
  connectionId: string
): Promise<string> {
  return brokerSecret(secretRef, new URLSearchParams({ organizationId, connectionId }));
}
