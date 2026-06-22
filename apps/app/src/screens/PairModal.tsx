import { useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { claimDevice } from "../lib/pairing";
import type { Palette } from "../lib/theme";
import { useThemeContext, useThemedStyles } from "../lib/theme-context";

export function PairModal({
  visible,
  onClose,
  onPaired,
}: {
  visible: boolean;
  onClose: () => void;
  onPaired: () => void;
}) {
  const { palette } = useThemeContext();
  const styles = useThemedStyles(makeStyles);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = (): void => {
    setCode("");
    setError(null);
    onClose();
  };

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await claimDevice(code);
      setCode("");
      onPaired();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo emparejar.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Emparejar una PC</Text>
          <Text style={styles.muted}>
            En tu PC ejecuta «pulpo-runner pair» y escribe aquí el código que muestra.
          </Text>
          <TextInput
            style={styles.input}
            value={code}
            onChangeText={setCode}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="A1B2C3D4"
            placeholderTextColor={palette.muted}
            maxLength={16}
            onSubmitEditing={() => void submit()}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <View style={styles.actions}>
            <Pressable onPress={close} style={styles.cancelBtn}>
              <Text style={styles.cancelText}>Cancelar</Text>
            </Pressable>
            <Pressable
              onPress={() => void submit()}
              disabled={busy || code.trim().length === 0}
              style={[styles.pairBtn, (busy || code.trim().length === 0) && styles.disabled]}
            >
              {busy ? (
                <ActivityIndicator color={palette.primaryText} />
              ) : (
                <Text style={styles.pairText}>Emparejar</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (p: Palette) =>
  StyleSheet.create({
    backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" },
    sheet: {
      backgroundColor: p.card,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      padding: 20,
      gap: 10,
    },
    title: { fontSize: 20, fontWeight: "700", color: p.text },
    muted: { color: p.muted, fontSize: 13 },
    input: {
      borderWidth: 1,
      borderColor: p.inputBorder,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 12,
      fontSize: 20,
      letterSpacing: 4,
      textAlign: "center",
      color: p.text,
    },
    error: { color: "#ef4444" },
    actions: { flexDirection: "row", justifyContent: "flex-end", gap: 12, marginTop: 4 },
    cancelBtn: { paddingHorizontal: 16, paddingVertical: 12 },
    cancelText: { color: p.muted, fontWeight: "600" },
    pairBtn: {
      backgroundColor: p.primary,
      paddingHorizontal: 20,
      paddingVertical: 12,
      borderRadius: 8,
      minWidth: 110,
      alignItems: "center",
    },
    pairText: { color: p.primaryText, fontWeight: "700" },
    disabled: { opacity: 0.5 },
  });
