export function generatedFileKeys(runs) {
  return [...new Set(runs.flatMap((run) => (run.outputs ?? [])
    .map((path) => JSON.stringify([run.id, path.replaceAll("\\", "/")]))))].sort();
}

// A selected tab may still be below the viewport or in a background window.
export function watchFilesViewed(element, onViewed) {
  const doc = element.ownerDocument;
  let visible = false;
  let viewed = false;
  const markViewed = () => {
    if (viewed || !visible || doc.visibilityState !== "visible" || !doc.hasFocus()) return;
    viewed = true;
    onViewed();
  };
  const observer = new doc.defaultView.IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    markViewed();
  });
  observer.observe(element);
  doc.addEventListener("visibilitychange", markViewed);
  doc.defaultView.addEventListener("focus", markViewed);
  return () => {
    observer.disconnect();
    doc.removeEventListener("visibilitychange", markViewed);
    doc.defaultView.removeEventListener("focus", markViewed);
  };
}
