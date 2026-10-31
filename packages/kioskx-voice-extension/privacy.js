// A background call must not paint the destination if its tab is selected.
if (new URL(location.href).searchParams.get('a')?.startsWith('nc,')) {
  const style = document.createElement('style');
  style.textContent = 'html { visibility: hidden !important; }';
  (document.head || document.documentElement).append(style);
  // Let Voice consume its documented deep link before clearing the visible URL.
  addEventListener('load', () => setTimeout(() => history.replaceState(null, '', '/u/0/calls'), 5000), { once: true });
}
