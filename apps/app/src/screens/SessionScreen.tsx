import type { Artifact, Event, Session } from "@batuta/protocol";
import { useEffect, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { resolveArtifactUrl } from "../lib/artifacts";
import { backend } from "../lib/backend";
import { appendEvents } from "../lib/events";

export function SessionScreen({ session, onBack }: { session: Session; onBack: () => void }) {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void backend.listEvents(session.id).then((list) => {
      if (!active) return;
      setEvents(list);
      setLoading(false);
    });
    const unsubscribe = backend.subscribeEvents(session.id, (event) =>
      setEvents((prev) => appendEvents(prev, event)),
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [session.id]);

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.back}>
          <Text style={styles.backText}>‹ Atrás</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {session.title || "Sesión"}
        </Text>
      </View>
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : (
        <FlatList
          data={events}
          keyExtractor={(e) => e.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.muted}>Sin actividad todavía.</Text>}
          renderItem={({ item }) => <EventRow event={item} />}
        />
      )}
    </View>
  );
}

function EventRow({ event }: { event: Event }) {
  switch (event.type) {
    case "message":
      return <Bubble label={event.role} text={event.text} />;
    case "thought":
      return <Line muted>{`💭 ${event.text}`}</Line>;
    case "tool_call":
      return <Line>{`🔧 ${event.title} · ${event.status}`}</Line>;
    case "plan_step":
      return <Line>{`• ${event.step} (${event.state})`}</Line>;
    case "permission_required":
      return <Line>{`🔐 Permiso: ${event.summary}`}</Line>;
    case "question":
      return <Line>{`❓ ${event.question}`}</Line>;
    case "task_done":
      return <Line>{`${event.outcome === "completed" ? "✓" : "■"} Tarea ${event.outcome}`}</Line>;
    case "error":
      return <Line warn>{`⚠️ ${event.message}`}</Line>;
    case "artifact":
      return <ArtifactView artifact={event.artifact} />;
  }
}

function ArtifactView({ artifact }: { artifact: Artifact }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void resolveArtifactUrl(artifact.ref).then((resolved) => {
      if (active) setUrl(resolved);
    });
    return () => {
      active = false;
    };
  }, [artifact.ref]);

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{`📎 ${artifact.name} · ${artifact.kind}`}</Text>
      {artifact.kind === "image" && url ? (
        <Image source={{ uri: url }} style={styles.image} resizeMode="contain" />
      ) : null}
      {url ? (
        <Pressable onPress={() => void Linking.openURL(url)}>
          <Text style={styles.link}>Abrir / descargar</Text>
        </Pressable>
      ) : (
        <Text style={styles.muted}>resolviendo…</Text>
      )}
    </View>
  );
}

function Line({ children, muted, warn }: { children: ReactNode; muted?: boolean; warn?: boolean }) {
  return (
    <Text style={[styles.line, muted ? styles.muted : null, warn ? styles.warn : null]}>
      {children}
    </Text>
  );
}

function Bubble({ label, text }: { label: string; text: string }) {
  return (
    <View style={styles.bubble}>
      <Text style={styles.bubbleLabel}>{label}</Text>
      <Text style={styles.bubbleText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingTop: 48 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  back: { paddingHorizontal: 8, paddingVertical: 6 },
  backText: { color: "#2563eb", fontWeight: "600", fontSize: 16 },
  title: { fontSize: 20, fontWeight: "700", flexShrink: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: { paddingHorizontal: 16, paddingBottom: 24, gap: 8 },
  muted: { color: "#666" },
  warn: { color: "#b00020" },
  line: { fontSize: 14 },
  bubble: { backgroundColor: "#f1f5f9", borderRadius: 10, padding: 12, gap: 2 },
  bubbleLabel: { fontSize: 11, color: "#64748b", textTransform: "uppercase" },
  bubbleText: { fontSize: 15 },
  card: { borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 10, padding: 12, gap: 8 },
  cardTitle: { fontWeight: "600" },
  image: { width: "100%", height: 220, backgroundColor: "#f8fafc", borderRadius: 8 },
  link: { color: "#2563eb", fontWeight: "600" },
});
