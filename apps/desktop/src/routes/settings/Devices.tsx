import { Button, Chip, Dialog, ItemRow, Modal } from "@dlh/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTRPC } from "../../api/client";
import { useAuth } from "../../auth/AuthProvider";
import { formatLastActive } from "./lastActive";

const platformLabels = {
  macos: "macOS",
  windows: "Windows",
  web: "Browser",
} as const;

export function Devices() {
  const trpc = useTRPC();
  const { signOut } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const devices = useQuery(trpc.devices.list.queryOptions());
  const revoke = useMutation(
    trpc.devices.revoke.mutationOptions({
      onSuccess: () => devices.refetch(),
    }),
  );
  const now = new Date();

  return (
    <section className="glass-panel flex flex-col gap-3 p-6">
      <h2 className="text-[17px] font-semibold">Devices</h2>
      <div className="flex flex-col">
        {devices.data?.map((d) => (
          <ItemRow
            key={d.id}
            title={d.name}
            meta={`${platformLabels[d.platform]} · ${formatLastActive(d.lastUsedAt, now)}`}
            chips={d.current ? <Chip kind="type">This device</Chip> : undefined}
            trailing={
              d.current ? undefined : (
                <Button
                  variant="ghost"
                  isDisabled={revoke.isPending}
                  onPress={() => revoke.mutate({ id: d.id })}
                >
                  Revoke
                </Button>
              )
            }
          />
        ))}
      </div>
      <div>
        <Button variant="glass" onPress={() => setConfirming(true)}>
          Sign out
        </Button>
      </div>
      <Modal isOpen={confirming} onOpenChange={setConfirming}>
        <Dialog title="Sign out of this device?">
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onPress={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              variant="solid"
              onPress={() => {
                setConfirming(false);
                void signOut();
              }}
            >
              Sign out
            </Button>
          </div>
        </Dialog>
      </Modal>
    </section>
  );
}
