import { useState } from "react";
import { api } from "../../lib/api";

export default function RedeemForm() {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;

    setLoading(true);
    setResult(null);

    try {
      const res = await api.redeemCode(code.trim());
      setResult({
        type: "success",
        message: `兑换成功！获得 ${res.credits} 积分，当前余额: ${res.newBalance}`,
      });
      setCode("");
    } catch (err: any) {
      setResult({
        type: "error",
        message: err.message || "兑换失败",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-[22px] border border-[#2B313B] bg-[#0A0C11]/72 p-4">
      <div className="text-xs uppercase tracking-[0.18em] text-[#788493]">
        Redeem Code
      </div>
      <p className="mt-2 text-sm text-[#B8C0CC]">
        输入兑换码获取积分
      </p>
      <form onSubmit={handleSubmit} className="mt-3 flex gap-2">
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="请输入兑换码"
          className="flex-1 rounded-xl border border-[#3C4654] bg-[#14171D] px-3 py-2 text-sm text-[#F5F7FA] placeholder-[#788493] outline-none focus:border-[#28D7F5]"
          disabled={loading}
        />
        <button
          type="submit"
          disabled={loading || !code.trim()}
          className="rounded-xl bg-[#28D7F5] px-4 py-2 text-sm font-semibold text-[#050608] disabled:opacity-50"
        >
          {loading ? "兑换中..." : "兑换"}
        </button>
      </form>
      {result && (
        <div
          className={`mt-3 rounded-lg px-3 py-2 text-sm ${
            result.type === "success"
              ? "bg-green-900/30 text-green-300"
              : "bg-red-900/30 text-red-300"
          }`}
        >
          {result.message}
        </div>
      )}
    </div>
  );
}
