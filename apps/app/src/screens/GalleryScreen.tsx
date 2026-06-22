import type { ArtifactKind, Event } from "@pulpo/protocol";
import { useEffect, useMemo, useState } from "react";
import {
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { downloadAll, downloadArtifact, resolveArtifactUrl } from "../lib/artifacts";
import {
  artifactLabel,
  collectArtifacts,
  filterByKind,
  kindCounts,
  kindIcon,
  type GalleryItem,
  type KindFilter,
} from "../lib/gallery";
import type { Palette } from "../lib/theme";
import { useThemedStyles } from "../lib/theme-context";

const KIND_LABEL: Record<ArtifactKind, string> = {
  text: "Texto",
  image: "Imágenes",
  audio: "Audio",
  video: "Vídeo",
  file: "Otros",
};

export function GalleryScreen({
  events,
  title,
  onBack,
}: {
  events: Event[];
  title: string;
  onBack: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const all = useMemo(() => collectArtifacts(events), [events]);
  const counts = useMemo(() => kindCounts(all), [all]);
  const [filter, setFilter] = useState<KindFilter>("all");
  const [preview, setPreview] = useState<GalleryItem | null>(null);
  const [busy, setBusy] = useState(false);

  const items = useMemo(() => filterByKind(all, filter), [all, filter]);
  const kinds = (Object.keys(KIND_LABEL) as ArtifactKind[]).filter((k) => counts[k] > 0);

  const downloadVisible = async (): Promise<void> => {
    setBusy(true);
    try {
      await downloadAll(items.map((i) => i.artifact));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.back}>
          <Text style={styles.backText}>‹ Atrás</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          Galería · {title}
        </Text>
      </View>

      {all.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.muted}>Esta sesión no ha generado recursos todavía.</Text>
        </View>
      ) : (
        <>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filters}
          >
            <Chip
              label={`Todos · ${all.length}`}
              on={filter === "all"}
              onPress={() => setFilter("all")}
            />
            {kinds.map((k) => (
              <Chip
                key={k}
                label={`${kindIcon(k)} ${KIND_LABEL[k]} · ${counts[k]}`}
                on={filter === k}
                onPress={() => setFilter(k)}
              />
            ))}
          </ScrollView>

          <FlatList
            data={items}
            keyExtractor={(i) => i.id}
            numColumns={2}
            columnWrapperStyle={styles.gridRow}
            contentContainerStyle={styles.grid}
            renderItem={({ item }) => <GalleryCard item={item} onOpen={() => setPreview(item)} />}
          />

          <Pressable
            onPress={() => void downloadVisible()}
            disabled={busy || items.length === 0}
            style={[styles.downloadAll, (busy || items.length === 0) && styles.disabled]}
          >
            <Text style={styles.downloadAllText}>
              {busy ? "Descargando…" : `Descargar todo (${items.length})`}
            </Text>
          </Pressable>
        </>
      )}

      <PreviewModal item={preview} onClose={() => setPreview(null)} />
    </View>
  );
}

function GalleryCard({ item, onOpen }: { item: GalleryItem; onOpen: () => void }) {
  const styles = useThemedStyles(makeStyles);
  const [thumb, setThumb] = useState<string | null>(null);
  const isImage = item.artifact.kind === "image";

  useEffect(() => {
    if (!isImage) return;
    let active = true;
    void resolveArtifactUrl(item.artifact.ref).then((url) => {
      if (active) setThumb(url);
    });
    return () => {
      active = false;
    };
  }, [item.artifact.ref, isImage]);

  return (
    <Pressable style={styles.card} onPress={onOpen}>
      {isImage && thumb ? (
        <Image source={{ uri: thumb }} style={styles.thumb} resizeMode="cover" />
      ) : (
        <View style={[styles.thumb, styles.thumbIcon]}>
          <Text style={styles.icon}>{kindIcon(item.artifact.kind)}</Text>
        </View>
      )}
      <Text style={styles.cardName} numberOfLines={1}>
        {item.artifact.name}
      </Text>
      <Text style={styles.cardMeta} numberOfLines={1}>
        {artifactLabel(item.artifact)}
      </Text>
    </Pressable>
  );
}

