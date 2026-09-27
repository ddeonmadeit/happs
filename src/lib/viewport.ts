/**
 * Home-screen web apps on iOS don't shrink the layout when the keyboard
 * opens; they pan the page instead, which pushes headers off-screen and
 * hides the chat box. Track the *visible* height and pin the app to it.
 */
export function trackVisualViewport() {
  const vv = window.visualViewport;
  const root = document.documentElement;
  const update = () => {
    root.style.setProperty("--app-height", `${Math.round(vv ? vv.height : window.innerHeight)}px`);
    if (vv && vv.offsetTop > 0) window.scrollTo(0, 0);
  };
  update();
  vv?.addEventListener("resize", update);
  vv?.addEventListener("scroll", update);
  window.addEventListener("orientationchange", () => setTimeout(update, 250));
}
