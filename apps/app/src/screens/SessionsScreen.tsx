import { type Machine, type Session } from "@batuta/protocol";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { backend } from "../lib/backend";
import { groupByMachine } from "../lib/grouping";
import { ntfyTopicFor } from "../lib/push";
import { filterSessions } from "../lib/search";
import { upsertSession } from "../lib/sessions";
import { themeIcon, type Palette } from "../lib/theme";
import { useThemeContext } from "../lib/theme-context";
import { NewTaskModal } from "./NewTaskModal";
import { PairModal } from "./PairModal";

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
  const { palette, preference, cycle } = useThemeContext();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [machines, setMachines] = useState<Record<string, Machine>>({});
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [showPair, setShowPair] = useState(false);
  const [query, setQuery] = useState("");

  const reloadMachines = async (): Promise<void> => {
    const machineList = await backend.listMachines();
    setMachines(Object.fromEntries(machineList.map((m) => [m.id, m])) as Record<string, Machine>);
  };

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
      groupByMachine(Object.values(machines), filterSessions(sessions, query)).map((g) => ({
        key: g.machine?.id ?? "unknown",
        machine: g.machine,
        online: g.online,
        data: g.sessions,
      })),
    [machines, sessions, query],
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
          <Pressable onPress={cycle} style={styles.iconBtn}>
            <Text style={styles.iconText}>{themeIcon(preference)}</Text>
          </Pressable>
          <Pressable onPress={() => setShowPair(true)} style={styles.iconBtn}>
            <Text style={styles.iconText}>🔗</Text>
          </Pressable>
          <Pressable onPress={() => setShowNew(true)} style={styles.newButton}>
            <Text style={styles.newButtonText}>+ Nueva</Text>
          </Pressable>
          <Pressable onPress={onSignOut} style={styles.signOut}>
            <Text style={styles.signOutText}>Salir</Text>
          </Pressable>
        </View>
      </View>

      <TextInput
        style={styles.search}
        value={query}
        onChangeText={setQuery}
        placeholder="Buscar en el historial…"
        placeholderTextColor={palette.muted}
        autoCapitalize="none"
        clearButtonMode="while-editing"
      />

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
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.muted}>
                {query ? "Sin resultados para tu búsqueda." : "No hay PCs emparejadas todavía."}
              </Text>
              {query ? null : (
                <Pressable onPress={() => setShowPair(true)} style={styles.pairCta}>
                  <Text style={styles.pairCtaText}>🔗 Emparejar una PC</Text>
                </Pressable>
              )}
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

      <PairModal
        visible={showPair}
        onClose={() => setShowPair(false)}
        onPaired={() => void reloadMachines()}
      />
    </View>
  );
}

const makeStyles = (p: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, paddingTop: 48, backgroundColor: p.bg },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 20,
      paddingBottom: 12,
    },
    headerText: { flexShrink: 1 },
    title: { fontSize: 24, fontWeight: "700", color: p.text },
    muted: { fontSize: 13, color: p.muted },
    headerActions: { flexDirection: "row", alignItems: "center", gap: 4 },
    iconBtn: { paddingHorizontal: 8, paddingVertical: 8 },
    iconText: { fontSize: 18 },
    newButton: {
      backgroundColor: p.primary,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 8,
    },
    newButtonText: { color: p.primaryText, fontWeight: "700" },
    signOut: { paddingHorizontal: 12, paddingVertical: 8 },
    signOutText: { color: p.primary, fontWeight: "600" },
    search: {
      marginHorizontal: 16,
      marginBottom: 8,
      borderWidth: 1,
      borderColor: p.inputBorder,
      borderRadius: 999,
      paddingHorizontal: 14,
      paddingVertical: 8,
      color: p.text,
    },
    pushHint: { fontSize: 11, color: p.muted, textAlign: "center", paddingVertical: 6 },
    center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 24 },
    pairCta: {
      backgroundColor: p.primary,
      paddingHorizontal: 18,
      paddingVertical: 12,
      borderRadius: 10,
    },
    pairCtaText: { color: p.primaryText, fontWeight: "700" },
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
    dotOff: { backgroundColor: p.border },
    machineName: { fontSize: 13, fontWeight: "700", color: p.text, flexShrink: 1 },
    machineMeta: { fontSize: 12, color: p.muted, marginLeft: "auto" },
    emptyHint: { fontSize: 12, color: p.muted, paddingVertical: 8, paddingLeft: 16 },
    row: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      borderWidth: 1,
      borderColor: p.border,
      borderRadius: 10,
      padding: 14,
      gap: 12,
      marginTop: 8,
      backgroundColor: p.card,
    },
    rowMain: { flexShrink: 1, gap: 2 },
    rowTitle: { fontSize: 16, fontWeight: "600", color: p.text },
    badge: {
      fontSize: 12,
      color: p.badgeText,
      backgroundColor: p.badgeBg,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 999,
      overflow: "hidden",
    },
  });
