import type { ReactNode } from 'react';
import type { AdminOverview, AdminUser, Role } from '@iris/shared';
import { Avatar, Badge, Button, Card, Spinner } from '@/components/primitives';
import type { BadgeTone } from '@/components/primitives';
import { Plus, Shield } from '@/components/icons';
import { ApiError } from '@/lib/api';
import { useAdminOverview } from '@/features/admin/useAdmin';
import styles from './Admin.module.css';

type HealthStatus = AdminOverview['systemHealth'][number]['status'];

const HEALTH_META: Record<HealthStatus, { color: string; label: string }> = {
  operational: { color: 'var(--success)', label: 'Operational' },
  elevated: { color: 'var(--warn)', label: 'Elevated load' },
  down: { color: 'var(--danger)', label: 'Down' },
};

const ROLE_TONE: Record<Role, BadgeTone> = {
  owner: 'accent',
  admin: 'info',
  member: 'neutral',
};

function statusTone(status: string): BadgeTone {
  const s = status.toLowerCase();
  if (s === 'active') return 'success';
  if (s === 'invited' || s === 'pending') return 'warn';
  if (s === 'suspended' || s === 'disabled') return 'danger';
  return 'neutral';
}

const nf = new Intl.NumberFormat('en-US');

export function Admin() {
  const { data, isLoading, error } = useAdminOverview();

  if (isLoading) {
    return (
      <div className={styles.page}>
        <div className={styles.center}>
          <Spinner size={24} />
        </div>
      </div>
    );
  }

  if (error instanceof ApiError && error.status === 403) {
    return (
      <div className={styles.page}>
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>
            <Shield size={26} />
          </div>
          <h2 className={styles.emptyTitle}>Admins only</h2>
          <p className={styles.emptyText}>
            This area is reserved for workspace owners and admins. Ask an admin if you need access to provisioning,
            system health, or the audit log.
          </p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className={styles.page}>
        <Header />
        <div className={styles.errorMsg}>
          {error instanceof ApiError ? error.message : 'Could not load the admin overview.'}
        </div>
      </div>
    );
  }

  const { stats, users, systemHealth, audit } = data;

  const kpis: { label: string; value: string; foot: string; footTone?: 'success' }[] = [
    {
      label: 'Active users',
      value: nf.format(stats.activeUsers),
      foot: `${users.length} provisioned`,
    },
    {
      label: 'Connectors',
      value: nf.format(stats.connectors),
      foot: 'across workspace',
    },
    {
      label: 'Memories',
      value: nf.format(stats.memories),
      foot: 'indexed',
    },
    {
      label: 'Pending approvals',
      value: nf.format(stats.pendingApprovals),
      foot: stats.pendingApprovals === 0 ? 'all clear' : 'awaiting review',
      footTone: stats.pendingApprovals === 0 ? 'success' : undefined,
    },
    {
      label: 'System health',
      value: `${systemHealth.filter((s) => s.status === 'operational').length}/${systemHealth.length}`,
      foot: systemHealth.every((s) => s.status === 'operational') ? 'all systems normal' : 'needs attention',
      footTone: systemHealth.every((s) => s.status === 'operational') ? 'success' : undefined,
    },
  ];

  return (
    <div className={styles.page}>
      <Header />

      <div className={styles.kpis}>
        {kpis.map((k) => (
          <Card key={k.label} className={styles.kpi}>
            <div className={styles.kpiLabel}>{k.label}</div>
            <div className={styles.kpiValue}>{k.value}</div>
            <div className={`${styles.kpiFoot} ${k.footTone === 'success' ? styles.kpiFootUp : ''}`}>{k.foot}</div>
          </Card>
        ))}
      </div>

      <div className={styles.grid}>
        <Card padded={false} className={styles.usersCard}>
          <div className={styles.cardHead}>
            <h3 className={styles.cardTitle}>Users</h3>
            <span className={styles.cardMeta}>{users.length} total</span>
          </div>
          <div className={`${styles.tableRow} ${styles.tableHead}`}>
            <span>User</span>
            <span>Role</span>
            <span>Connectors</span>
            <span>Status</span>
          </div>
          {users.map((u, i) => (
            <UserRow key={u.id} user={u} last={i === users.length - 1} />
          ))}
        </Card>

        <div className={styles.sideCol}>
          <Card>
            <h3 className={styles.cardTitle}>System health</h3>
            <div className={styles.healthList}>
              {systemHealth.map((sub) => {
                const meta = HEALTH_META[sub.status];
                return (
                  <div key={sub.name} className={styles.healthRow}>
                    <span className={styles.healthName}>{sub.name}</span>
                    <span className={styles.healthStatus} style={{ color: meta.color }}>
                      <span className={styles.dot} style={{ background: meta.color }} />
                      {meta.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card>
            <h3 className={styles.cardTitle}>Audit log</h3>
            <div className={styles.auditList}>
              {audit.map((entry, i) => (
                <div key={entry.id} className={`${styles.auditRow} ${i === audit.length - 1 ? styles.auditLast : ''}`}>
                  <span className={styles.auditTime}>{entry.time}</span>
                  <span className={styles.auditAction}>
                    {entry.action}
                    {entry.actor ? <span className={styles.auditActor}> · {entry.actor}</span> : null}
                  </span>
                </div>
              ))}
              {audit.length === 0 && <div className={styles.auditEmpty}>No recent activity.</div>}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Header(): ReactNode {
  return (
    <div className={styles.header}>
      <div>
        <h1 className={styles.title}>Admin</h1>
        <p className={styles.subtitle}>
          Provision users, monitor system health, and audit every action across the platform.
        </p>
      </div>
      <Button
        variant="primary"
        leftIcon={<Plus size={15} />}
        disabled
        title="Coming soon"
        aria-label="Provision user (coming soon)"
      >
        Provision user
      </Button>
    </div>
  );
}

function UserRow({ user, last }: { user: AdminUser; last: boolean }) {
  return (
    <div className={`${styles.tableRow} ${styles.userRow} ${last ? styles.userRowLast : ''}`}>
      <div className={styles.userCell}>
        <Avatar name={user.name} size={30} />
        <div className={styles.userMeta}>
          <div className={styles.userName}>{user.name}</div>
          <div className={styles.userEmail}>{user.email}</div>
        </div>
      </div>
      <span>
        <Badge tone={ROLE_TONE[user.role]} style={{ textTransform: 'capitalize' }}>
          {user.role}
        </Badge>
      </span>
      <span className={styles.connectorCount}>{user.connectorCount}</span>
      <span>
        <Badge tone={statusTone(user.status)} style={{ textTransform: 'capitalize' }}>
          {user.status}
        </Badge>
      </span>
    </div>
  );
}
