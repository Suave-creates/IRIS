import styles from './Avatar.module.css';

export interface AvatarProps {
  name: string;
  src?: string | null;
  size?: number;
}

/** Initials avatar with the brand gradient (matches the prototype), or an image. */
export function Avatar({ name, src, size = 32 }: AvatarProps) {
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  const fontSize = Math.round(size * 0.42);
  if (src) {
    return <img className={styles.img} src={src} alt={name} style={{ width: size, height: size }} />;
  }
  return (
    <div className={styles.avatar} style={{ width: size, height: size, fontSize }} aria-hidden>
      {initial}
    </div>
  );
}
