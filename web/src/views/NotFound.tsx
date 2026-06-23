import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/primitives';

export function NotFound() {
  const navigate = useNavigate();
  return (
    <div style={{ maxWidth: 520, margin: '80px auto', padding: '0 36px', textAlign: 'center' }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-3)', marginBottom: 8 }}>404</div>
      <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, letterSpacing: '-0.03em' }}>Nothing here</h1>
      <p style={{ margin: '8px 0 20px', color: 'var(--text-2)', fontSize: 14.5 }}>
        That page doesn’t exist. Let’s get you back to the dashboard.
      </p>
      <Button onClick={() => navigate('/')}>Go to dashboard</Button>
    </div>
  );
}
