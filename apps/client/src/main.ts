const path = location.pathname.replace(/\/+$/, '');
if (path === '/debug') {
  void import('./debug/debug');
} else {
  void import('./game/boot');
}
