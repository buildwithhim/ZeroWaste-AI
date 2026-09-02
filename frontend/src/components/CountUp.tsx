import { useEffect, useState } from "react";
import { animate } from "framer-motion";

type CountUpProps = { value: number; suffix?: string; prefix?: string };

export default function CountUp({ value, suffix = "", prefix = "" }: CountUpProps) {
  const [displayValue, setDisplayValue] = useState(0);
  useEffect(() => {
    const controls = animate(0, value, { duration: 0.8, ease: "easeOut", onUpdate: (latest) => setDisplayValue(Math.round(latest)) });
    return () => controls.stop();
  }, [value]);
  return <>{prefix}{displayValue.toLocaleString()}{suffix}</>;
}
