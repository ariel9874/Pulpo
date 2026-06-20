import {
  boxOpen,
  openSealed,
  type Artifact,
  type EncryptedPayload,
  type Event,
  type Session,
} from "@batuta/protocol";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
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
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { MarkdownMessage } from "../components/MarkdownMessage";
import { resolveArtifactUrl } from "../lib/artifacts";
import { backend } from "../lib/backend";
import { sendSignedCommand } from "../lib/commands";
import { getBoxSecretKey } from "../lib/enc-key";
import { appendEvents } from "../lib/events";
import { getRunnerBoxPublic } from "../lib/runner-keys";
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

  // Auto-scroll: seguimos el último mensaje mientras el usuario esté cerca del
  // fondo; si subió a leer historial, no lo arrastramos al llegar algo nuevo.
  const listRef = useRef<FlatList<Event>>(null);
  const atBottom = useRef(true);
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    atBottom.current = contentSize.height - contentOffset.y - layoutMeasurement.height < 80;
  }, []);
  const followIfAtBottom = useCallback(() => {
    if (atBottom.current) listRef.current?.scrollToEnd({ animated: true });
  }, []);

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
    // Al enviar, volvemos a "seguir el fondo" aunque hubiéramos subido a leer.
    atBottom.current = true;
    listRef.current?.scrollToEnd({ animated: true });
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
          ref={listRef}
          style={styles.flex}
          data={events}
          keyExtractor={(e) => e.id}
          extraData={pending}
          contentContainerStyle={styles.list}
          onScroll={onScroll}
          scrollEventThrottle={16}
          onContentSizeChange={followIfAtBottom}
          ListEmptyComponent={<Text style={styles.muted}>Sin actividad todavía.</Text>}
          renderItem={({ item }) =>
            item.type === "permission_required" ? (
              <PermissionView
                event={item}
                isPending={pending.has(item.permissionId)}
                onDecide={decide}
                machineId={session.machineId}
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
      return <Bubble role={event.role} text={event.text} ts={event.ts} />;
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
  machineId,
}: {
  event: Extract<Event, { type: "permission_required" }>;
  isPending: boolean;
  onDecide: (permissionId: string, decision: "approve" | "reject") => void;
  machineId: string;
}) {
  const styles = useThemedStyles(makeStyles);
  const [diff, setDiff] = useState<string | null>(
    event.diff?.type === "inline" ? event.diff.content : null,
  );
  useEffect(() => {
    if (event.diff?.type !== "encrypted") return;
    const payload: EncryptedPayload = event.diff;
    let active = true;
    void (async () => {
      const secret = await getBoxSecretKey();
      let text: string | null;
      if (payload.alg === "nacl-box") {
        // Autenticado: verifica que vino del runner anclado al emparejar.
        const senderPublic = await getRunnerBoxPublic(machineId);
        text = senderPublic ? boxOpen(payload, senderPublic, secret) : null;
      } else {
        text = openSealed(payload, secret);
      }
      if (active) setDiff(text ?? "[no se pudo descifrar/autenticar el diff]");
    })();
    return () => {
      active = false;
    };
  }, [event.diff, machineId]);
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

const ROLE_LABEL: Record<"agent" | "user" | "system", string> = {
  agent: "Agente",
  user: "Tú",
  system: "Sistema",
};

/** Altura máxima (px) de una respuesta antes de recortarla con "Ver más". */
const COLLAPSED_MAX = 360;

function formatTime(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function Bubble({
  role,
  text,
  ts,
}: {
  role: "agent" | "user" | "system";
  text: string;
  ts: string;
}) {
  const { palette } = useThemeContext();
  const styles = useThemedStyles(makeStyles);
  const mine = role === "user";
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async (): Promise<void> => {
    await Clipboard.setStringAsync(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [text]);

  // Colapso: las respuestas muy largas se recortan a una altura máxima y se
  // expanden con "Ver más". Medimos la altura natural del contenido (overflow
  // hidden recorta el pintado, no el layout) para decidir si mostrar el toggle.
  const [expanded, setExpanded] = useState(false);
  const [contentHeight, setContentHeight] = useState<number | null>(null);
  const canCollapse = contentHeight !== null && contentHeight > COLLAPSED_MAX;
  return (
    <View style={[styles.bubble, mine && styles.bubbleUser]}>
      <View style={styles.bubbleHeader}>
        <Text style={[styles.bubbleLabel, mine && styles.bubbleOnPrimary]}>{ROLE_LABEL[role]}</Text>
        <View style={styles.bubbleHeaderRight}>
          <Text style={[styles.bubbleTime, mine && styles.bubbleOnPrimary]}>{formatTime(ts)}</Text>
          <Pressable onPress={() => void copy()} hitSlop={8} style={styles.copyBtn}>
            <Text style={[styles.copyText, mine && styles.bubbleOnPrimary]}>
              {copied ? "✓ Copiado" : "⧉ Copiar"}
            </Text>
          </Pressable>
        </View>
      </View>
      {mine ? (
        <Text style={[styles.bubbleText, styles.bubbleOnPrimary]} selectable>
          {text}
        </Text>
      ) : (
        <>
          <View style={[styles.collapsible, !expanded && { maxHeight: COLLAPSED_MAX }]}>
            <View onLayout={(e) => setContentHeight(e.nativeEvent.layout.height)}>
              <MarkdownMessage text={text} palette={palette} />
            </View>
          </View>
          {canCollapse ? (
            <Pressable onPress={() => setExpanded((v) => !v)} hitSlop={6} style={styles.moreBtn}>
              <Text style={styles.moreText}>{expanded ? "Ver menos ▲" : "Ver más ▼"}</Text>
            </Pressable>
          ) : null}
        </>
      )}
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
    bubble: {
      backgroundColor: p.badgeBg,
      borderRadius: 10,
      padding: 12,
      gap: 2,
      alignSelf: "flex-start",
      maxWidth: "92%",
    },
    bubbleUser: { alignSelf: "flex-end", backgroundColor: p.primary },
    bubbleOnPrimary: { color: p.primaryText },
    bubbleHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
      marginBottom: 2,
    },
    bubbleHeaderRight: { flexDirection: "row", alignItems: "center", gap: 10 },
    bubbleLabel: { fontSize: 11, color: p.muted, textTransform: "uppercase" },
    bubbleTime: { fontSize: 11, color: p.muted, opacity: 0.8 },
    copyBtn: { paddingVertical: 2 },
    copyText: { fontSize: 11, color: p.muted, fontWeight: "600" },
    collapsible: { overflow: "hidden" },
    moreBtn: { alignSelf: "flex-start", marginTop: 6, paddingVertical: 2 },
    moreText: { fontSize: 13, color: p.primary, fontWeight: "600" },
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
