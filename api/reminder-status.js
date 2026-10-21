//reminder-status.js
import { neon } from '@neondatabase/serverless';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/api/reminder-status' || request.method !== 'GET') {
      return new Response('Not found', { status: 404 });
    }
    const userId = url.searchParams.get('userId') || '';
    const groupId = url.searchParams.get('groupId') || '';
    const date = url.searchParams.get('date') || '';
    if (!UUID.test(userId) || !UUID.test(groupId) || !DATE.test(date)) {
      return new Response('Bad request', { status: 400 });
    }

    // Neon veritabanı bağlantısı (environment değişkeni veya doğrudan Neon Auth host referanslı bağlantı havuzu)
    const sql = neon(env.DATABASE_URL);
    
    const [row] = await sql`
      SELECT
        EXISTS (
          SELECT 1 FROM public.reading_logs
          WHERE user_id = ${userId} AND group_id = ${groupId} AND log_date = ${date}
        ) AS has_log,
        (
          SELECT count(*)::int
          FROM public.reading_logs rl
          JOIN public.group_members gm ON gm.user_id = rl.user_id
          WHERE gm.group_id = ${groupId} AND rl.log_date = ${date}
        ) AS reader_count`;

    return Response.json(
      { hasLog: row.has_log, readerCount: row.reader_count },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }
};
