// Temas de color. Los valores (variables CSS) viven en legacy.css, bajo html[data-theme=…]; aquí solo el nombre y la muestra.
export interface Theme { id: string; name: string; swatch: string }
const half = (a: string, b: string) => `linear-gradient(135deg,${a} 50%,${b} 50%)`;

export const THEMES: Theme[] = [
  { id: "sonda", name: "Sonda", swatch: half("#00e5ff", "#1f5df5") },
  { id: "bn", name: "Blanco y negro", swatch: half("#fff", "#000") },
  { id: "negro", name: "Solo negro", swatch: "#000" },
  { id: "cyberpunk", name: "Cyberpunk", swatch: half("#ff2bd6", "#00f0ff") },
  { id: "colocolo", name: "Colo-Colo", swatch: half("#fff", "#0b0b0b") },
  { id: "uchile", name: "U. de Chile", swatch: half("#0033a0", "#e4002b") },
  { id: "catolica", name: "U. Católica", swatch: half("#0a3f7a", "#f2c200") },
  { id: "oceano", name: "Océano", swatch: half("#27d3c4", "#1e90ff") },
  { id: "bosque", name: "Bosque", swatch: half("#7be07d", "#2faa4f") },
  { id: "atardecer", name: "Atardecer", swatch: half("#ff8a3d", "#ff3d77") },
  { id: "wanderers", name: "Wanderers", swatch: half("#00873e", "#fff") },
  { id: "clouddancer", name: "Cloud Dancer", swatch: half("#f0eee9", "#4a5bd8") },
  { id: "mocha", name: "Mocha", swatch: half("#a47864", "#4a3328") },
  { id: "aurora", name: "Aurora", swatch: half("#8b7bff", "#3ee6b0") },
  { id: "lavanda", name: "Lavanda", swatch: half("#7a5af8", "#c06bff") },
  { id: "terminal", name: "Terminal", swatch: half("#39ff6a", "#0a0f0a") },
];

export function currentTheme(): string {
  return document.documentElement.dataset.theme || "sonda";
}
