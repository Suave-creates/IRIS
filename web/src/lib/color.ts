/**
 * Colour utilities + the People & Meetings design hues that have no token
 * (sanctioned by the design handoff, §8). Single source so the roster
 * categories, day columns and meeting speaker colours never drift apart.
 */

/** GGN location + Monday teal. */
export const GGN_TEAL = '#17a877';
/** Thursday / Indirect purple. */
export const THU_PURPLE = '#6b5bd6';
/** Agent category pink. */
export const AGENT_PINK = '#e87ba4';
/** Support category orange. */
export const SUPPORT_ORANGE = '#eb6834';
/** Direct-2 category amber. */
export const DIRECT2_AMBER = '#eda100';
/** Wednesday neutral gray. */
export const WED_NEUTRAL = '#8a8a93';

/**
 * Translucent tint of a colour: hex → exact `rgba()`, CSS variables →
 * `color-mix()` (the prototype's hex-alpha suffixes, theme-safe for tokens).
 */
export function alpha(color: string, fraction: number): string {
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    const full =
      hex.length === 3
        ? hex
            .split('')
            .map((ch) => ch + ch)
            .join('')
        : hex;
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${fraction})`;
  }
  const pct = Number((fraction * 100).toFixed(2));
  return `color-mix(in srgb, ${color} ${pct}%, transparent)`;
}

/** Avatar initials: first letters of the first two words of the name. */
export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0))
    .join('');
}