function PreviewModal({ item, onClose }: { item: GalleryItem | null; onClose: () => void }) {
  const styles = useThemedStyles(makeStyles);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    setUrl(null);
    if (!item) return;
    let active = true;
    void resolveArtifactUrl(item.artifact.ref).then((resolved) => {
      if (active) setUrl(resolved);
    });
    return () => {
      active = false;
    };
  }, [item]);

  return (
    <Modal visible={item !== null} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.previewBackdrop}>
        <Pressable style={styles.previewClose} onPress={onClose}>
          <Text style={styles.previewCloseText}>✕</Text>
        </Pressable>
        {item ? (
          <>
            {item.artifact.kind === "image" && url ? (
              <Image source={{ uri: url }} style={styles.previewImage} resizeMode="contain" />
            ) : (
              <View style={styles.previewIconWrap}>
                <Text style={styles.previewIcon}>{kindIcon(item.artifact.kind)}</Text>
                <Text style={styles.previewName} numberOfLines={2}>
                  {item.artifact.name}
                </Text>
                <Text style={styles.previewMeta}>{artifactLabel(item.artifact)}</Text>
              </View>
            )}
            <Pressable
              style={styles.previewDownload}
              onPress={() => void downloadArtifact(item.artifact)}
            >
              <Text style={styles.previewDownloadText}>Descargar</Text>
            </Pressable>
          </>
        ) : null}
      </View>
    </Modal>
  );
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable onPress={onPress} style={[styles.chip, on && styles.chipOn]}>
      <Text style={on ? styles.chipOnText : styles.chipText}>{label}</Text>
    </Pressable>
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
    center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
    muted: { color: p.muted },
    filters: { paddingHorizontal: 16, gap: 8, paddingBottom: 8 },
    chip: {
      borderWidth: 1,
      borderColor: p.inputBorder,
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    chipOn: { backgroundColor: p.primary, borderColor: p.primary },
    chipText: { color: p.badgeText },
    chipOnText: { color: p.primaryText, fontWeight: "600" },
    grid: { paddingHorizontal: 12, paddingBottom: 12, gap: 12 },
    gridRow: { gap: 12 },
    card: {
      flex: 1,
      borderWidth: 1,
      borderColor: p.border,
      borderRadius: 10,
      overflow: "hidden",
      padding: 8,
      gap: 4,
      backgroundColor: p.card,
    },
    thumb: { width: "100%", height: 120, borderRadius: 8, backgroundColor: p.badgeBg },
    thumbIcon: { alignItems: "center", justifyContent: "center" },
    icon: { fontSize: 40 },
    cardName: { fontWeight: "600", fontSize: 13, color: p.text },
    cardMeta: { color: p.muted, fontSize: 11 },
    downloadAll: {
      margin: 12,
      backgroundColor: p.primary,
      paddingVertical: 14,
      borderRadius: 10,
      alignItems: "center",
    },
    downloadAllText: { color: p.primaryText, fontWeight: "700", fontSize: 15 },
    disabled: { opacity: 0.5 },
    previewBackdrop: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.9)",
      alignItems: "center",
      justifyContent: "center",
      padding: 16,
    },
    previewClose: { position: "absolute", top: 48, right: 20, padding: 8 },
    previewCloseText: { color: "white", fontSize: 24, fontWeight: "700" },
    previewImage: { width: "100%", height: "70%" },
    previewIconWrap: { alignItems: "center", gap: 8 },
    previewIcon: { fontSize: 80 },
    previewName: { color: "white", fontSize: 18, fontWeight: "600", textAlign: "center" },
    previewMeta: { color: "#cbd5e1", fontSize: 13 },
    previewDownload: {
      marginTop: 24,
      backgroundColor: p.primary,
      paddingHorizontal: 28,
      paddingVertical: 12,
      borderRadius: 10,
    },
    previewDownloadText: { color: p.primaryText, fontWeight: "700", fontSize: 15 },
  });
