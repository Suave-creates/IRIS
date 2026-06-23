import type { SessionUser } from '@iris/shared';

/**
 * M0 placeholder identity used to render the app chrome before authentication
 * exists. **Replaced in M1** by the real authenticated session (`useSession()`).
 * Mirrors the design persona so the shell looks correct during M0.
 */
export const DEMO_USER: SessionUser = {
  id: 'usr_demo',
  tenantId: 'ten_demo',
  email: 'kartik@lenskart.com',
  name: 'Kartik Dwivedi',
  title: 'VP · Lenskart',
  avatarUrl: null,
  role: 'owner',
};
