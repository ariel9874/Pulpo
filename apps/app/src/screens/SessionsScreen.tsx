import { isMachineOnline, type Machine, type Session } from "@batuta/protocol";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { backend } from "../lib/backend";
import { ntfyTopicFor } from "../lib/push";
import { upsertSession } from "../lib/sessions";
import { NewTaskModal } from "./NewTaskModal";

const STATUS_LABEL: Record<Session["status"], string> = {
  starting: "Arrancando",
  running: "En curso",
  waiting_permission: "Esperando permiso",
  waiting_input: "Esperando entrada",
  done: "Hecho",
  error: "Error",
  cancelled: "Cancelada",
};

export function SessionsScreen({
  email,
  userId,
  onSignOut,
  onOpen,
}: {
  email: string;
  userId: string;
  onSignOut: () => void;
  onOpen: (session: Session) => void;
}) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [machines, setMachines] = useState<Record<string, Machine>>({});
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async (): Promise<void> => {
      const [list, machineList] = await Promise.all([
        backend.listSessions(),
        backend.listMachines(),
      ]);
      if (!active) return;
      setMachines(Object.fromEntries(machineList.map((m) => [m.id, m])) as Record<string, Machine>);
      setSessions([...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      setLoading(false);
    };
    void load();
    const unsubscribe = backend.subscribeSessions((session) =>
      setSessions((prev) => upsertSession(prev, session)),
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>Sesiones</Text>
          <Text style={styles.muted} numberOfLines={1}>
            {email}
          </Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable onPress={() => setShowNew(true)} style={styles.newButton}>
            <Text style={styles.newButtonText}>+ Nueva</Text>
          </Pressable>
          <Pressable onPress={onSignOut} style={styles.signOut}>
            <Text style={styles.signOutText}>Salir</Text>
          </Pressable>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : sessions.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.muted}>No hay sesiones todavía.</Text>
          <Text style={styles.muted}>Pulsa «+ Nueva» para lanzar una tarea.</Text>
        </View>
      ) : (
        <FlatList
          data={sessions}
          keyExtractor={(s) => s.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const machine = machines[item.machineId];
            const online = machine ? isMachineOnline(machine) : false;
            return (
              <Pressable style={styles.row} onPress={() => onOpen(item)}>
                <View style={styles.rowMain}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {item.title || "(sin título)"}
                  </Text>
                  <Text style={styles.muted}>
                    {(machine?.name ?? "máquina") + " · " + (online ? "online" : "offline")}
                  </Text>
                </View>
                <Text style={styles.badge}>{STATUS_LABEL[item.status]}</Text>
              </Pressable>
            );
          }}
        />
      )}
      <Text style={styles.pushHint} numberOfLines={1}>
        {`🔔 Push (dev): suscríbete en ntfy.sh al topic ${ntfyTopicFor(userId)}`}
      </Text>

      <NewTaskModal
        visible={showNew}
        machines={Object.values(machines)}
        onClose={() => setShowNew(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingTop: 48 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  headerText: { flexShrink: 1 },
  title: { fontSize: 24, fontWeight: "700" },
  muted: { fontSize: 13, color: "#666" },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 4 },
  newButton: {
    backgroundColor: "#2563eb",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  newButtonText: { color: "white", fontWeight: "700" },
  signOut: { paddingHorizontal: 12, paddingVertical: 8 },
  signOutText: { color: "#2563eb", fontWeight: "600" },
  pushHint: { fontSize: 11, color: "#94a3b8", textAlign: "center", paddingVertical: 6 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 6, padding: 24 },
  list: { paddingHorizontal: 16, gap: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: "#eee",
    borderRadius: 10,
    padding: 14,
    gap: 12,
  },
  rowMain: { flexShrink: 1, gap: 2 },
  rowTitle: { fontSize: 16, fontWeight: "600" },
  badge: {
    fontSize: 12,
    color: "#334155",
    backgroundColor: "#f1f5f9",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: "hidden",
  },
});
