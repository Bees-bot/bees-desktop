export function installScrollbars(doc) {
  const timers = new Map();
  const onScroll = ({ target }) => {
    const element = target === doc ? doc.scrollingElement : target;
    if (!element?.setAttribute) return;
    clearTimeout(timers.get(element));
    element.setAttribute("data-bees-scrolling", "");
    timers.set(element, setTimeout(() => {
      element.removeAttribute("data-bees-scrolling");
      timers.delete(element);
    }, 800));
  };
  doc.addEventListener("scroll", onScroll, { capture: true, passive: true });
  return () => {
    doc.removeEventListener("scroll", onScroll, { capture: true });
    for (const [element, timer] of timers) {
      clearTimeout(timer);
      element.removeAttribute("data-bees-scrolling");
    }
    timers.clear();
  };
}
