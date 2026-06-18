import { type Machine, type Session } from "@batuta/protocol";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, SectionList, StyleSheet, Text, View } from "react-native";
import { backend } from "../lib/backend";
import { groupByMachine } from "../lib/grouping";
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

interface Section {
  key: string;
  machine: Machine | null;
  online: boolean;
  data: Session[];
}

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

  const sections: Section[] = useMemo(
    () =>
      groupByMachine(Object.values(machines), sessions).map((g) => ({
        key: g.machine?.id ?? "unknown",
        machine: g.machine,
        online: g.online,
        data: g.sessions,
      })),
    [machines, sessions],
  );

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
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(s) => s.id}
          contentContainerStyle={styles.list}
          stickySectionHeadersEnabled={false}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.muted}>No hay PCs emparejadas todavía.</Text>
              <Text style={styles.muted}>Ejecuta el runner (pair) para conectar una.</Text>
            </View>
          }
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
              <View style={[styles.dot, section.online ? styles.dotOn : styles.dotOff]} />
              <Text style={styles.machineName} numberOfLines={1}>
                {section.machine?.name ?? "Máquina desconocida"}
              </Text>
              <Text style={styles.machineMeta}>
                {section.online ? "online" : "offline"} · {section.data.length}
              </Text>
            </View>
          )}
          renderSectionFooter={({ section }) =>
            section.data.length === 0 ? (
              <Text style={styles.emptyHint}>Sin sesiones — pulsa «+ Nueva».</Text>
            ) : null
          }
          renderItem={({ item }) => (
            <Pressable style={styles.row} onPress={() => onOpen(item)}>
              <View style={styles.rowMain}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {item.title || "(sin título)"}
                </Text>
                <Text style={styles.muted}>{item.agentType}</Text>
              </View>
              <Text style={styles.badge}>{STATUS_LABEL[item.status]}</Text>
            </Pressable>
          )}
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
  list: { paddingHorizontal: 16, paddingBottom: 8 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingTop: 16,
    paddingBottom: 6,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotOn: { backgroundColor: "#16a34a" },
  dotOff: { backgroundColor: "#cbd5e1" },
  machineName: { fontSize: 13, fontWeight: "700", color: "#0f172a", flexShrink: 1 },
  machineMeta: { fontSize: 12, color: "#94a3b8", marginLeft: "auto" },
  emptyHint: { fontSize: 12, color: "#94a3b8", paddingVertical: 8, paddingLeft: 16 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: "#eee",
    borderRadius: 10,
    padding: 14,
    gap: 12,
    marginTop: 8,
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
