  const isScrolledUpRef = React.useRef(false);
  useEffect(() => {
    isScrolledUpRef.current = false;
  }, [run?.id, item.id]);

  // Auto-scroll conversation robustly
  useEffect(() => {
    if (isScrolledUpRef.current) return;
    const scrollToBottom = () => { if (convoRef.current) convoRef.current.scrollTop = convoRef.current.scrollHeight; };
    scrollToBottom();
    // Remove the 300ms timeout that fights the user. Just use a short 50ms one for immediate renders.
    let id1 = setTimeout(scrollToBottom, 50);
    return () => { clearTimeout(id1); };
  }, [history, pendingRun, interaction, item.runtimePhase]);
