export { clsx as cn } from 'clsx';

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 1).toLocaleUpperCase('tr');
  return (parts[0]![0]! + parts[1]![0]!).toLocaleUpperCase('tr');
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
