// Mobile browsers can restore the login document from their back/forward cache
// without remounting React. Re-check the persisted session on every pageshow.
export function watchLoginSession(
  target: Pick<Window, 'addEventListener' | 'removeEventListener'>,
  hasSession: () => Promise<boolean>,
  signedIn: () => void,
  signedOut: () => void,
) {
  let active = true;
  let revision = 0;
  const check = () => {
    const current = ++revision;
    void hasSession().then(present => {
      if (active && current === revision) (present ? signedIn : signedOut)();
    }).catch(() => {
      if (active && current === revision) signedOut();
    });
  };
  target.addEventListener('pageshow', check);
  target.addEventListener('focus', check);
  check();
  return () => {
    active = false;
    target.removeEventListener('pageshow', check);
    target.removeEventListener('focus', check);
  };
}
