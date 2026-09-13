/** Add an optional presentation slot; without Bees the native frame is unchanged. */
export function embedBeesContent(source) {
  if (source.includes('renderOwnedSlot("shell.content"')) return source;
  const frame = "function AppFrame({ useStore, useSessions, usePanelInfo, actions, renderSlot, t }) {";
  const children = '"shell.overlay": {\n';
  if (!source.includes(frame) || !source.includes(children)) {
    throw new Error("DSH 0.1.5-rc.2 embedded-content patch no longer matches its pinned package");
  }
  return source.replace(frame, `function AppFrame({ useStore, useSessions, usePanelInfo, actions, renderSlot: renderOwnedSlot, t }) {
      const renderSlot = (key, owner, options) => {
        const content = renderOwnedSlot(key, owner, options);
        return key === "main" || key === "rightbar"
          ? renderOwnedSlot("shell.content", { content, width: owner.width }, { entryKey: key, fallback: content })
          : content;
      };`).replace(children, '"shell.content": { kind: "keyed", scope: "root" },\n\t\t\t\t\t\t"shell.overlay": {\n');
}
