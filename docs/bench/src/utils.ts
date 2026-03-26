export function fmt(ns: number | null | undefined): string {
  if (ns == null) return "—";
  if (ns < 1e3) return `${ns.toFixed(1)} ns`;
  if (ns < 1e6) return `${(ns / 1e3).toFixed(1)} µs`;
  if (ns < 1e9) return `${(ns / 1e6).toFixed(1)} ms`;
  return `${(ns / 1e9).toFixed(2)} s`;
}

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
