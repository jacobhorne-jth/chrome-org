/** Compact "time ago" formatting for last-used display. */
export function timeAgo(iso: string | undefined): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "never";
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

export function actionIcon(type: string): string {
  switch (type) {
    case "vscode":
      return "⧉";
    case "discord":
      return "◇";
    case "application":
      return "▣";
    case "url":
      return "↗";
    case "path":
      return "🗀";
    default:
      return "•";
  }
}
