import { Suspense } from "react";
import ConstellationsClient from "./ConstellationsClient";

export default function ConstellationsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-950 text-slate-200 flex items-center justify-center text-sm">
          Loading…
        </div>
      }
    >
      <ConstellationsClient />
    </Suspense>
  );
}
