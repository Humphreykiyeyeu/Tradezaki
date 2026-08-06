import { DerivProvider } from "@/components/DerivProvider";
import AppShell from "@/components/AppShell";

/**
 * The provider sits above the router so the WebSocket, tick stream and account
 * state survive navigation between Trade, Positions and Account.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <DerivProvider>
      <AppShell>{children}</AppShell>
    </DerivProvider>
  );
}
