// Runs before the page below it is drawn: scroll-driven live mode, only without Reduce Motion and in
// windows up to 1600px tall, so the first frame already has the right layout.
document.currentScript.parentNode.classList.toggle(
  'is-live',
  !matchMedia('(prefers-reduced-motion: reduce)').matches && matchMedia('(max-height: 1600px)').matches,
);
