/**
 * The dish photograph.
 *
 * Every dish image is a remote URL, so any one of them can go away without the
 * app changing -- and one already had: a dead link rendered as the browser's
 * broken-image icon in the middle of a meal card, which reads as a fault in the
 * app rather than a missing photo. The failure is handled here so no screen has
 * to think about it, and the fallback is a plain tinted tile rather than
 * another network request that could fail the same way.
 *
 * The image is decorative: the dish name is always rendered as text beside it,
 * so alt is intentionally empty and the fallback is hidden from assistive
 * technology instead of being announced as a missing picture.
 */

import { UtensilsCrossed } from "lucide-react";
import { useEffect, useState } from "react";

export default function DishImage({ src, className }: { src: string; className?: string }) {
  const [failed, setFailed] = useState(false);

  // A new dish in the same slot deserves a fresh attempt.
  useEffect(() => setFailed(false), [src]);

  if (failed || !src) {
    return (
      <span className={`dish-image-fallback${className ? ` ${className}` : ""}`} aria-hidden="true">
        <UtensilsCrossed size={18} />
      </span>
    );
  }

  return <img src={src} alt="" loading="lazy" className={className} onError={() => setFailed(true)} />;
}
