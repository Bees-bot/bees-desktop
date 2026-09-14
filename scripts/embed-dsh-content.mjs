/** Add an optional presentation slot; without Bees the native frame is unchanged. */
export function embedBeesContent(source) {
  if (source.includes('renderOwnedSlot("shell.content"')) return source;
  const frame = [
    "function AppFrame({ useStore, useSessions, usePanelInfo, actions, renderSlot, t }) {",
    "function AppFrame({ useStore, useSessions, actions, renderSlot, SessionProvider, t }) {"
  ].find((signature) => source.includes(signature));
  const children = '"shell.overlay": {\n';
  if (!frame || !source.includes(children)) {
    throw new Error("DSH embedded-content patch no longer matches its supported layouts");
  }
  return source.replace(frame, `${frame.replace("renderSlot,", "renderSlot: renderOwnedSlot,")}
      const renderSlot = (key, owner, options) => {
        const content = renderOwnedSlot(key, owner, options);
        const destination = key === "conversation" ? "main" : key === "details" ? "rightbar" : key;
        return destination === "main" || destination === "rightbar"
          ? renderOwnedSlot("shell.content", { content, width: ${frame.includes("SessionProvider") ? 'key === "details" ? cols.details : owner.width' : 'owner.width'} }, { entryKey: destination, fallback: content })
          : content;
      };`).replace(children, '"shell.content": { kind: "keyed", scope: "root" },\n\t\t\t\t\t\t"shell.overlay": {\n');
}
