import type { ReactNode } from 'react';
import { Avatar, Button, Card, Spinner, Toggle } from '@/components/primitives';
import { useTheme } from '@/providers/ThemeProvider';
import type { UserSettings } from '@/features/me/api';
import { useMe, useRevokeOtherSessions, useSessions, useUpdateSettings } from '@/features/me/useMe';
import styles from './Settings.module.css';

const RETENTION_OPTIONS = [12, 24, 36, 48];
const VOICE_OPTIONS = ['Calm · Neutral', 'Warm', 'Direct', 'Formal'];

export function Settings() {
  const { data: me, isLoading } = useMe();
  const update = useUpdateSettings();
  const { theme, setTheme } = useTheme();

  if (isLoading || !me) {
    return (
      <div className={styles.page}>
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
          <Spinner size={24} />
        </div>
      </div>
    );
  }

  const s = me.settings;
  const patch = (next: Partial<UserSettings>) => update.mutate({ ...s, ...next });

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Settings</h1>

      <Card className={styles.profile}>
        <Avatar name={me.user.name} src={me.user.avatarUrl} size={56} />
        <div className={styles.profileBody}>
          <div className={styles.profileName}>{me.user.name}</div>
          <div className={styles.profileMeta}>
            {me.user.email} · {me.user.title ?? '—'} · <span className={styles.role}>{me.user.role}</span>
          </div>
        </div>
        {me.tenant && <div className={styles.tenant}>{me.tenant.name}</div>}
      </Card>

      <div className={styles.grid}>
        {/* Memory & learning */}
        <Card>
          <h3 className={styles.cardTitle}>Memory &amp; learning</h3>
          <p className={styles.cardSub}>Control what IRIS remembers and for how long.</p>
          <SettingRow title="Continuous learning" sub="Learn from every conversation">
            <Toggle checked={s.continuousLearning} onChange={(v) => patch({ continuousLearning: v })} label="Continuous learning" />
          </SettingRow>
          <SettingRow title="Auto-save memory" sub="Skip review for memory writes">
            <Toggle checked={s.autoSaveMemory} onChange={(v) => patch({ autoSaveMemory: v })} label="Auto-save memory" />
          </SettingRow>
          <SettingRow title="Retention window" sub="Keep memories for" last>
            <select
              className={styles.select}
              value={s.retentionMonths}
              onChange={(e) => patch({ retentionMonths: Number(e.target.value) })}
            >
              {RETENTION_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m} months
                </option>
              ))}
            </select>
          </SettingRow>
        </Card>

        {/* Approvals & safety */}
        <Card>
          <h3 className={styles.cardTitle}>Approvals &amp; safety</h3>
          <p className={styles.cardSub}>IRIS always asks before sensitive actions.</p>
          <SettingRow title="Require approval to send email">
            <Toggle checked={s.approveEmail} onChange={(v) => patch({ approveEmail: v })} label="Approval to send email" />
          </SettingRow>
          <SettingRow title="Require approval for calendar">
            <Toggle checked={s.approveCalendar} onChange={(v) => patch({ approveCalendar: v })} label="Approval for calendar" />
          </SettingRow>
          <SettingRow title="Require approval to delete" last>
            <Toggle checked={s.approveDelete} onChange={(v) => patch({ approveDelete: v })} label="Approval to delete" />
          </SettingRow>
        </Card>

        {/* Appearance & voice */}
        <Card>
          <h3 className={styles.cardTitle}>Appearance &amp; voice</h3>
          <SettingRow title="Theme">
            <div className={styles.segmented}>
              <button className={theme !== 'dark' ? styles.segOn : styles.seg} onClick={() => setTheme('light')}>
                Light
              </button>
              <button className={theme === 'dark' ? styles.segOn : styles.seg} onClick={() => setTheme('dark')}>
                Dark
              </button>
            </div>
          </SettingRow>
          <SettingRow title="Voice replies">
            <Toggle checked={s.voiceReplies} onChange={(v) => patch({ voiceReplies: v })} label="Voice replies" />
          </SettingRow>
          <SettingRow title="Voice" last>
            <select className={styles.select} value={s.voice} onChange={(e) => patch({ voice: e.target.value })}>
              {VOICE_OPTIONS.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </SettingRow>
        </Card>

        {/* Security & data */}
        <SecurityCard />
      </div>
    </div>
  );
}

function SettingRow({
  title,
  sub,
  last,
  children,
}: {
  title: string;
  sub?: string;
  last?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`${styles.row} ${last ? styles.rowLast : ''}`}>
      <div>
        <div className={styles.rowTitle}>{title}</div>
        {sub && <div className={styles.rowSub}>{sub}</div>}
      </div>
      {children}
    </div>
  );
}

function SecurityCard() {
  const { data: sessions, isLoading } = useSessions();
  const revoke = useRevokeOtherSessions();
  const others = sessions?.filter((x) => !x.current).length ?? 0;

  return (
    <Card>
      <h3 className={styles.cardTitle}>Security &amp; data</h3>
      <p className={styles.cardSub}>Manage where you're signed in.</p>
      <SettingRow title="Active sessions" sub={isLoading ? 'Loading…' : `${sessions?.length ?? 0} active`}>
        <span className={styles.count}>{sessions?.length ?? 0}</span>
      </SettingRow>
      <div className={styles.sessionList}>
        {sessions?.map((sess) => (
          <div key={sess.id} className={styles.sessionItem}>
            <div className={styles.sessionMeta}>
              <span className={styles.sessionUa}>{shortUa(sess.userAgent)}</span>
              <span className={styles.sessionIp}>{sess.ip ?? 'unknown IP'}</span>
            </div>
            {sess.current ? <span className={styles.thisBadge}>This device</span> : null}
          </div>
        ))}
      </div>
      <SettingRow title="Sign out other sessions" sub={others ? `${others} other active` : 'No other sessions'} last>
        <Button variant="secondary" size="sm" disabled={!others || revoke.isPending} onClick={() => revoke.mutate()}>
          {revoke.isPending ? 'Signing out…' : 'Sign out'}
        </Button>
      </SettingRow>
    </Card>
  );
}

function shortUa(ua: string | null): string {
  if (!ua) return 'Unknown device';
  if (/edg/i.test(ua)) return 'Edge';
  if (/chrome/i.test(ua)) return 'Chrome';
  if (/firefox/i.test(ua)) return 'Firefox';
  if (/safari/i.test(ua)) return 'Safari';
  return ua.slice(0, 28);
}
