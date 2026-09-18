-- The addresses people type, bookmark and get sent when they mean "sign in".
--
-- The canonical member URLs are /login, /signup and /forgot-password. Anything
-- else a visitor is likely to try answered HTTP 200 with an empty app shell.
-- Same conventions as 004/019/061: lowercase, no trailing slash, and
-- ON CONFLICT DO NOTHING so a row edited in the admin is left alone.
-- /logout is NOT here: it is a real client route (it has to end the session).
INSERT INTO redirects (from_path, to_path, status_code, target_exists, note) VALUES
  ('/signin',            '/login',           301, true, 'Sign-in alias'),
  ('/sign-in',           '/login',           301, true, 'Sign-in alias'),
  ('/log-in',            '/login',           301, true, 'Sign-in alias'),
  ('/members/login',     '/login',           301, true, 'Sign-in alias'),
  ('/member/login',      '/login',           301, true, 'Sign-in alias'),
  ('/members',           '/login',           301, true, 'Sign-in alias'),
  ('/account/login',     '/login',           301, true, 'Sign-in alias'),
  ('/users/sign_in',     '/login',           301, true, 'Kajabi member sign-in'),
  ('/register',          '/signup',          301, true, 'Sign-up alias'),
  ('/sign-up',           '/signup',          301, true, 'Sign-up alias'),
  ('/join',              '/signup',          301, true, 'Sign-up alias'),
  ('/create-account',    '/signup',          301, true, 'Sign-up alias'),
  ('/users/sign_up',     '/signup',          301, true, 'Kajabi member sign-up'),
  ('/forgot',            '/forgot-password', 301, true, 'Password reset alias'),
  ('/reset-password',    '/forgot-password', 301, true, 'Password reset alias (no token)'),
  ('/password/reset',    '/forgot-password', 301, true, 'Password reset alias'),
  ('/sign-out',          '/logout',          301, true, 'Sign-out alias'),
  ('/signout',           '/logout',          301, true, 'Sign-out alias'),
  ('/log-out',           '/logout',          301, true, 'Sign-out alias')
ON CONFLICT (from_path) DO NOTHING;
