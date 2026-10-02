/** Display text only; provider/model routes remain stable for saved runs. */
export function modelLabel(route, name, providerName) {
  if (!route) return "";
  const separator = route.indexOf("/");
  if (separator < 0) return route;
  const provider = route.slice(0, separator);
  const model = route.slice(separator + 1);
  if (provider === "local-openai" || provider.startsWith("local-openai-")) {
    const label = name && name !== "active" && name !== "Bees AI model" ? name
      : model === "active" ? "the model running on this computer" : model;
    return `Local · ${label}`;
  }
  return `${providerName || provider} · ${name || model}`;
}
