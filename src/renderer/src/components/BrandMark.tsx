import brandMark from '@renderer/assets/bs-color.png';

interface BrandMarkProps {
  compact?: boolean;
  eyebrow?: string;
  subtitle?: string;
}

export function BrandMark({ compact = false, eyebrow, subtitle }: BrandMarkProps) {
  return (
    <div className={`brand-mark ${compact ? 'compact' : ''}`}>
      <div className="brand-mark-image-shell" aria-hidden="true">
        <img className="brand-mark-image" src={brandMark} alt="" />
      </div>
      <div className="brand-mark-copy">
        {eyebrow ? <span className="brand-mark-eyebrow">{eyebrow}</span> : null}
        <strong className="brand-mark-title">BeatStride</strong>
        {subtitle ? <span className="brand-mark-subtitle">{subtitle}</span> : null}
      </div>
    </div>
  );
}
