/**
 * Seeds a tenant with realistic demo data matching the approved design, so a
 * freshly-provisioned executive sees a populated workspace immediately.
 * Idempotent: does nothing if the tenant already has projects.
 *
 * Called automatically when a new tenant is created (auth.service), and by the
 * `db:seed:demo` script for already-existing but empty tenants.
 */
import { execute, query } from './pool.js';
import { id } from '../lib/ids.js';
import { logger } from '../lib/logger.js';

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dtAt = (d: Date, h: number, m = 0) => `${ymd(d)} ${pad(h)}:${pad(m)}:00`;

export async function tenantHasDemoData(tenantId: string): Promise<boolean> {
  const rows = await query<({ n: number } & import('mysql2/promise').RowDataPacket)[]>(
    'SELECT COUNT(*) AS n FROM projects WHERE tenant_id = :t',
    { t: tenantId },
  );
  return (rows[0]?.n ?? 0) > 0;
}

export async function seedTenantDemoData(
  tenantId: string,
  userId: string,
  ownerName: string,
): Promise<void> {
  if (await tenantHasDemoData(tenantId)) return;

  const now = new Date();
  const day = (offset: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + offset);
    return d;
  };

  // ── Projects (+ children) ──
  const projects = [
    {
      name: 'Series B Fundraise', source: 'manual', priority: 'critical', status: 'On track',
      deadline: ymd(day(3)), progress: 72, owner: 'You', auto: 0,
      summary: 'Close the $30M Series B by end of Q3. Board deck and investor update are in flight; data room is ready.',
      sourceDetail: 'Added manually',
      stages: ['Prep', 'Deck', 'Diligence', 'Term sheet', 'Close'], current: 2,
      fields: [['Target', '$30M'], ['Lead', 'Sequoia'], ['Stage', 'Deck + diligence']],
      tasks: [['Finalize board deck', 0], ['Send investor update', 0], ['Data room ready', 1]],
      files: [['Board Deck.ppt', 'Slides'], ['Q3 Forecast.sheet', 'Sheets']],
      activity: [['IRIS', 'flagged deadline as critical'], ['You', 'updated progress to 72%']],
    },
    {
      name: 'Acme Renewal', source: 'conversation', priority: 'high', status: 'At risk',
      deadline: ymd(day(8)), progress: 40, owner: 'You', auto: 1,
      summary: 'Two-year renewal with dedicated onboarding support. Usage is down 18% MoM — actively mitigating.',
      sourceDetail: 'Fetched from your conversation · today',
      stages: ['Discovery', 'Proposal', 'Negotiation', 'Signed'], current: 2,
      fields: [['ARR', '$24.1M'], ['Contact', 'David Chen'], ['Risk', 'Usage −18%']],
      tasks: [['Send follow-up email', 0], ['Scope onboarding package', 0]],
      files: [['Acme Brief.pdf', 'PDF']],
      activity: [['IRIS', 'created this project from your conversation']],
    },
    {
      name: 'Q3 Hiring Plan', source: 'journal', priority: 'high', status: 'Blocked',
      deadline: ymd(day(1)), progress: 30, owner: 'Priya Nair', auto: 0,
      summary: 'Four roles across engineering and sales. Awaiting your approval to post.',
      sourceDetail: 'From Journal · Hiring Plan.doc',
      stages: ['Plan', 'Approval', 'Posted', 'Interviewing'], current: 1,
      fields: [['Open roles', '4'], ['Owner', 'Priya Nair']],
      tasks: [['Approve plan', 0], ['Post job descriptions', 0]],
      files: [['Hiring Plan.doc', 'Docs']],
      activity: [['Priya', 'requested your approval']],
    },
    {
      name: 'Annual Tax Filing', source: 'calendar', priority: 'med', status: 'On track',
      deadline: ymd(day(7)), progress: 15, owner: 'Finance', auto: 1,
      summary: 'Compile and submit filing documents to the accountant before the deadline.',
      sourceDetail: 'From Calendar deadline',
      stages: ['Gather', 'Prepare', 'Review', 'File'], current: 0,
      fields: [['Due', ymd(day(7))], ['Owner', 'Finance']],
      tasks: [['Gather documents', 0]],
      files: [],
      activity: [['IRIS', 'added from a calendar deadline']],
    },
  ];

  for (const p of projects) {
    const pid = id('proj');
    await execute(
      `INSERT INTO projects (id, tenant_id, name, source, priority, status, deadline, progress, owner, auto, summary, source_detail, stages, current_stage)
       VALUES (:id,:t,:name,:source,:priority,:status,:deadline,:progress,:owner,:auto,:summary,:detail,:stages,:cur)`,
      {
        id: pid, t: tenantId, name: p.name, source: p.source, priority: p.priority, status: p.status,
        deadline: p.deadline, progress: p.progress, owner: p.owner, auto: p.auto, summary: p.summary,
        detail: p.sourceDetail, stages: JSON.stringify(p.stages), cur: p.current,
      },
    );
    for (let i = 0; i < p.fields.length; i++)
      await execute('INSERT INTO project_fields (id, project_id, label, value, position) VALUES (:id,:p,:l,:v,:pos)', {
        id: id('pf'), p: pid, l: p.fields[i]![0], v: p.fields[i]![1], pos: i,
      });
    for (let i = 0; i < p.tasks.length; i++)
      await execute('INSERT INTO project_tasks (id, project_id, title, done, position) VALUES (:id,:p,:t,:d,:pos)', {
        id: id('pt'), p: pid, t: p.tasks[i]![0], d: p.tasks[i]![1], pos: i,
      });
    for (let i = 0; i < p.files.length; i++)
      await execute('INSERT INTO project_files (id, project_id, name, kind, position) VALUES (:id,:p,:n,:k,:pos)', {
        id: id('pfl'), p: pid, n: p.files[i]![0], k: p.files[i]![1], pos: i,
      });
    for (const a of p.activity)
      await execute('INSERT INTO project_activity (id, project_id, who, act) VALUES (:id,:p,:w,:a)', {
        id: id('pa'), p: pid, w: a[0], a: a[1],
      });
  }

  // ── Project sources ──
  for (const s of [
    { type: 'sheet', name: 'Q3 Forecast.sheet', meta: '1 sheet · 4 tabs', status: 'scanned' },
    { type: 'folder', name: '/Strategy 2026', meta: 'Google Drive folder', status: 'linked' },
  ])
    await execute('INSERT INTO project_sources (id, tenant_id, type, name, meta, status) VALUES (:id,:t,:ty,:n,:m,:s)', {
      id: id('psrc'), t: tenantId, ty: s.type, n: s.name, m: s.meta, s: s.status,
    });

  // ── Journal tasks ──
  const tasks = [
    ['Finalize board deck', 0, '09:00', 'high', 0, 'Two sections remain: financials and GTM.'],
    ['Approve Q3 hiring plan', 0, '13:00', 'high', 0, 'Priya is blocked on this — 4 roles.'],
    ['Review Acme brief', 0, '13:30', 'med', 1, 'Read the IRIS-prepared QBR brief before the 2:00 PM call.'],
    ['Send investor update', 1, '10:00', 'high', 0, 'IRIS drafted it — review tone and metrics, then approve send.'],
    ['Gym', 1, '18:00', 'low', 0, ''],
    ['Sequoia intro call', 2, '13:00', 'med', 0, 'Thank Maya afterwards for the introduction.'],
    ['Board meeting prep', 3, '08:00', 'high', 0, ''],
    ['1:1 with Ravi', 4, '15:00', 'low', 0, ''],
    ['Tax filing documents', 7, '12:00', 'med', 0, 'Send to accountant before the deadline.'],
  ] as const;
  for (const [title, off, time, pri, done, detail] of tasks)
    await execute(
      `INSERT INTO journal_tasks (id, tenant_id, user_id, title, due_date, due_time, priority, done, detail)
       VALUES (:id,:t,:u,:title,:dd,:tm,:pr,:dn,:dt)`,
      { id: id('jt'), t: tenantId, u: userId, title, dd: ymd(day(off)), tm: time, pr: pri, dn: done, dt: detail },
    );

  // ── Calendar events ──
  const events: [string, number, number, number, number, number, string, string, number][] = [
    // title, dayOffset, startH, startM, endH, endM, color, location, attendees
    ['Daily standup', 0, 9, 0, 9, 30, '#2a6fdb', 'Zoom', 6],
    ['1:1 with Priya', 0, 11, 0, 12, 0, '#1f9d57', 'Office', 2],
    ['Acme — Quarterly Business Review', 0, 14, 0, 15, 0, '#4b49d6', 'Zoom', 6],
    ['Board deck review', 1, 10, 0, 11, 0, '#c77700', 'Office', 4],
    ['Sequoia intro call', 2, 13, 0, 14, 0, '#d14343', 'Zoom', 3],
    ['Board meeting', 3, 9, 0, 10, 30, '#4b49d6', 'Boardroom', 8],
    ['Product review', 4, 11, 0, 12, 30, '#2a6fdb', 'Zoom', 5],
    ['Tennis', 5, 16, 0, 17, 0, '#1f9d57', 'Club', 1],
  ];
  for (const [title, off, sh, sm, eh, em, color, loc, att] of events)
    await execute(
      `INSERT INTO calendar_events (id, tenant_id, user_id, title, start_at, end_at, color, location, attendees, source)
       VALUES (:id,:t,:u,:title,:s,:e,:c,:loc,:att,'gcalendar')`,
      { id: id('evt'), t: tenantId, u: userId, title, s: dtAt(day(off), sh, sm), e: dtAt(day(off), eh, em), c: color, loc, att },
    );

  // ── Mail items ──
  const mail: [string, string, string, string, string, number][] = [
    ['David Chen', 'Re: Renewal terms', 'Open to a 2-year deal if onboarding support is included — awaiting your reply.', 'approvals', 'high', 0],
    ['Priya Nair', 'Q3 hiring plan — approval needed', 'Four roles ready to post; blocked on your sign-off since yesterday.', 'approvals', 'high', 1],
    ['Customer Success', 'Acme usage report', 'Active seats down 18% MoM — recommends proactive outreach this week.', 'tasks', 'high', 1],
    ['Finance', 'Invoice #4821 due', 'Vendor invoice of $42k due soon — approve or flag for review.', 'finance', 'med', 1],
    ['Accountant', 'Tax filing documents', 'Needs your signed forms before the filing deadline.', 'deadlines', 'med', 2],
    ['Maya Iyer', 'Intro: Sequoia partner', 'Warm intro to a Sequoia partner for the Series B — reply to schedule.', 'intros', 'high', 3],
    ['Board', 'Board meeting agenda', 'Agenda for the meeting; asks you to confirm deck section owners.', 'meetings', 'med', 3],
    ['Legal', 'MSA redlines', 'Two open redlines on the Acme MSA need a decision before signing.', 'decisions', 'med', 4],
    ['Ravi Shah', 'Sprint update', 'Engineering behind on 3 tickets; flags risk to the launch date.', 'tasks', 'low', 4],
    ['TechCrunch', 'Weekly digest', 'Industry newsletter — summarized, no action needed.', 'fyi', 'low', 5],
  ];
  const mailTags: Record<string, string[]> = {
    'Re: Renewal terms': ['Acme', 'renewal'], 'Q3 hiring plan — approval needed': ['hiring'],
    'Acme usage report': ['Acme', 'usage'], 'Invoice #4821 due': ['invoice'],
    'Tax filing documents': ['tax', 'deadline'], 'Intro: Sequoia partner': ['Series B', 'Sequoia'],
    'Board meeting agenda': ['board'], 'MSA redlines': ['legal', 'Acme'], 'Sprint update': ['eng'], 'Weekly digest': ['news'],
  };
  for (const [from, subject, summary, category, priority, ago] of mail)
    await execute(
      `INSERT INTO mail_items (id, tenant_id, from_name, subject, summary, category, priority, received_at, tags)
       VALUES (:id,:t,:f,:s,:sm,:c,:p,:d,:tags)`,
      { id: id('mail'), t: tenantId, f: from, s: subject, sm: summary, c: category, p: priority, d: ymd(day(-ago)), tags: JSON.stringify(mailTags[subject] ?? []) },
    );

  // ── Memories + knowledge graph ──
  const memories: [string, string, string, number | null, string][] = [
    ['preference', 'Prefers concise, bulleted updates over long prose', '6 chat corrections', 94, 'long'],
    ['fact', 'Acme prefers multi-year deals with onboarding support', 'chat · today · linked to Acme node', null, 'long'],
    ['contact', 'David Chen — VP Operations, Acme; decision-maker on renewal', 'Gmail + Calendar · 11 interactions', null, 'long'],
    ['project', 'Series B raise — targeting close by end of Q3', 'Docs + Slack · 23 references', null, 'long'],
    ['preference', 'Prefers meetings scheduled in the afternoon', 'Calendar patterns', 81, 'long'],
    ['fact', 'Runway is healthy at ~14 months at current burn', 'Q3 Forecast.sheet', null, 'long'],
    ['correction', 'Use "Lenskart" not "the company" in external comms', '2 chat corrections', null, 'short'],
    ['contact', 'Maya Iyer — connector to Sequoia', 'Gmail · 4 interactions', null, 'short'],
  ];
  for (const [type, content, source, conf, scope] of memories)
    await execute(
      `INSERT INTO memories (id, tenant_id, type, content, source, confidence, scope)
       VALUES (:id,:t,:ty,:c,:s,:cf,:sc)`,
      { id: id('mem'), t: tenantId, ty: type, c: content, s: source, cf: conf, sc: scope },
    );

  const nodeIds: Record<string, string> = {};
  for (const [label, kind] of [['Acme', 'account'], ['David Chen', 'person'], ['QBR', 'event'], ['Renewal', 'topic'], ['Tickets', 'topic']] as const) {
    const nid = id('kn');
    nodeIds[label] = nid;
    await execute('INSERT INTO knowledge_nodes (id, tenant_id, label, kind) VALUES (:id,:t,:l,:k)', { id: nid, t: tenantId, l: label, k: kind });
  }
  for (const [from, to, rel] of [['Acme', 'David Chen', 'stakeholder'], ['Acme', 'QBR', 'meeting'], ['Acme', 'Renewal', 'topic'], ['Acme', 'Tickets', 'open'], ['David Chen', 'Renewal', 'owns'], ['QBR', 'Tickets', 'covers']] as const)
    await execute('INSERT INTO knowledge_edges (id, tenant_id, from_node, to_node, relation) VALUES (:id,:t,:f,:to,:r)', {
      id: id('ke'), t: tenantId, f: nodeIds[from], to: nodeIds[to], r: rel,
    });

  // ── Connectors ──
  const connectors: [string, string, string, string, string, number, string | null][] = [
    // provider, displayName, group, status, capabilities, syncedMinsAgo, note
    ['gmail', 'Gmail', 'Google Workspace', 'connected', 'Read · Draft · Send', 2, null],
    ['gcalendar', 'Calendar', 'Google Workspace', 'connected', 'Read · Create · Update', 2, null],
    ['gdrive', 'Drive & Docs', 'Google Workspace', 'connected', 'Read · Edit · Comment', 5, null],
    ['gsheets', 'Sheets & Tasks', 'Google Workspace', 'connected', 'Read · Write · Update', 5, null],
    ['slack', 'Slack', 'Communication & Work', 'connected', 'Read · Post · Summarize', 1, null],
    ['notion', 'Notion', 'Communication & Work', 'connected', 'Read · Create · Update', 8, null],
    ['github', 'GitHub', 'Communication & Work', 'connected', 'Read · Issues · PRs', 12, null],
    ['jira', 'Jira', 'Communication & Work', 'expiring', 'Read · Issues', 60, 'Token expiring in 3 days'],
  ];
  for (const [provider, name, group, status, caps, mins, note] of connectors)
    await execute(
      `INSERT INTO connectors (id, tenant_id, provider, display_name, group_label, status, capabilities, last_synced_at, note)
       VALUES (:id,:t,:p,:n,:g,:s,:c, DATE_SUB(NOW(), INTERVAL :mins MINUTE), :note)`,
      { id: id('conn'), t: tenantId, p: provider, n: name, g: group, s: status, c: caps, mins, note },
    );

  // ── Notifications ──
  const notifs: [string, string, string, number][] = [
    ['David Chen replied', 'Re: Acme renewal — open to a 2-year deal with onboarding.', '#d14343', 0],
    ['Priya is waiting on you', 'Q3 hiring plan needs your approval to proceed.', '#c77700', 0],
    ['IRIS prepared 5 actions', 'From your latest conversation — review & approve.', '#4b49d6', 0],
    ['Board deck due soon', '2 sections remaining before the board meeting.', '#2a6fdb', 1],
    ['Warm intro from Maya', 'Connected you with a Sequoia partner for the raise.', '#1f9d57', 1],
  ];
  for (const [title, body, dot, read] of notifs)
    await execute(
      'INSERT INTO notifications (id, tenant_id, user_id, title, body, dot_color, is_read) VALUES (:id,:t,:u,:ti,:b,:d,:r)',
      { id: id('ntf'), t: tenantId, u: userId, ti: title, b: body, d: dot, r: read },
    );

  // ── Actions (approval gate) ──
  const actions: [string, string, string, string, string][] = [
    ['Draft email', 'Gmail', 'Follow-up to David Chen — Acme renewal', 'Proposes a 2-year term with dedicated onboarding support. Warm, concise, executive tone.', 'pending'],
    ['Calendar event', 'Calendar', 'Acme onboarding scoping call', 'Tue 11:00 AM · 30 min · invites David Chen and Priya.', 'pending'],
    ['Update record', 'Sheets', 'Acme account — renewal intent', "Sets stage to '2-year intent', adds onboarding requirement note.", 'pending'],
    ['Create task', 'Tasks', 'Scope onboarding package for Acme', 'Assigned to you · due before the Tuesday call.', 'pending'],
    ['Save memory', 'Long-term', 'Acme prefers multi-year deals with onboarding', 'Stored to long-term memory and the Acme knowledge node.', 'approved'],
  ];
  for (const [kind, target, title, detail, status] of actions)
    await execute(
      `INSERT INTO actions (id, tenant_id, user_id, kind, target, title, detail, status, decided_at)
       VALUES (:id,:t,:u,:k,:tg,:ti,:d,:s, IF(:s2='approved', NOW(), NULL))`,
      { id: id('act'), t: tenantId, u: userId, k: kind, tg: target, ti: title, d: detail, s: status, s2: status },
    );

  // ── Risks ──
  const risks: [string, string, string, number][] = [
    ['Acme renewal at risk', 'Product usage down 18% MoM', 'high', 0],
    ['Eng hiring behind plan', '3 roles open past target date', 'med', 1],
    ['Runway healthy', '14 months at current burn', 'low', 2],
  ];
  for (const [title, detail, sev, pos] of risks)
    await execute('INSERT INTO risks (id, tenant_id, title, detail, severity, position) VALUES (:id,:t,:ti,:d,:s,:p)', {
      id: id('rsk'), t: tenantId, ti: title, d: detail, s: sev, p: pos,
    });

  // ── Priorities ──
  const priorities: [number, string, string, string, string][] = [
    [0, 'Finalize the Series B board deck', '2 sections remain · due before the board meeting', 'Critical', 'danger'],
    [1, 'Approve the Q3 hiring plan', 'Priya has been waiting since yesterday · 4 roles', 'Blocking', 'warn'],
    [2, 'Review Acme renewal terms', 'Before the 2:00 PM QBR · IRIS prepared a brief', '2:00 PM', 'neutral'],
  ];
  for (const [rank, title, detail, tag, tone] of priorities)
    await execute(
      'INSERT INTO priorities (id, tenant_id, user_id, rank, title, detail, tag, tag_tone) VALUES (:id,:t,:u,:r,:ti,:d,:tg,:tone)',
      { id: id('prio'), t: tenantId, u: userId, r: rank, ti: title, d: detail, tg: tag, tone },
    );

  logger.info({ tenantId, ownerName }, 'seeded demo data for tenant');
}
