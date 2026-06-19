import {
  openSealed,
  type Artifact,
  type EncryptedPayload,
  type Event,
  type Session,
} from "@batuta/protocol";
import { useEffect, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { resolveArtifactUrl } from "../lib/artifacts";
import { backend } from "../lib/backend";
import { sendSignedCommand } from "../lib/commands";
import { getBoxSecretKey } from "../lib/enc-key";
import { appendEvents } from "../lib/events";
import type { Palette } from "../lib/theme";
import { useThemeContext, useThemedStyles } from "../lib/theme-context";
import { GalleryScreen } from "./GalleryScreen";

export function SessionScreen({ session, onBack }: { session: Session; onBack: () => void }) {
  const { palette } = useThemeContext();
  const styles = useThemedStyles(makeStyles);
  const [events, setEvents] = useState<Event[]>([]);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [showGallery, setShowGallery] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      const [list, perms] = await Promise.all([
        backend.listEvents(session.id),
        backend.listPendingPermissions(session.id),
      ]);
      if (!active) return;
      setEvents(list);
      setPending(new Set(perms.map((p) => p.id)));
      setLoading(false);
    })();
    const unsubscribe = backend.subscribeEvents(session.id, (event) => {
      setEvents((prev) => appendEvents(prev, event));
      if (event.type === "permission_required") {
        setPending((prev) => new Set(prev).add(event.permissionId));
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [session.id]);

  const [draft, setDraft] = useState("");

  const decide = (permissionId: string, decision: "approve" | "reject") => {
    setPending((prev) => {
      const next = new Set(prev);
      next.delete(permissionId);
      return next;
    });
    void sendSignedCommand({ type: decision, sessionId: session.id, permissionId });
  };

  const send = async (): Promise<void> => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    await sendSignedCommand({ type: "send_message", sessionId: session.id, text });
  };

  const cancelTask = (): void => void sendSignedCommand({ type: "cancel", sessionId: session.id });

  if (showGallery) {
    return (
      <GalleryScreen
        events={events}
        title={session.title || "Sesión"}
        onBack={() => setShowGallery(false)}
      />
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.back}>
          <Text style={styles.backText}>‹ Atrás</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {session.title || "Sesión"}
        </Text>
        <Pressable onPress={() => setShowGallery(true)} style={styles.gallery}>
          <Text style={styles.galleryText}>🖼 Galería</Text>
        </Pressable>
      </View>
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={palette.primary} />
        </View>
      ) : (
        <FlatList
          style={styles.flex}
          data={events}
          keyExtractor={(e) => e.id}
          extraData={pending}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.muted}>Sin actividad todavía.</Text>}
          renderItem={({ item }) =>
            item.type === "permission_required" ? (
              <PermissionView
                event={item}
                isPending={pending.has(item.permissionId)}
                onDecide={decide}
              />
            ) : (
              <EventRow event={item} />
            )
          }
        />
      )}

      <View style={styles.footer}>
        <Pressable onPress={cancelTask} style={styles.cancelTask}>
          <Text style={styles.cancelTaskText}>Cancelar</Text>
        </Pressable>
        <TextInput
          style={styles.composer}
          value={draft}
          onChangeText={setDraft}
          placeholder="Mensaje a Claude…"
          placeholderTextColor={palette.muted}
          onSubmitEditing={() => void send()}
        />
        <Pressable
          onPress={() => void send()}
          disabled={!draft.trim()}
          style={[styles.sendBtn, !draft.trim() && styles.sendDisabled]}
        >
          <Text style={styles.sendText}>Enviar</Text>
        </Pressable>
      </View>
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
  const styles = useThemedStyles(makeStyles);
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

