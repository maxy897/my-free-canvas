import { useEffect, useState } from "react";
import { api } from "../../lib/api";

type CreditBalanceVariant = "pill" | "stat" | "canvas";

interface CreditBalanceProps {
  variant?: CreditBalanceVariant;
  label?: string;
}

export default function CreditBalance({ variant = "pill", label = "Credits" }: CreditBalanceProps) {
  const [credits, setCredits] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    api
      .getCredits()
      .then((data) => {
        if (isMounted) {
          setCredits(data.totalAvailable);
        }
      })
      .catch(() => {
        if (isMounted) {
          setCredits(null);
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const value = isLoading || credits === null ? "—" : credits.toLocaleString();

  if (variant === "stat") {
    return (
      <>
        <div className="text-xs uppercase tracking-[0.18em] text-[#788493]">{label}</div>
        <div className="mt-3 text-3xl font-bold">{value}</div>
      </>
    );
  }

  if (variant === "canvas") {
    return (
      <div className="rounded-2xl border border-white/10 bg-[#070C14]/86 px-4 py-2 shadow-[0_18px_56px_rgba(0,0,0,0.32),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-2xl">
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#788493]">{label}</div>
        <div className="mt-0.5 text-sm font-bold text-[#F5F7FA]">{value}</div>
      </div>
    );
  }

  return (
    <div className="rounded-full border border-[#2B313B] bg-[#14171D]/82 px-3 py-1.5 text-right shadow-[0_10px_28px_rgba(0,0,0,0.18)]">
      <span className="mr-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#788493]">{label}</span>
      <span className="text-sm font-bold text-[#F5F7FA]">{value}</span>
    </div>
  );
}
