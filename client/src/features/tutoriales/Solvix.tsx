// Solvix, el astronauta de SRV que guía los tutoriales. Dibujado en SVG y animado con CSS
// (styles.css → .solvix): flota, parpadea, saluda, señala y festeja. Sus colores son los de la marca
// SRV y no cambian con el tema: es un personaje, no una pieza de la interfaz.

export type PoseSolvix = 'saluda' | 'senala' | 'piensa' | 'festeja' | 'quieto';

export function Solvix({ pose = 'quieto', size = 96 }: { pose?: PoseSolvix; size?: number }) {
  return (
    <svg className={`solvix solvix-${pose}`} width={size} height={size * 1.15} viewBox="0 0 120 138" role="img" aria-label="Solvix, el astronauta de SRV">
      <defs>
        <linearGradient id="solvix-visor" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#0B78FB" />
          <stop offset="1" stopColor="#0A1B3D" />
        </linearGradient>
        <linearGradient id="solvix-traje" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="1" stopColor="#DCE6F5" />
        </linearGradient>
      </defs>
      <ellipse className="solvix-sombra" cx="60" cy="134" rx="24" ry="3.5" fill="currentColor" opacity="0.12" />
      <g className="solvix-cuerpo">
        {/* mochila */}
        <rect x="31" y="78" width="58" height="38" rx="12" fill="#B9C7DC" />
        {/* piernas */}
        <rect x="44" y="108" width="13" height="20" rx="6" fill="url(#solvix-traje)" stroke="#C7D3E6" />
        <rect x="63" y="108" width="13" height="20" rx="6" fill="url(#solvix-traje)" stroke="#C7D3E6" />
        <rect x="42" y="122" width="17" height="7" rx="3.5" fill="#F6950A" />
        <rect x="61" y="122" width="17" height="7" rx="3.5" fill="#F6950A" />
        {/* brazo izquierdo */}
        <g className="solvix-brazo-izq">
          <rect x="24" y="84" width="14" height="28" rx="7" fill="url(#solvix-traje)" stroke="#C7D3E6" />
          <circle cx="31" cy="113" r="6" fill="#F6950A" />
        </g>
        {/* torso */}
        <rect x="36" y="80" width="48" height="36" rx="14" fill="url(#solvix-traje)" stroke="#C7D3E6" />
        <rect x="49" y="90" width="22" height="14" rx="4" fill="#0A1B3D" />
        <circle className="solvix-luz" cx="55" cy="97" r="2.6" fill="#F6950A" />
        <circle cx="62" cy="97" r="2.6" fill="#0B78FB" />
        <circle cx="68" cy="97" r="1.6" fill="#7EE3A0" />
        {/* brazo derecho (saluda / señala) */}
        <g className="solvix-brazo-der">
          <rect x="82" y="84" width="14" height="28" rx="7" fill="url(#solvix-traje)" stroke="#C7D3E6" />
          <circle cx="89" cy="113" r="6" fill="#F6950A" />
        </g>
        {/* cabeza */}
        <g className="solvix-cabeza">
          <line x1="60" y1="18" x2="60" y2="8" stroke="#B9C7DC" strokeWidth="3" strokeLinecap="round" />
          <circle className="solvix-antena" cx="60" cy="7" r="4.5" fill="#F6950A" />
          <circle cx="60" cy="50" r="33" fill="url(#solvix-traje)" stroke="#C7D3E6" strokeWidth="1.5" />
          <rect x="34" y="32" width="52" height="38" rx="19" fill="url(#solvix-visor)" />
          <g className="solvix-ojos">
            <ellipse cx="50" cy="50" rx="4.2" ry="5.4" fill="#FFFFFF" />
            <ellipse cx="70" cy="50" rx="4.2" ry="5.4" fill="#FFFFFF" />
          </g>
          <path d="M53 60 Q60 65 67 60" stroke="#FFFFFF" strokeWidth="2.4" fill="none" strokeLinecap="round" />
          <path d="M40 40 Q44 34 52 34" stroke="#FFFFFF" strokeWidth="2.5" fill="none" strokeLinecap="round" opacity="0.45" />
          <circle cx="27" cy="50" r="5" fill="#F6950A" />
          <circle cx="93" cy="50" r="5" fill="#F6950A" />
        </g>
      </g>
    </svg>
  );
}
