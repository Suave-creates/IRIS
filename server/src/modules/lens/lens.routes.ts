import type { FastifyInstance } from 'fastify';
import type { RowDataPacket } from 'mysql2/promise';
import { z } from 'zod';
import type { LensGather, LensResult } from '@iris/shared';
import { query } from '../../db/pool.js';
import { hasAnthropic } from '../../config/env.js';
import { complete, systemBlocks } from '../../lib/anthropic.js';
import { logger } from '../../lib/logger.js';
import { currentUser, requireAuth } from '../auth/guards.js';

const gatherSchema = z.object({ keyword: z.string().min(1).max(80) });

interface Row extends RowDataPacket {
  [k: string]: unknown;
}

/** Escapes LIKE wildcards in user input. */
const likeTerm = (s: string) => `%${s.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;

export async function lensRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  // POST /gather { keyword } → cross-source results + an AI synthesis.
  app.post('/gather', async (req) => {
    const me = currentUser(req);
    const { keyword } = gatherSchema.parse(req.body);
    const kw = likeTerm(keyword);
    const t = me.tenantId;
    const results: LensResult[] = [];

    const contacts = await query<Row[]>(
      `SELECT name, email, title FROM users WHERE tenant_id = :t AND (name LIKE :kw OR email LIKE :kw) LIMIT 3`,
      { t, kw },
    );
    for (const c of contacts)
      results.push({
        kind: 'person', source: 'Contacts', icon: 'P',
        title: String(c.name), snippet: `${String(c.title ?? 'Team member')}`, meta: String(c.email),
      });

    const projects = await query<Row[]>(
      `SELECT name, summary, status, deadline FROM projects WHERE tenant_id = :t AND (name LIKE :kw OR summary LIKE :kw) LIMIT 4`,
      { t, kw },
    );
    for (const p of projects)
      results.push({
        kind: 'project', source: 'Projects', icon: '▣',
        title: String(p.name), snippet: String(p.summary ?? ''), meta: `${String(p.status)}${p.deadline ? ` · due ${String(p.deadline)}` : ''}`,
      });

    const mail = await query<Row[]>(
      `SELECT from_name, subject, summary, received_at FROM mail_items
       WHERE tenant_id = :t AND (subject LIKE :kw OR summary LIKE :kw OR from_name LIKE :kw OR CAST(tags AS CHAR) LIKE :kw)
       ORDER BY received_at DESC LIMIT 5`,
      { t, kw },
    );
    for (const m of mail)
      results.push({
        kind: 'mail', source: 'Mail', icon: '@',
        title: String(m.subject), snippet: String(m.summary ?? ''), meta: `${String(m.from_name)} · ${String(m.received_at)}`,
      });

    const memories = await query<Row[]>(
      `SELECT type, content, source FROM memories WHERE tenant_id = :t AND content LIKE :kw LIMIT 4`,
      { t, kw },
    );
    for (const mem of memories)
      results.push({
        kind: 'memory', source: 'Memory', icon: '✦',
        title: String(mem.content), snippet: `Learned ${String(mem.type)}`, meta: String(mem.source ?? 'long-term'),
      });

    const events = await query<Row[]>(
      `SELECT title, notes, start_at FROM calendar_events WHERE tenant_id = :t AND (title LIKE :kw OR notes LIKE :kw) ORDER BY start_at DESC LIMIT 4`,
      { t, kw },
    );
    for (const e of events)
      results.push({
        kind: 'calendar', source: 'Calendar', icon: '▦',
        title: String(e.title), snippet: String(e.notes ?? ''), meta: String(e.start_at),
      });

    const sources = [...new Set(results.map((r) => r.source))];

    // AI synthesis grounded strictly in the gathered items.
    let summary = '';
    if (hasAnthropic && results.length > 0) {
      try {
        const ctx = results.map((r, i) => `${i + 1}. [${r.source}] ${r.title} — ${r.snippet} (${r.meta})`).join('\n');
        summary = await complete({
          system: systemBlocks(
            'You are IRIS. Synthesize everything known about a topic for a busy executive, grounded ONLY in the provided items. Be concise: 3–5 tight bullets, lead with what matters. Never invent facts beyond the items.',
          ),
          messages: [{ role: 'user', content: `Topic: "${keyword}"\n\nGathered items:\n${ctx}\n\nSummarize what IRIS knows.` }],
          maxTokens: 600,
        });
      } catch (err) {
        logger.warn({ err }, 'lens synthesis failed (non-fatal)');
      }
    }

    const data: LensGather = { keyword, summary, results, sources };
    return { data };
  });
}
