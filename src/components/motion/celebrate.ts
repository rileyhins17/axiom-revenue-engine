/** A short burst of brand-coloured confetti from a point. No dependencies; skipped for reduced motion. */
export function celebrate(origin?: { x: number; y: number }) {
  if (typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const x = origin?.x ?? window.innerWidth / 2;
  const y = origin?.y ?? window.innerHeight / 3;
  const colors = ["#e3c07a", "#b8893b", "#f7e4b5", "#0a0a0a", "#fffdf8", "#8a6420"];
  for (let i = 0; i < 46; i += 1) {
    const piece = document.createElement("span");
    piece.className = "owner-confetti";
    const angle = Math.random() * Math.PI * 2;
    const distance = 90 + Math.random() * 220;
    piece.style.left = `${x}px`;
    piece.style.top = `${y}px`;
    piece.style.background = colors[i % colors.length]!;
    piece.style.setProperty("--dx", `${Math.cos(angle) * distance}px`);
    piece.style.setProperty("--dy", `${Math.sin(angle) * distance + 140}px`);
    piece.style.setProperty("--rot", `${Math.round(Math.random() * 720 - 360)}deg`);
    piece.style.animationDelay = `${Math.random() * 90}ms`;
    document.body.appendChild(piece);
    setTimeout(() => piece.remove(), 1400);
  }
}
