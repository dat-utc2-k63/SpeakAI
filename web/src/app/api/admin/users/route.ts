import { handleAdminCreateUser } from '@/lib/server/adminUsersHandler';

export const runtime = 'nodejs';

export async function POST(req: Request): Promise<Response> {
  return handleAdminCreateUser(req);
}
