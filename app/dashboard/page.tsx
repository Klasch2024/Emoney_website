"use client";
import { useEffect, useMemo, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { isUSZip, cleanUSZip } from "@/lib/zip";
import ItemCard from "@/components/ItemCard";
import Modal from "@/components/Modal";
import SkeletonCard from "@/components/SkeletonCard";
import { gaEvent } from "@/app/(lib)/ga";
import SuccessHeroSlider from "@/components/SuccessHeroSlider";
import { useSearchParams, useRouter } from "next/navigation";
import ScanOverlayPurchase from "@/components/ScanOverlayPurchase";

const SIGNUP_URL = "https://reserve.emoneydeals.com";

type ApiResp = { items: any[]; count: number };

interface ZipData {
  zip_code: number;
  city: string;
  state: string;
  county: string;
  latitude: number;
  longitude: number;
  cities: string[];
  uniqueCities: string[];
  addresses: string[];
}

type FomoProps = {
  min?: number;
  max?: number;
  durationMs?: number;
  autoReset?: boolean;
  onExpire?: () => void;
  label?: string;
};

// NEW: stages for flow
type Stage = "demo" | "loading" | "results";

export default function Dashboard() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const initialZip = searchParams.get("zip");
  const [zip, setZip] = useState(cleanUSZip(initialZip || ""));
  const [stage, setStage] = useState<Stage>("demo"); // start at demo once we have a valid zip

  // PHONE intake (US)
  const [phone, setPhone] = useState("");
  const [phoneErr, setPhoneErr] = useState<string | null>(null);
  const [formSubmitting, setFormSubmitting] = useState(false);

  const [data, setData] = useState<ApiResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [zipData, setZipData] = useState<ZipData | null>(null);
  const [selectedItem, setSelectedItem] = useState<any | null>(null);
  const [scanning, setScanning] = useState(false);

  // keep local zip in sync with URL
  useEffect(() => {
    const next = cleanUSZip(initialZip || "");
    setZip(next);
  }, [initialZip]);

  // if no valid zip in URL, send them back home to enter it
  useEffect(() => {
    if (!isUSZip(zip) || !initialZip || !initialZip?.length) {
      router.push("/");
    } else {
      // reflect "demo screen" state in the URL for clarity
      const qp = new URLSearchParams(searchParams.toString());
      qp.set("demo", "1");
      router.replace(`?${qp.toString()}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zip]);

  // Fetch only when stage moves to "loading"
  useEffect(() => {
    if (stage === "loading" && isUSZip(zip)) {
      void fetchItems(zip);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, zip]);

  async function fetchItems(z: string) {
    setLoading(true);
    setData(null);
    try {
      const res = await fetch(`/api/items?zip=${encodeURIComponent(z)}`, { cache: "no-store" });
      const json = (await res.json()) as ApiResp;
      setData(json);

      const response = await fetch(`/api/zip/${z}`);
      const zjson = (await response.json()) as ZipData;
      setZipData(zjson);

      setStage("results");
    } catch (e) {
      console.error("Error fetching items:", e);
      setData({ items: [], count: 0 });
      setZipData(null);
      setStage("results");
    } finally {
      setLoading(false);
      // clean demo flag from URL when leaving demo
      const qp = new URLSearchParams(searchParams.toString());
      qp.delete("demo");
      router.replace(`?${qp.toString()}`);
    }
  }

  function finalizeRoute() {
    const url = `${SIGNUP_URL}?src=dashboard_modal&zip=${encodeURIComponent(zip)}`;
    gaEvent("buy_click", { zip, url });
    window.location.href = url;
  }

  function getDealItem(item: any) {
    setSelectedItem(item);
    gaEvent("check_deal", { item });
    setScanning(true);
  }

  function openPurchaseOverlay() {
    setScanning(false);
    setOpen(true);
  }

  // ---- PHONE HELPERS ----
  function cleanPhone(input: string) {
    return (input || "").replace(/\D+/g, "");
  }
  function isValidUSPhone(input: string) {
    const digits = cleanPhone(input);
    if (digits.length === 10) return true; // standard US number
    if (digits.length === 11 && digits.startsWith("1")) return true; // with country code
    return false;
  }

  async function submitDemo(e: React.FormEvent) {
    e.preventDefault();
    setPhoneErr(null);

    if (!isValidUSPhone(phone)) {
      setPhoneErr("Enter a valid US phone number.");
      return;
    }

    try {
      setFormSubmitting(true);
      // optional: record the demo lead — safe to no-op if you don’t have this route
      await fetch("/api/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "",
          email: "",
          phone: cleanPhone(phone),
          source: "demo_mode",
          zip,
        }),
      }).catch(() => { /* ignore errors here */ });

      gaEvent("demo_start", { zip, phone: cleanPhone(phone) });
      setStage("loading"); // this triggers fetchItems via effect
    } catch (err) {
      console.error(err);
      setPhoneErr("Could not start demo. Please try again.");
    } finally {
      setFormSubmitting(false);
    }
  }

  // While we’re in demo stage, render the Demo Screen
  if (stage === "demo" && isUSZip(zip)) {
    return (
      <div className="relative min-h-dvh pb-20">
        <section className="container max-w-[680px] mx-auto py-10">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
            className="card p-8 text-center"
          >
            <h1 className="text-3xl font-extrabold tracking-tight">Try Demo Mode</h1>
            <p className="mt-2 text-white/75">
              A private invite to our <span className="font-semibold">100% free Telegram</span> deal group will be
              <span className="font-semibold"> texted to your phone</span> (watch for the SMS).
            </p>

            <form onSubmit={submitDemo} className="mx-auto mt-6 grid gap-3 max-w-md">
              <div className="text-left">
                <label className="text-xs font-semibold text-white/70">Phone</label>
                <input
                  className="input mt-1 w-full"
                  type="tel"
                  inputMode="tel"
                  placeholder="(555) 123-4567"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  aria-invalid={!!phoneErr}
                  aria-describedby="phone-err"
                />
                {phoneErr ? (
                  <p id="phone-err" className="mt-1 text-xs text-red-300">
                    {phoneErr}
                  </p>
                ) : null}
              </div>

              {/* We show the submitted ZIP read-only to match your request “textbox below where they submitted their zipcode” */}
              <div className="text-left">
                <label className="text-xs font-semibold text-white/70">ZIP Code</label>
                <input className="input mt-1 w-full opacity-70" value={zip} readOnly />
                <p className="mt-1 text-[11px] text-white/50">Scanning stores near this ZIP in demo. Your invite will arrive by text.</p>
              </div>

              <motion.button
                type="submit"
                disabled={formSubmitting}
                className="btn btn-primary mt-2"
                whileTap={{ scale: 0.98 }}
              >
                {formSubmitting ? "Starting Demo…" : "Start Demo"}
              </motion.button>

              <p className="mt-2 text-xs text-white/60">
                Preview the Clearance Software for <span className="font-semibold">ZIP {zip}</span>.
              </p>
            </form>
          </motion.div>
        </section>
      </div>
    );
  }

  // From here on, your original page (loading/results/modal) remains
  return (
    <div className="relative min-h-dvh pb-20">
      <section className="container py-6">
        <h1 className="text-2xl font-bold">eMoney Deals</h1>

        {stage === "results" && data?.count ? (
          <div className="mt-4 card p-4">
            <div className="text-sm">
              <span className="ml-2 text-white/70">Click one of the deals to unlock. ✅</span>
            </div>
          </div>
        ) : null}
      </section>

      <section className="container mt-4">
        {stage !== "results" || data === null ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 12 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : (
          <div key={`grid-${zip}`} className="grid items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {data.items.map((it) => (
              <motion.div
                key={it.id}
                className="h-full"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
              >
                <ItemCard item={it} cities={zipData?.cities || []} onClick={() => getDealItem(it)} className="h-full" />
              </motion.div>
            ))}
          </div>
        )}
      </section>

      <AnimatePresence>
        {loading && (
          <motion.div
            className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div className="h-1 w-2/3 overflow-hidden rounded-full bg-white/10">
              <motion.div
                className="h-full w-1/3 bg-gradient-to-r from-brand-purple to-brand-magenta"
                initial={{ x: "-100%" }}
                animate={{ x: "300%" }}
                transition={{ repeat: Infinity, duration: 1.2, ease: "easeInOut" }}
              />
            </motion.div>
            <div className="mt-3 text-sm text-white/70">Scanning inventory near {zip}…</div>
          </motion.div>
        )}
      </AnimatePresence>

      <Modal open={open} onClose={() => setOpen(false)}>
        <div className="items-center justify-center text-center">
          <h3 className="text-xl font-bold">WAIT! 🛑</h3>
          <p className="text-sm text-white/70 mt-1">
            To Unlock Your Deal & Free Access to eMoney Click Below ✅
          </p>

          <div className="mt-6">
            <div
              className="inline-flex items-center justify-center rounded-xl px-4 py-2 font-semibold transition bg-[color:var(--card)] border border-white/10"
              onClick={finalizeRoute}
            >
              <div className="w-[10px] h-[10px] rounded-full bg-green-400 animate-pulse"></div> &nbsp; Get Full Access To Everything Below FOR FREE 🔓
            </div>
          </div>

          <SuccessHeroSlider
            items={[
              { src: "/success/insaneclearance.jpg", caption: "UNLOCK EXCLUSIVE HIDDEN CLEARANCE DEALS" },
              { src: "/success/pokemoncar.jpg", caption: "UNLOCK TRADING CARD RELEASES" },
              { src: "/success/lego.jpg", caption: "UNLOCK HIGH DEMAND COLLECTIBLES TO RESELL" },
              { src: "/success/penny.jpg", caption: "UNLOCK PENNY CLEARANCE ITEMS" },
              { src: "/success/tools.jpg", caption: "UNLOCK RANDOM RESELLABLE ITEMS" },
            ]}
            height={300}
            autoplayMs={1200}
            className="mx-auto"
          />
        </div>

        <div className="mt-3 flex items-center justify-center">
          <FomoBadge min={200} max={450} durationMs={15 * 60_000} />
        </div>

        <div className="flex items-center justify-center">
          <button className="btn btn-primary mt-4 py-4! cursor-pointer hover:opacity-80 transition-all duration-200" onClick={finalizeRoute}>
            GET ACCESS FOR FREE 🔓
          </button>
        </div>

        <div className="absolute top-0 right-0 w-16 h-16 rounded-full bg-red-600 flex items-center justify-center text-white font-bold text-sm -translate-x-1/3 -translate-y-1/3 shadow-glow">
          <span className="text-center">FREE TRIAL</span>
        </div>
      </Modal>

      {scanning && <ScanOverlayPurchase item={selectedItem} cities={zipData?.cities || []} onDone={openPurchaseOverlay} />}
    </div>
  );
}

function FomoBadge({
  min = 200,
  max = 400,
  durationMs = 15 * 60_000,
  autoReset = false,
  onExpire,
  label = "claimed in the last hour",
}: FomoProps) {
  const randInt = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));
  const [count] = useState(() => randInt(min, max));
  const endTs = useRef<number>(Date.now() + durationMs);
  const [remaining, setRemaining] = useState<number>(durationMs);

  // keep min/max valid
  const safeCount = useMemo(
    () => Math.min(Math.max(count, Math.min(min, max)), Math.max(min, max)),
    [count, min, max]
  );

  useEffect(() => {
    // reset endTs when duration changes
    endTs.current = Date.now() + durationMs;
    setRemaining(durationMs);

    const id = window.setInterval(() => {
      const left = Math.max(0, endTs.current - Date.now());
      setRemaining(left);

      if (left === 0) {
        onExpire?.();
        if (autoReset) {
          endTs.current = Date.now() + durationMs;
          setRemaining(durationMs);
        } else {
          window.clearInterval(id);
        }
      }
    }, 1000);

    return () => window.clearInterval(id);
  }, [durationMs, autoReset, onExpire]);

  const mm = String(Math.floor(remaining / 60_000)).padStart(2, "0");
  const ss = String(Math.floor((remaining % 60_000) / 1000)).padStart(2, "0");
  const urgent = remaining <= 60_000; // last minute → subtle pulse

  return (
    <span
      className={[
        "inline-flex items-center gap-3 rounded-full border border-white/10 bg-white/5",
        "px-3 py-1 text-xs font-semibold text-white/80",
        urgent ? "ring-1 ring-red-500/20 animate-[pulse_1.6s_ease-in-out_infinite]" : "",
      ].join(" ")}
      aria-live="polite"
      title={`Offer window ends in ${mm}:${ss}`}
    >
      <span className="text-base leading-none">🔥</span>
      <span>
        <strong className="text-white">{safeCount}</strong> {label}
      </span>
      <span className="inline-flex items-center gap-1 text-white/70">
        • <span className="tabular-nums">{mm}:{ss}</span>
      </span>
    </span>
  );
}