function PermissionView({
  event,
  isPending,
  onDecide,
}: {
  event: Extract<Event, { type: "permission_required" }>;
  isPending: boolean;
  onDecide: (permissionId: string, decision: "approve" | "reject") => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const [diff, setDiff] = useState<string | null>(
    event.diff?.type === "inline" ? event.diff.content : null,
  );
  useEffect(() => {
    if (event.diff?.type !== "encrypted") return;
    const payload: EncryptedPayload = event.diff;
    let active = true;
    void getBoxSecretKey().then((secret) => {
      if (active) setDiff(openSealed(payload, secret) ?? "[no se pudo descifrar el diff]");
    });
    return () => {
      active = false;
    };
  }, [event.diff]);
  return (
    <View style={styles.permission}>
      <Text style={styles.permTitle}>{`🔐 ${event.summary || event.tool}`}</Text>
      {diff ? <Text style={styles.diff}>{diff}</Text> : null}
      {isPending ? (
        <View style={styles.permActions}>
          <Pressable
            style={[styles.btn, styles.approve]}
            onPress={() => onDecide(event.permissionId, "approve")}
          >
            <Text style={styles.btnText}>Aprobar</Text>
          </Pressable>
          <Pressable
            style={[styles.btn, styles.reject]}
            onPress={() => onDecide(event.permissionId, "reject")}
          >
            <Text style={styles.btnText}>Rechazar</Text>
          </Pressable>
        </View>
      ) : (
        <Text style={styles.muted}>decisión registrada</Text>
      )}
    </View>
  );
}

function Line({ children, muted, warn }: { children: ReactNode; muted?: boolean; warn?: boolean }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Text style={[styles.line, muted ? styles.muted : null, warn ? styles.warn : null]}>
      {children}
    </Text>
  );
}

function Bubble({ label, text }: { label: string; text: string }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.bubble}>
      <Text style={styles.bubbleLabel}>{label}</Text>
      <Text style={styles.bubbleText}>{text}</Text>
    </View>
  );
}

const makeStyles = (p: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, paddingTop: 48, backgroundColor: p.bg },
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: 12,
      paddingBottom: 12,
    },
    back: { paddingHorizontal: 8, paddingVertical: 6 },
    backText: { color: p.primary, fontWeight: "600", fontSize: 16 },
    title: { fontSize: 20, fontWeight: "700", flexShrink: 1, color: p.text },
    gallery: { marginLeft: "auto", paddingHorizontal: 8, paddingVertical: 6 },
    galleryText: { color: p.primary, fontWeight: "600" },
    center: { flex: 1, alignItems: "center", justifyContent: "center" },
    list: { paddingHorizontal: 16, paddingBottom: 24, gap: 8 },
    muted: { color: p.muted },
    warn: { color: "#ef4444" },
    line: { fontSize: 14, color: p.text },
    bubble: { backgroundColor: p.badgeBg, borderRadius: 10, padding: 12, gap: 2 },
    bubbleLabel: { fontSize: 11, color: p.muted, textTransform: "uppercase" },
    bubbleText: { fontSize: 15, color: p.text },
    card: { borderWidth: 1, borderColor: p.border, borderRadius: 10, padding: 12, gap: 8 },
    cardTitle: { fontWeight: "600", color: p.text },
    image: { width: "100%", height: 220, backgroundColor: p.badgeBg, borderRadius: 8 },
    link: { color: p.primary, fontWeight: "600" },
    permission: {
      borderWidth: 1,
      borderColor: "#f59e0b",
      backgroundColor: p.badgeBg,
      borderRadius: 10,
      padding: 12,
      gap: 8,
    },
    permTitle: { fontWeight: "700", color: p.text },
    diff: {
      fontFamily: "monospace",
      fontSize: 12,
      backgroundColor: "#0f172a",
      color: "#e2e8f0",
      padding: 10,
      borderRadius: 8,
    },
    permActions: { flexDirection: "row", gap: 10 },
    btn: { flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: 8 },
    approve: { backgroundColor: "#16a34a" },
    reject: { backgroundColor: "#dc2626" },
    btnText: { color: "white", fontWeight: "700" },
    flex: { flex: 1 },
    footer: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderTopWidth: 1,
      borderTopColor: p.border,
    },
    cancelTask: { paddingHorizontal: 8, paddingVertical: 8 },
    cancelTaskText: { color: "#dc2626", fontWeight: "600" },
    composer: {
      flex: 1,
      borderWidth: 1,
      borderColor: p.inputBorder,
      borderRadius: 999,
      paddingHorizontal: 14,
      paddingVertical: 8,
      color: p.text,
    },
    sendBtn: {
      backgroundColor: p.primary,
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: 999,
    },
    sendDisabled: { opacity: 0.5 },
    sendText: { color: p.primaryText, fontWeight: "700" },
  });
