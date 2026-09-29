import { useEffect, useState } from "react";
import { qrPayload } from "@/lib/tickets";
import { cn } from "@/lib/utils";

/** A ticket's door code as a QR (dark on cream, so it scans in a dark room). */
export function TicketQR({ code, className }: { code: string; className?: string }) {
  const [svg, setSvg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    import("qrcode").then((QRCode) =>
      QRCode.toString(qrPayload(code), {
        type: "svg",
        margin: 1,
        errorCorrectionLevel: "M",
        color: { dark: "#13110f", light: "#f6e7cf" },
      }).then((out) => !cancelled && setSvg(out)),
    );
    return () => {
      cancelled = true;
    };
  }, [code]);

  return (
    <div
      role="img"
      aria-label="Ticket QR code"
      className={cn("aspect-square overflow-hidden rounded-3xl bg-[#f6e7cf] p-3 [&>svg]:h-full [&>svg]:w-full", className)}
      // The SVG comes from the qrcode library, generated from our own code string.
      dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
    />
  );
}
