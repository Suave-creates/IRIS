import { useNavigate } from 'react-router-dom';
import { VIEW_PATHS } from '@iris/shared';
import { Check, IrisMark, Lock } from '@/components/icons';
import { useSession } from '@/features/auth/useSession';
import styles from './Welcome.module.css';

export function Welcome() {
  const navigate = useNavigate();
  const { user } = useSession();
  const firstName = user?.name?.split(' ')[0] ?? 'there';

  return (
    <div className={styles.screen}>
      <div className={styles.inner}>
        <div className={styles.mark}>
          <IrisMark size={28} />
        </div>
        <div className={styles.eyebrow}>Provisioned by Lenskart Tech Sangathan</div>
        <h1 className={styles.title}>Welcome to IRIS, {firstName}.</h1>
        <p className={styles.intro}>
          Your executive intelligence layer is ready. Three quick steps and IRIS will start working in the
          background — learning your context, never acting without your approval.
        </p>

        <div className={styles.steps}>
          <div className={styles.step}>
            <div className={`${styles.stepIcon} ${styles.done}`}>
              <Check size={17} />
            </div>
            <div className={styles.stepBody}>
              <div className={styles.stepTitle}>Identity verified</div>
              <div className={styles.stepSub}>Signed in as {user?.email}</div>
            </div>
            <span className={styles.doneBadge}>Done</span>
          </div>

          <div className={`${styles.step} ${styles.active}`}>
            <div className={`${styles.stepIcon} ${styles.accent}`}>2</div>
            <div className={styles.stepBody}>
              <div className={styles.stepTitle}>Connect your services</div>
              <div className={styles.stepSub}>Gmail, Calendar, Slack, Drive and more — scoped and revocable</div>
            </div>
            <button className={styles.connectBtn} onClick={() => navigate(VIEW_PATHS.connectors)}>
              Connect
            </button>
          </div>

          <div className={`${styles.step} ${styles.dim}`}>
            <div className={`${styles.stepIcon} ${styles.muted}`}>3</div>
            <div className={styles.stepBody}>
              <div className={styles.stepTitle}>Personalize IRIS</div>
              <div className={styles.stepSub}>Tone, working hours, approval preferences</div>
            </div>
            <button className={styles.ghostBtn} onClick={() => navigate(VIEW_PATHS.settings)}>
              Set up
            </button>
          </div>
        </div>

        <div className={styles.footnote}>
          <Lock size={14} />
          End-to-end encrypted · isolated workspace · you control every action
        </div>
      </div>
    </div>
  );
}
