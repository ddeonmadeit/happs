import { useEffect, useState } from "react";
import { ticketingEnabled } from "@/lib/tickets";

/** Whether paid happs are available (this repo's backend + Stripe configured). */
export function useTicketing() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let cancelled = false;
    ticketingEnabled().then((v) => !cancelled && setOn(v));
    return () => {
      cancelled = true;
    };
  }, []);
  return on;
}
